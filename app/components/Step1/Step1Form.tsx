'use client'

import { SchoolData, StandardColor, TimelineItem, ImageResult } from '@/app/types'
import { useState } from 'react'

// ─── 子组件 ────────────────────────────────────────────────

function SectionHeader({ index, title }: { index: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-1 h-5 bg-indigo-500 rounded-full" />
      <span className="text-xs font-bold text-indigo-500">{index}.</span>
      <span className="text-sm font-semibold text-stone-800">{title}</span>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder = '',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-stone-500 mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition"
        />
      )}
    </div>
  )
}

function ColorRow({
  color,
  onChange,
  onDelete,
}: {
  color: StandardColor
  onChange: (c: StandardColor) => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-start gap-3 p-3 bg-stone-50 rounded-lg">
      <div className="flex items-center gap-2 flex-shrink-0">
        <div
          className="w-8 h-8 rounded-md border border-stone-200 shadow-inner"
          style={{ backgroundColor: color.hex || '#cccccc' }}
        />
        <input
          type="text"
          value={color.hex}
          onChange={(e) => onChange({ ...color, hex: e.target.value })}
          placeholder="#000000"
          className="w-24 border border-stone-200 rounded px-2 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
      <div className="flex-1 flex gap-2">
        <input
          type="text"
          value={color.name}
          onChange={(e) => onChange({ ...color, name: e.target.value })}
          placeholder="颜色名称"
          className="w-28 border border-stone-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <input
          type="text"
          value={color.description}
          onChange={(e) => onChange({ ...color, description: e.target.value })}
          placeholder="象征意义"
          className="flex-1 border border-stone-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
      <button onClick={onDelete} className="text-stone-300 hover:text-red-400 transition text-lg leading-none mt-1">×</button>
    </div>
  )
}

function TimelineRow({
  item,
  onChange,
  onDelete,
}: {
  item: TimelineItem
  onChange: (t: TimelineItem) => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="text"
        value={item.year}
        onChange={(e) => onChange({ ...item, year: e.target.value })}
        placeholder="年份"
        className="w-20 border border-stone-200 rounded-lg px-3 py-2 text-sm font-semibold text-indigo-600 outline-none focus:ring-2 focus:ring-indigo-400 text-center"
      />
      <input
        type="text"
        value={item.event}
        onChange={(e) => onChange({ ...item, event: e.target.value })}
        placeholder="重要历史事件"
        className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-800 outline-none focus:ring-2 focus:ring-indigo-400"
      />
      <button onClick={onDelete} className="text-stone-300 hover:text-red-400 transition text-xl leading-none">×</button>
    </div>
  )
}

function ImageCard({
  image,
  onDelete,
}: {
  image: ImageResult
  onDelete: () => void
}) {
  const [error, setError] = useState(false)
  if (error) return null

  return (
    <div className="relative group rounded-xl overflow-hidden border border-stone-200 bg-stone-100">
      <div className="aspect-[4/3] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.imageUrl}
          alt={image.title}
          className="w-full h-full object-cover"
          onError={() => setError(true)}
        />
      </div>
      <div className="px-2 py-1.5">
        <p className="text-xs text-stone-500 truncate">{image.title}</p>
      </div>
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 w-6 h-6 bg-black/50 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
      >
        ×
      </button>
    </div>
  )
}

// ─── 主组件 ────────────────────────────────────────────────

interface Step1FormProps {
  schoolName: string
  initialData: SchoolData
  initialImages: ImageResult[]
  onConfirm: (data: SchoolData, images: ImageResult[]) => void
}

