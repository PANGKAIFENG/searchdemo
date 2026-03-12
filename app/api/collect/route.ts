import { NextRequest, NextResponse } from 'next/server'
import { SchoolData, ImageSearchHints } from '@/app/types'

export const maxDuration = 60

const COLLECT_PROMPT = `你是院校文化资料采集专家，负责为学位服/校服设计项目收集学校的原始素材。

⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- JSON 字符串值内禁止用英文双引号 " 引用词语，改用【】或「」

请联网搜索该学校，按以下 8 个维度采集真实信息，同时输出搜图关键词提示：

{
  "basic": {
    "full_name": "学校全称",
    "short_name": "常用简称",
    "founded_year": "创办年份（如1898）",
    "location": "地理位置（如中国·北京）",
    "introduction": "院校简介，约500字，涵盖历史沿革、办学定位、总体规模、核心优势"
  },
  "culture": {
    "motto": "校训原文（逐字提取，不可意译）",
    "school_song_excerpt": "校歌歌名+核心段落，50字以内",
    "vision": "办学愿景（官方表述）",
    "core_spirit": "核心精神关键词（3-5个，如：爱国、进步、民主、科学）"
  },
  "symbols": {
    "emblem_description": "校徽官方释义，描述图形构成与寓意",
    "flag_description": "校旗说明，描述颜色、图案与象征",
    "standard_colors": [
      { "name": "颜色名称（官方命名优先）", "hex": "#XXXXXX（必须精确，来自官网或VIS规范）", "description": "该颜色的象征意义与使用场景" }
    ]
  },
  "history": {
    "timeline": [
      { "year": "年份", "event": "该年发生的重要历史事件，20-40字" }
    ],
    "notable_alumni": "代表性校友名单，3-8人，格式：姓名（身份）"
  },
  "landmarks": {
    "buildings": "标志性建筑名称，逗号分隔，如：未名湖、博雅塔、图书馆",
    "stone_carvings": "非遗石刻或碑文，无则填【暂无】",
    "sculptures": "校园著名雕塑，无则填【暂无】"
  },
  "ecology": {
    "plants": "校花/校树名称及象征，如：北京大学校花为桃花，象征...",
    "geography": "校园湖泊、山丘、河流等自然地理要素"
  },
  "academics": {
    "strong_disciplines": "强势学科或优势专业，逗号分隔",
    "major_achievements": "重大科技成果或获奖，2-4条，逗号分隔"
  },
  "marketing": {
    "president_message": "校长寄语核心句，50字以内",
    "campus_slogan": "校园流行语或非官方口号",
    "student_nickname": "学生对母校的昵称或情感称呼"
  },
  "image_search_hints": {
    "emblem": ["学校名 校徽 官方 高清"],
    "landmark": ["学校名 具体地标1", "学校名 具体地标2", "学校名 具体地标3"],
    "scenery": ["学校名 校园风景", "学校名 航拍 秋景"]
  }
}

注意：
- image_search_hints.landmark 的关键词必须来自上面 landmarks.buildings 中的真实地标名称
- standard_colors 的 hex 值必须精确，优先来自官方 VIS 规范；若无法确认，在 description 中注明"颜色参考值"
- 所有信息必须真实，无法查到的字段填【暂无】或【待核实】，禁止捏造`

export async function POST(request: NextRequest) {
  try {
    const { school_name } = await request.json()

    if (!school_name || typeof school_name !== 'string' || !school_name.trim()) {
      return NextResponse.json({ error: '请输入学校名称' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
    const model = process.env.GEEKAI_MODEL || 'gpt-4o'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const schoolName = school_name.trim()

    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: COLLECT_PROMPT },
          {
            role: 'user',
            content: `请采集【${schoolName}】的院校文化资料。联网搜索后直接输出 JSON，不要任何其他内容。`,
          },
        ],
        enable_search: true,
        search_result_count: 15,
        temperature: 0.3,
        max_tokens: 6000,
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

    let raw: Record<string, unknown>
    try {
      raw = extractJSON(content) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'AI 返回格式异常，请重试', raw: content }, { status: 502 })
    }

    // 分离 image_search_hints 和 schoolData
    const { image_search_hints, ...schoolDataRaw } = raw
    const schoolData = schoolDataRaw as unknown as SchoolData
    const hints = (image_search_hints as ImageSearchHints) || {
      emblem: [`${schoolName} 校徽 官方 高清`],
      landmark: [`${schoolName} 标志性建筑`, `${schoolName} 图书馆`],
      scenery: [`${schoolName} 校园风景`, `${schoolName} 校园`],
    }

    return NextResponse.json({
      school_name: schoolName,
      school_data: schoolData,
      image_search_hints: hints,
      citations: aiData.citations || [],
    })
  } catch (error) {
    console.error('Collect API error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}

function extractJSON(text: string): unknown {
  const match = text.match(/```json\s*([\s\S]*?)```/)
  if (match) return JSON.parse(sanitize(match[1].trim()))

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) return JSON.parse(sanitize(text.slice(start, end + 1)))

  throw new Error('No JSON found')
}

function sanitize(raw: string): string {
  return raw.replace(/\u201c/g, '「').replace(/\u201d/g, '」')
}
