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
  candidates?: SchoolCandidate[]  // status=ambiguous 时
  error_message?: string    // status=not_found 时
}

// ─── Step 1 数据采集（8维度）────────────────────────────────

export interface TimelineItem {
  year: string
  event: string
}

export interface StandardColor {
  name: string
  hex: string
  description: string
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
  }
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
  creativeFoundation: string
  designLogic: string
  patternSuggestions: PatternSuggestion[]
}