export default function Step1Form({
  schoolName,
  initialData,
  initialImages,
  onConfirm,
}: Step1FormProps) {
  const [data, setData] = useState<SchoolData>(initialData)
  const [images, setImages] = useState<ImageResult[]>(initialImages)

  function update<K extends keyof SchoolData>(dim: K, patch: Partial<SchoolData[K]>) {
    setData((prev) => ({ ...prev, [dim]: { ...prev[dim], ...patch } }))
  }

  function addTimelineItem() {
    setData((prev) => ({
      ...prev,
      history: {
        ...prev.history,
        timeline: [...prev.history.timeline, { year: '', event: '' }],
      },
    }))
  }

  function updateTimelineItem(i: number, item: TimelineItem) {
    setData((prev) => ({
      ...prev,
      history: {
        ...prev.history,
        timeline: prev.history.timeline.map((t, idx) => (idx === i ? item : t)),
      },
    }))
  }

  function deleteTimelineItem(i: number) {
    setData((prev) => ({
      ...prev,
      history: {
        ...prev.history,
        timeline: prev.history.timeline.filter((_, idx) => idx !== i),
      },
    }))
  }

  function addColor() {
    setData((prev) => ({
      ...prev,
      symbols: {
        ...prev.symbols,
        standard_colors: [...prev.symbols.standard_colors, { name: '', hex: '#000000', description: '' }],
      },
    }))
  }

  function updateColor(i: number, c: StandardColor) {
    setData((prev) => ({
      ...prev,
      symbols: {
        ...prev.symbols,
        standard_colors: prev.symbols.standard_colors.map((col, idx) => (idx === i ? c : col)),
      },
    }))
  }

  function deleteColor(i: number) {
    setData((prev) => ({
      ...prev,
      symbols: {
        ...prev.symbols,
        standard_colors: prev.symbols.standard_colors.filter((_, idx) => idx !== i),
      },
    }))
  }

  const cardClass = 'bg-white rounded-2xl border border-stone-100 shadow-sm p-6'

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* 顶部操作栏 - sticky */}
      <div className="sticky top-14 z-[9] -mx-6 px-6 py-3 bg-white/95 backdrop-blur-sm border-b border-stone-100 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-stone-900">{schoolName}</h2>
          <p className="text-sm text-stone-400 mt-0.5">AI 已自动采集，请核对并修改后确认</p>
        </div>
        <button
          onClick={() => onConfirm(data, images)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-2.5 rounded-xl transition text-sm flex-shrink-0"
        >
          确认数据，生成提案 →
        </button>
      </div>

      {/* 文字采集区 */}
      <div className="bg-indigo-50 rounded-xl px-4 py-2 flex items-center gap-2">
        <span className="text-indigo-500 text-sm">📝</span>
        <span className="text-indigo-700 text-sm font-semibold">文字采集区</span>
      </div>

      {/* 1. 院校基本面 */}
      <div className={cardClass}>
        <SectionHeader index={1} title="院校基本面" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="校名全称" value={data.basic.full_name} onChange={(v) => update('basic', { full_name: v })} />
          <Field label="简称" value={data.basic.short_name} onChange={(v) => update('basic', { short_name: v })} />
          <Field label="创办年份" value={data.basic.founded_year} onChange={(v) => update('basic', { founded_year: v })} />
          <Field label="地理位置" value={data.basic.location} onChange={(v) => update('basic', { location: v })} />
        </div>
        <div className="mt-4">
          <Field label="院校简介" value={data.basic.introduction} onChange={(v) => update('basic', { introduction: v })} multiline placeholder="100-200字，涵盖学校定位、规模、特色" />
        </div>
      </div>

      {/* 2. 学校文化灵魂 */}
      <div className={cardClass}>
        <SectionHeader index={2} title="学校文化灵魂" />
        <div className="space-y-4">
          <Field label="校训" value={data.culture.motto} onChange={(v) => update('culture', { motto: v })} />
          <Field label="校歌片段" value={data.culture.school_song_excerpt} onChange={(v) => update('culture', { school_song_excerpt: v })} multiline />
          <div className="grid grid-cols-2 gap-4">
            <Field label="办学愿景" value={data.culture.vision} onChange={(v) => update('culture', { vision: v })} />
            <Field label="核心精神" value={data.culture.core_spirit} onChange={(v) => update('culture', { core_spirit: v })} />
          </div>
        </div>
      </div>

      {/* 3. 符号语义块 */}
      <div className={cardClass}>
        <SectionHeader index={3} title="符号语义块" />
        <div className="space-y-4">
          <Field label="校徽官方释义" value={data.symbols.emblem_description} onChange={(v) => update('symbols', { emblem_description: v })} multiline />
          <div className="grid grid-cols-2 gap-4">
            <Field label="校旗说明" value={data.symbols.flag_description} onChange={(v) => update('symbols', { flag_description: v })} />
            <div />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-stone-500">标准校色</label>
              <button onClick={addColor} className="text-xs text-indigo-500 hover:text-indigo-700">+ 添加颜色</button>
            </div>
            <div className="space-y-2">
              {data.symbols.standard_colors.map((c, i) => (
                <ColorRow key={i} color={c} onChange={(nc) => updateColor(i, nc)} onDelete={() => deleteColor(i)} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 4. 历史时间轴 */}
      <div className={cardClass}>
        <SectionHeader index={4} title="历史时间轴" />
        <div className="space-y-3 mb-4">
          {data.history.timeline.map((item, i) => (
            <TimelineRow
              key={i}
              item={item}
              onChange={(t) => updateTimelineItem(i, t)}
              onDelete={() => deleteTimelineItem(i)}
            />
          ))}
        </div>
        <button onClick={addTimelineItem} className="text-xs text-indigo-500 hover:text-indigo-700 mb-4">+ 添加历史节点</button>
        <Field label="代表性校友" value={data.history.notable_alumni} onChange={(v) => update('history', { notable_alumni: v })} multiline placeholder="姓名（身份），逗号分隔" />
      </div>

      {/* 5 & 6 */}
      <div className="grid grid-cols-2 gap-4">
        <div className={cardClass}>
          <SectionHeader index={5} title="核心地标语义" />
          <div className="space-y-4">
            <Field label="标志性建筑" value={data.landmarks.buildings} onChange={(v) => update('landmarks', { buildings: v })} multiline placeholder="逗号分隔，如：未名湖、博雅塔" />
            <Field label="非遗石刻" value={data.landmarks.stone_carvings} onChange={(v) => update('landmarks', { stone_carvings: v })} />
            <Field label="著名雕塑" value={data.landmarks.sculptures} onChange={(v) => update('landmarks', { sculptures: v })} />
          </div>
        </div>
        <div className={cardClass}>
          <SectionHeader index={6} title="生态环境语义" />
          <div className="space-y-4">
            <Field label="校花 / 校树" value={data.ecology.plants} onChange={(v) => update('ecology', { plants: v })} multiline />
            <Field label="湖泊 / 山岳" value={data.ecology.geography} onChange={(v) => update('ecology', { geography: v })} />
          </div>
        </div>
      </div>

      {/* 7. 荣誉与学科 */}
      <div className={cardClass}>
        <SectionHeader index={7} title="荣誉与学科" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="强势学科" value={data.academics.strong_disciplines} onChange={(v) => update('academics', { strong_disciplines: v })} multiline />
          <Field label="重大科技成果" value={data.academics.major_achievements} onChange={(v) => update('academics', { major_achievements: v })} multiline />
        </div>
      </div>

      {/* 8. 营销话术 */}
      <div className={cardClass}>
        <SectionHeader index={8} title="营销话术采集" />
        <div className="space-y-4">
          <Field label="校长寄语" value={data.marketing.president_message} onChange={(v) => update('marketing', { president_message: v })} multiline />
          <div className="grid grid-cols-2 gap-4">
            <Field label="校园流行语" value={data.marketing.campus_slogan} onChange={(v) => update('marketing', { campus_slogan: v })} />
            <Field label="学生对母校的昵称" value={data.marketing.student_nickname} onChange={(v) => update('marketing', { student_nickname: v })} />
          </div>
        </div>
      </div>

      {/* 视觉采集区 */}
      <div className="bg-indigo-50 rounded-xl px-4 py-2 flex items-center gap-2">
        <span className="text-indigo-500 text-sm">🖼</span>
        <span className="text-indigo-700 text-sm font-semibold">视觉采集区</span>
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between mb-4">
          <SectionHeader index={9} title="地标实拍图" />
          <p className="text-xs text-stone-400">用于后续纹样生成的参考图，可删除不相关图片</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {images.map((img, i) => (
            <ImageCard
              key={img.imageUrl}
              image={img}
              onDelete={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>
        {images.length === 0 && (
          <p className="text-center text-stone-300 text-sm py-8">暂无图片</p>
        )}
      </div>

      <div className="pb-8" />
    </div>
  )
}
