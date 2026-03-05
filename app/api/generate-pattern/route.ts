import { NextRequest, NextResponse } from 'next/server'

const MODELS = ['nano-banana', 'gpt-image-1-mini'] as const

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json() as { prompt: string }

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: '缺少生成提示词' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    // 同时提交两个模型，各生成 2 张
    const results = await Promise.allSettled(
      MODELS.map((model) =>
        fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            prompt: prompt.trim(),
            n: 2,
            size: '1024x1024',
            async: true,
          }),
        }).then((res) => res.json())
      )
    )

    const taskIds: { taskId: string; model: string }[] = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value?.task_id) {
        taskIds.push({ taskId: r.value.task_id, model: MODELS[i] })
      }
    }

    if (taskIds.length === 0) {
      return NextResponse.json({ error: '所有模型提交失败，请重试' }, { status: 502 })
    }

    return NextResponse.json({ taskIds })
  } catch (error) {
    console.error('Generate pattern error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}
