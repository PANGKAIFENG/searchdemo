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
