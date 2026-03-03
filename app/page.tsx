'use client'

import { useState, useRef } from 'react'
import BriefResult from '@/app/components/BriefResult'
import LoadingProgress from '@/app/components/LoadingProgress'
import { SchoolBrief, ImageResult } from '@/app/types'

const EXAMPLE_SCHOOLS = ['山东大学', '北京大学', '复旦大学', '浙江大学', '同济大学']

export default function HomePage() {
  const [school, setSchool] = useState('')
  const [loading, setLoading] = useState(false)
  const [brief, setBrief] = useState<SchoolBrief | null>(null)
  const [images, setImages] = useState<ImageResult[]>([])
  const [citations, setCitations] = useState<string[]>([])
  const [error, setError] = useState('')
  const resultRef = useRef<HTMLDivElement>(null)

  async function handleSubmit(schoolName?: string) {
    const name = (schoolName ?? school).trim()
    if (!name) return

    if (schoolName) setSchool(schoolName)
    setLoading(true)
    setError('')
    setBrief(null)
    setImages([])

    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school: name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '请求失败，请重试')
        return
      }

      setBrief(data.brief)
      setImages(data.images || [])
      setCitations(data.citations || [])

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch {
      setError('网络错误，请检查连接后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <span className="text-base font-bold text-stone-800 tracking-tight">迪尚 · 校服设计提案</span>
            <span className="ml-2 text-xs text-stone-400">AI 驱动</span>
          </div>
          <span className="text-xs text-stone-400">DEMO</span>
        </div>
      </div>

      {/* Hero + 搜索 */}
      <div className="bg-white border-b border-stone-100 py-12">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h1 className="text-4xl font-bold text-stone-900 tracking-tight mb-3">
            输入学校名称
          </h1>
          <p className="text-stone-500 text-base mb-8">
            AI 联网检索学校文化资料，自动生成专属校服设计提案
          </p>

          <div className="flex gap-3 max-w-xl mx-auto">
            <input
              type="text"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="例如：山东大学"
              className="flex-1 border border-stone-200 rounded-xl px-5 py-3 text-stone-800 text-base outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent transition"
            />
            <button
              onClick={() => handleSubmit()}
              disabled={loading || !school.trim()}
              className="bg-stone-900 hover:bg-stone-700 disabled:bg-stone-300 text-white font-semibold px-7 py-3 rounded-xl transition text-base flex-shrink-0"
            >
              {loading ? '生成中…' : '生成提案'}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            {EXAMPLE_SCHOOLS.map((s) => (
              <button
                key={s}
                onClick={() => handleSubmit(s)}
                disabled={loading}
                className="text-xs text-stone-500 hover:text-stone-800 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-full transition disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 结果区 */}
      <div className="max-w-3xl mx-auto px-6 py-10" ref={resultRef}>
        {loading && <LoadingProgress school={school} />}

        {error && !loading && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center">
            <p className="text-red-600 font-semibold">{error}</p>
            <button
              onClick={() => handleSubmit()}
              className="mt-3 text-sm text-red-500 hover:text-red-700 underline"
            >
              重试
            </button>
          </div>
        )}

        {brief && !loading && <BriefResult brief={brief} images={images} citations={citations} />}

        {!brief && !loading && !error && (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🎓</div>
            <p className="text-stone-400 text-base">输入任意学校名称，开始生成专属设计提案</p>
          </div>
        )}
      </div>
    </main>
  )
}
