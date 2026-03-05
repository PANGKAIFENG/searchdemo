'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import LoadingProgress, { BRIEF_STEPS } from '@/app/components/LoadingProgress'
import { SchoolData, ImageResult, Step2Brief, PatternSuggestion } from '@/app/types'

// ─── 类型 ───────────────────────────────────────────────────

interface TaskEntry {
  taskId: string
  model: string
  imageUrls: string[]
  done: boolean
  failed: boolean
}

type CardPhase = 'idle' | 'generating' | 'done' | 'error'

// ─── PatternCard ────────────────────────────────────────────

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
  const [tasks, setTasks] = useState<TaskEntry[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const activePolls = useRef<Set<string>>(new Set())

  const refImage = suggestion.imageIndex >= 0 ? images[suggestion.imageIndex] : null
  const meta = POSITION_LABELS[suggestion.position] ?? { icon: '🎨', desc: '' }

  // 所有任务完成时切换到 done
  useEffect(() => {
    if (tasks.length > 0 && tasks.every((t) => t.done)) {
      setCardPhase('done')
    }
  }, [tasks])

  const pollTask = useCallback((taskId: string) => {
    activePolls.current.add(taskId)

    async function check() {
      if (!activePolls.current.has(taskId)) return
      try {
        const res = await fetch(`/api/pattern-status/${taskId}`)
        const data = await res.json()

        // API 返回错误（非 200 或含 error 字段）→ 直接标记失败，停止轮询
        if (!res.ok || data.error) {
          activePolls.current.delete(taskId)
          setTasks((prev) =>
            prev.map((t) => (t.taskId === taskId ? { ...t, done: true, failed: true } : t))
          )
          return
        }

        if (data.status === 'succeed') {
          activePolls.current.delete(taskId)
          setTasks((prev) =>
            prev.map((t) =>
              t.taskId === taskId ? { ...t, imageUrls: data.imageUrls ?? [], done: true } : t
            )
          )
        } else if (data.status === 'failed') {
          activePolls.current.delete(taskId)
          setTasks((prev) =>
            prev.map((t) => (t.taskId === taskId ? { ...t, done: true, failed: true } : t))
          )
        } else {
          setTimeout(check, 3000)
        }
      } catch {
        if (activePolls.current.has(taskId)) {
          setTimeout(check, 3000)
        }
      }
    }

    check()
  }, [])

  async function handleGenerate() {
    if (!prompt.trim()) return
    activePolls.current.clear()
    setCardPhase('generating')
    setTasks([])
    setErrorMsg('')

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

      const entries: TaskEntry[] = (data.taskIds as { taskId: string; model: string }[]).map(
        ({ taskId, model }) => ({ taskId, model, imageUrls: [], done: false, failed: false })
      )
      setTasks(entries)
      entries.forEach(({ taskId }) => pollTask(taskId))
    } catch {
      setErrorMsg('网络错误，请重试')
      setCardPhase('error')
    }
  }

  function handleReset() {
    activePolls.current.clear()
    setCardPhase('idle')
    setTasks([])
    setErrorMsg('')
  }

  const allImages = tasks.flatMap((t) => t.imageUrls)

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-stone-50 flex items-center gap-3" style={{ backgroundColor: `${accentColor}08` }}>
        <span className="text-2xl">{meta.icon}</span>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-stone-900">{suggestion.position}</span>
            <span className="text-xs text-stone-400">{meta.desc}</span>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">{suggestion.rationale}</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* 提示词 + 参考图 */}
        <div className="flex gap-4">
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
              <div className="space-y-2">
                <button disabled className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 opacity-80" style={{ backgroundColor: accentColor }}>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  AI 生成中…
                </button>
                {/* 任务进度 */}
                {tasks.length > 0 && (
                  <div className="flex gap-2">
                    {tasks.map((t) => (
                      <div key={t.taskId} className="flex-1 flex items-center gap-1.5 bg-stone-50 rounded-lg px-2 py-1">
                        {t.done ? (
                          t.failed
                            ? <span className="text-red-400 text-xs">✗ {t.model}</span>
                            : <span className="text-green-500 text-xs">✓ {t.model} ({t.imageUrls.length}张)</span>
                        ) : (
                          <>
                            <span className="w-3 h-3 border border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: `${accentColor}60`, borderTopColor: 'transparent' }} />
                            <span className="text-stone-400 text-xs truncate">{t.model}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                <button onClick={handleReset} className="w-full py-2.5 rounded-xl text-sm font-semibold border border-red-200 text-red-500 hover:bg-red-50 transition">重试</button>
              </div>
            )}
          </div>

          {/* 参考图 */}
          <div className="w-40 flex-shrink-0">
            <p className="text-xs text-stone-400 mb-1">参考图片</p>
            {refImage ? <ReferenceImage image={refImage} /> : (
              <div className="w-full aspect-square rounded-lg bg-stone-50 border border-stone-100 flex items-center justify-center">
                <span className="text-stone-300 text-xs">无参考图</span>
              </div>
            )}
          </div>
        </div>

        {/* 生成结果：4 张图 2×2，generating 时立即展示占位框 */}
        {(cardPhase === 'generating' || cardPhase === 'done') && (
          <div>
            <p className="text-xs text-stone-400 mb-2">
              生成结果
              <span className="ml-1 text-stone-300">
                （nano-banana-pro × 2 张 + nano-banana-2 × 2 张）
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {tasks.length === 0
                ? /* 还未收到 taskId，展示 4 个占位 spinner */
                  Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="aspect-square rounded-xl bg-stone-50 border border-stone-100 flex flex-col items-center justify-center gap-2">
                      <span className="w-6 h-6 border-2 border-stone-200 border-t-stone-400 rounded-full animate-spin" />
                      <span className="text-xs text-stone-300">提交中…</span>
                    </div>
                  ))
                : tasks.flatMap((t) =>
                    t.done && !t.failed
                      ? t.imageUrls.map((url, idx) => (
                          <GeneratedImage
                            key={`${t.taskId}-${idx}`}
                            url={url}
                            label={`${t.model} · ${idx + 1}`}
                            alt={`${schoolName} ${suggestion.position}纹样`}
                          />
                        ))
                      : t.failed
                      ? Array.from({ length: 2 }).map((_, idx) => (
                          <div key={`${t.taskId}-fail-${idx}`} className="aspect-square rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
                            <span className="text-red-300 text-xs text-center px-2">{t.model}<br />生成失败</span>
                          </div>
                        ))
                      : Array.from({ length: 2 }).map((_, idx) => (
                          <div key={`${t.taskId}-pending-${idx}`} className="aspect-square rounded-xl bg-stone-50 border border-stone-100 flex flex-col items-center justify-center gap-2">
                            <span className="w-6 h-6 border-2 border-stone-200 border-t-stone-400 rounded-full animate-spin" />
                            <span className="text-xs text-stone-300">{t.model}</span>
                          </div>
                        ))
                  )
              }
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GeneratedImage({ url, label, alt }: { url: string; label: string; alt: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-stone-100 shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="w-full aspect-square object-cover" />
      <div className="flex items-center justify-between px-2 py-1.5 bg-stone-50">
        <span className="text-xs text-stone-400">{label}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:text-indigo-600">查看 ↗</a>
      </div>
    </div>
  )
}

function ReferenceImage({ image }: { image: ImageResult }) {
  const [error, setError] = useState(false)
  if (error) return (
    <div className="w-full aspect-square rounded-lg bg-stone-50 border border-stone-100 flex items-center justify-center">
      <span className="text-stone-300 text-xs">图片不可用</span>
    </div>
  )
  return (
    <div className="w-full aspect-square rounded-lg overflow-hidden border border-stone-100 bg-stone-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.imageUrl} alt={image.title} className="w-full h-full object-cover" onError={() => setError(true)} />
    </div>
  )
}

// ─── Step2View 主组件 ───────────────────────────────────────

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

      {/* 纹样分段标题 */}
      <div className="bg-indigo-50 rounded-xl px-4 py-2 flex items-center gap-2">
        <span className="text-indigo-500 text-sm">🪡</span>
        <span className="text-indigo-700 text-sm font-semibold">AI 纹样分段建议</span>
        <span className="text-indigo-400 text-xs ml-auto">
          点击「生成纹样图片」· 双模型各出 2 张，共 4 张
        </span>
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

      <div className="flex justify-center pb-8">
        <button onClick={onReset} className="text-sm text-stone-400 hover:text-stone-600 transition">
          ← 重新开始
        </button>
      </div>
    </div>
  )
}
