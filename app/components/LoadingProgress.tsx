'use client'

import { useEffect, useState, type ReactNode } from 'react'

export interface LoadingStep {
  label: string
  duration: number
}

export const COLLECT_STEPS: LoadingStep[] = [
  { label: '正在访问学校官网', duration: 2500 },
  { label: '解析学校基本信息', duration: 3000 },
  { label: '检索校史与重要节点', duration: 4000 },
  { label: '搜索校训与精神理念', duration: 3000 },
  { label: '识别标志性建筑与地标', duration: 4500 },
  { label: '提取视觉符号与色彩体系', duration: 4000 },
  { label: '检索图片素材', duration: 5000 },
  { label: '整合所有信息汇总呈现中', duration: 99999 },
]

export const COLLECT_PRECISE_STEPS: LoadingStep[] = [
  { label: '准备采集任务', duration: 2000 },
  { label: '搜索并提取基本面与学术信息', duration: 15000 },
  { label: '搜索并提取文化与符号信息', duration: 15000 },
  { label: '搜索并提取地标与营销信息', duration: 15000 },
  { label: '检索图片素材', duration: 5000 },
  { label: '整合所有信息汇总呈现中', duration: 99999 },
]

export const BRIEF_STEPS: LoadingStep[] = [
  { label: '分析院校文化内涵', duration: 3000 },
  { label: '提炼设计主题与灵感来源', duration: 4000 },
  { label: '构建色彩与符号体系', duration: 3500 },
  { label: '生成门襟纹样设计方案', duration: 4000 },
  { label: '生成袖口纹样设计方案', duration: 3500 },
  { label: '生成帽兜纹样设计方案', duration: 3500 },
  { label: '整合提案并优化呈现中', duration: 99999 },
]

interface Props {
  school: string
  title?: ReactNode
  steps?: LoadingStep[]
  accentColor?: string
  currentStep?: string  // 后端推送的真实步骤文字，有值时覆盖假进度文字
}

export default function LoadingProgress({
  school,
  title,
  steps = COLLECT_STEPS,
  accentColor = '#1c1917',
  currentStep,
}: Props) {
  const [stepIndex, setStepIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  const totalMs = steps.slice(0, -1).reduce((s, step) => s + step.duration, 0)

  useEffect(() => {
    setStepIndex(0)
    setElapsed(0)

    let cumulative = 0
    const timers: ReturnType<typeof setTimeout>[] = []

    steps.slice(0, -1).forEach((step, i) => {
      cumulative += step.duration
      const t = setTimeout(() => setStepIndex(i + 1), cumulative)
      timers.push(t)
    })

    const ticker = setInterval(() => {
      setElapsed((e) => Math.min(e + 200, totalMs))
    }, 200)

    return () => {
      timers.forEach(clearTimeout)
      clearInterval(ticker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school])

  const progress = Math.min((elapsed / totalMs) * 90, 90)
  const currentLabel = currentStep || (steps[stepIndex]?.label ?? steps[steps.length - 1].label)

  return (
    <div className="max-w-md mx-auto py-16 px-4">
      <p className="text-center text-stone-500 text-sm mb-6">
        {title ?? <>正在为 <span className="font-semibold text-stone-800">{school}</span> 采集院校资料</>}
      </p>

      <div className="mb-6">
        <div className="flex justify-between text-xs text-stone-400 mb-1.5">
          <span>{currentLabel}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, backgroundColor: accentColor }}
          />
        </div>
        <p className="text-xs text-stone-400 mt-2 text-right">预计需要 {Math.round(totalMs / 1000)} 秒</p>
      </div>

      <div className="space-y-2.5">
        {steps.map((step, i) => {
          const isDone = i < stepIndex
          const isActive = i === stepIndex
          const isPending = i > stepIndex

          return (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {isDone && (
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isActive && (
                  <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: `${accentColor}40`, borderTopColor: 'transparent',
                      borderLeftColor: accentColor }} />
                )}
                {isPending && <div className="w-2 h-2 rounded-full bg-stone-200" />}
              </div>
              <span className={`text-sm transition-colors ${
                isDone ? 'text-stone-400 line-through'
                  : isActive ? 'text-stone-800 font-medium'
                  : 'text-stone-300'
              }`}>
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
