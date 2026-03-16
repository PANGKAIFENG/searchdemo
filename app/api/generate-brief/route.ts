import { NextRequest, NextResponse } from 'next/server'
import { SchoolData, ImageResult, Step2Brief } from '@/app/types'
import { extractJSON } from '@/app/lib/utils'

export const maxDuration = 60

type DesignStyle = '经典传承' | '现代简约' | '自然生态'

const STYLE_DESCRIPTIONS: Record<DesignStyle, string> = {
  经典传承: '以中式纹样融合学院风为核心，强调学校历史底蕴与文化传承，运用传统工艺语汇（如刺绣、暗纹、云纹）提炼校园经典符号',
  现代简约: '以几何抽象为手法，提炼学校核心符号的最简形式，干净克制，线条利落，适合现代运动类校服',
  自然生态: '以校园植被、自然景观为主题，善用校花/校树等生态元素，强调自然生命力与校园人文氛围的融合',
}

function buildBriefPrompt(style: DesignStyle): string {
  return `你是专业的校服纹样设计顾问，当前设计风格为【${style}】。
风格说明：${STYLE_DESCRIPTIONS[style]}

根据以下学校文化资料，生成一份校服纹样设计方案。

⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- JSON 字符串值内禁止用英文双引号 " 引用词语，改用【】或「」
- pattern_suggestions 中 prompt 字段用中文描述，供 AI 图片生成使用

输出格式：
{
  "design_theme": "设计主题，10字以内的精炼标题",
  "creative_foundation": "灵感来源，100-150字，明确说明引用了哪些具体的院校文化元素（建筑/植物/色彩/历史），格式：以[具体元素]为灵感核心，结合[另一元素]...",
  "design_logic": "设计推导，150-200字，解释每个文化元素如何转化为具体服装设计语言，包含色彩方案（附HEX）、纹样设计方向、面料暗纹参考",
  "design_philosophy": "设计理念精华，50-80字，可直接用于提案PPT，语言清雅有力，必须包含院校名称或显著文化符号",
  "pattern_keywords_zh": ["纹样关键词1（来自地标/生态/符号）", "纹样关键词2", "...（共10-15个）"],
  "pattern_keywords_en": ["keyword1 in English", "keyword2", "...（与中文关键词一一对应）"],
  "color_palette": [
    { "name": "颜色名称", "hex": "#XXXXXX", "role": "主色|辅色|点缀色" }
  ],
  "pattern_suggestions": [
    {
      "position": "门襟",
      "rationale": "该位置纹样的设计理由，30-50字，说明为何选择此文化元素装饰门襟",
      "prompt": "中文生图提示词：校服门襟纹样，融入【具体文化元素】，刺绣风格，对称构图，白色背景，平铺展示，高清细节",
      "image_index": 0
    },
    {
      "position": "袖口",
      "rationale": "...",
      "prompt": "中文生图提示词...",
      "image_index": 1
    },
    {
      "position": "帽兜",
      "rationale": "...",
      "prompt": "中文生图提示词...",
      "image_index": 2
    }
  ]
}

注意：
- image_index 必须是参考图片列表中的有效索引（0 到 N-1），严禁填 -1；若无完全匹配，选最接近主题的已有图片
- 【无图片的元素】列表中的元素，禁止在 prompt 字段中作为视觉主体引用；可在 rationale 中提及，但 prompt 只描述有图片支撑的视觉元素
- 三个位置的纹样在文化元素上应相互呼应，形成完整的视觉叙事
- prompt 要具体描述纹样的视觉特征、文化元素，越具体越好
- color_palette 优先使用学校 standard_colors 中提供的 HEX 值
- design_philosophy 和 creative_foundation 必须引用真实的院校元素，不可使用通用描述`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { schoolData: SchoolData; images: ImageResult[]; style?: DesignStyle }
    const { schoolData, images } = body
    const style: DesignStyle = body.style ?? '经典传承'

    if (!schoolData) {
      return NextResponse.json({ error: '缺少学校数据' }, { status: 400 })
    }

    const validStyles: DesignStyle[] = ['经典传承', '现代简约', '自然生态']
    if (!validStyles.includes(style)) {
      return NextResponse.json({ error: `style 参数无效，只支持：${validStyles.join('、')}` }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
    const model = process.env.GEEKAI_MODEL || 'gpt-4o'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const systemPrompt = buildBriefPrompt(style)
    const userContent = buildUserContent(schoolData, images ?? [])

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        enable_search: false,
        temperature: 0.5,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `AI 服务请求失败 (${res.status})` }, { status: 502 })
    }

    const aiData = await res.json()
    const message = aiData.choices?.[0]?.message
    const content = message?.content || message?.reasoning_content || ''

    if (!content) {
      return NextResponse.json({ error: 'AI 未返回有效内容' }, { status: 502 })
    }

    let raw: Record<string, unknown>
    try {
      raw = extractJSON(content) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'AI 返回格式异常，请重试' }, { status: 502 })
    }

    const brief: Step2Brief = {
      designTheme: String(raw.design_theme || ''),
      creativeFoundation: String(raw.creative_foundation || ''),
      designLogic: String(raw.design_logic || ''),
      designPhilosophy: raw.design_philosophy ? String(raw.design_philosophy) : undefined,
      patternKeywordsZh: Array.isArray(raw.pattern_keywords_zh)
        ? raw.pattern_keywords_zh.map(String)
        : undefined,
      patternKeywordsEn: Array.isArray(raw.pattern_keywords_en)
        ? raw.pattern_keywords_en.map(String)
        : undefined,
      colorPalette: normalizeColorPalette(raw.color_palette),
      patternSuggestions: normalizePatterns(raw.pattern_suggestions),
    }

    return NextResponse.json({ brief })
  } catch (error) {
    console.error('Generate brief error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}

function buildUserContent(data: SchoolData, images: ImageResult[]): string {
  const imageList = images
    .map((img, i) => `  [${i}] ${img.category_label} — ${img.title}（关键词：${img.search_keyword}）`)
    .join('\n')

  const colors = data.symbols?.standard_colors
    ?.map((c) => `${c.name}（${c.hex}，来源级别：${c.source_level ?? '未知'}，可信度：${c.confidence ?? '-'}）`)
    .join('、') ?? '未填写'

  const timeline = data.history?.timeline
    ?.map((t) => `${t.year}：${t.event}`)
    .join('；') ?? ''

  const academicsSection = buildAcademicsSection(data)
  const marketingSection = buildMarketingSection(data)

  return `请基于以下院校文化资料生成校服纹样设计方案：

【基本信息】
- 校名：${data.basic?.full_name}（${data.basic?.short_name}）
- 创办：${data.basic?.founded_year} | 地点：${data.basic?.location}
- 简介：${data.basic?.introduction}

【文化灵魂】
- 校训：${data.culture?.motto}
- 核心精神：${data.culture?.core_spirit}
- 校歌片段：${data.culture?.school_song_excerpt}

【视觉符号】
- 校徽：${data.symbols?.emblem_description}
- 标准校色：${colors}

【地标与生态】
- 标志性建筑：${data.landmarks?.buildings}
- 著名雕塑：${data.landmarks?.sculptures}
- 校花/校树：${data.ecology?.plants}
- 地理环境：${data.ecology?.geography}
${academicsSection}
${marketingSection}
【历史节点】${timeline ? '\n' + timeline : '无'}

【参考图片列表（用于 image_index 推荐）】
${imageList || '  无参考图片'}

【图片覆盖分析】
${buildImageCoverageAnalysis(data, images)}

请严格按照 JSON 格式输出设计方案，image_index 从上述图片列表中选择（地标图片优先用于相应位置的纹样推荐）。`
}

function buildAcademicsSection(data: SchoolData): string {
  const parts: string[] = ['\n【学术荣誉】']
  const academics = data.academics

  if (academics?.strong_disciplines && !academics.strong_disciplines.includes('暂无')) {
    parts.push(`- 强势学科：${academics.strong_disciplines}`)
  }
  if (academics?.major_achievements && !academics.major_achievements.includes('暂无')) {
    parts.push(`- 重大成果：${academics.major_achievements}`)
  }

  return parts.length > 1 ? parts.join('\n') : ''
}

function buildMarketingSection(data: SchoolData): string {
  const parts: string[] = ['\n【营销话术参考】']
  const marketing = data.marketing

  if (marketing?.b2b_highlights?.length) {
    const validHighlights = marketing.b2b_highlights.filter((h) => h?.trim() && !h.includes('暂无'))
    if (validHighlights.length > 0) {
      parts.push(`- B端亮点：${validHighlights.join('；')}`)
    }
  }
  if (marketing?.president_message && !marketing.president_message.includes('暂无')) {
    parts.push(`- 校长寄语：${marketing.president_message}`)
  }
  if (marketing?.campus_slogan && !marketing.campus_slogan.includes('暂无')) {
    parts.push(`- 校园话术：${marketing.campus_slogan}`)
  }
  if (marketing?.student_nickname && !marketing.student_nickname.includes('暂无')) {
    parts.push(`- 学生昵称：${marketing.student_nickname}`)
  }

  return parts.length > 1 ? parts.join('\n') : ''
}

function buildImageCoverageAnalysis(data: SchoolData, images: ImageResult[]): string {
  if (images.length === 0) return '无参考图片，所有 image_index 填 0（如有图片）或跳过视觉引用。'

  // 从图片 category_label 和 search_keyword 提取关键词集合
  const coveredKeywords = new Set<string>()
  images.forEach((img) => {
    const label = img.category_label || ''
    const kw = img.search_keyword || ''
    const labelSuffix = label.replace(/^校园地标-|^校园风景-/, '').trim()
    if (labelSuffix) coveredKeywords.add(labelSuffix)
    const kwSuffix = kw.replace(data.basic?.full_name || '', '').replace(data.basic?.short_name || '', '').trim()
    if (kwSuffix) coveredKeywords.add(kwSuffix)
  })

  // 检查校花/校树是否有图片覆盖
  const uncovered: string[] = []
  if (data.ecology?.plants) {
    const plantNames = data.ecology.plants
      .replace(/校花[：:]/g, '').replace(/校树[：:]/g, '')
      .split(/[；;，,、\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 8)

    plantNames.forEach((name) => {
      const hasCoverage = Array.from(coveredKeywords).some((kw) => kw.includes(name) || name.includes(kw))
      if (!hasCoverage) uncovered.push(name)
    })
  }

  const coveredList = `有图片支撑的元素：${images.map((img, i) => `${img.category_label}（index ${i}）`).join('、')}`
  const uncoveredList = uncovered.length > 0
    ? `\n无图片的元素（禁止在 prompt 中作为视觉主体引用）：${uncovered.join('、')}`
    : '\n所有主要文化元素均有图片支撑。'

  return coveredList + uncoveredList
}

function normalizeColorPalette(raw: unknown): Step2Brief['colorPalette'] {
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: String(item.name || ''),
      hex: String(item.hex || ''),
      role: String(item.role || ''),
    }))
    .filter((item) => item.name && item.hex)
}

function normalizePatterns(raw: unknown): import('@/app/types').PatternSuggestion[] {
  const positions = ['门襟', '袖口', '帽兜'] as const
  if (!Array.isArray(raw)) return positions.map((position) => ({ position, rationale: '', prompt: '', imageIndex: -1 }))

  return positions.map((position, i) => {
    const item = raw[i] as Record<string, unknown> | undefined
    return {
      position,
      rationale: String(item?.rationale || ''),
      prompt: String(item?.prompt || ''),
      imageIndex: typeof item?.image_index === 'number' ? item.image_index : -1,
    }
  })
}
