// ─── 采集模式 ──────────────────────────────────────────────
export type CollectMode = 'precise' | 'fast'

// ─── 学校名称校验（接口① validate）────────────────────────
export interface SchoolCandidate {
  official_name: string
  location: string
  level: string      // 985/211/普通本科/专科/中小学 等
  website: string
  is_recommended: boolean
  recommend_reason: string
}

export interface ValidateResult {
  status: 'confirmed' | 'ambiguous' | 'not_found'
  confirmed_name?: string    // status=confirmed 时
  edu_domain?: string        // 学校官网域名（如 tsinghua.edu.cn）
  candidates?: SchoolCandidate[]  // status=ambiguous 时
  error_message?: string    // status=not_found 时
}

// ─── Step 1 数据采集（8维度）────────────────────────────────

export interface TimelineItem {
  year: string
  event: string
}

export interface StandardColor {
  name: string                          // 颜色中文名（官方命名优先，否则 AI 命名并在 extraction_note 注明）
  hex: string                           // #RRGGBB 格式，必须精确
  rgb: string                           // "R___ G___ B___"
  usage: 'primary' | 'secondary' | 'accent'
  source_level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5'  // L1=官方VIS, L5=图像提取兜底
  source_url: string                    // 来源链接
  confidence: number                    // 0.0 – 1.0，L1=1.0, L5=0.4
  is_official: boolean                  // 是否来自学校官方域名
  conflict: boolean                     // ΔE ≥ 15 时为 true，需人工核验
  conflict_note?: string               // conflict=true 时说明冲突来源
  extraction_note?: string             // L5 时注明"图像提取，非官方"
}

/** 8 个采集维度 */
export interface SchoolData {
  /** 1. 院校基本面 */
  basic: {
    full_name: string
    short_name: string
    founded_year: string
    location: string
    introduction: string
  }
  /** 2. 学校文化灵魂 */
  culture: {
    motto: string
    school_song_excerpt: string
    vision: string
    core_spirit: string
  }
  /** 3. 符号语义块 */
  symbols: {
    emblem_description: string
    flag_description: string
    standard_colors: StandardColor[]
  }
  /** 4. 历史时间轴 */
  history: {
    timeline: TimelineItem[]
    notable_alumni: string
  }
  /** 5. 核心地标语义 */
  landmarks: {
    buildings: string
    stone_carvings: string
    sculptures: string
  }
  /** 6. 生态环境语义 */
  ecology: {
    plants: string
    geography: string
  }
  /** 7. 荣誉与学科 */
  academics: {
    strong_disciplines: string
    major_achievements: string
  }
  /** 8. 营销话术采集 */
  marketing: {
    president_message: string
    campus_slogan: string
    student_nickname: string
    b2b_highlights?: string[]   // B端项目亮点，3-5条，可直接用于提案PPT
  }
}

// ─── 数据质量评估（接口② collect 响应新增）────────────────────

export interface DimensionScore {
  score: number               // 0–100
  missing_fields: string[]    // 该维度缺失的字段名
  warnings: string[]          // 低可信度告警信息
}

export interface DataQuality {
  completeness_score: number                     // 0–100，8维度加权平均
  confidence_score: number                       // 0.0–1.0，来源域名权重计算
  verdict: '通过' | '需补查'                      // 完整性≥80 且 可信度≥0.7 时为"通过"
  dimension_scores: Record<string, DimensionScore>
  low_confidence_warnings: string[]             // 跨维度低可信度字段汇总
  missing_fields: string[]                       // 跨维度缺失字段汇总（字段路径，如 "symbols.standard_colors"）
  recommended_queries: string[]                  // 补查推荐搜索词（用于 refine 接口）
}

// ─── 图片采集（接口③ images/collect）────────────────────────

export type ImageCategory = 'emblem' | 'landmark' | 'scenery'

/** 单张图片（含分类标注）*/
export interface ImageResult {
  category: ImageCategory          // 图片分类
  category_label: string           // 中文分类说明，如"校园地标-未名湖"
  search_keyword: string           // 搜索使用的关键词
  title: string
  imageUrl: string
  link: string
  source_domain: string            // 来源域名
  is_official: boolean             // 是否来自 *.edu.cn
}

/** 图片采集结果（按类别分组）*/
export interface ImageAssets {
  emblem: ImageResult[]
  landmark: ImageResult[]
  scenery: ImageResult[]
  summary: {
    total: number
    emblem_count: number
    landmark_count: number
    scenery_count: number
    missing_emblem: boolean
    image_insufficient: boolean
  }
}

/** collect 接口同步返回的搜图关键词提示 */
export interface ImageSearchHints {
  emblem: string[]
  landmark: string[]
  scenery: string[]
}

// ─── Step 2 设计提案（接口④ design/brief）──────────────────

export interface PatternSuggestion {
  position: '门襟' | '袖口' | '帽兜'
  rationale: string
  prompt: string
  imageIndex: number   // 关联参考图片索引，-1 表示无
}

export interface Step2Brief {
  designTheme: string
  creativeFoundation: string           // 灵感来源，100-150字
  designLogic: string                  // 设计推导，150-200字
  designPhilosophy?: string            // 设计理念精华文案，50-80字，可直接用于提案PPT
  patternKeywordsZh?: string[]         // 10-15个中文纹样关键词（来自地标/生态/符号/学科）
  patternKeywordsEn?: string[]         // 对应英文关键词，供 Midjourney/DALL-E 使用
  colorPalette?: Array<{               // 色板，来自学校 standard_colors
    name: string
    hex: string
    role: string                       // 如"主色"、"辅色"
  }>
  patternSuggestions: PatternSuggestion[]
}
