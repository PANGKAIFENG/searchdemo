import { SchoolData, DataQuality, DimensionScore } from '@/app/types'

// ─── 可信度来源域名权重表（PRD §3.3）──────────────────────────

const OFFICIAL_DOMAINS = ['edu.cn', 'gov.cn']
const WIKI_DOMAINS = ['baike.baidu.com', 'zh.wikipedia.org', 'en.wikipedia.org']
const MEDIA_DOMAINS = ['people.com.cn', 'xinhuanet.com', 'xinhua.net', 'chinadaily.com.cn']

function getDomainWeight(url: string): number {
  try {
    const hostname = new URL(url).hostname
    if (OFFICIAL_DOMAINS.some((d) => hostname.endsWith(d))) return 1.0
    if (WIKI_DOMAINS.some((d) => hostname === d)) return 0.8
    if (MEDIA_DOMAINS.some((d) => hostname.includes(d))) return 0.7
    return 0.4
  } catch {
    return 0.1
  }
}

/**
 * 计算 citations 来源的综合可信度分数（PRD §3.3）
 * 取所有来源权重的平均值，空数组时返回 0.1（AI 直接生成，无来源）
 */
export function calcConfidenceScore(citations: string[]): number {
  if (!citations || citations.length === 0) return 0.1
  const weights = citations.map(getDomainWeight)
  const sum = weights.reduce((acc, w) => acc + w, 0)
  return Math.round((sum / weights.length) * 100) / 100
}

// ─── 单维度评分规则（PRD §3.2）──────────────────────────────

function scoreBasic(data: SchoolData): DimensionScore {
  const missing_fields: string[] = []
  const warnings: string[] = []

  if (!data.basic?.full_name?.trim() || data.basic.full_name.includes('暂无')) missing_fields.push('basic.full_name')
  if (!data.basic?.short_name?.trim() || data.basic.short_name.includes('暂无')) missing_fields.push('basic.short_name')
  if (!data.basic?.founded_year?.trim() || data.basic.founded_year.includes('暂无')) missing_fields.push('basic.founded_year')
  if (!data.basic?.location?.trim() || data.basic.location.includes('暂无')) missing_fields.push('basic.location')
  if (!data.basic?.introduction?.trim() || data.basic.introduction.includes('暂无')) missing_fields.push('basic.introduction')

  if (data.basic?.introduction && data.basic.introduction.length < 100) {
    warnings.push('basic.introduction 内容过短（<100字），建议补充')
  }

  const filled = 5 - missing_fields.length
  return { score: Math.round((filled / 5) * 100), missing_fields, warnings }
}

function scoreCulture(data: SchoolData): DimensionScore {
  const missing_fields: string[] = []
  const warnings: string[] = []

  const hasMotto = data.culture?.motto?.trim() && !data.culture.motto.includes('暂无')
  if (!hasMotto) missing_fields.push('culture.motto')

  const hasSong = data.culture?.school_song_excerpt?.trim() && !data.culture.school_song_excerpt.includes('暂无')
  const hasVision = data.culture?.vision?.trim() && !data.culture.vision.includes('暂无')
  const hasSpirit = data.culture?.core_spirit?.trim() && !data.culture.core_spirit.includes('暂无')

  if (!hasSong && !hasVision && !hasSpirit) {
    missing_fields.push('culture.school_song_excerpt | culture.vision | culture.core_spirit（至少需要一项）')
  }

  if (hasMotto && !hasSong) {
    warnings.push('culture.school_song_excerpt 缺失，建议补充校歌信息')
  }

  // 满分条件：校训 + 至少校歌/愿景/精神之一
  const score = !hasMotto ? 0 : (!hasSong && !hasVision && !hasSpirit) ? 50 : 100
  return { score, missing_fields, warnings }
}

