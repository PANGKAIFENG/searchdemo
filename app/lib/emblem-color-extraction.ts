/**
 * 校徽图像主色提取（兜底策略）
 *
 * 触发条件：Batch B 提取结束后 standard_colors 仍无有效 HEX 值
 * 流程：
 *   1. Serper 图片搜索 → 取置信度最高的校徽图片 URL
 *   2. 将图片 URL 以 vision 消息格式传给 LLM
 *   3. LLM 返回 2-3 个主色的 HEX / RGB / 名称
 *   4. 写回 standard_colors（source_level: L5，标注"图像提取，非官方"）
 */

import type { StandardColor } from '@/app/types'

// ─── 类型 ────────────────────────────────────────────────

interface ExtractedColor {
  name: string
  hex: string
  rgb: string
  usage: 'primary' | 'secondary' | 'accent'
}

// ─── Step 1：搜索校徽图片 URL ───────────────────────────

/**
 * 用 Serper Images API 搜索校徽图片，返回最佳候选 URL
 * 优先取 .edu.cn 来源；无则取首个 HTTPS URL
 */
export async function searchEmblemImageUrl(
  schoolName: string,
  serperKey: string,
): Promise<string | null> {
  const queries = [
    `${schoolName} 校徽 官方 高清`,
    `${schoolName} logo 校徽`,
  ]

  for (const q of queries) {
    try {
      const res = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: 8, gl: 'cn', hl: 'zh-cn' }),
      })

      if (!res.ok) continue

      const data = await res.json()
      const imgs = (data.images ?? []) as Array<{ imageUrl: string; link: string }>

      // 优先 edu.cn 来源
      const official = imgs.find(
        (img) => img.imageUrl?.startsWith('https') && img.link?.includes('.edu.cn'),
      )
      if (official?.imageUrl) return official.imageUrl

      // 次选：HTTPS 图片，过滤掉明显不是 logo 的
      const fallback = imgs.find(
        (img) =>
          img.imageUrl?.startsWith('https') &&
          !img.imageUrl.includes('news') &&
          !img.imageUrl.includes('photo') &&
          !img.imageUrl.includes('banner'),
      )
      if (fallback?.imageUrl) return fallback.imageUrl
    } catch {
      // 继续下一个 query
    }
  }

  return null
}

// ─── Step 2：Vision LLM 提取主色 ─────────────────────────

const VISION_SYSTEM_PROMPT = `你是专业的品牌色彩分析师，专注于提取校徽/Logo的标准色。
输出规则：
- 只输出合法 JSON，直接以 { 开头
- 禁止任何 markdown、解释文字
- 颜色名称使用中文官方命名风格（如"学院蓝"、"深红色"）
- HEX 必须为 #RRGGBB 格式`

/**
 * 调用 vision LLM，从校徽图片 URL 中提取主色
 */
async function extractColorsViaVision(
  imageUrl: string,
  schoolName: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<ExtractedColor[]> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'low' },
            },
            {
              type: 'text',
              text: `这是【${schoolName}】的校徽图片。请分析图片，提取 2-3 个主要颜色，输出如下 JSON：
{
  "colors": [
    {
      "name": "颜色中文名",
      "hex": "#RRGGBB",
      "rgb": "R___ G___ B___",
      "usage": "primary"
    }
  ]
}
usage 枚举值：primary（主色）/ secondary（辅色）/ accent（点缀色）
不要提取白色（#FFFFFF）和纯黑（#000000）作为主色。`,
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`Vision API failed (${response.status}): ${err}`)
  }

  const data = await response.json()
  const content: string = data.choices?.[0]?.message?.content ?? ''

  const parsed = JSON.parse(content) as { colors?: ExtractedColor[] }
  const colors = parsed.colors ?? []

  // 基础校验：过滤掉没有合法 HEX 的条目
  return colors.filter(
    (c) =>
      c.hex &&
      /^#[0-9A-Fa-f]{6}$/.test(c.hex) &&
      c.hex.toLowerCase() !== '#ffffff' &&
      c.hex.toLowerCase() !== '#000000',
  )
}

// ─── Step 3：转换为 StandardColor 格式 ───────────────────

function toStandardColors(
  colors: ExtractedColor[],
  imageUrl: string,
): StandardColor[] {
  return colors.map((c) => ({
    name: c.name,
    hex: c.hex.toUpperCase(),
    rgb: c.rgb || hexToRgbString(c.hex),
    usage: c.usage ?? 'primary',
    source_level: 'L5' as const,
    source_url: imageUrl,
    confidence: 0.5,
    is_official: false,
    conflict: false,
    conflict_note: '',
    extraction_note: '图像提取，非官方标准色，仅供参考',
  }))
}

function hexToRgbString(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `R${r} G${g} B${b}`
}

// ─── 主入口 ───────────────────────────────────────────────

/**
 * 兜底提取：仅当 existingColors 中无有效 HEX 时才执行
 * 返回从图像提取的 StandardColor[]，失败时返回 null（不影响主流程）
 */
export async function extractEmblemColorsAsFallback(
  schoolName: string,
  existingColors: StandardColor[],
  apiKey: string,
  baseUrl: string,
  model: string,
  serperKey: string | undefined,
): Promise<StandardColor[] | null> {
  // 已有有效 HEX，跳过
  const hasValidHex = existingColors.some(
    (c) => c.hex && /^#[0-9A-Fa-f]{6}$/.test(c.hex),
  )
  if (hasValidHex) return null

  // 无 Serper key，无法搜图
  if (!serperKey) return null

  try {
    const imageUrl = await searchEmblemImageUrl(schoolName, serperKey)
    if (!imageUrl) return null

    const extracted = await extractColorsViaVision(imageUrl, schoolName, apiKey, baseUrl, model)
    if (extracted.length === 0) return null

    return toStandardColors(extracted, imageUrl)
  } catch {
    return null
  }
}
