import { NextRequest } from 'next/server'
import { SchoolData, ImageSearchHints, StandardColor } from '@/app/types'
import { extractJSON } from '@/app/lib/utils'
import { calcDataQuality } from '@/app/lib/quality-check'
import {
  searchByDimensions,
  fetchTopResults,
  formatSearchResultsAsContext,
  formatFetchResultsWithWindows,
  extractCitations as extractSearchCitations,
} from '@/app/lib/web-search'
import {
  discoverUrlsViaCitations,
  extractViaUrlContext,
  mergeAndRankUrls,
} from '@/app/lib/citation-discovery'
import { searchAndExtractWithPerplexity } from '@/app/lib/perplexity-search'
import { extractEmblemColorsAsFallback } from '@/app/lib/emblem-color-extraction'
import type { DimensionSearchResult } from '@/app/lib/web-search'

// 从 batch.input() 完整 prompt 中截取纯 JSON schema 部分（去掉"请搜索..."前言）
function extractSchemaFromBatchInput(batchInput: string): string {
  const start = batchInput.indexOf('{')
  return start >= 0 ? batchInput.slice(start) : batchInput
}

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

// ─── Chat Completions API 调用 ────────────────────────────

function getPreciseModel(): string {
  return process.env.GEEKAI_PRECISE_MODEL || process.env.GEEKAI_MODEL || 'gpt-4o'
}

async function callChatCompletions(
  instructions: string,
  input: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
      temperature: 0.1,
      max_tokens: 30000,
      response_format: { type: 'json_object' },
      enable_search: false,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Chat Completions API failed (${response.status}): ${errText}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content ?? ''
}

/**
 * 当 extractJSON 失败时尝试修复损坏的 JSON 输出（最多调用 1 次）
 */
