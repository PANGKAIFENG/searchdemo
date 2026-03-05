import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params

    if (!taskId) {
      return NextResponse.json({ error: '缺少任务 ID' }, { status: 400 })
    }

    const apiKey = process.env.GEEKAI_API_KEY
    const baseUrl = process.env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1'

    if (!apiKey) {
      return NextResponse.json({ error: '服务未配置 API Key' }, { status: 500 })
    }

    const res = await fetch(`${baseUrl}/images/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`GeeKAI status error ${res.status}:`, body)
      return NextResponse.json({ error: `查询失败 (${res.status})`, detail: body }, { status: 502 })
    }

    const data = await res.json()
    // GeeKAI 有时返回 200 但 task_status 为 failed 且带 error 对象
    if (data.task_status === 'failed' || data.error) {
      console.error('GeeKAI task failed:', JSON.stringify(data.error ?? data))
    }
    const status = data.task_status as 'pending' | 'running' | 'succeed' | 'failed'
    const imageUrls: string[] =
      status === 'succeed'
        ? (data.data ?? []).map((d: { url?: string }) => d.url).filter(Boolean)
        : []

    return NextResponse.json({ status, imageUrls })
  } catch (error) {
    console.error('Pattern status error:', error)
    return NextResponse.json({ error: '查询状态失败' }, { status: 500 })
  }
}
