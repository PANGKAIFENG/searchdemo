/**
 * 多路 Web Search + Web Fetch 封装
 *
 * 搜索层：GeeKAI web_search（并行）+ Serper.dev /search（并行）
 * 抓取层：Jina Reader 直连（r.jina.ai/{url}）→ GeeKAI web_fetch 兜底
 *
 * Phase 1 升级：两路搜索结果合并去重，抓取优先 Jina 直连（无 500 问题）。
 */

import { searchWithSerper, extractSiteFilter } from './serper-search'

// ─── 类型定义 ───────────────────────────────────────────────

export interface WebSearchQuery {
  prompt: string
  domain_filter?: string
  count?: number
  content_size?: 'medium' | 'high'
}

export interface WebSearchResultItem {
  link: string
  title: string
  content: string
  icon?: string
  media?: string
}

export interface WebSearchResponse {
  id: string
  created: number
  results: WebSearchResultItem[]
}

export interface DimensionSearchResult {
  dimension: string
  query: string
  results: WebSearchResultItem[]
}

export interface WebFetchResult {
  url: string
  title: string
  content: string
}

export interface WebFetchResponse {
  id: string
  created: number
  result: {
    url: string
    title: string
    content: string
    links?: Record<string, string>
    images?: Record<string, string>
    metadata?: Record<string, unknown>
  }
}

// ─── 搜索策略定义 ─────────────────────────────────────────

type SearchStrategyFactory = (schoolName: string) => WebSearchQuery[]

const SEARCH_STRATEGIES: Record<string, SearchStrategyFactory> = {
  basic: (name) => [
    {
      prompt: `${name} 学校简介 办学定位 历史沿革`,
      domain_filter: 'edu.cn',
      count: 5,
      content_size: 'high',
    },
    {
      prompt: `${name} 百度百科 学校概况`,
      domain_filter: 'baike.baidu.com',
      count: 3,
      content_size: 'high',
    },
  ],

  culture: (name) => [
    {
      prompt: `${name} 校训 校歌 歌词 全文`,
      domain_filter: 'edu.cn',
      count: 5,
      content_size: 'high',
    },
    {
      prompt: `${name} 校歌歌词 完整版`,
      count: 5,
      content_size: 'high',
    },
    {
      prompt: `${name} 办学精神 办学愿景 核心理念`,
      domain_filter: 'edu.cn',
      count: 3,
      content_size: 'high',
    },
  ],

  symbols: (name) => [
    {
      prompt: `${name} 校徽 校旗 标准色 VIS 视觉识别`,
      domain_filter: 'edu.cn',
      count: 5,
      content_size: 'high',
    },
    {
      prompt: `${name} 校徽含义 校色 主色调 品牌色`,
      domain_filter: 'baike.baidu.com,zh.wikipedia.org',
      count: 5,
      content_size: 'high',
    },
    {
      prompt: `${name} 校徽 颜色 HEX RGB`,
      count: 5,
      content_size: 'high',
    },
  ],

  history: (name) => [
    {
      prompt: `${name} 大事记 发展历程 历史沿革`,
      domain_filter: 'edu.cn',
      count: 5,
      content_size: 'high',
    },
    {
      prompt: `${name} 知名校友 杰出校友`,
      count: 5,
      content_size: 'high',
    },
  ],

  landmarks: (name) => [
    {
      prompt: `${name} 标志性建筑 校园地标 代表建筑物`,
      count: 8,
      content_size: 'medium',
    },
    {
      prompt: `${name} 校园雕塑 石刻 碑文`,
      count: 3,
      content_size: 'medium',
    },
  ],

  ecology: (name) => [
    {
      prompt: `${name} 校花 校树 官方认定 校园植物`,
      count: 5,
      content_size: 'medium',
    },
    {
      prompt: `${name} 校园湖泊 山丘 自然景观`,
      count: 3,
      content_size: 'medium',
    },
  ],

  academics: (name) => [
    {
      prompt: `${name} 优势学科 重点专业 学科评估 国家级`,
      count: 8,
      content_size: 'medium',
    },
    {
      prompt: `${name} 重大科技成果 获奖 科研成就`,
      count: 3,
      content_size: 'medium',
    },
  ],

  marketing: (name) => [
    {
      prompt: `${name} 校长寄语 校园口号 学校精神`,
      count: 5,
      content_size: 'medium',
    },
    {
      prompt: `${name} 学生昵称 校园流行语 校园文化`,
      count: 3,
      content_size: 'medium',
    },
  ],
}