async function repairSectionOutput(
  brokenText: string,
  batchName: string,
  instructions: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string> {
  const repairPrompt = `以下 JSON 格式有误，请修复并只输出合法 JSON：\n${brokenText.slice(0, 4000)}`
  try {
    return await callChatCompletions(instructions, repairPrompt, apiKey, baseUrl, model)
  } catch (err) {
    throw new Error(`Repair failed for batch ${batchName}: ${err}`)
  }
}

// ─── 分批 Prompt 构建 ─────────────────────────────────────

interface BatchConfig {
  name: string
  label: string
  dimensions: string[]
  instructions: string
  input: (schoolName: string) => string
}

function buildBatches(schoolName: string): BatchConfig[] {
  const commonRules = `⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- JSON 字符串值内禁止用英文双引号 " 引用词语，改用【】或「」
- 所有信息必须有搜索来源依据，找不到的填【暂无】，禁止编造
- 不要把来源 URL 直接拼接到自然语言字段正文中
- 仅在 schema 已提供 source_url 的字段中填写来源链接
- 全局来源链接会由系统从搜索 annotations 自动汇总，无需额外输出说明`

  return [
    {
      name: 'A',
      label: '搜索并提取基本面、校史与学术信息…',
      dimensions: ['basic', 'history', 'academics'],
      instructions: `你是院校文化资料采集专家。${commonRules}`,
      input: () => `请搜索【${schoolName}】的官方网站和权威来源（优先 edu.cn），提取以下信息，输出 JSON：
{
  "basic": {
    "full_name": "学校全称",
    "short_name": "常用简称",
    "founded_year": "创办年份（如1898）",
    "location": "地理位置（如中国·北京）",
    "introduction": {
      "value": "院校简介，约500字，涵盖历史沿革、办学定位、总体规模、核心优势",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.9,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    }
  },
  "history": {
    "timeline": [
      { "year": "年份", "event": "该年发生的重要历史事件，20-40字", "source_url": "事件来源 URL（找到则填）" }
    ],
    "notable_alumni": "代表性校友名单，3-8人，格式：姓名（身份）"
  },
  "academics": {
    "strong_disciplines": {
      "value": "强势学科或优势专业（至少5个），逗号分隔",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.8,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "major_achievements": "重大科技成果或获奖（2-4条），逗号分隔"
  }
}

重要：timeline 至少 5 条含年份的历史事件。校友必须是真实存在的人物，搜索中没有找到的校友不要列出。`,
    },
    {
      name: 'B',
      label: '搜索并提取文化灵魂与符号语义…',
      dimensions: ['culture', 'symbols'],
      instructions: `你是院校文化资料采集专家。${commonRules}`,
      input: () => `请搜索【${schoolName}】的官方网站和权威来源，提取以下信息，输出 JSON：
{
  "culture": {
    "motto": {
      "value": "校训原文（逐字提取，不可意译）",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.95,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "school_song": {
      "title": "校歌歌名（找不到则填【暂无】）",
      "lyrics_excerpt": "歌词节选，优先完整歌词；若找不到官方完整歌词则填节选并注明【暂无完整歌词】；完全找不到则填【暂无】",
      "completeness": "full|partial|not_found",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.8,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "vision": "办学愿景（官方表述）",
    "core_spirit": "核心精神关键词（3-5个，如：爱国、进步、民主、科学）"
  },
  "symbols": {
    "emblem_description": {
      "value": "校徽官方释义，描述图形构成与寓意",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.85,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    },
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
- 只有在搜索来源中找到官方 VI 手册、学校官网明确声明的颜色证据，status 才能填 confirmed
- 来源中提到颜色名称但无 HEX 值时，status 填 inferred，source_level 填 L3 或更低
- 官方已明确表示未公开标准色时，standard_colors 数组填单条 { "name": "官方未公开", "status": "officially_not_public" }
- 完全找不到颜色信息时 standard_colors 返回空数组 []
- 禁止凭空猜测 HEX 值`,
    },
    {
      name: 'C',
      label: '搜索并提取地标与生态信息…',
      dimensions: ['landmarks', 'ecology'],
      instructions: `你是院校文化资料采集专家。${commonRules}`,
      input: () => `请搜索【${schoolName}】的官方网站和权威来源，提取以下信息，输出 JSON：
{
  "landmarks": {
    "buildings": "标志性建筑名称，逗号分隔（至少3处，搜索来源中提到的真实建筑）",
    "stone_carvings": "非遗石刻或碑文，无则填【暂无】",
    "sculptures": "校园著名雕塑，无则填【暂无】"
  },
  "ecology": {
    "plants": {
      "value": "校花/校树名称及象征（未找到则填【该校暂无官方认定校花校树】）",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.9,
      "source_url": "来源 URL（找不到则留空字符串）",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "geography": "校园湖泊、山丘、河流等自然地理要素"
  },
  "image_search_hints": {
    "emblem": ["${schoolName} 校徽 官方 高清"],
    "landmark": ["${schoolName} 具体地标1", "${schoolName} 具体地标2"],
    "scenery": ["${schoolName} 校园风景", "${schoolName} 航拍"]
  }
}

注意：image_search_hints.landmark 的关键词必须来自 landmarks.buildings 中的真实地标名称。`,
    },
    {
      name: 'D',
      label: '归纳营销话术（基于已采集内容推断）…',
      // Batch D 不搜索，依赖 A/B/C 结果在 prompt 中归纳
      dimensions: [],
      instructions: `你是院校品牌营销文案专家，擅长将院校文化特色转化为 B2B 提案语言。${commonRules}`,
      input: () => `请基于已搜索到的【${schoolName}】院校信息，归纳以下营销话术字段，输出 JSON：
{
  "marketing": {
    "president_message": "校长寄语核心句，50字以内（根据学校特色和愿景推断，注明「推断」）",
    "campus_slogan": "校园流行语或非官方口号（可来自已知文化资料）",
    "student_nickname": "学生对母校的昵称或情感称呼",
    "b2b_highlights": [
      "B端项目亮点1（面向企业采购，20-40字，突出历史、学科、文化特色）",
      "B端项目亮点2（强调校园氛围、标志性元素）",
      "B端项目亮点3（突出荣誉、影响力）"
    ]
  }
}

重要：b2b_highlights 必须基于该校的真实特色，不得泛泛而谈。`,
    },
  ]
}

function buildStructuredInput(
  schoolName: string,
  schemaPrompt: string,
  searchContext: string,
  fetchContext: string,
): string {
  const evidenceSections = [
    `目标院校：${schoolName}`,
    '请只依据下面给出的搜索证据进行结构化提取；若证据不足，请按 schema 规则填【暂无】，禁止补充证据外事实。',
    '【输出 Schema】',
    schemaPrompt,
    '【搜索摘要证据】',
    searchContext || '（无）',
  ]

  if (fetchContext) {
    evidenceSections.push('【网页正文证据】', fetchContext)
  }

  evidenceSections.push('再次强调：只输出 JSON，不要解释，不要重复来源列表。')

  return evidenceSections.join('\n\n')
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
  const model = getPreciseModel()

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

        // ── Batch A/B/C 并行执行（带搜索+抓取）；Batch D 暂跳过，等 A/B/C 完成后串行执行 ──
        const searchBatches = batches.filter((b) => b.dimensions.length > 0)
        const inferBatches = batches.filter((b) => b.dimensions.length === 0)

        const phase3Enabled = process.env.PHASE3_CITATION_DISCOVERY_ENABLED === 'true'
        const perplexityEnabled =
          process.env.PERPLEXITY_ENABLED === 'true' &&
          Boolean(process.env.PERPLEXITY_API_KEY)

        const searchBatchResults = await Promise.allSettled(
          searchBatches.map(async (batch) => {
            push('progress', { step: batch.label })

            // ── Phase 3：Batch B 并行 citation discovery ──
            const isBatchB = batch.name === 'B'
            const perpApiKey = process.env.PERPLEXITY_API_KEY ?? ''

            const citationDiscoveryPromise =
              phase3Enabled && isBatchB
                ? discoverUrlsViaCitations(schoolName, 'standard_colors', apiKey, baseUrl).catch(
                    () => [] as string[],
                  )
                : Promise.resolve([] as string[])

            // ── Perplexity 并行通道（仅 Batch B）──
            const perplexityPromise =
              perplexityEnabled && isBatchB
                ? Promise.all([
                    searchAndExtractWithPerplexity(schoolName, 'standard_colors', perpApiKey).catch(
                      () => null,
                    ),
                    searchAndExtractWithPerplexity(schoolName, 'school_song', perpApiKey).catch(
                      () => null,
                    ),
                  ])
                : Promise.resolve([null, null] as [null, null])

            const [searchResults, citationUrls, perplexityResults] = await Promise.all([
              searchByDimensions(schoolName, batch.dimensions, apiKey, baseUrl),
              citationDiscoveryPromise,
              perplexityPromise,
            ])

            if (searchResults.length === 0) {
              throw new Error(`No search results for batch ${batch.name}`)
            }

            // ── Phase 3 Step 2：尝试 url_context 直接提取（仅 Batch B）──
            if (phase3Enabled && isBatchB && citationUrls.length > 0) {
              push('progress', { step: '尝试 url_context 直接提取符号语义…' })

              const mergedUrls = mergeAndRankUrls(
                extractSearchCitations(searchResults),
                citationUrls,
              )

              const urlContextResult = await extractViaUrlContext(
                schoolName,
                mergedUrls,
                extractSchemaFromBatchInput(batch.input(schoolName)),
                apiKey,
                baseUrl,
              )

              if (urlContextResult) {
                push('progress', { step: 'url_context 提取成功，跳过 Jina 抓取…' })
                const citations = [...new Set([...mergedUrls])]
                return { data: urlContextResult, citations }
              }

              // url_context 不可用：将 citation URL 注入现有抓取路径
              push('progress', { step: `抓取 ${batch.name} 批次权威页面（含 citation URL）…` })

              const augmentedResults: DimensionSearchResult[] = [
                ...searchResults,
                {
                  dimension: 'citation-discovery',
                  query: '',
                  results: citationUrls.map((link) => ({ link, title: '', content: '' })),
                },
              ]

              const fetchedPages = await fetchTopResults(augmentedResults, apiKey, baseUrl, 5)

              const citations = [
                ...new Set([
                  ...mergedUrls,
                  ...fetchedPages.map((page) => page.url),
                  ...(perplexityResults[0]?.citations ?? []),
                  ...(perplexityResults[1]?.citations ?? []),
                ]),
              ]

              const text = await callChatCompletions(
                batch.instructions,
                buildStructuredInput(
                  schoolName,
                  batch.input(schoolName),
                  formatSearchResultsAsContext(searchResults),
                  formatFetchResultsWithWindows(fetchedPages, batch.dimensions),
                ),
                apiKey,
                baseUrl,
                model,
              )

              try {
                const parsed = extractJSON(text) as Record<string, unknown>
                return { data: parsed, citations }
              } catch {
                push('progress', { step: `Batch ${batch.name} 输出解析失败，尝试修复…` })
                try {
                  const repairedText = await repairSectionOutput(text, batch.name, batch.instructions, apiKey, baseUrl, model)
                  const parsed = extractJSON(repairedText) as Record<string, unknown>
                  return { data: parsed, citations }
                } catch {
                  throw new Error(`JSON parse failed for batch ${batch.name}: ${text.slice(0, 200)}`)
                }
              }
            }

            // ── 标准路径（Batch A/C，或 Phase 3 未启用）──
            push('progress', { step: `抓取 ${batch.name} 批次权威页面…` })

            const fetchedPages = await fetchTopResults(
              searchResults,
              apiKey,
              baseUrl,
              batch.name === 'A' ? 6 : 5,
            )

            const perpCitations = isBatchB
              ? [
                  ...(perplexityResults[0]?.citations ?? []),
                  ...(perplexityResults[1]?.citations ?? []),
                ]
              : []

            const citations = [
              ...new Set([
                ...extractSearchCitations(searchResults),
                ...fetchedPages.map((page) => page.url),
                ...perpCitations,
              ]),
            ]

            const text = await callChatCompletions(
              batch.instructions,
              buildStructuredInput(
                schoolName,
                batch.input(schoolName),
                formatSearchResultsAsContext(searchResults),
                formatFetchResultsWithWindows(fetchedPages, batch.dimensions),
              ),
              apiKey,
              baseUrl,
              model,
            )

            let rawParsed: Record<string, unknown>
            try {
              rawParsed = extractJSON(text) as Record<string, unknown>
            } catch {
              push('progress', { step: `Batch ${batch.name} 输出解析失败，尝试修复…` })
              try {
                const repairedText = await repairSectionOutput(text, batch.name, batch.instructions, apiKey, baseUrl, model)
                rawParsed = extractJSON(repairedText) as Record<string, unknown>
              } catch {
                push('progress', { step: `Batch ${batch.name} 修复失败，跳过…` })
                throw new Error(`JSON parse failed for batch ${batch.name}: ${text.slice(0, 200)}`)
              }
            }

            // ── Perplexity 结果覆盖：优先覆盖 Batch B 低置信度字段 ──
            let mergedData = rawParsed
            if (isBatchB) {
              const [colorResult, songResult] = perplexityResults
              if (colorResult?.data) {
                const perpSymbols = colorResult.data.symbols as Record<string, unknown> | undefined
                const mainSymbols = mergedData.symbols as Record<string, unknown> | undefined
                if (perpSymbols?.standard_colors && Array.isArray(perpSymbols.standard_colors) && perpSymbols.standard_colors.length > 0) {
                  mergedData = {
                    ...mergedData,
                    symbols: { ...(mainSymbols ?? {}), standard_colors: perpSymbols.standard_colors },
                  }
                }
              }
              if (songResult?.data) {
                const perpCulture = songResult.data.culture as Record<string, unknown> | undefined
                const mainCulture = mergedData.culture as Record<string, unknown> | undefined
                // Perplexity 仍使用旧字段名 school_song_excerpt，映射到新字段 school_song
                const perpSongData = (perpCulture?.school_song_excerpt ?? perpCulture?.school_song) as Record<string, unknown> | undefined
                const mainSong = mainCulture?.school_song as Record<string, unknown> | undefined
                const mainLyrics = mainSong?.lyrics_excerpt as string | undefined
                if (perpSongData && (!mainLyrics || mainLyrics === '【暂无】')) {
                  // 将 Perplexity 旧格式 {value} 适配为新格式 {title, lyrics_excerpt, completeness}
                  const adaptedSong = perpSongData.lyrics_excerpt
                    ? perpSongData
                    : {
                        title: perpSongData.title ?? '【暂无】',
                        lyrics_excerpt: perpSongData.value ?? '【暂无】',
                        completeness: perpSongData.value && perpSongData.value !== '【暂无】' ? 'partial' : 'not_found',
                        status: perpSongData.status ?? 'inferred',
                        confidence: perpSongData.confidence ?? 0.6,
                        source_url: perpSongData.source_url ?? '',
                        source_level: perpSongData.source_level ?? 'L3',
                      }
                  mergedData = {
                    ...mergedData,
                    culture: {
                      ...(mainCulture ?? {}),
                      school_song: adaptedSong,
                    },
                  }
                }
              }
            }

            return { data: mergedData, citations }
          }),
        )

        // ── 合并 A/B/C 结果 ──
        push('progress', { step: '整合事实采集信息…' })

        // 把各 batch 失败原因推送到前端，方便调试
        searchBatchResults.forEach((r, i) => {
          if (r.status === 'rejected') {
            const batchName = searchBatches[i]?.name ?? i
            const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
            push('progress', { step: `Batch ${batchName} 失败: ${reason.slice(0, 120)}` })
          }
        })

        const allCitations: string[] = []
        const mergedABC = searchBatchResults
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

        const allFailed = searchBatchResults.every((r) => r.status === 'rejected')
        if (allFailed) {
          push('error', { error: 'AI 提取全部失败，请重试或切换到快速模式' })
          closeStream()
          return
        }

        // ── Vision 兜底：standard_colors 无有效 HEX 时从校徽图片提取主色 ──
        const existingColors = (
          (mergedABC.data.symbols as Record<string, unknown>)?.standard_colors ?? []
        ) as StandardColor[]

        const serperKey = process.env.SERPER_API_KEY
        const visionEnabled = process.env.EMBLEM_VISION_FALLBACK_ENABLED !== 'false'

        if (visionEnabled) {
          push('progress', { step: '检查标准色完整性，尝试从校徽图像提取主色…' })
          const extractedColors = await extractEmblemColorsAsFallback(
            schoolName,
            existingColors,
            apiKey,
            baseUrl,
            model,
            serperKey,
          )
          if (extractedColors && extractedColors.length > 0) {
            push('progress', { step: `图像提取到 ${extractedColors.length} 个主色（L5 兜底）` })
            mergedABC.data = {
              ...mergedABC.data,
              symbols: {
                ...((mergedABC.data.symbols as Record<string, unknown>) ?? {}),
                standard_colors: extractedColors,
              },
            }
          }
        }

        // ── Batch D：推断批次（不搜索，基于 A/B/C 结果归纳营销话术）──
        for (const batch of inferBatches) {
          push('progress', { step: batch.label })
          try {
            // 将 A/B/C 结果注入为上下文供 Batch D 推断
            const abcContext = JSON.stringify(mergedABC.data, null, 2).slice(0, 6000)
            const inferInput = buildStructuredInput(
              schoolName,
              batch.input(schoolName),
              `以下是已从权威来源采集到的${schoolName}院校信息（请基于此归纳，不要重新搜索）：\n\n${abcContext}`,
              '',
            )

            const text = await callChatCompletions(batch.instructions, inferInput, apiKey, baseUrl, model)
            try {
              const parsed = extractJSON(text) as Record<string, unknown>
              mergedABC.data = { ...mergedABC.data, ...parsed }
            } catch {
              push('progress', { step: `Batch ${batch.name} 推断解析失败，跳过…` })
            }
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            push('progress', { step: `Batch ${batch.name} 推断失败（跳过）: ${reason.slice(0, 120)}` })
          }
        }

        const schoolData = mergedABC.data as unknown as SchoolData
        const hints: ImageSearchHints = mergedABC.hints ?? {
          emblem: [`${schoolName} 校徽 官方 高清`],
          landmark: [`${schoolName} 标志性建筑`, `${schoolName} 图书馆`],
          scenery: [`${schoolName} 校园风景`, `${schoolName} 校园`],
        }

        const citations = [...new Set(allCitations)]
        const data_quality = calcDataQuality(schoolName, schoolData, citations)

        // ── Sufficiency gate：confidence < 0.5 的字段写入 insufficient_fields ──
        push('result', {
          school_name: schoolName,
          school_data: schoolData,
          data_quality,
          image_search_hints: hints,
          citations,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('Collect-precise SSE error:', err)
        push('error', { error: `采集失败：${msg.slice(0, 300)}` })
      } finally {
        closeStream()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