function scoreSymbols(data: SchoolData): DimensionScore {
  const missing_fields: string[] = []
  const warnings: string[] = []

  const hasEmblem = data.symbols?.emblem_description?.trim() && !data.symbols.emblem_description.includes('暂无')
  if (!hasEmblem) missing_fields.push('symbols.emblem_description')

  const colors = data.symbols?.standard_colors || []
  const hasHex = colors.some(
    (c) => c.hex && /^#[0-9A-Fa-f]{6}$/.test(c.hex) && c.hex !== '#000000' && c.hex !== '#FFFFFF'
  )
  if (!hasHex) missing_fields.push('symbols.standard_colors[].hex')

  if (colors.length > 0 && !colors.some((c) => c.source_level === 'L1' || c.source_level === 'L2')) {
    warnings.push('standard_colors 无 L1/L2 官方来源，可信度较低')
  }

  const score = [hasEmblem, hasHex].filter(Boolean).length
  return { score: Math.round((score / 2) * 100), missing_fields, warnings }
}

function scoreHistory(data: SchoolData): DimensionScore {
  const missing_fields: string[] = []
  const warnings: string[] = []

  const timeline = data.history?.timeline || []
  const validEvents = timeline.filter((t) => t.year && t.event && !t.event.includes('暂无'))

  if (validEvents.length < 5) {
    missing_fields.push(`history.timeline（当前 ${validEvents.length} 条，需≥5条）`)
  }

  if (!data.history?.notable_alumni?.trim() || data.history.notable_alumni.includes('暂无')) {
    warnings.push('history.notable_alumni 缺失')
  }

  const score = Math.min(100, Math.round((validEvents.length / 5) * 100))
  return { score, missing_fields, warnings }
}

function scoreLandmarks(data: SchoolData): DimensionScore {
  const missing_fields: string[] = []
  const warnings: string[] = []

  const buildings = data.landmarks?.buildings?.trim()
  if (!buildings || buildings.includes('暂无')) {
    missing_fields.push('landmarks.buildings')
    return { score: 0, missing_fields, warnings }
  }

  // 简单判断：以逗号/顿号分割，≥3个地标得满分
  const count = buildings.split(/[，,、]/).filter((s) => s.trim().length > 0).length
  if (count < 3) {
    missing_fields.push(`landmarks.buildings（当前约 ${count} 处，需≥3处）`)
  }

  const score = Math.min(100, Math.round((count / 3) * 100))
  return { score, missing_fields, warnings }
}

function scoreEcology(data: SchoolData): DimensionScore {
  const missing_fields: string[] = []
  const warnings: string[] = []

  const hasPlants = data.ecology?.plants?.trim() && !data.ecology.plants.includes('暂无')
  if (!hasPlants) {
    missing_fields.push('ecology.plants（校花/校树）')
  }

  return { score: hasPlants ? 100 : 0, missing_fields, warnings }
}

function scoreAcademics(data: SchoolData): DimensionScore {
  const missing_fields: string[] = []
  const warnings: string[] = []

  const disciplines = data.academics?.strong_disciplines?.trim()
  const achievements = data.academics?.major_achievements?.trim()

  if (!disciplines || disciplines.includes('暂无')) missing_fields.push('academics.strong_disciplines')
  if (!achievements || achievements.includes('暂无')) missing_fields.push('academics.major_achievements')

  // 以逗号分割判断数量（≥5个学科/成果得满分）
  const count = disciplines ? disciplines.split(/[，,、]/).filter((s) => s.trim().length > 0).length : 0
  const score = missing_fields.length === 2 ? 0 : count >= 5 ? 100 : Math.round((count / 5) * 80)

  if (count > 0 && count < 5) {
    warnings.push(`academics.strong_disciplines 只有约 ${count} 项，建议补充至≥5项`)
  }

  return { score, missing_fields, warnings }
}

function scoreMarketing(data: SchoolData): DimensionScore {
  const missing_fields: string[] = []
  const warnings: string[] = []

  const highlights = data.marketing?.b2b_highlights || []
  const validHighlights = highlights.filter((h) => h?.trim() && !h.includes('暂无'))

  if (validHighlights.length < 3) {
    missing_fields.push(`marketing.b2b_highlights（当前 ${validHighlights.length} 条，需≥3条）`)
  }

  if (!data.marketing?.president_message?.trim() || data.marketing.president_message.includes('暂无')) {
    warnings.push('marketing.president_message 缺失')
  }

  const score = Math.min(100, Math.round((validHighlights.length / 3) * 100))
  return { score, missing_fields, warnings }
}

// ─── 权重配置（精度要求100%的维度权重×1.5，PRD §3.2）──────────

