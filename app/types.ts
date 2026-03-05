// ─── Step 1 数据采集 ───────────────────────────────────────

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

// ─── Step 2（现有，保持不变）────────────────────────────────

export interface PrimaryColor {
  name: string
  hex: string
  meaning: string
}

export interface VisualAssets {
  primary_colors: PrimaryColor[]
  landmarks: string[]
  cultural_symbols: string[]
  image_search_keywords: string[]
}

export interface PatternSuggestions {
  front_placket: string
  cuffs: string
  hood: string
}

export interface HistoryHighlight {
  year: string
  event: string
}

export interface Motto {
  original: string
  interpretation: string
}

export interface SchoolBrief {
  school_name: string
  school_abbr: string
  region: string
  school_type: string
  design_theme: string
  creative_foundation: string
  visual_assets: VisualAssets
  design_logic: string
  pattern_suggestions: PatternSuggestions
  school_history_highlights: HistoryHighlight[]
  motto: Motto
  citations: string[]
}

// ─── 通用 ────────────────────────────────────────────────

export interface ImageResult {
  keyword: string
  title: string
  imageUrl: string
  link: string
}
