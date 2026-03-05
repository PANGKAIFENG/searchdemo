'use client'

import { useEffect, useState, useCallback } from 'react'
import LoadingProgress, { BRIEF_STEPS } from '@/app/components/LoadingProgress'
import { SchoolData, ImageResult, Step2Brief, PatternSuggestion } from '@/app/types'

// ─── PatternCard ───────────────────────────────────────────

type CardPhase = 'idle' | 'generating' | 'done' | 'error'

const POSITION_LABELS: Record<string, { icon: string; desc: string }> = {
  门襟: { icon: '🪡', desc: '前胸开合处，视觉焦点' },
  袖口: { icon: '✂️', desc: '手腕收口装饰带' },
  帽兜: { icon: '🧢', desc: '帽沿内衬装饰区' },
}

function PatternCard({
  suggestion,
  images,
  accentColor,
  schoolName,
}: {
  suggestion: PatternSuggestion
  images: ImageResult[]
  accentColor: string
  schoolName: string
}) {
  const [cardPhase, setCardPhase] = useState<CardPhase>('idle')
  const [prompt, setPrompt] = useState(suggestion.prompt)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const refImage = suggestion.imageIndex >= 0 ? images[suggestion.imageIndex] : null
  const meta = POSITION_LABELS[suggestion.position] ?? { icon: '🎨', desc: '' }

  const poll = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/pattern-status/${taskId}`)
      const data = await res.json()

      if (data.status === 'succeed' && data.imageUrl) {
        setGeneratedUrl(data.imageUrl)
        setCardPhase('done')
      } else if (data.status === 'failed') {
        setErrorMsg('图片生成失败，请重试')
        setCardPhase('error')
      } else {
        setTimeout(() => poll(taskId), 3000)
      }
    } catch {
      setErrorMsg('网络错误，请重试')
      setCardPhase('error')
    }
  }, [])

  async function handleGenerate() {
    if (!prompt.trim()) return
    setCardPhase('generating')
    setErrorMsg('')
    setGeneratedUrl(null)

    try {
      const res = await fetch('/api/generate-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error || '提交失败，请重试')
        setCardPhase('error')
        return
      }

      poll(data.taskId)
    } catch {
      setErrorMsg('网络错误，请重试')
      setCardPhase('error')
    }
  }

  function handleReset() {
    setCardPhase('idle')
    setGeneratedUrl(null)
    setErrorMsg('')
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-stone-50 flex items-center gap-3" style={{ backgroundColor: `${accentColor}08` }}>
        <span className="text-2xl">{meta.icon}</span>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-stone-900">{suggestion.position}</span>
            <span className="text-xs text-stone-400 font-normal">{meta.desc}</span>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">{suggestion.rationale}</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* 两列布局：左=提示词+按钮，右=参考图 */}
        <div className="flex gap-4">
          {/* 左侧：prompt + 按钮 */}
          <div className="flex-1 flex flex-col gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">生成提示词（可编辑）</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={cardPhase === 'generating'}
                rows={5}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs text-stone-700 font-mono outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent transition resize-none disabled:bg-stone-50 disabled:text-stone-400"
                placeholder="输入英文生成提示词..."
              />
            </div>

            {/* 生成按钮 */}
            {cardPhase === 'idle' && (
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition disabled:opacity-40"
                style={{ backgroundColor: accentColor }}
              >
                生成纹样图片
              </button>
            )}

            {cardPhase === 'generating' && (
              <button disabled className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 opacity-80" style={{ backgroundColor: accentColor }}>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                AI 生成中，约需 30-60 秒…
              </button>
            )}

            {cardPhase === 'done' && (
              <button
                onClick={handleReset}
                className="w-full py-2.5 rounded-xl text-sm font-semibold border border-stone-200 text-stone-600 hover:bg-stone-50 transition"
              >
                重新生成
              </button>
            )}

            {cardPhase === 'error' && (
              <div className="space-y-2">
                <p className="text-xs text-red-500">{errorMsg}</p>
                <button
                  onClick={handleReset}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold border border-red-200 text-red-500 hover:bg-red-50 transition"
                >
                  重试
                </button>
              </div>
            )}
          </div>

          {/* 右侧：参考图 */}
          <div className="w-40 flex-shrink-0">
            <p className="text-xs text-stone-400 mb-1">参考图片</p>
            {refImage ? (
              <ReferenceImage image={refImage} />
            ) : (
              <div className="w-full aspect-square rounded-lg bg-stone-50 border border-stone-100 flex items-center justify-center">
                <span className="text-stone-300 text-xs">无参考图</span>
              </div>
            )}
          </div>
        </div>

        {/* 生成结果 */}
        {cardPhase === 'done' && generatedUrl && (
          <div>
            <p className="text-xs text-stone-400 mb-2">生成结果</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={generatedUrl}
              alt={`${schoolName} ${suggestion.position}纹样`}
              className="w-full rounded-xl border border-stone-100 shadow-sm"
            />
            <a
              href={generatedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs text-indigo-500 hover:text-indigo-700 mt-2"
            >
              在新窗口查看完整图片 ↗
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function ReferenceImage({ image }: { image: ImageResult }) {
  const [error, setError] = useState(false)
  if (error) {
    return (
      <div className="w-full aspect-square rounded-lg bg-stone-50 border border-stone-100 flex items-center justify-center">
        <span className="text-stone-300 text-xs">图片不可用</span>
      </div>
    )
  }
  return (
    <div className="w-full aspect-square rounded-lg overflow-hidden border border-stone-100 bg-stone-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.imageUrl}
        alt={image.title}
        className="w-full h-full object-cover"
        onError={() => setError(true)}
      />
    </div>
  )
}

// ─── 主组件 ────────────────────────────────────────────────

type ViewPhase = 'loading' | 'ready' | 'error'

interface Step2ViewProps {
  schoolName: string
  schoolData: SchoolData
  images: ImageResult[]
  onReset: () => void
}

export default function Step2View({ schoolName, schoolData, images, onReset }: Step2ViewProps) {
  const [viewPhase, setViewPhase] = useState<ViewPhase>('loading')
  const [brief, setBrief] = useState<Step2Brief | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const accentColor = schoolData.symbols.standard_colors[0]?.hex || '#6366f1'

  useEffect(() => {
    let cancelled = false

    async function fetchBrief() {
      try {
        const res = await fetch('/api/generate-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolData, images }),
        })
        const data = await res.json()

        if (cancelled) return

        if (!res.ok) {
          setErrorMsg(data.error || '生成提案失败，请重试')
          setViewPhase('error')
          return
        }

        setBrief(data.brief)
        setViewPhase('ready')
      } catch {
        if (!cancelled) {
          setErrorMsg('网络错误，请检查连接后重试')
          setViewPhase('error')
        }
      }
    }

    fetchBrief()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (viewPhase === 'loading') {
    return (
      <LoadingProgress
        school={schoolName}
        title={<>正在为 <span className="font-semibold text-stone-800">{schoolName}</span> 生成专属设计提案</>}
        steps={BRIEF_STEPS}
        accentColor={accentColor}
      />
    )
  }

  if (viewPhase === 'error') {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <p className="text-red-500 font-semibold mb-2">{errorMsg}</p>
        <button
          onClick={() => { setViewPhase('loading'); setErrorMsg(''); setBrief(null) }}
          className="text-sm text-stone-500 hover:text-stone-700 underline"
        >
          重试
        </button>
      </div>
    )
  }

  if (!brief) return null

  return (
    <div className="space-y-6">
      {/* 设计摘要 */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="w-1 h-5 rounded-full" style={{ backgroundColor: accentColor }} />
          <span className="text-xs font-bold" style={{ color: accentColor }}>设计方案</span>
          <span className="text-sm font-semibold text-stone-800">{schoolName} 校服提案</span>
        </div>

        <h2 className="text-2xl font-bold text-stone-900 mb-4">{brief.designTheme}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-stone-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-stone-500 mb-2">创意基石</p>
            <p className="text-sm text-stone-700 leading-relaxed">{brief.creativeFoundation}</p>
          </div>
          <div className="bg-stone-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-stone-500 mb-2">设计逻辑</p>
            <p className="text-sm text-stone-700 leading-relaxed">{brief.designLogic}</p>
          </div>
        </div>

        {/* 校色展示 */}
        {schoolData.symbols.standard_colors.length > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <span className="text-xs text-stone-400">校色体系</span>
            <div className="flex gap-2">
              {schoolData.symbols.standard_colors.map((c) => (
                <div key={c.hex} className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full border border-stone-200 shadow-inner" style={{ backgroundColor: c.hex }} />
                  <span className="text-xs text-stone-500">{c.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 纹样分段 */}
      <div className="bg-indigo-50 rounded-xl px-4 py-2 flex items-center gap-2">
        <span className="text-indigo-500 text-sm">🪡</span>
        <span className="text-indigo-700 text-sm font-semibold">AI 纹样分段建议</span>
        <span className="text-indigo-400 text-xs ml-auto">点击「生成纹样图片」调用 AI 作图</span>
      </div>

      {brief.patternSuggestions.map((s) => (
        <PatternCard
          key={s.position}
          suggestion={s}
          images={images}
          accentColor={accentColor}
          schoolName={schoolName}
        />
      ))}

      {/* 底部操作 */}
      <div className="flex justify-center pb-8">
        <button
          onClick={onReset}
          className="text-sm text-stone-400 hover:text-stone-600 transition"
        >
          ← 重新开始
        </button>
      </div>
    </div>
  )
}
