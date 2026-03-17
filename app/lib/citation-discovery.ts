/**
 * Phase 3：Citation Discovery 库
 *
 * 三个函数：
 *   1. discoverUrlsViaCitations  — 多 LLM 并行 enable_search，只收 citations[]（Step 1）
 *   2. extractViaUrlContext      — url_context 直接提取结构化数据（Step 2 路径A）
 *   3. mergeAndRankUrls         — URL 合并去重排序工具（复用 web-search.ts 评分规则）
 *
 * 控制开关（.env.local）：
 *   PHASE3_CITATION_DISCOVERY_ENABLED=false  — Phase 3 总开关
 *   PHASE3_DISCOVERY_MODELS=glm-5-turbo,qwen3.5-plus  — Step1 并行模型
 *   PHASE3_URL_CONTEXT_MODEL=gemini-3.1-pro-preview   — Step2 url_context 模型
 *   PHASE3_URL_CONTEXT_SUPPORTED=false                — 由验证脚本结果手动设置
 */

import { extractJSON } from '@/app/lib/utils'

// ─── 类型定义 ───────────────────────────────────────────────

type DiscoveryDimension = 'standard_colors' | 'school_song' | 'emblem' | 'history'

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: { content?: string }
  }>
  citations?: string[]
}

// ─── 辅助函数 ──────────────────────────────────────────────

function getDiscoveryModels(): string[] {
  const raw = process.env.PHASE3_DISCOVERY_MODELS || 'glm-5-turbo,qwen3.5-plus'
  return raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
}

function getUrlContextModel(): string {
  return process.env.PHASE3_URL_CONTEXT_MODEL || 'gemini-3.1-pro-preview'
}

function isUrlContextSupported(): boolean {
  return process.env.PHASE3_URL_CONTEXT_SUPPORTED === 'true'
}

function buildDiscoveryPrompt(schoolName: string, dimension: DiscoveryDimension): string {
  const dimensionDesc: Record<DiscoveryDimension, string> = {
    standard_colors: '标准校色（校徽颜色、品牌色、HEX 值）',
    school_song: '校歌（校歌名称、歌词）',
    emblem: '校徽（校徽官方释义、图形构成）',
    history: '校史（发展历史、大事记、重要事件）',
  }
  const desc = dimensionDesc[dimension]
  return `请搜索【${schoolName}】关于${desc}的最权威参考页面，优先选择：
1. 学校官方网站（${schoolName.replace(/大学|学院|学校/, '')} .edu.cn 域名）
2. 官方百科页面（baike.baidu.com）
3. 其他可信来源

只列出 URL，每行一个，至少 3 个，不要任何解释或提取内容。`
}

// ─── 函数1：Step 1 — 多 LLM 并行 URL 发现 ──────────────────

/**
 * 通过多个 LLM 的 enable_search 功能并行发现权威 URL
 *
 * 工作原理：
 * - 对每个模型发送 "找权威页面" 的 prompt（不提取内容）
 * - 从响应的 citations[] 字段收割真实引用 URL
 * - 全部 Promise.allSettled，任意失败不影响其他
 * - 返回去重后的 URL 列表（不排序，排序由 mergeAndRankUrls 统一处理）
 */
