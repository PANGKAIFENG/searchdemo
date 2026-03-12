import { NextRequest, NextResponse } from 'next/server'
import { ValidateResult } from '@/app/types'

export const maxDuration = 30

const VALIDATE_PROMPT = `你是一个中国院校名称识别专家，负责帮助用户确认学校的完整官方名称。

⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字

任务：根据用户输入，判断是否是明确的学校官方名称，并返回以下格式：

{
  "status": "confirmed" | "ambiguous" | "not_found",
  "confirmed_name": "学校全称（仅 status=confirmed 时填写）",
  "candidates": [
    {
      "official_name": "学校官方全称",
      "location": "省市，如：北京市海淀区",
      "level": "院校层次，如：985/211/双一流 或 普通本科 或 专科 或 附属中学 等",
      "website": "官方网站域名，如：pku.edu.cn，若无则填空字符串",
      "is_recommended": true或false（综合可信度最高的标 true，最多1个）,
      "recommend_reason": "推荐理由，如：全称匹配、官方 edu.cn 域名权威"
    }
  ],
  "error_message": "仅 status=not_found 时填写原因"
}

规则：
1. 若输入是唯一明确的学校全称（官方注册名称完整），直接返回 status=confirmed，confirmed_name 填写标准全称
2. 若输入是简称/别称/存在多所同名学校，返回 status=ambiguous，candidates 列出所有可能
3. 候选列表按以下优先级排序：985/211 > 普通本科 > 专科 > 中学 > 其他
4. 候选中 is_recommended 最多设置一个为 true
5. 若完全无法匹配，返回 status=not_found
6. 禁止捏造不存在的学校
7. 名称中包含省份/地区限定词时（如"广东的海大"），优先过滤对应地区的学校`

export async function POST(request: NextRequest) {
  try {
    const { input, region, school_type } = await request.json()

    if (!input || typeof input !== 'string' || !input.trim()) {
      return NextResponse.json({ error: '请输入学校名称' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
    const model = process.env.GEEKAI_MODEL || 'gpt-4o'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const userMsg = buildUserMsg(input.trim(), region, school_type)

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: VALIDATE_PROMPT },
          { role: 'user', content: userMsg },
        ],
        enable_search: false,  // 歧义判断用模型已有知识即可
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `AI 服务请求失败 (${res.status})` }, { status: 502 })
    }

    const aiData = await res.json()
    const content = aiData.choices?.[0]?.message?.content || ''

    if (!content) {
      return NextResponse.json({ error: 'AI 未返回有效内容' }, { status: 502 })
    }

    let result: ValidateResult
    try {
      result = extractJSON(content) as ValidateResult
    } catch {
      return NextResponse.json({ error: 'AI 返回格式异常，请重试' }, { status: 502 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Validate API error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}

function buildUserMsg(input: string, region?: string, school_type?: string): string {
  let msg = `请识别以下输入：【${input}】`
  if (region) msg += `\n用户补充地区：${region}`
  if (school_type) msg += `\n用户补充学校类型：${school_type}`
  msg += '\n\n请直接输出 JSON，不要任何其他内容。'
  return msg
}

function extractJSON(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1))
  throw new Error('No JSON found')
}
