'use client'

import { useEffect, useState } from 'react'

const STEPS = [
  { label: '正在访问学校官网', duration: 2500 },
  { label: '解析学校基本信息', duration: 3000 },
  { label: '检索校史与重要节点', duration: 4000 },
  { label: '搜索校训与精神理念', duration: 3000 },
  { label: '识别标志性建筑与地标', duration: 4500 },
  { label: '提取视觉符号与色彩体系', duration: 4000 },
  { label: '检索图片素材', duration: 5000 },
  { label: '生成专属设计提案中…', duration: 99999 },
]

const TOTAL_MS = STEPS.slice(0, -1).reduce((s, step) => s + step.duration, 0)

export default function LoadingProgress({ school }: { school: string }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setStepIndex(0)
    setElapsed(0)

    let cumulative = 0
    const timers: ReturnType<typeof setTimeout>[] = []

    STEPS.slice(0, -1).forEach((step, i) => {
      cumulative += step.duration
      const t = setTimeout(() => setStepIndex(i + 1), cumulative)
      timers.push(t)
    })

    const ticker = setInterval(() => {
      setElapsed((e) => Math.min(e + 200, TOTAL_MS))
    }, 200)

    return () => {
      timers.forEach(clearTimeout)
      clearInterval(ticker)
    }
  }, [school])

  const progress = Math.min((elapsed / TOTAL_MS) * 90, 90)
  const currentLabel = STEPS[stepIndex]?.label ?? STEPS[STEPS.length - 1].label

  return (
    <div className="max-w-md mx-auto py-16 px-4">
      {/* 学校名 */}
      <p className="text-center text-stone-500 text-sm mb-6">
        正在为 <span className="font-semibold text-stone-800">{school}</span> 生成设计提案
      </p>

      {/* 进度条 */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-stone-400 mb-1.5">
          <span>{currentLabel}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-stone-800 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-stone-400 mt-2 text-right">预计需要 30 秒</p>
      </div>

      {/* 步骤列表 */}
      <div className="space-y-2.5">
        {STEPS.map((step, i) => {
          const isDone = i < stepIndex
          const isActive = i === stepIndex
          const isPending = i > stepIndex

          return (
            <div key={i} className="flex items-center gap-3">
              {/* 状态图标 */}
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {isDone && (
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isActive && (
                  <div className="w-3.5 h-3.5 border-2 border-stone-700 border-t-transparent rounded-full animate-spin" />
                )}
                {isPending && (
                  <div className="w-2 h-2 rounded-full bg-stone-200" />
                )}
              </div>

              {/* 文案 */}
              <span
                className={`text-sm transition-colors ${
                  isDone ? 'text-stone-400 line-through' : isActive ? 'text-stone-800 font-medium' : 'text-stone-300'
                }`}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