const DIMENSION_WEIGHTS: Record<string, number> = {
  basic: 1.5,
  culture: 1.5,
  symbols: 1.5,
  history: 1.0,
  landmarks: 1.0,
  ecology: 1.0,
  academics: 1.0,
  marketing: 1.0,
}

interface CompletenessResult {
  completeness_score: number
  dimension_scores: Record<string, DimensionScore>
  missing_fields: string[]
  low_confidence_warnings: string[]
}

/**
 * 计算 SchoolData 的完整性评分（PRD §3.2）
 * 返回加权平均分 + 各维度细节
 */
export function calcCompletenessScore(data: SchoolData): CompletenessResult {
  const scorers: Record<string, (d: SchoolData) => DimensionScore> = {
    basic: scoreBasic,
    culture: scoreCulture,
    symbols: scoreSymbols,
    history: scoreHistory,
    landmarks: scoreLandmarks,
    ecology: scoreEcology,
    academics: scoreAcademics,
    marketing: scoreMarketing,
  }

  const dimension_scores: Record<string, DimensionScore> = {}
  let weightedSum = 0
  let totalWeight = 0
  const allMissingFields: string[] = []
  const allWarnings: string[] = []

  for (const [dim, scorer] of Object.entries(scorers)) {
    const result = scorer(data)
    dimension_scores[dim] = result

    const weight = DIMENSION_WEIGHTS[dim] ?? 1.0
    weightedSum += result.score * weight
    totalWeight += weight
    allMissingFields.push(...result.missing_fields)
    allWarnings.push(...result.warnings)
  }

  const completeness_score = Math.round(weightedSum / totalWeight)

  return {
    completeness_score,
    dimension_scores,
    missing_fields: allMissingFields,
    low_confidence_warnings: allWarnings,
  }
}

/**
 * 根据完整性和可信度判断是否需要补查（PRD §3.3 阈值）
 */
export function getVerdict(completenessScore: number, confidenceScore: number): '通过' | '需补查' {
  return completenessScore >= 80 && confidenceScore >= 0.7 ? '通过' : '需补查'
}

// ─── 补查推荐搜索词（PRD §4.2 补查策略表）──────────────────────

const FIELD_QUERY_MAP: Record<string, (schoolName: string) => string> = {
  'symbols.standard_colors[].hex': (name) => `${name} 校色 HEX RGB 官方 site:edu.cn`,
  'culture.school_song_excerpt | culture.vision | culture.core_spirit（至少需要一项）': (name) => `${name} 校歌 完整版歌词`,
  'culture.motto': (name) => `${name} 校训 官方原文`,
  'history.timeline（当前': (name) => `${name} 发展历史 大事记`,
  'landmarks.buildings': (name) => `${name} 标志性建筑 代表建筑物`,
  'marketing.b2b_highlights（当前': (name) => `${name} 校园精神 办学特色 项目亮点`,
  'academics.strong_disciplines': (name) => `${name} 优势学科 特色专业 国家级`,
  'ecology.plants（校花/校树）': (name) => `${name} 校花 校树 官方`,
}

/**
 * 根据缺失字段列表生成推荐补查搜索词（PRD §4.2）
 */
export function buildRecommendedQueries(schoolName: string, missingFields: string[]): string[] {
  const queries = new Set<string>()
  for (const field of missingFields) {
    for (const [pattern, queryFn] of Object.entries(FIELD_QUERY_MAP)) {
      if (field.startsWith(pattern) || field === pattern) {
        queries.add(queryFn(schoolName))
        break
      }
    }
  }
  return Array.from(queries)
}

/**
 * 组合全部评分，生成标准 DataQuality 对象
 */
export function calcDataQuality(schoolName: string, data: SchoolData, citations: string[]): DataQuality {
  const completenessResult = calcCompletenessScore(data)
  const confidence_score = calcConfidenceScore(citations)
  const verdict = getVerdict(completenessResult.completeness_score, confidence_score)
  const recommended_queries = buildRecommendedQueries(schoolName, completenessResult.missing_fields)

  return {
    completeness_score: completenessResult.completeness_score,
    confidence_score,
    verdict,
    dimension_scores: completenessResult.dimension_scores,
    low_confidence_warnings: completenessResult.low_confidence_warnings,
    missing_fields: completenessResult.missing_fields,
    recommended_queries,
  }
}