// ─── 搜索批次定义 ─────────────────────────────────────────

export interface SearchBatch {
  name: string
  dimensions: string[]
}

export const SEARCH_BATCHES: SearchBatch[] = [
  { name: 'A', dimensions: ['basic', 'history', 'academics'] },
  { name: 'B', dimensions: ['culture', 'symbols'] },
  { name: 'C', dimensions: ['landmarks', 'ecology', 'marketing'] },
]

// ─── 核心搜索函数 ─────────────────────────────────────────

/**
 * 调用 GeeKAI web_search API 执行单次搜索
 * @param model 搜索引擎模型，默认 glm-search-std
 */
export async function callWebSearch(
  query: WebSearchQuery,
  apiKey: string,
  baseUrl: string,
  model = 'glm-search-std',
): Promise<WebSearchResultItem[]> {
  const response = await fetch(`${baseUrl}/web_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: query.prompt,
      intent: true,
      count: query.count ?? 5,
      ...(query.domain_filter ? { domain_filter: query.domain_filter } : {}),
      content_size: query.content_size ?? 'medium',
      recency_filter: 'noLimit',
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`web_search failed (${response.status}): ${text}`)
  }

  const data: WebSearchResponse = await response.json()
  return data.results ?? []
}

/**
 * 带兜底链的 web_search：
 * 1. 并行调用 GeeKAI（模型链） + Serper.dev，取各自第一个非空结果
 * 2. 合并去重后返回，条数一般比单一来源多 1.5~2×
 */
export async function callWebSearchWithFallback(
  query: WebSearchQuery,
  apiKey: string,
  baseUrl: string,
): Promise<WebSearchResultItem[]> {
  // ── GeeKAI 模型兜底链 ──
  const geekaiPromise = (async (): Promise<WebSearchResultItem[]> => {
    const chain = (process.env.GEEKAI_SEARCH_MODEL_CHAIN || 'glm-search-std')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)

    for (const model of chain) {
      try {
        const results = await callWebSearch(query, apiKey, baseUrl, model)
        if (results.length > 0) return results
      } catch {
        // 降级到下一个模型
      }
    }
    return []
  })()

  // ── Serper.dev 并行搜索 ──
  const siteFilter = extractSiteFilter(query.domain_filter)
  const serperPromise = searchWithSerper(query.prompt, siteFilter, query.count ?? 10)

  const [geekaiResults, serperResults] = await Promise.all([geekaiPromise, serperPromise])

  // 合并去重（以 URL 为 key）
  const seen = new Set<string>()
  const merged: WebSearchResultItem[] = []
  for (const item of [...geekaiResults, ...serperResults]) {
    if (seen.has(item.link)) continue
    seen.add(item.link)
    merged.push(item)
  }

  return merged
}

/**
 * 针对指定维度列表执行搜索，返回按维度分组的结果
 */
export async function searchByDimensions(
  schoolName: string,
  dimensions: string[],
  apiKey: string,
  baseUrl: string,
): Promise<DimensionSearchResult[]> {
  // 收集所有需要执行的搜索任务
  const tasks: Array<{ dimension: string; query: WebSearchQuery }> = []
  for (const dim of dimensions) {
    const strategyFactory = SEARCH_STRATEGIES[dim]
    if (!strategyFactory) continue
    const queries = strategyFactory(schoolName)
    for (const q of queries) {
      tasks.push({ dimension: dim, query: q })
    }
  }

  // 并行执行所有搜索（每个搜索独立，失败不影响其他）
  const settled = await Promise.allSettled(
    tasks.map(async (task) => {
      const results = await callWebSearchWithFallback(task.query, apiKey, baseUrl)
      return {
        dimension: task.dimension,
        query: task.query.prompt,
        results,
      }
    }),
  )

  return settled
    .filter((r): r is PromiseFulfilledResult<DimensionSearchResult> => r.status === 'fulfilled')
    .map((r) => r.value)
}

/**
 * 针对一个批次的维度执行搜索
 */
export async function searchBatch(
  schoolName: string,
  batch: SearchBatch,
  apiKey: string,
  baseUrl: string,
): Promise<DimensionSearchResult[]> {
  return searchByDimensions(schoolName, batch.dimensions, apiKey, baseUrl)
}

/**
 * 将搜索结果格式化为 LLM 上下文文本
 */
export function formatSearchResultsAsContext(results: DimensionSearchResult[]): string {
  // 按维度合并去重（同一 URL 不重复）
  const seenUrls = new Set<string>()
  const entries: Array<{ index: number; title: string; url: string; content: string }> = []

  for (const dimResult of results) {
    for (const item of dimResult.results) {
      if (seenUrls.has(item.link)) continue
      seenUrls.add(item.link)
      entries.push({
        index: entries.length + 1,
        title: item.title,
        url: item.link,
        content: item.content,
      })
    }
  }

  if (entries.length === 0) {
    return '（未找到相关搜索结果）'
  }

  return entries
    .map((e) => `=== 来源 ${e.index}: ${e.title} (${e.url}) ===\n${e.content}`)
    .join('\n\n')
}

/**
 * 从搜索结果中提取所有来源 URL（用于 citations）
 */
export function extractCitations(results: DimensionSearchResult[]): string[] {
  const urls = new Set<string>()
  for (const dimResult of results) {
    for (const item of dimResult.results) {
      urls.add(item.link)
    }
  }
  return Array.from(urls)
}

// ─── Web Fetch API ──────────────────────────────────────────

/**
 * 调用 GeeKAI web_fetch API 获取完整页面内容
 * 当服务不可用时返回 null（优雅降级）
 * @param model 抓取引擎模型，默认 jina-reader-v1
 */
export async function callWebFetch(
  url: string,
  apiKey: string,
  baseUrl: string,
  model = 'jina-reader-v1',
): Promise<WebFetchResult | null> {
  try {
    const response = await fetch(`${baseUrl}/web_fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        url,
        engine: 'browser',
        response_format: 'text',
        timeout: 20,
        remove_images: true,
      }),
    })

    if (!response.ok) return null

    const data: WebFetchResponse = await response.json()
    if (!data.result?.content) return null

    return {
      url: data.result.url,
      title: data.result.title,
      content: data.result.content,
    }
  } catch {
    return null
  }
}

