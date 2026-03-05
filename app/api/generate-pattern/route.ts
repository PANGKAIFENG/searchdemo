import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json() as { prompt: string }

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: '缺少生成提示词' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'
    const model = process.env.GEEKAI_IMAGE_MODEL || 'gpt-image-1'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const res = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        prompt: prompt.trim(),
        n: 1,
        size: '1024x1024',
        async: true,
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('Image generation error:', errBody)
      return NextResponse.json({ error: `图片生成服务请求失败 (${res.status})` }, { status: 502 })
    }

    const data = await res.json()
    const taskId = data.task_id

    if (!taskId) {
      return NextResponse.json({ error: '未获取到任务 ID，请重试' }, { status: 502 })
    }

    return NextResponse.json({ taskId })
  } catch (error) {
    console.error('Generate pattern error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}
