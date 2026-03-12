'use client'

import { SchoolCandidate, ValidateResult } from '@/app/types'

interface ValidateStepProps {
  inputName: string
  result: ValidateResult
  onSelect: (officialName: string) => void
  onBack: () => void
}

export default function ValidateStep({ inputName, result, onSelect, onBack }: ValidateStepProps) {
  const candidates = result.candidates || []

  return (
    <div className="space-y-4">
      {/* 提示区 */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔍</span>
          <div>
            <h2 className="text-base font-semibold text-amber-900">
              「{inputName}」可能对应多所学校，请选择正确的院校
            </h2>
            <p className="text-sm text-amber-700 mt-1">
              AI 已找到 {candidates.length} 所候选院校，点击对应卡片继续采集
            </p>
          </div>
        </div>
      </div>

      {/* 候选列表 */}
      <div className="space-y-3">
        {candidates.map((c, i) => (
          <CandidateCard key={i} candidate={c} onSelect={() => onSelect(c.official_name)} />
        ))}
      </div>

      {/* 返回按钮 */}
      <div className="text-center pt-2">
        <button
          onClick={onBack}
          className="text-sm text-stone-500 hover:text-stone-800 transition"
        >
          ← 重新输入
        </button>
      </div>
    </div>
  )
}

function CandidateCard({
  candidate,
  onSelect,
}: {
  candidate: SchoolCandidate
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border p-5 transition hover:shadow-md active:scale-[0.99] ${
        candidate.is_recommended
          ? 'border-indigo-300 bg-indigo-50 shadow-sm'
          : 'border-stone-200 bg-white hover:border-stone-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-semibold text-stone-900">
              {candidate.official_name}
            </span>
            {candidate.is_recommended && (
              <span className="text-xs text-indigo-600 font-medium bg-indigo-100 px-2 py-0.5 rounded-full flex-shrink-0">
                推荐
              </span>
            )}
            <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full flex-shrink-0">
              {candidate.level}
            </span>
          </div>
          <p className="text-sm text-stone-500 mt-1">{candidate.location}</p>
          {candidate.website && (
            <p className="text-xs text-stone-400 mt-0.5 font-mono">{candidate.website}</p>
          )}
          {candidate.is_recommended && candidate.recommend_reason && (
            <p className="text-xs text-indigo-600 mt-2">💡 {candidate.recommend_reason}</p>
          )}
        </div>
        <div className="flex-shrink-0 text-stone-300 text-xl mt-0.5">→</div>
      </div>
    </button>
  )
}
