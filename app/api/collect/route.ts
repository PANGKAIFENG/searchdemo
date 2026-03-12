import { NextRequest, NextResponse } from 'next/server'
import { SchoolData, ImageSearchHints } from '@/app/types'
import { extractJSON, sanitize } from '@/app/lib/utils'
import { calcDataQuality } from '@/app/lib/quality-check'

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
    "school_song_excerpt": "校歌歌名+完整歌词（若歌词过长，保留全部，不截断）",
    "vision": "办学愿景（官方表述）",
    "core_spirit": "核心精神关键词（3-5个，如：爱国、进步、民主、科学）"
  },
  "symbols": {
    "emblem_description": "校徽官方释义，描述图形构成与寓意",
    "flag_description": "校旗说明，描述颜色、图案与象征",
    "standard_colors": [
      {
        "name": "颜色中文名（官方命名优先；AI命名时在 extraction_note 中注明）",
        "hex": "#XXXXXX（必须为 #RRGGBB 格式，严禁捏造）",
        "rgb": "R___ G___ B___（与 hex 一致）",
        "usage": "primary|secondary|accent（主色/辅色/点缀色）",
        "source_level": "L1|L2|L3|L4|L5（按下方分级规则填写）",
        "source_url": "颜色信息来源的完整URL",
        "confidence": 0.9,
        "is_official": true,
        "conflict": false,
        "conflict_note": "（若 conflict=true 则填写冲突说明，否则留空字符串）",
        "extraction_note": "（若 source_level=L5 则填写图像提取说明，否则留空字符串）"
      }
    ]
  },
  "history": {
    "timeline": [
      { "year": "年份", "event": "该年发生的重要历史事件，20-40字" }
    ],
    "notable_alumni": "代表性校友名单，3-8人，格式：姓名（身份）"
  },
  "landmarks": {
    "buildings": "标志性建筑名称，逗号分隔，如：未名湖、博雅塔、图书馆（至少3处）",
    "stone_carvings": "非遗石刻或碑文，无则填【暂无】",
    "sculptures": "校园著名雕塑，无则填【暂无】"
  },
  "ecology": {
    "plants": "校花/校树名称及象征，如：北京大学校花为桃花，象征...",
    "geography": "校园湖泊、山丘、河流等自然地理要素"
  },
  "academics": {
    "strong_disciplines": "强势学科或优势专业（至少5个），逗号分隔",
    "major_achievements": "重大科技成果或获奖（2-4条），逗号分隔"
  },
  "marketing": {
    "president_message": "校长寄语核心句，50字以内",
    "campus_slogan": "校园流行语或非官方口号",
    "student_nickname": "学生对母校的昵称或情感称呼",
    "b2b_highlights": [
      "B端项目亮点1（面向企业采购，直接可用于提案PPT，20-40字）",
      "B端项目亮点2",
      "B端项目亮点3"
    ]
  },
  "image_search_hints": {
    "emblem": ["学校名 校徽 官方 高清"],
    "landmark": ["学校名 具体地标1", "学校名 具体地标2", "学校名 具体地标3"],
    "scenery": ["学校名 校园风景", "学校名 航拍 秋景"]
  }
}

【标准校色专项规则（standard_colors 字段必须遵守）】
请按以下优先级逐级尝试获取标准校色，成功获取后停止，不继续向下级尝试：

L1（可信度1.0）：搜索学校官网 VIS 视觉标识手册
  - 搜索：site:学校域名 VIS 视觉 校色 HEX 或 品牌规范 色彩
  - 若找到官方文档，提取其中主色/辅色的 HEX 值

L2（可信度0.9）：访问学校官网首页
  - 提取页面 CSS 中高频有彩色值（排除纯黑白灰，饱和度<10%不选）
  - 提取校徽 SVG 中的 fill 颜色属性

L3（可信度0.8）：搜索百度百科/维基百科院校词条
  - 提取"标志色""主色调"等字段，必须记录来源 URL

L4（可信度0.6）：搜索媒体报道
  - 搜索："学校名" 校色 OR 主色 OR 品牌色 OR 校徽颜色 HEX
  - 必须记录来源 URL

L5（可信度0.4，兜底）：若以上均失败
  - source_level 填 "L5"，confidence 填 0.4，is_official 填 false
  - extraction_note 填写：「该颜色由校徽图像推测，非官方公布数值，仅供参考」
  - 尽量基于校徽图片的主色调进行推测

颜色合法性规则：
- hex 必须为 #RRGGBB 格式（如 #9D2235），禁止使用颜色关键词（如 red）
- 纯黑 #000000 和纯白 #FFFFFF 不得作为主色（除非官方明确声明）
- 若确实无法获取任何颜色，standard_colors 返回空数组 []

注意：
- image_search_hints.landmark 的关键词必须来自上面 landmarks.buildings 中的真实地标名称
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
        temperature: 0.3,
        max_tokens: 8000,
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

    // 处理某些模型触发安全策略被阻断的情况
    if (content.includes("I can't discuss that") || content.includes("I cannot fulfill this request")) {
      return NextResponse.json({
        error: '该学校的关联搜索触发了 AI 平台的安全策略，建议在学校名称后加上"大学官方"重新尝试，或换一所学校。',
        raw: content,
      }, { status: 502 })
    }

    let raw: Record<string, unknown>
    try {
      raw = extractJSON(content) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'AI 返回内容解析失败（可能是触发了安全限制或搜索异常），请重试', raw: content }, { status: 502 })
    }

    // 分离 image_search_hints 和 schoolData
    const { image_search_hints, ...schoolDataRaw } = raw
    const schoolData = schoolDataRaw as unknown as SchoolData
    const hints = (image_search_hints as ImageSearchHints) || {
      emblem: [`${schoolName} 校徽 官方 高清`],
      landmark: [`${schoolName} 标志性建筑`, `${schoolName} 图书馆`],
      scenery: [`${schoolName} 校园风景`, `${schoolName} 校园`],
    }

    const citations: string[] = aiData.citations || []

    // 计算数据质量评分
    const data_quality = calcDataQuality(schoolName, schoolData, citations)

    return NextResponse.json({
      school_name: schoolName,
      school_data: schoolData,
      data_quality,
      image_search_hints: hints,
      citations,
    })
  } catch (error) {
    console.error('Collect API error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}

// sanitize 仍在此处保留，以兼容 extractJSON 内部使用
// 实际已统一到 lib/utils.ts，此处仅为向后兼容的类型导出
export { sanitize }
