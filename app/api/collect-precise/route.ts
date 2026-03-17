import { NextRequest } from 'next/server'
import { SchoolData, ImageSearchHints } from '@/app/types'
import { extractJSON } from '@/app/lib/utils'
import { calcDataQuality } from '@/app/lib/quality-check'

export const maxDuration = 300

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// ─── Responses API 调用 ───────────────────────────────────

interface ResponsesOutput {
  id: string
  type: string
  status?: string
  content?: Array<{ type: string; text: string; annotations?: Array<{ url?: string }> }>
}

interface ResponsesResult {
  id: string
  status: string
  output: ResponsesOutput[]
  usage?: { input_tokens: number; output_tokens: number }
}

async function callResponsesAPI(
  instructions: string,
  input: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<{ text: string; citations: string[] }> {
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      tools: [{ type: 'web_search_preview' }],
      temperature: 0.2,
      max_output_tokens: 16000,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Responses API failed (${response.status}): ${errText}`)
  }

  const data: ResponsesResult = await response.json()

  // 提取文本内容
  let text = ''
  const citations: string[] = []

  for (const item of data.output) {
    if (item.type === 'message' && item.content) {
      for (const c of item.content) {
        if (c.type === 'output_text') {
          text += c.text
          // 提取 annotations 中的 URL 作为 citations
          if (c.annotations) {
            for (const ann of c.annotations) {
              if (ann.url) citations.push(ann.url)
            }
          }
        }
      }
    }
  }

  // 也从 markdown 链接中提取 URL
  const urlMatches = text.matchAll(/\[.*?\]\((https?:\/\/[^\s)]+)\)/g)
  for (const match of urlMatches) {
    if (!citations.includes(match[1])) citations.push(match[1])
  }

  return { text, citations }
}

// ─── 分批 Prompt 构建 ─────────────────────────────────────

interface BatchConfig {
  name: string
  label: string
  instructions: string
  input: (schoolName: string) => string
}

function buildBatches(schoolName: string): BatchConfig[] {
  const commonRules = `⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- JSON 字符串值内禁止用英文双引号 " 引用词语，改用【】或「」
- 所有信息必须有搜索来源依据，找不到的填【暂无】，禁止编造
- 每条重要信息后标注来源 URL`

  return [
    {
      name: 'A',
      label: '搜索并提取基本面、校史与学术信息…',
      instructions: `你是院校文化资料采集专家。${commonRules}`,
      input: () => `请搜索【${schoolName}】的官方网站和权威来源（优先 edu.cn），提取以下信息，输出 JSON：
{
  "basic": {
    "full_name": "学校全称",
    "short_name": "常用简称",
    "founded_year": "创办年份（如1898）",
    "location": "地理位置（如中国·北京）",
    "introduction": "院校简介，约500字，涵盖历史沿革、办学定位、总体规模、核心优势"
  },
  "history": {
    "timeline": [
      { "year": "年份", "event": "该年发生的重要历史事件，20-40字" }
    ],
    "notable_alumni": "代表性校友名单，3-8人，格式：姓名（身份）"
  },
  "academics": {
    "strong_disciplines": "强势学科或优势专业（至少5个），逗号分隔",
    "major_achievements": "重大科技成果或获奖（2-4条），逗号分隔"
  }
}

重要：timeline 至少 5 条含年份的历史事件。校友必须是真实存在的人物，搜索中没有找到的校友不要列出。`,
    },
    {
      name: 'B',
      label: '搜索并提取文化灵魂与符号语义…',
      instructions: `你是院校文化资料采集专家。${commonRules}`,
      input: () => `请搜索【${schoolName}】的官方网站和权威来源，提取以下信息，输出 JSON：
{
  "culture": {
    "motto": "校训原文（逐字提取，不可意译）",
    "school_song_excerpt": "校歌歌名+完整歌词（若歌词过长，保留全部，不截断；找不到完整歌词则填【暂无完整歌词】）",
    "vision": "办学愿景（官方表述）",
    "core_spirit": "核心精神关键词（3-5个，如：爱国、进步、民主、科学）"
  },
  "symbols": {
    "emblem_description": "校徽官方释义，描述图形构成与寓意",
    "flag_description": "校旗说明，描述颜色、图案与象征（找不到则填【暂无】）",
    "standard_colors": [
      {
        "name": "颜色中文名（官方命名优先）",
        "hex": "#XXXXXX（必须为 #RRGGBB 格式，来源中有明确值时才填写）",
        "rgb": "R___ G___ B___（与 hex 一致）",
        "usage": "primary|secondary|accent",
        "source_level": "L1|L2|L3|L4|L5",
        "source_url": "颜色信息来源 URL",
        "confidence": 0.9,
        "is_official": true,
        "conflict": false,
        "conflict_note": "",
        "extraction_note": ""
      }
    ]
  }
}

【标准校色专项规则】
- 必须从搜索来源中找到明确的颜色信息才能填写 hex 值
- 来源中提到颜色名称但无 HEX 值时，source_level 填 L3 或更低
- 完全找不到颜色信息时 standard_colors 返回空数组 []
- 禁止凭空猜测 HEX 值`,
    },
    {
      name: 'C',
      label: '搜索并提取地标、生态与营销信息…',
      instructions: `你是院校文化资料采集专家。${commonRules}`,
      input: () => `请搜索【${schoolName}】的官方网站和权威来源，提取以下信息，输出 JSON：
{
  "landmarks": {
    "buildings": "标志性建筑名称，逗号分隔（至少3处，搜索来源中提到的真实建筑）",
    "stone_carvings": "非遗石刻或碑文，无则填【暂无】",
    "sculptures": "校园著名雕塑，无则填【暂无】"
  },
  "ecology": {
    "plants": "校花/校树名称及象征（未找到则填【该校暂无官方认定校花校树】）",
    "geography": "校园湖泊、山丘、河流等自然地理要素"
  },
  "marketing": {
    "president_message": "校长寄语核心句，50字以内",
    "campus_slogan": "校园流行语或非官方口号",
    "student_nickname": "学生对母校的昵称或情感称呼",
    "b2b_highlights": [
      "B端项目亮点1（面向企业采购，20-40字）",
      "B端项目亮点2",
      "B端项目亮点3"
    ]
  },
  "image_search_hints": {
    "emblem": ["${schoolName} 校徽 官方 高清"],
    "landmark": ["${schoolName} 具体地标1", "${schoolName} 具体地标2"],
    "scenery": ["${schoolName} 校园风景", "${schoolName} 航拍"]
  }
}

注意：image_search_hints.landmark 的关键词必须来自 landmarks.buildings 中的真实地标名称。`,
    },
  ]
}

// ─── 核心采集逻辑 ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { school_name } = await request.json().catch(() => ({}))

  if (!school_name || typeof school_name !== 'string' || !school_name.trim()) {
    return new Response(
      sseEvent('error', { error: '请输入学校名称' }),
      { status: 400, headers: SSE_HEADERS },
    )
  }

  const apiKey = process.env.GEEKAI_API_KEY
  const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
  const model = process.env.GEEKAI_MODEL || 'gpt-5.4-pro'

  if (!apiKey) {
    return new Response(
      sseEvent('error', { error: '服务未配置 API Key' }),
      { status: 500, headers: SSE_HEADERS },
    )
  }

  const schoolName = school_name.trim()

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      let streamClosed = false
      const push = (event: string, data: unknown) => {
        if (streamClosed) return
        controller.enqueue(enc.encode(sseEvent(event, data)))
      }
      const closeStream = () => {
        if (streamClosed) return
        streamClosed = true
        controller.close()
      }

      try {
        push('progress', { step: '准备采集任务…' })

        const batches = buildBatches(schoolName)

        // ── 并行调用 3 个批次（每个批次自带联网搜索） ──
        const batchResults = await Promise.allSettled(
          batches.map(async (batch) => {
            push('progress', { step: batch.label })

            const { text, citations } = await callResponsesAPI(
              batch.instructions,
              batch.input(schoolName),
              apiKey,
              baseUrl,
              model,
            )

            try {
              const parsed = extractJSON(text) as Record<string, unknown>
              return { data: parsed, citations }
            } catch {
              push('progress', { step: `Batch ${batch.name} 输出解析失败，跳过…` })
              throw new Error(`JSON parse failed for batch ${batch.name}: ${text.slice(0, 200)}`)
            }
          }),
        )

        // ── 合并结果 ──
        push('progress', { step: '整合所有信息…' })

        const allCitations: string[] = []
        const mergedResult = batchResults
          .filter((r): r is PromiseFulfilledResult<{ data: Record<string, unknown>; citations: string[] }> =>
            r.status === 'fulfilled',
          )
          .reduce<{ data: Record<string, unknown>; hints: ImageSearchHints | null }>(
            (acc, r) => {
              allCitations.push(...r.value.citations)
              const { image_search_hints, ...rest } = r.value.data
              return {
                data: { ...acc.data, ...rest },
                hints: image_search_hints
                  ? (image_search_hints as unknown as ImageSearchHints)
                  : acc.hints,
              }
            },
            { data: {}, hints: null },
          )

        const allFailed = batchResults.every((r) => r.status === 'rejected')
        if (allFailed) {
          push('error', { error: 'AI 提取全部失败，请重试或切换到快速模式' })
          closeStream()
          return
        }

        const schoolData = mergedResult.data as unknown as SchoolData
        const hints: ImageSearchHints = mergedResult.hints ?? {
          emblem: [`${schoolName} 校徽 官方 高清`],
          landmark: [`${schoolName} 标志性建筑`, `${schoolName} 图书馆`],
          scenery: [`${schoolName} 校园风景`, `${schoolName} 校园`],
        }

        const citations = [...new Set(allCitations)]
        const data_quality = calcDataQuality(schoolName, schoolData, citations)

        push('result', {
          school_name: schoolName,
          school_data: schoolData,
          data_quality,
          image_search_hints: hints,
          citations,
        })
      } catch (err) {
        console.error('Collect-precise SSE error:', err)
        push('error', { error: '服务器内部错误，请稍后重试' })
      } finally {
        closeStream()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
