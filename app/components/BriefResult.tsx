'use client'

import { SchoolBrief } from '@/app/types'

interface BriefResultProps {
  brief: SchoolBrief
  citations: string[]
}

function SectionCard({
  label,
  children,
  accent,
}: {
  label: string
  children: React.ReactNode
  accent?: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
      <div
        className="px-6 py-3 text-sm font-semibold tracking-widest text-white"
        style={{ backgroundColor: accent || '#1a1a1a' }}
      >
        {label}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function ColorSwatch({ name, hex, meaning }: { name: string; hex: string; meaning: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-lg flex-shrink-0 shadow-inner border border-black/10"
        style={{ backgroundColor: hex }}
      />
      <div>
        <p className="text-sm font-semibold text-stone-800">{name}</p>
        <p className="text-xs text-stone-400 font-mono">{hex}</p>
        <p className="text-xs text-stone-500 mt-0.5">{meaning}</p>
      </div>
    </div>
  )
}

function PatternBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-14 flex-shrink-0">
        <span className="inline-block bg-amber-50 text-amber-800 text-xs font-bold px-2 py-1 rounded-md border border-amber-200 mt-0.5">
          {label}
        </span>
      </div>
      <p className="text-stone-700 text-sm leading-relaxed">{content}</p>
    </div>
  )
}

export default function BriefResult({ brief, citations }: BriefResultProps) {
  const accentColor = brief.visual_assets?.primary_colors?.[0]?.hex || '#8B1A1A'

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* 标题区 */}
      <div
        className="rounded-2xl p-8 text-white"
        style={{ background: `linear-gradient(135deg, ${accentColor}dd, ${accentColor}88)` }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-white/70 text-sm font-medium tracking-widest mb-1">校服设计提案</p>
            <h1 className="text-3xl font-bold tracking-tight">{brief.school_name}</h1>
            <p className="text-white/70 text-sm mt-1">
              {brief.region} · {brief.school_type}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-white/60 text-xs tracking-widest mb-1">设计主题</p>
            <p className="text-xl font-bold">{brief.design_theme}</p>
          </div>
        </div>

        {/* 校训 */}
        {brief.motto?.original && (
          <div className="mt-6 pt-5 border-t border-white/20">
            <p className="text-white/60 text-xs tracking-widest mb-1">校训</p>
            <p className="text-lg font-semibold">{brief.motto.original}</p>
            {brief.motto.interpretation && (
              <p className="text-white/70 text-sm mt-1">{brief.motto.interpretation}</p>
            )}
          </div>
        )}
      </div>

      {/* 创意基石 */}
      <SectionCard label="创意基石" accent={accentColor}>
        <p className="text-stone-700 leading-relaxed text-sm">{brief.creative_foundation}</p>
      </SectionCard>

      {/* 视觉资产 */}
      <SectionCard label="视觉资产" accent={accentColor}>
        <div className="space-y-5">
          {/* 主色系 */}
          {brief.visual_assets?.primary_colors?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-stone-400 tracking-widest mb-3">主色系</p>
              <div className="flex flex-wrap gap-4">
                {brief.visual_assets.primary_colors.map((c, i) => (
                  <ColorSwatch key={i} {...c} />
                ))}
              </div>
            </div>
          )}

          {/* 地标 & 文化符号 */}
          <div className="grid grid-cols-2 gap-4">
            {brief.visual_assets?.landmarks?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-stone-400 tracking-widest mb-2">
                  标志性地标
                </p>
                <div className="flex flex-wrap gap-2">
                  {brief.visual_assets.landmarks.map((l, i) => (
                    <span
                      key={i}
                      className="text-xs bg-stone-100 text-stone-700 px-3 py-1 rounded-full"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {brief.visual_assets?.cultural_symbols?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-stone-400 tracking-widest mb-2">
                  文化符号
                </p>
                <div className="flex flex-wrap gap-2">
                  {brief.visual_assets.cultural_symbols.map((s, i) => (
                    <span
                      key={i}
                      className="text-xs bg-stone-100 text-stone-700 px-3 py-1 rounded-full"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* 设计逻辑 */}
      <SectionCard label="设计逻辑" accent={accentColor}>
        <p className="text-stone-700 leading-relaxed text-sm">{brief.design_logic}</p>
      </SectionCard>

      {/* AI 纹样分段建议 */}
      <SectionCard label="AI 纹样分段建议" accent={accentColor}>
        <div className="space-y-4">
          <PatternBlock label="门襟" content={brief.pattern_suggestions?.front_placket} />
          <div className="border-t border-stone-100" />
          <PatternBlock label="袖口" content={brief.pattern_suggestions?.cuffs} />
          <div className="border-t border-stone-100" />
          <PatternBlock label="帽兜" content={brief.pattern_suggestions?.hood} />
        </div>
      </SectionCard>

      {/* 校史要点 */}
      {brief.school_history_highlights?.length > 0 && (
        <SectionCard label="校史要点" accent={accentColor}>
          <div className="space-y-3">
            {brief.school_history_highlights.map((h, i) => (
              <div key={i} className="flex gap-4 items-start">
                <span
                  className="text-xs font-bold px-2 py-1 rounded flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                >
                  {h.year}
                </span>
                <p className="text-sm text-stone-700 leading-relaxed">{h.event}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 信息来源 */}
      {citations?.length > 0 && (
        <div className="bg-stone-50 rounded-xl px-6 py-4">
          <p className="text-xs font-semibold text-stone-400 tracking-widest mb-2">信息来源</p>
          <div className="space-y-1">
            {citations.slice(0, 5).map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-blue-500 hover:text-blue-700 truncate"
              >
                {url}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
