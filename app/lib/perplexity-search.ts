/**
 * Perplexity Sonar-Pro 搜索封装
 *
 * 针对 standard_colors / school_song 薄弱字段，直连 Perplexity API
 * 实现：搜索 + JSON 结构化提取 + citations 一次完成
 */

interface PerplexitySearchResult {
  data: Record<string, unknown>
  citations: string[]
}

interface PerplexityChoice {
  message: {
    content: string
  }
}

interface PerplexityResponse {
  choices: PerplexityChoice[]
  search_results?: Array<{ url: string }>
  citations?: string[]
}

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  standard_colors: '标准校色（官方颜色名称、HEX 值、RGB 值及用途）',
  school_song: '校歌（歌名及完整歌词或权威节选）',
}

const DIMENSION_SCHEMAS: Record<string, string> = {
  standard_colors: JSON.stringify(
    {
      symbols: {
        standard_colors: [
          {
            name: '颜色中文名（官方命名优先）',
            hex: '#XXXXXX（必须为 #RRGGBB 格式，来源中有明确值时才填写）',
            rgb: 'R___ G___ B___',
            usage: 'primary|secondary|accent',
            source_level: 'L1|L2|L3|L4|L5',
            source_url: '颜色信息来源 URL',
            confidence: 0.9,
            is_official: true,
            conflict: false,
            conflict_note: '',
            extraction_note: '',
          },
        ],
      },
    },
    null,
    2,
  ),
  school_song: JSON.stringify(
    {
      culture: {
        school_song_excerpt: {
          value: '校歌歌名+歌词节选（优先完整歌词；找不到则返回可核实节选并注明【暂无完整歌词】）',
          status: 'confirmed|inferred|insufficient',
          confidence: 0.8,
          source_url: '来源 URL',
          source_level: 'L1|L2|L3|L4|L5',
        },
      },
    },
    null,
    2,
  ),
}

/**
 * 使用 Perplexity Sonar-Pro 搜索并结构化提取院校指定维度信息
 *
 * @param schoolName 院校名称
 * @param dimension  提取维度（standard_colors | school_song）
 * @param apiKey     Perplexity API Key
 * @returns 提取结果及 citation URL 列表，失败时返回 null
 */
export async function searchAndExtractWithPerplexity(
  schoolName: string,
  dimension: 'standard_colors' | 'school_song',
  apiKey: string,
): Promise<PerplexitySearchResult | null> {
  try {
    const dimensionDesc = DIMENSION_DESCRIPTIONS[dimension]
    const schema = DIMENSION_SCHEMAS[dimension]

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content:
              '你是院校信息提取专家，只输出合法 JSON，不输出任何说明、markdown 标记或代码块。' +
              '所有信息必须来源于搜索结果，找不到的字段填【暂无】，禁止编造数据。',
          },
          {
            role: 'user',
            content:
              `请搜索【${schoolName}】的${dimensionDesc}，按照以下 schema 提取信息并输出 JSON：\n\n` +
              schema,
          },
        ],
        search_domain_filter: ['.edu.cn', 'baike.baidu.com', 'zh.wikipedia.org'],
        search_language_filter: ['zh'],
        response_format: {
          type: 'json_schema',
          json_schema: {
            schema: JSON.parse(schema),
          },
        },
        max_tokens: 2000,
        temperature: 0.1,
      }),
    })

    if (!response.ok) {
      return null
    }

    const result: PerplexityResponse = await response.json()

    const content = result.choices?.[0]?.message?.content
    if (!content) return null

    let data: Record<string, unknown>
    try {
      data = JSON.parse(content)
    } catch {
      // 尝试从内容中提取 JSON
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) return null
      try {
        data = JSON.parse(match[0])
      } catch {
        return null
      }
    }

    // 从 search_results 或 citations 字段提取真实 citation URL
    const citations: string[] = [
      ...(result.search_results?.map((r) => r.url) ?? []),
      ...(result.citations ?? []),
    ].filter((url) => typeof url === 'string' && url.startsWith('http'))

    return { data, citations }
  } catch {
    return null
  }
}
