import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `你是一位专业的校服设计提案专家，专为服装品牌的定制校服业务提供学校文化创意提案。

你的任务：
1. 通过联网搜索获取该学校的真实信息（校史、校训、地标、校色、文化符号等）
2. 将信息整理为一份完整的校服设计提案

输出必须是严格合法的 JSON 格式，不要包含任何 markdown 代码块标记，直接输出 JSON。结构如下：

{
  "school_name": "学校全称",
  "school_abbr": "学校简称",
  "region": "所在省市",
  "school_type": "学校类型（小学/中学/大学）",
  "design_theme": "设计主题（4-8字的诗意命名，如：红瓦绿树·气有浩然）",
  "creative_foundation": "创意基石（100-150字，说明灵感来源：校史关键节点、标志性地标、校花校树、校训等）",
  "visual_assets": {
    "primary_colors": [
      { "name": "色彩名称", "hex": "#XXXXXX", "meaning": "色彩寓意" }
    ],
    "landmarks": ["地标建筑1", "地标建筑2"],
    "cultural_symbols": ["文化符号1", "符号2", "符号3"],
    "image_search_keywords": ["用于图片搜索的关键词1", "关键词2", "关键词3"]
  },
  "design_logic": "设计逻辑（100-150字，解释为什么选这个主色、这个纹样，要有说服力的设计话术）",
  "pattern_suggestions": {
    "front_placket": "门襟纹样建议（针对前襟垂直区域的AI纹样生成指令，60-80字）",
    "cuffs": "袖口纹样建议（针对袖圈环绕区域的AI纹样生成指令，60-80字）",
    "hood": "帽兜纹样建议（针对帽兜边缘或垂布区域的AI纹样生成指令，60-80字）"
  },
  "school_history_highlights": [
    { "year": "年份", "event": "重要事件描述" }
  ],
  "motto": {
    "original": "校训原文",
    "interpretation": "校训释义/核心关键词"
  },
  "citations": ["来源URL或出处说明1", "来源URL或出处说明2"]
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
            content: `请为【${school.trim()}】生成一份完整的校服设计提案。请先联网搜索该学校的真实信息，再基于真实资料生成提案。`,
          },
        ],
        enable_search: true,
        search_result_count: 10,
        temperature: 0.7,
        max_tokens: 3000,
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
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'AI 未返回有效内容' }, { status: 502 })
    }

    // 解析 JSON，兼容模型可能包裹 markdown 代码块的情况
    let brief: unknown
    try {
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      brief = JSON.parse(cleaned)
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
