import { NextRequest, NextResponse } from 'next/server'
import { SchoolData } from '@/app/types'
import { extractJSON, deepMerge } from '@/app/lib/utils'
import { calcDataQuality } from '@/app/lib/quality-check'

export const maxDuration = 60

/**
 * POST /api/collect/refine
 *
 * 兜底补查接口（PRD Step 4）：当 collect 返回的 data_quality.verdict 为"需补查"时，
 * 针对缺失/低可信度字段进行定向二次检索。
 *
 * Request Body:
 *   school_name        string            必填：已确认的学校全称
 *   confirmed_data     Partial<SchoolData>  必填：已确认准确的字段（不会重复检索）
 *   missing_fields     string[]          必填：需补查的字段路径（来自 data_quality.missing_fields）
 *   recommended_queries  string[]        可选：quality-check 生成的推荐搜索词
 *
 * Response:
 *   status            'success' | 'partial'
 *   refined_data      Partial<SchoolData>   仅包含补查到的字段
 *   data_quality      DataQuality           合并后重新评分
 *   citations         string[]
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      school_name,
      confirmed_data,
      missing_fields,
      recommended_queries,
    } = body as {
      school_name: string
      confirmed_data: Partial<SchoolData>
      missing_fields: string[]
      recommended_queries?: string[]
    }

    if (!school_name?.trim()) {
      return NextResponse.json({ error: '请提供学校名称' }, { status: 400 })
    }
    if (!Array.isArray(missing_fields) || missing_fields.length === 0) {
      return NextResponse.json({ error: 'missing_fields 不能为空' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
    const model = process.env.GEEKAI_MODEL || 'gpt-4o'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const schoolName = school_name.trim()
    const systemPrompt = buildRefinePrompt(schoolName, confirmed_data, missing_fields, recommended_queries ?? [])

    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `请对【${schoolName}】的以下缺失字段进行定向补查，直接输出 JSON，不要任何其他内容：\n${missing_fields.join('\n')}`,
          },
        ],
        enable_search: true,
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!aiResponse.ok) {
      return NextResponse.json({ error: `AI 服务请求失败 (${aiResponse.status})` }, { status: 502 })
    }

    const aiData = await aiResponse.json()
    const message = aiData.choices?.[0]?.message
    const content = message?.content || message?.reasoning_content || ''

    if (!content) {
      return NextResponse.json({ error: 'AI 未返回有效内容' }, { status: 502 })
    }

    let refinedRaw: Record<string, unknown>
    try {
      refinedRaw = extractJSON(content) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'AI 返回内容解析失败，请重试', raw: content }, { status: 502 })
    }

    // 将补查结果与原始已确认数据深度合并
    const mergedData = deepMerge(confirmed_data as Record<string, unknown>, refinedRaw) as unknown as SchoolData
    const citations: string[] = aiData.citations || []
    const data_quality = calcDataQuality(schoolName, mergedData, citations)

    return NextResponse.json({
      status: data_quality.missing_fields.length === 0 ? 'success' : 'partial',
      refined_data: refinedRaw,
      data_quality,
      citations,
    })
  } catch (error) {
    console.error('Refine API error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}

/**
 * 构造兜底补查的 System Prompt（PRD §4.4 定向补查 Prompt）
 */
function buildRefinePrompt(
  schoolName: string,
  confirmedData: Partial<SchoolData>,
  missingFields: string[],
  recommendedQueries: string[],
): string {
  const confirmedSummary = buildConfirmedSummary(confirmedData)
  const fieldStrategies = buildFieldStrategies(schoolName, missingFields)
  const queriesHint = recommendedQueries.length > 0
    ? `\n推荐使用以下搜索词（可直接搜索）：\n${recommendedQueries.map((q) => `  - ${q}`).join('\n')}`
    : ''

  return `你是精准信息检索专家，负责针对性补充缺失的院校信息。

目标院校：${schoolName}

⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- JSON 字符串值内禁止用英文双引号 " 引用词语，改用【】或「」
- 只输出缺失字段的补查结果，不要重复已确认字段

已确认准确的字段（请不要重新检索，直接信任）：
${confirmedSummary}

需补查的字段及策略：
${fieldStrategies}
${queriesHint}

降级处理规则：
- 若某字段确实无法找到，在该字段值后追加 "_fallback_note" 键，值为降级说明
- 例如：若无法找到校歌，返回 { "culture": { "school_song_excerpt": "【暂无】", "school_song_excerpt_fallback_note": "官方网站未公开完整歌词" } }
- 颜色 HEX 若无法从官方来源获取，必须在 standard_colors 中标注 source_level 为 L5
- 所有补查结果必须附带来源 URL（字段名 + _source_url）

输出仅包含需要补查的维度字段，格式与 collect 接口的 schema 保持一致。`
}

function buildConfirmedSummary(confirmedData: Partial<SchoolData>): string {
  const summaryItems: string[] = []
  if (confirmedData.basic?.full_name) summaryItems.push(`- 学校全称：${confirmedData.basic.full_name}`)
  if (confirmedData.culture?.motto) summaryItems.push(`- 校训：${confirmedData.culture.motto}`)
  if (confirmedData.symbols?.standard_colors?.length) {
    summaryItems.push(`- 标准校色：已采集 ${confirmedData.symbols.standard_colors.length} 个颜色`)
  }
  if (confirmedData.history?.timeline?.length) {
    summaryItems.push(`- 历史时间轴：已采集 ${confirmedData.history.timeline.length} 条`)
  }
  return summaryItems.length > 0 ? summaryItems.join('\n') : '（无已确认字段，需全量检索）'
}

function buildFieldStrategies(schoolName: string, missingFields: string[]): string {
  const strategies: string[] = []

  for (const field of missingFields) {
    if (field.includes('standard_colors')) {
      strategies.push(`【标准校色】搜索：${schoolName} 校色 HEX RGB 官方 site:edu.cn
  - 若官网无明确说明，改搜：${schoolName} 校徽颜色 主色调 品牌色
  - 按 L1→L5 优先级填写 source_level 字段`)
    } else if (field.includes('school_song')) {
      strategies.push(`【校歌歌词】搜索：${schoolName} 校歌 完整版歌词
  - 优先从官网找，其次百科
  - 若只找到部分歌词，填写现有内容并在 fallback_note 注明`)
    } else if (field.includes('history.timeline')) {
      strategies.push(`【历史时间轴】搜索：${schoolName} 发展历史 大事记
  - 需要至少 5 条含年份的历史事件`)
    } else if (field.includes('landmarks')) {
      strategies.push(`【地标建筑】搜索：${schoolName} 标志性建筑 代表建筑物
  - 至少列出 3 处有名称和描述的建筑`)
    } else if (field.includes('b2b_highlights')) {
      strategies.push(`【B端亮点】根据已知的学校信息提炼 3-5 条面向企业采购的项目亮点
  - 强调历史底蕴、学术成就、校园特色等维度
  - 格式为字符串数组，每条 20-40 字`)
    } else if (field.includes('ecology.plants')) {
      strategies.push(`【校花/校树】搜索：${schoolName} 校花 校树 官方认定
  - 若无官方认定，说明该学校未正式指定校花/校树`)
    } else if (field.includes('academics')) {
      strategies.push(`【学科专业】搜索：${schoolName} 优势学科 特色专业 国家级重点
  - 至少列出 5 个专业或学科，最好包含教育部评估结果`)
    }
  }

  return strategies.length > 0 ? strategies.join('\n\n') : '请针对以下缺失字段进行精准搜索：\n' + missingFields.join('\n')
}
