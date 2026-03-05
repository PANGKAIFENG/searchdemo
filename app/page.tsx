'use client'

import { useState } from 'react'
import LoadingProgress, { COLLECT_STEPS } from '@/app/components/LoadingProgress'
import Step1Form from '@/app/components/Step1/Step1Form'
import Step2View from '@/app/components/Step2/Step2View'
import { SchoolData, ImageResult } from '@/app/types'

type Phase = 'idle' | 'collecting' | 'review' | 'step2'

const EXAMPLE_SCHOOLS = ['山东大学', '北京大学', '复旦大学', '浙江大学', '同济大学']

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [school, setSchool] = useState('')
  const [error, setError] = useState('')

  // Step 1 data
  const [schoolData, setSchoolData] = useState<SchoolData | null>(null)
  const [images, setImages] = useState<ImageResult[]>([])

  async function startCollect(schoolName: string) {
    const name = schoolName.trim()
    if (!name) return

    setSchool(name)
    setPhase('collecting')
    setError('')
    setSchoolData(null)
    setImages([])

    try {
      const res = await fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school: name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '采集失败，请重试')
        setPhase('idle')
        return
      }

      setSchoolData(data.schoolData)
      setImages(data.images || [])
      setPhase('review')
    } catch {
      setError('网络错误，请检查连接后重试')
      setPhase('idle')
    }
  }

  function handleConfirm(confirmedData: SchoolData, confirmedImages: ImageResult[]) {
    setSchoolData(confirmedData)
    setImages(confirmedImages)
    setPhase('step2')
  }

  function handleReset() {
    setPhase('idle')
    setSchool('')
    setError('')
    setSchoolData(null)
    setImages([])
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={handleReset} className="flex items-center gap-2 hover:opacity-70 transition">
            <span className="text-base font-bold text-stone-800 tracking-tight">迪尚 · 校服设计提案</span>
            <span className="ml-1 text-xs text-stone-400">AI 驱动</span>
          </button>
          <div className="flex items-center gap-4">
            {phase === 'review' && (
              <span className="text-xs text-indigo-600 font-medium bg-indigo-50 px-3 py-1 rounded-full">
                Step 1 · 资料核对
              </span>
            )}
            {phase === 'step2' && (
              <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-3 py-1 rounded-full">
                Step 2 · 生成提案
              </span>
            )}
            <span className="text-xs text-stone-400">DEMO</span>
          </div>
        </div>
      </div>

      {/* ── Phase: idle ── */}
      {phase === 'idle' && (
        <>
          <div className="bg-white border-b border-stone-100 py-12">
            <div className="max-w-3xl mx-auto px-6 text-center">
              <h1 className="text-4xl font-bold text-stone-900 tracking-tight mb-3">
                输入学校名称
              </h1>
              <p className="text-stone-500 text-base mb-8">
                AI 联网采集院校文化资料，人工确认后生成专属校服设计提案
              </p>

              <div className="flex gap-3 max-w-xl mx-auto">
                <input
                  type="text"
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && startCollect(school)}
                  placeholder="例如：山东大学"
                  className="flex-1 border border-stone-200 rounded-xl px-5 py-3 text-stone-800 text-base outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent transition"
                />
                <button
                  onClick={() => startCollect(school)}
                  disabled={!school.trim()}
                  className="bg-stone-900 hover:bg-stone-700 disabled:bg-stone-300 text-white font-semibold px-7 py-3 rounded-xl transition text-base flex-shrink-0"
                >
                  开始采集
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {EXAMPLE_SCHOOLS.map((s) => (
                  <button
                    key={s}
                    onClick={() => startCollect(s)}
                    className="text-xs text-stone-500 hover:text-stone-800 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-full transition"
                  >
                    {s}
                  </button>
                ))}
              </div>

              {error && (
                <div className="mt-6 bg-red-50 border border-red-100 rounded-2xl p-4 text-center">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}
            </div>
          </div>

          <div className="max-w-3xl mx-auto px-6 py-16 text-center">
            <div className="text-6xl mb-4">🎓</div>
            <p className="text-stone-400 text-base">输入任意学校名称，AI 自动采集 8 个维度的院校文化资料</p>
            <div className="mt-8 grid grid-cols-4 gap-4 text-left">
              {[
                { icon: '🏫', label: '院校基本面' },
                { icon: '🧭', label: '学校文化灵魂' },
                { icon: '🎨', label: '符号语义块' },
                { icon: '📅', label: '历史时间轴' },
                { icon: '🏛', label: '核心地标语义' },
                { icon: '🌿', label: '生态环境语义' },
                { icon: '🏆', label: '荣誉与学科' },
                { icon: '💬', label: '营销话术采集' },
              ].map((item) => (
                <div key={item.label} className="bg-white rounded-xl p-4 border border-stone-100 text-center">
                  <div className="text-2xl mb-1">{item.icon}</div>
                  <p className="text-xs text-stone-600">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Phase: collecting ── */}
      {phase === 'collecting' && (
        <div className="max-w-3xl mx-auto px-6 py-10">
          <LoadingProgress school={school} steps={COLLECT_STEPS} accentColor="#6366f1" />
        </div>
      )}

      {/* ── Phase: review ── */}
      {phase === 'review' && schoolData && (
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Step1Form
            schoolName={school}
            initialData={schoolData}
            initialImages={images}
            onConfirm={handleConfirm}
          />
        </div>
      )}

      {/* ── Phase: step2 ── */}
      {phase === 'step2' && schoolData && (
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Step2View
            schoolName={school}
            schoolData={schoolData}
            images={images}
            onReset={handleReset}
          />
        </div>
      )}
    </main>
  )
}