// ─── Jina Reader 直连抓取 ────────────────────────────────

/**
 * 通过 Jina Reader 直连抓取页面内容（GET r.jina.ai/{url}）
 * - 无需配置即可使用（免费限速），有 JINA_API_KEY 时更稳定
 * - 不依赖 GeeKAI 代理，解决 500 问题
 */
// 按 URL 域名判断是否需要 browser 渲染（JS 动态内容）
const BROWSER_RENDER_DOMAINS = ['.edu.cn', 'baike.baidu.com', 'wenku.baidu.com']

async function fetchWithJinaDirect(url: string): Promise<WebFetchResult | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`
    const needsBrowser = BROWSER_RENDER_DOMAINS.some((d) => url.includes(d))
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Return-Format': 'text',
      'X-Remove-Selector': 'header, footer, nav, aside, script, style',
      'X-Locale': 'zh-CN',
    }
    if (needsBrowser) {
      headers['X-Engine'] = 'browser'
      headers['X-Timeout'] = '15'
    }
    const jinaKey = process.env.JINA_API_KEY
    if (jinaKey) {
      headers['Authorization'] = `Bearer ${jinaKey}`
    }

    const resp = await fetch(jinaUrl, { headers })
    if (!resp.ok) return null

    const data = await resp.json().catch(() => null)
    if (data?.data?.content) {
      return {
        url: data.data.url || url,
        title: data.data.title || '',
        content: data.data.content,
      }
    }

    // 部分响应是纯文本
    const text = await resp.text().catch(() => '')
    if (text.length > 200) {
      return { url, title: '', content: text }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 带兜底链的 web_fetch：
 * 1. 优先使用 Jina Reader 直连（r.jina.ai/{url}），避免 GeeKAI 500 问题
 * 2. Jina 失败时降级到 GeeKAI web_fetch 模型链
 */
export async function callWebFetchWithFallback(
  url: string,
  apiKey: string,
  baseUrl: string,
): Promise<WebFetchResult | null> {
  // 优先 Jina 直连
  const jinaResult = await fetchWithJinaDirect(url)
  if (jinaResult) return jinaResult

  // Jina 失败时降级到 GeeKAI 模型链
  const chain = (process.env.GEEKAI_FETCH_MODEL_CHAIN || 'jina-reader-v1')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)

  for (const model of chain) {
    try {
      const result = await callWebFetch(url, apiKey, baseUrl, model)
      if (result) return result
    } catch {
      // 降级到下一个模型
    }
  }
  return null
}

/**
 * 从搜索结果中挑选最佳 URL 并抓取完整内容
 * 优先 edu.cn 域名，其次百科类站点
 */
export async function fetchTopResults(
  searchResults: DimensionSearchResult[],
  apiKey: string,
  baseUrl: string,
  maxFetches: number = 5,
): Promise<WebFetchResult[]> {
  const allItems = searchResults.flatMap((r) => r.results)
  const seenUrls = new Set<string>()
  const uniqueItems: WebSearchResultItem[] = []

  for (const item of allItems) {
    if (seenUrls.has(item.link)) continue
    seenUrls.add(item.link)
    uniqueItems.push(item)
  }

  // 按优先级排序：edu.cn > baike > wikipedia > 其他
  const scored = uniqueItems.map((item) => {
    const url = item.link.toLowerCase()
    const score = url.includes('.edu.cn') ? 100
      : url.includes('baike.baidu.com') ? 80
      : url.includes('wikipedia.org') ? 70
      : 50
    return { item, score }
  })

  const topUrls = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFetches)
    .map((s) => s.item.link)

  const results = await Promise.allSettled(
    topUrls.map((url) => callWebFetchWithFallback(url, apiKey, baseUrl)),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<WebFetchResult | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is WebFetchResult => v !== null)
}

/**
 * 将 web_fetch 抓取到的完整页面内容格式化为 LLM 上下文
 * @deprecated 推荐使用 formatFetchResultsWithWindows 以减少 token 消耗
 */
export function formatFetchResultsAsContext(fetched: WebFetchResult[]): string {
  if (fetched.length === 0) return ''

  return fetched
    .map((f, i) =>
      `=== 完整页面 ${i + 1}: ${f.title} (${f.url}) ===\n${f.content.slice(0, 8000)}`,
    )
    .join('\n\n')
}

// ─── 关键词窗口截取 ─────────────────────────────────────

const SECTION_KEYWORDS: Record<string, string[]> = {
  basic:     ['简介', '概况', '地址', '校区', '创办', '建校'],
  culture:   ['校训', '校歌', '精神', '愿景'],
  symbols:   ['校徽', '校旗', '校色', 'VI', '视觉识别', '标准色'],
  history:   ['历史沿革', '大事记', '更名', '升格', '合并'],
  landmarks: ['地标', '校门', '图书馆', '礼堂', '建筑'],
  ecology:   ['校花', '校树', '景观', '湖', '山'],
  academics: ['学科', '科研', '成果'],
  marketing: ['校长', '寄语', '昵称', '口号'],
}

/**
 * 从页面内容中按 section 关键词截取证据窗口
 * 每个命中关键词：前 320 字符 + 后 680 字符 = 最多 1000 字符/窗口
 * 最多 3 个窗口，总计最多 3000 字符
 * 无关键词命中时兜底 slice(0, 2600)
 */
export function selectEvidenceWindows(content: string, section: string): string {
  const keywords = SECTION_KEYWORDS[section] ?? []
  if (keywords.length === 0) return content.slice(0, 2600)

  const windows: string[] = []
  const usedRanges: Array<[number, number]> = []

  for (const kw of keywords) {
    if (windows.length >= 3) break
    const idx = content.indexOf(kw)
    if (idx < 0) continue
    const start = Math.max(0, idx - 320)
    const end = Math.min(content.length, idx + 680)

    // 跳过与已有窗口重叠的范围（避免重复内容）
    const overlaps = usedRanges.some(([s, e]) => start < e && end > s)
    if (overlaps) continue

    usedRanges.push([start, end])
    windows.push(content.slice(start, end))
  }

  if (windows.length === 0) return content.slice(0, 2600)
  return windows.join('\n…\n').slice(0, 3000)
}

/**
 * 将 web_fetch 抓取到的完整页面内容按 section 关键词窗口截取后格式化为 LLM 上下文
 * 替代 formatFetchResultsAsContext，大幅减少 token 消耗（每页 ≤3000 字符 vs 原 8000）
 */
export function formatFetchResultsWithWindows(
  fetched: WebFetchResult[],
  sections: string[],
): string {
  if (fetched.length === 0) return ''

  return fetched
    .map((f, i) => {
      // 对每个 section 截取窗口，合并去重后限制总长度
      const windowParts = sections.flatMap((sec) =>
        selectEvidenceWindows(f.content, sec).split('\n…\n'),
      )
      const dedupedContent = [...new Set(windowParts)].join('\n…\n').slice(0, 3000)
      return `=== 完整页面 ${i + 1}: ${f.title} (${f.url}) ===\n${dedupedContent}`
    })
    .join('\n\n')
}

/**
 * 为精准模式 refine 构造定向搜索查询
 */
export function buildRefineSearchQueries(
  schoolName: string,
  missingFields: string[],
): WebSearchQuery[] {
  const queries: WebSearchQuery[] = []

  for (const field of missingFields) {
    if (field.includes('standard_colors')) {
      queries.push({
        prompt: `${schoolName} 校色 HEX RGB 官方 标准色`,
        domain_filter: 'edu.cn',
        count: 5,
        content_size: 'high',
      })
      queries.push({
        prompt: `${schoolName} 校徽颜色 主色调 品牌色`,
        count: 5,
        content_size: 'high',
      })
    } else if (field.includes('school_song')) {
      queries.push({
        prompt: `${schoolName} 校歌 完整版歌词`,
        count: 8,
        content_size: 'high',
      })
    } else if (field.includes('history.timeline')) {
      queries.push({
        prompt: `${schoolName} 发展历史 大事记 历年重要事件`,
        domain_filter: 'edu.cn',
        count: 5,
        content_size: 'high',
      })
    } else if (field.includes('landmarks')) {
      queries.push({
        prompt: `${schoolName} 标志性建筑 代表建筑物 校园地标`,
        count: 8,
        content_size: 'medium',
      })
    } else if (field.includes('b2b_highlights')) {
      queries.push({
        prompt: `${schoolName} 办学特色 学校荣誉 办学成就`,
        count: 5,
        content_size: 'medium',
      })
    } else if (field.includes('ecology.plants')) {
      queries.push({
        prompt: `${schoolName} 校花 校树 官方认定`,
        count: 5,
        content_size: 'medium',
      })
    } else if (field.includes('academics')) {
      queries.push({
        prompt: `${schoolName} 优势学科 特色专业 国家级重点`,
        count: 5,
        content_size: 'medium',
      })
    }
  }

  return queries
}
