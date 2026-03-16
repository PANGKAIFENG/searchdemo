'use client'

import { useState } from 'react'
import LoadingProgress, { COLLECT_STEPS, COLLECT_PRECISE_STEPS } from '@/app/components/LoadingProgress'
import Step1Form from '@/app/components/Step1/Step1Form'
import Step2View from '@/app/components/Step2/Step2View'
import ValidateStep from '@/app/components/ValidateStep/ValidateStep'
import { SchoolData, ImageResult, ValidateResult, ImageSearchHints, DataQuality, CollectMode } from '@/app/types'
import { deepMerge } from '@/app/lib/utils'

type Phase = 'idle' | 'validating' | 'ambiguous' | 'collecting' | 'review' | 'step2'

const EXAMPLE_SCHOOLS = ['山东大学', '北京大学', '复旦大学', '浙江大学', '同济大学']

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [school, setSchool] = useState('')
  const [collectMode, setCollectMode] = useState<CollectMode>('precise')
  const [confirmedName, setConfirmedName] = useState('')
  const [error, setError] = useState('')

  // validate 结果
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null)

  // Step 1 data（文字 + 图片分开存）
  const [schoolData, setSchoolData] = useState<SchoolData | null>(null)
  const [images, setImages] = useState<ImageResult[]>([])
  const [dataQuality, setDataQuality] = useState<DataQuality | null>(null)
  const [collectStep, setCollectStep] = useState('')

  // 第一步：校验学校名称
  async function handleValidate(schoolName: string) {
    const name = schoolName.trim()
    if (!name) return

    setSchool(name)
    setPhase('validating')
    setError('')

    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: name }),
      })

      const data: ValidateResult = await res.json()

      if (!res.ok) {
        setError((data as unknown as { error: string }).error || '校验失败，请重试')
        setPhase('idle')
        return
      }

      if (data.status === 'confirmed' && data.confirmed_name) {
        // 直接进入采集
        await startCollect(data.confirmed_name)
      } else if (data.status === 'ambiguous') {
        setValidateResult(data)
        setPhase('ambiguous')
      } else {
        setError(data.error_message || '未找到该学校，请输入更完整的名称')
        setPhase('idle')
      }
    } catch {
      setError('网络错误，请检查连接后重试')
      setPhase('idle')
    }
  }

  // 用户从候选列表中选择确认
  async function handleCandidateSelect(selectedName: string) {
    await startCollect(selectedName)
  }

  // 第二步：并行采集文字数据和图片
  async function startCollect(schoolName: string) {
    setConfirmedName(schoolName)
    setPhase('collecting')
    setError('')
    setSchoolData(null)
    setImages([])
    setDataQuality(null)
    setCollectStep('')

    // 根据模式选择不同的采集接口
    const collectEndpoint = collectMode === 'precise' ? '/api/collect-precise' : '/api/collect'

    try {
      // SSE 流式消费 collect 接口
      const collectRes = await fetch(collectEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_name: schoolName }),
      })

      if (!collectRes.ok || !collectRes.body) {
        setError('采集失败，请重试')
        setPhase('idle')
        return
      }

      // 解析 SSE 事件流，等待 result 事件
      let collectData: {
        school_data: SchoolData
        data_quality: DataQuality
        image_search_hints: ImageSearchHints
        citations: string[]
      } | null = null

      const reader = collectRes.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const payload = JSON.parse(line.slice(5).trim())
            if (payload.step) {
              setCollectStep(payload.step)
            } else if (payload.school_data) {
              collectData = payload
              break outer
            } else if (payload.error) {
              setError(payload.error)
              setPhase('idle')
              return
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
      }

      if (!collectData) {
        setError('采集失败，请重试')
        setPhase('idle')
        return
      }

      const fetchedData: SchoolData = collectData.school_data
      const hints: ImageSearchHints = collectData.image_search_hints
      const fetchedQuality: DataQuality = collectData.data_quality

      // Step 3 → Step 4：verdict=需补查时自动调 refine
      let finalData = fetchedData
      let finalQuality = fetchedQuality

      if (fetchedQuality?.verdict === '需补查' && fetchedQuality.missing_fields.length > 0) {
        try {
          const refineRes = await fetch('/api/collect/refine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              school_name: schoolName,
              confirmed_data: fetchedData,
              missing_fields: fetchedQuality.missing_fields,
              recommended_queries: fetchedQuality.recommended_queries,
              mode: collectMode,
            }),
          })
          if (refineRes.ok) {
            const refineData = await refineRes.json()
            if (refineData.refined_data) {
              finalData = deepMerge(
                fetchedData as unknown as Record<string, unknown>,
                refineData.refined_data as Record<string, unknown>,
              ) as unknown as SchoolData
              finalQuality = refineData.data_quality ?? fetchedQuality
            }
          }
        } catch {
          // refine 失败时静默降级，使用原始采集数据
        }
      }

      // 将 ecology.plants 中的校花/校树追加到 scenery 搜索词，确保生态图片能被选中
      const ecologyKeywords: string[] = []
      if (finalData.ecology?.plants) {
        // 从 "校花：白玉兰；校树：法国梧桐" 中提取植物名
        const plantNames = finalData.ecology.plants
          .replace(/校花[：:]/g, '')
          .replace(/校树[：:]/g, '')
          .split(/[；;，,、\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length <= 6)
        plantNames.forEach((name) => ecologyKeywords.push(`${schoolName} ${name}`))
      }
      const enrichedHints: ImageSearchHints = {
        ...hints,
        scenery: [...hints.scenery, ...ecologyKeywords],
      }

      // 有了 hints 后，采集图片（不阻断主流程）
      const imagesPromise = fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_name: schoolName, search_hints: enrichedHints }),
      })
        .then((r) => r.json())
        .then((d) => {
          const assets = d.assets
          if (!assets) return []
          // 将三类图片合并为平铺数组供 Step1Form 使用
          return [
            ...(assets.emblem || []),
            ...(assets.landmark || []),
            ...(assets.scenery || []),
          ] as ImageResult[]
        })
        .catch(() => [] as ImageResult[])

      // 等图片（最多 15s 超时）
      const fetchedImages = await Promise.race([
        imagesPromise,
        new Promise<ImageResult[]>((resolve) => setTimeout(() => resolve([]), 15000)),
      ])

      setSchoolData(finalData)
      setImages(fetchedImages)
      setDataQuality(finalQuality)
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
    setConfirmedName('')
    setError('')
    setSchoolData(null)
    setImages([])
    setDataQuality(null)
    setValidateResult(null)
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
            {(phase === 'validating') && (
              <span className="text-xs text-orange-600 font-medium bg-orange-50 px-3 py-1 rounded-full">
                校验学校名称…
              </span>
            )}
            {phase === 'ambiguous' && (
              <span className="text-xs text-amber-600 font-medium bg-amber-50 px-3 py-1 rounded-full">
                请选择学校
              </span>
            )}
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
                  onKeyDown={(e) => e.key === 'Enter' && handleValidate(school)}
                  placeholder="例如：北大、山东大学、华师"
                  className="flex-1 border border-stone-200 rounded-xl px-5 py-3 text-stone-800 text-base outline-none focus:ring-2 focus:ring-stone-800 focus:border-transparent transition"
                />
                <button
                  onClick={() => handleValidate(school)}
                  disabled={!school.trim()}
                  className="bg-stone-900 hover:bg-stone-700 disabled:bg-stone-300 text-white font-semibold px-7 py-3 rounded-xl transition text-base flex-shrink-0"
                >
                  开始采集
                </button>
              </div>

              {/* 采集模式选择 */}
              <div className="mt-4 flex justify-center gap-6">
                <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg transition ${
                  collectMode === 'precise' ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-stone-50'
                }`}>
                  <input
                    type="radio"
                    name="collectMode"
                    value="precise"
                    checked={collectMode === 'precise'}
                    onChange={() => setCollectMode('precise')}
                    className="accent-indigo-600"
                  />
                  <div className="text-left">
                    <span className={`text-sm font-medium ${collectMode === 'precise' ? 'text-indigo-700' : 'text-stone-700'}`}>
                      精准模式
                    </span>
                    <span className="text-xs text-indigo-500 ml-1">推荐</span>
                    <p className="text-xs text-stone-400">先搜索权威来源再提取，更准确</p>
                  </div>
                </label>
                <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg transition ${
                  collectMode === 'fast' ? 'bg-amber-50 ring-1 ring-amber-200' : 'hover:bg-stone-50'
                }`}>
                  <input
                    type="radio"
                    name="collectMode"
                    value="fast"
                    checked={collectMode === 'fast'}
                    onChange={() => setCollectMode('fast')}
                    className="accent-amber-600"
                  />
                  <div className="text-left">
                    <span className={`text-sm font-medium ${collectMode === 'fast' ? 'text-amber-700' : 'text-stone-700'}`}>
                      快速模式
                    </span>
                    <p className="text-xs text-stone-400">LLM 直接联网搜索，更快速</p>
                  </div>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {EXAMPLE_SCHOOLS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleValidate(s)}
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

      {/* ── Phase: validating ── */}
      {phase === 'validating' && (
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <div className="text-4xl mb-4 animate-pulse">🔍</div>
          <p className="text-stone-600 text-base">正在识别「{school}」…</p>
        </div>
      )}

      {/* ── Phase: ambiguous（歧义，候选选择）── */}
      {phase === 'ambiguous' && validateResult && (
        <div className="max-w-3xl mx-auto px-6 py-8">
          <ValidateStep
            inputName={school}
            result={validateResult}
            onSelect={handleCandidateSelect}
            onBack={handleReset}
          />
        </div>
      )}

      {/* ── Phase: collecting ── */}
      {phase === 'collecting' && (
        <div className="max-w-3xl mx-auto px-6 py-10">
          <LoadingProgress
            school={confirmedName}
            steps={collectMode === 'precise' ? COLLECT_PRECISE_STEPS : COLLECT_STEPS}
            accentColor="#6366f1"
            currentStep={collectStep}
          />
        </div>
      )}

      {/* ── Phase: review ── */}
      {phase === 'review' && schoolData && (
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Step1Form
            schoolName={confirmedName}
            initialData={schoolData}
            initialImages={images}
            dataQuality={dataQuality ?? undefined}
            onConfirm={handleConfirm}
          />
        </div>
      )}

      {/* ── Phase: step2 ── */}
      {phase === 'step2' && schoolData && (
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Step2View
            schoolName={confirmedName}
            schoolData={schoolData}
            images={images}
            onReset={handleReset}
          />
        </div>
      )}
    </main>
  )
}