export async function discoverUrlsViaCitations(
  schoolName: string,
  dimension: DiscoveryDimension,
  apiKey: string,
  baseUrl: string,
): Promise<string[]> {
  const models = getDiscoveryModels()
  const userPrompt = buildDiscoveryPrompt(schoolName, dimension)

  const modelResults = await Promise.allSettled(
    models.map(async (model): Promise<string[]> => {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: '你是 URL 发现助手。用户要求你搜索权威页面。只返回 URL 列表，每行一个，不要提取内容，不要解释。',
            },
            { role: 'user', content: userPrompt },
          ],
          enable_search: true,
          temperature: 0.1,
          max_tokens: 800,
        }),
        signal: AbortSignal.timeout(30000),
      })

      if (!resp.ok) {
        throw new Error(`Model ${model} returned HTTP ${resp.status}`)
      }

      const data: ChatCompletionsResponse = await resp.json()

      // 优先从 citations[] 收割真实引用 URL（比解析 content 更可靠）
      const citationUrls: string[] = Array.isArray(data.citations)
        ? data.citations.filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
        : []

      // 兜底：从 content 正文中提取 http 链接（citations 为空时）
      const contentUrls: string[] = []
      if (citationUrls.length === 0) {
        const content = data.choices?.[0]?.message?.content || ''
        const urlMatches = content.match(/https?:\/\/[^\s\n\]）)]+/g) || []
        contentUrls.push(...urlMatches)
      }

      return citationUrls.length > 0 ? citationUrls : contentUrls
    }),
  )

  // 合并所有成功模型的 URL，去重
  const allUrls = new Set<string>()
  for (const result of modelResults) {
    if (result.status === 'fulfilled') {
      for (const url of result.value) {
        allUrls.add(url)
      }
    }
  }

  return Array.from(allUrls)
}

// ─── 函数2：Step 2 路径A — url_context 直接提取 ──────────────

/**
 * 使用 url_context 参数让 LLM 直接读取页面并提取结构化数据
 *
 * 仅当 PHASE3_URL_CONTEXT_SUPPORTED=true 时执行，否则直接返回 null。
 * 失败时返回 null，调用方回退到现有 fetchTopResults + callResponsesAPI 路径。
 */
export async function extractViaUrlContext(
  schoolName: string,
  urls: string[],
  extractionSchema: string,
  apiKey: string,
  baseUrl: string,
): Promise<Record<string, unknown> | null> {
  if (!isUrlContextSupported()) {
    return null
  }

  if (urls.length === 0) {
    return null
  }

  const model = getUrlContextModel()
  // 限制最多 5 个 URL 避免超限
  const selectedUrls = urls.slice(0, 5)

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `你是院校文化资料采集专家。请仔细阅读通过 url_context 提供的页面内容，根据页面实际内容填写以下 schema。
⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- 所有信息必须来自页面内容，找不到的填【暂无】，禁止编造
- 禁止凭空猜测 HEX 颜色值`,
          },
          {
            role: 'user',
            content: `目标院校：${schoolName}\n\n请阅读给你的页面后，提取以下信息并输出 JSON：\n\n${extractionSchema}`,
          },
        ],
        // url_context：传入待读取页面的 URL 列表
        url_context: selectedUrls.map((url) => ({ url })),
        temperature: 0.1,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!resp.ok) {
      return null
    }

    const data: ChatCompletionsResponse = await resp.json()
    const content = data.choices?.[0]?.message?.content || ''

    if (!content) {
      return null
    }

    // 使用 extractJSON 工具（复用 utils.ts 的健壮解析，避免贪婪 regex 问题）
    try {
      const parsed = extractJSON(content) as Record<string, unknown>
      return parsed
    } catch {
      console.error('[citation-discovery] extractViaUrlContext: JSON parse failed, falling back')
      return null
    }
  } catch (err) {
    // 网络或其他错误，静默降级
    console.error('[citation-discovery] extractViaUrlContext failed:', err)
    return null
  }
}

// ─── 函数3：URL 合并排序工具 ──────────────────────────────────

/**
 * 合并两路 URL 并按权威性评分排序
 *
 * 评分规则与 web-search.ts 中 fetchTopResults 完全一致：
 *   edu.cn = 100, baike.baidu.com = 80, wikipedia.org = 70, 其他 = 50
 */
export function mergeAndRankUrls(existingUrls: string[], citationUrls: string[]): string[] {
  const combined = [...new Set([...existingUrls, ...citationUrls])]

  const scored = combined.map((url) => {
    const lower = url.toLowerCase()
    const score = lower.includes('.edu.cn') ? 100
      : lower.includes('baike.baidu.com') ? 80
      : lower.includes('wikipedia.org') ? 70
      : 50
    return { url, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.url)
}
