import { NextRequest, NextResponse } from 'next/server'
import { SchoolData, ImageResult, Step2Brief } from '@/app/types'

export const maxDuration = 60

const BRIEF_PROMPT = `你是专业的校服纹样设计顾问。根据以下学校文化资料，生成一份校服纹样设计方案。

⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- JSON 字符串值内禁止用英文双引号 " 引用词语，改用【】或「」
- pattern_suggestions 中 prompt 字段用中文描述，供 AI 图片生成使用

输出格式：
{
  "design_theme": "设计主题，10字以内的精炼标题",
  "creative_foundation": "创意基石，50-80字，说明从哪些具体文化符号（建筑、植物、色彩、历史）提炼设计灵感",
  "design_logic": "设计逻辑，80-120字，解释色彩体系、纹样构成与学校精神的对应关系，以及三个纹样位置的整体呼应关系",
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
- image_index 是参考图片列表中最相关图片的索引（从0开始），不相关时填 -1
- 三个位置的纹样在文化元素上应相互呼应，形成完整的视觉叙事
- prompt 要具体描述纹样的视觉特征、文化元素，越具体越好，不要只写通用描述`

export async function POST(request: NextRequest) {
  try {
    const { schoolData, images } = await request.json() as { schoolData: SchoolData; images: ImageResult[] }

    if (!schoolData) {
      return NextResponse.json({ error: '缺少学校数据' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
    const model = process.env.GEEKAI_MODEL || 'gpt-4o'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const userContent = buildUserContent(schoolData, images)

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: BRIEF_PROMPT },
          { role: 'user', content: userContent },
        ],
        enable_search: false,
        temperature: 0.5,
        max_tokens: 3000,
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

  const colors = data.symbols.standard_colors
    .map((c) => `${c.name}（${c.hex}，${c.description}）`)
    .join('、')

  const timeline = data.history.timeline
    .map((t) => `${t.year}：${t.event}`)
    .join('；')

  return `请基于以下院校文化资料生成校服纹样设计方案：

【基本信息】
- 校名：${data.basic.full_name}（${data.basic.short_name}）
- 创办：${data.basic.founded_year} | 地点：${data.basic.location}
- 简介：${data.basic.introduction}

【文化灵魂】
- 校训：${data.culture.motto}
- 核心精神：${data.culture.core_spirit}
- 校歌片段：${data.culture.school_song_excerpt}

【视觉符号】
- 校徽：${data.symbols.emblem_description}
- 标准校色：${colors || '未填写'}

【地标与生态】
- 标志性建筑：${data.landmarks.buildings}
- 著名雕塑：${data.landmarks.sculptures}
- 校花/校树：${data.ecology.plants}
- 地理环境：${data.ecology.geography}

【强势学科与成果】
- 强势学科：${data.academics.strong_disciplines || '未填写'}
- 重大成果：${data.academics.major_achievements || '未填写'}

【营销话术】
- 校长寄语：${data.marketing.president_message || '未填写'}
- 学生昵称：${data.marketing.student_nickname || '未填写'}
- 校园流行语：${data.marketing.campus_slogan || '未填写'}

【历史节点】${timeline ? '\n' + timeline : '无'}

【参考图片列表（用于 image_index 推荐）】
${imageList || '  无参考图片'}

请严格按照 JSON 格式输出设计方案，image_index 从上述图片列表中选择（地标图片优先用于相应位置的纹样推荐）。`
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
