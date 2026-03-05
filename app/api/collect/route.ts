import { NextRequest, NextResponse } from 'next/server'
import { SchoolData, ImageResult } from '@/app/types'

const COLLECT_PROMPT = `你是院校文化资料采集专家，负责为学位服/校服设计项目收集学校的原始素材。

⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- JSON 字符串值内禁止用英文双引号 " 引用词语，改用【】或「」

请联网搜索该学校，按以下 8 个维度采集真实信息：

{
  "basic": {
    "full_name": "学校全称",
    "short_name": "常用简称",
    "founded_year": "创办年份（如1898）",
    "location": "地理位置（如中国·北京）",
    "introduction": "院校简介，100-200字，涵盖学校定位、规模、特色"
  },
  "culture": {
    "motto": "校训原文",
    "school_song_excerpt": "校歌核心句或片段，50字以内",
    "vision": "办学愿景（如：建设世界一流大学）",
    "core_spirit": "核心精神关键词（如：爱国、进步、民主、科学）"
  },
  "symbols": {
    "emblem_description": "校徽官方释义，描述图形构成与寓意",
    "flag_description": "校旗说明，描述颜色、图案与象征",
    "standard_colors": [
      { "name": "颜色名称", "hex": "#XXXXXX", "description": "该颜色的象征意义与使用场景" }
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
  }
}`

export async function POST(request: NextRequest) {
  try {
    const { school } = await request.json()

    if (!school || typeof school !== 'string' || !school.trim()) {
      return NextResponse.json({ error: '请输入学校名称' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
    const model = process.env.GEEKAI_MODEL || 'gpt-4o'
    const serperKey = process.env.SERPER_API_KEY

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const schoolName = school.trim()

    // 并行：AI 采集文字数据 + Serper 搜索图片
    const [aiResponse, images] = await Promise.all([
      fetchSchoolData(schoolName, apiKey, baseUrl, model),
      serperKey ? fetchImages(schoolName, serperKey) : Promise.resolve([]),
    ])

    if (!aiResponse.ok) {
      return NextResponse.json({ error: `AI 服务请求失败 (${aiResponse.status})` }, { status: 502 })
    }

    const aiData = await aiResponse.json()
    const message = aiData.choices?.[0]?.message
    const content = message?.content || message?.reasoning_content || ''

    if (!content) {
      return NextResponse.json({ error: 'AI 未返回有效内容' }, { status: 502 })
    }

    let schoolData: SchoolData
    try {
      schoolData = extractJSON(content) as SchoolData
    } catch {
      return NextResponse.json({ error: 'AI 返回格式异常，请重试', raw: content }, { status: 502 })
    }

    return NextResponse.json({
      schoolName,
      schoolData,
      images,
      citations: aiData.citations || [],
    })
  } catch (error) {
    console.error('Collect API error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}

async function fetchSchoolData(
  school: string,
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<Response> {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: COLLECT_PROMPT },
        {
          role: 'user',
          content: `请采集【${school}】的院校文化资料。联网搜索后直接输出 JSON，不要任何其他内容。`,
        },
      ],
      enable_search: true,
      search_result_count: 15,
      temperature: 0.3,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
    }),
  })
}

async function fetchImages(school: string, apiKey: string): Promise<ImageResult[]> {
  // 搜索地标建筑 + 校园风景，每个关键词取 3 张
  const keywords = [
    `${school} 标志性建筑`,
    `${school} 校园风景`,
    `${school} 主楼 图书馆`,
  ]

  const results = await Promise.allSettled(
    keywords.map((kw) => searchImages(kw, apiKey))
  )

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

async function searchImages(keyword: string, apiKey: string): Promise<ImageResult[]> {
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: keyword, num: 5, gl: 'cn', hl: 'zh-cn' }),
    })

    if (!res.ok) return []

    const data = await res.json()
    const imgs = (data.images || []) as Array<{ title: string; imageUrl: string; link: string }>

    return imgs
      .filter((img) => img.imageUrl && !img.imageUrl.includes('icon'))
      .slice(0, 3)
      .map((img) => ({ keyword, title: img.title || keyword, imageUrl: img.imageUrl, link: img.link || '' }))
  } catch {
    return []
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
