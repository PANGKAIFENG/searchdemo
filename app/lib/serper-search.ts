/**
 * Serper.dev 文字搜索封装
 *
 * 当前 SERPER_API_KEY 已在 .env.local 中配置（原用于图片搜索）。
 * 本模块将其扩展为文字搜索，作为 GeeKAI web_search 的并行补充源，
 * 提高搜索结果覆盖率（尤其当 GeeKAI 返回空结果时）。
 *
 * 接口文档：https://serper.dev/api-reference
 */

import { WebSearchResultItem } from './web-search'

export interface SerperOrganicResult {
  title: string
  link: string
  snippet: string
  position?: number
  date?: string
}

export interface SerperSearchResponse {
  organic?: SerperOrganicResult[]
  searchParameters?: { q: string }
  credits?: number
}

/**
 * 使用 Serper.dev /search 接口执行 Google 文字搜索
 *
 * @param query 搜索关键词
 * @param siteFilter 可选的 site: 过滤域名（如 edu.cn、baike.baidu.com）
 * @param num 返回结果数，默认 10
 */
export async function searchWithSerper(
  query: string,
  siteFilter?: string,
  num = 10,
): Promise<WebSearchResultItem[]> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) return []

  const q = siteFilter ? `${query} site:${siteFilter}` : query

  try {
    const resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q,
        num,
        gl: 'cn',
        hl: 'zh-cn',
      }),
    })

    if (!resp.ok) return []

    const data: SerperSearchResponse = await resp.json()
    return (
      data.organic?.map((r) => ({
        link: r.link,
        title: r.title,
        content: r.snippet,
      })) ?? []
    )
  } catch {
    return []
  }
}

/**
 * 将 WebSearchQuery 的 domain_filter 转换为 Serper 的 siteFilter 参数。
 * domain_filter 可能是逗号分隔的多个域名，取第一个。
 */
export function extractSiteFilter(domainFilter?: string): string | undefined {
  if (!domainFilter) return undefined
  return domainFilter.split(',')[0].trim()
}
