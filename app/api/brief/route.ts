import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `你是一位专业的校服设计提案专家。

⚠️ 极其重要的输出规则：
- 你的回复必须且只能是一个合法的 JSON 对象
- 不要输出任何 JSON 以外的内容：不要有说明文字、不要有 markdown、不要有代码块标记
- 直接以 { 开头，以 } 结尾
- 禁止输出 \`\`\`json 或 \`\`\` 标记
- JSON 字符串值内部禁止使用双引号 " 引用词语，改用【】或「」括起来

你的任务：
1. 通过联网搜索获取该学校的真实信息（校史、校训、地标、校色、文化符号等）
2. 将信息整理为校服设计提案，以下列 JSON 结构输出：

{
  "school_name": "学校全称",
  "school_abbr": "学校简称",
  "region": "所在省市",
  "school_type": "学校类型（小学/中学/大学）",
  "design_theme": "设计主题（4-8字的诗意命名）",
  "creative_foundation": "创意基石（100-150字，说明灵感来源）",
  "visual_assets": {
    "primary_colors": [
      { "name": "色彩名称", "hex": "#XXXXXX", "meaning": "色彩寓意" }
    ],
    "landmarks": ["地标建筑1", "地标建筑2"],
    "cultural_symbols": ["文化符号1", "符号2"],
    "image_search_keywords": ["图片搜索关键词1", "关键词2"]
  },
  "design_logic": "设计逻辑（100-150字）",
  "pattern_suggestions": {
    "front_placket": "门襟纹样建议（60-80字）",
    "cuffs": "袖口纹样建议（60-80字）",
    "hood": "帽兜纹样建议（60-80字）"
  },
  "school_history_highlights": [
    { "year": "年份", "event": "重要事件" }
  ],
  "motto": {
    "original": "校训原文",
    "interpretation": "校训释义"
  },
  "citations": ["来源URL1", "来源URL2"]
}`

export async function POST(request: NextRequest) {
  try {
    const { school } = await request.json()

    if (!school || typeof school !== 'string' || school.trim().length === 0) {
      return NextResponse.json({ error: '请输入学校名称' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
    const model = process.env.GEEKAI_MODEL || 'gpt-4o'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `请为【${school.trim()}】生成校服设计提案。先联网搜索真实信息，然后直接输出 JSON，不要任何其他内容。`,
          },
        ],
        enable_search: true,
        search_result_count: 10,
        temperature: 0.7,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('GeeKAI API error:', response.status, errorText)
      return NextResponse.json(
        { error: `AI 服务请求失败 (${response.status})` },
        { status: 502 }
      )
    }

    const data = await response.json()
    const message = data.choices?.[0]?.message
    const content = message?.content || message?.reasoning_content || ''

    if (!content) {
      return NextResponse.json({ error: 'AI 未返回有效内容' }, { status: 502 })
    }

    // 解析 JSON：从内容中提取第一个完整的 JSON 对象
    let brief: unknown
    try {
      brief = extractJSON(content)
    } catch {
      return NextResponse.json(
        { error: 'AI 返回格式异常，请重试', raw: content },
        { status: 502 }
      )
    }

    return NextResponse.json({ brief, citations: data.citations || [] })
  } catch (error) {
    console.error('Brief API error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}

// 从可能包含思考过程、function_calls 标签、markdown 代码块的文本中提取 JSON
function extractJSON(text: string): unknown {
  // 1. 优先提取 ```json ... ``` 块
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    return JSON.parse(sanitizeJSON(codeBlockMatch[1].trim()))
  }

  // 2. 提取第一个 { 到最后一个 } 之间的内容
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(sanitizeJSON(text.slice(start, end + 1)))
  }

  throw new Error('No JSON found in response')
}

// 修复 JSON 字符串值中的未转义双引号（模型有时会在值中插入裸双引号）
function sanitizeJSON(raw: string): string {
  // 将 JSON 字符串值中出现的中文全角双引号替换为书名号，避免解析歧义
  return raw
    .replace(/\u201c/g, '「') // 左双弯引号 "
    .replace(/\u201d/g, '」') // 右双弯引号 "
}
