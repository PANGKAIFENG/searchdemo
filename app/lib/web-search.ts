/**
 * GeeKAI Web Search + Web Fetch API 封装
 *
 * 通过 /web_search 接口主动搜索网页，获取结构化搜索结果，
 * 通过 /web_fetch 接口抓取完整页面内容（当服务可用时），
 * 用于注入 LLM prompt 作为事实上下文，取代黑箱 enable_search。
 */

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
 */
export async function callWebSearch(
  query: WebSearchQuery,
  apiKey: string,
  baseUrl: string,
): Promise<WebSearchResultItem[]> {
  const response = await fetch(`${baseUrl}/web_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'glm-search-std',
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
      const results = await callWebSearch(task.query, apiKey, baseUrl)
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
 */
export async function callWebFetch(
  url: string,
  apiKey: string,
  baseUrl: string,
): Promise<WebFetchResult | null> {
  try {
    const response = await fetch(`${baseUrl}/web_fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
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
    topUrls.map((url) => callWebFetch(url, apiKey, baseUrl)),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<WebFetchResult | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is WebFetchResult => v !== null)
}

/**
 * 将 web_fetch 抓取到的完整页面内容格式化为 LLM 上下文
 */
export function formatFetchResultsAsContext(fetched: WebFetchResult[]): string {
  if (fetched.length === 0) return ''

  return fetched
    .map((f, i) =>
      `=== 完整页面 ${i + 1}: ${f.title} (${f.url}) ===\n${f.content.slice(0, 8000)}`,
    )
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
