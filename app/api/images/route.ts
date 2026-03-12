import { NextRequest, NextResponse } from 'next/server'
import { ImageResult, ImageAssets, ImageCategory, ImageSearchHints } from '@/app/types'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  try {
    const { school_name, search_hints } = await request.json() as {
      school_name: string
      search_hints?: ImageSearchHints
    }

    if (!school_name || typeof school_name !== 'string' || !school_name.trim()) {
      return NextResponse.json({ error: '请输入学校名称' }, { status: 400 })
    }

    const serperKey = process.env.SERPER_API_KEY
    if (!serperKey) {
      // 无 Serper key 时返回空结果，不阻断主流程
      return NextResponse.json({ status: 'partial', assets: emptyAssets() })
    }

    const schoolName = school_name.trim()

    // 使用传入的 hints 或默认关键词
    const hints: ImageSearchHints = search_hints || {
      emblem: [`${schoolName} 校徽 官方 高清`],
      landmark: [`${schoolName} 标志性建筑`, `${schoolName} 图书馆`, `${schoolName} 主楼`],
      scenery: [`${schoolName} 校园风景`, `${schoolName} 校园 航拍`],
    }

    // 并行分类搜图
    const [emblemResults, landmarkResults, sceneryResults] = await Promise.all([
      searchByCategory('emblem', hints.emblem.slice(0, 1), 2, serperKey, schoolName),
      searchByCategory('landmark', hints.landmark.slice(0, 4), 2, serperKey, schoolName),
      searchByCategory('scenery', hints.scenery.slice(0, 3), 2, serperKey, schoolName),
    ])

    const assets: ImageAssets = {
      emblem: emblemResults,
      landmark: landmarkResults,
      scenery: sceneryResults,
      summary: {
        total: emblemResults.length + landmarkResults.length + sceneryResults.length,
        emblem_count: emblemResults.length,
        landmark_count: landmarkResults.length,
        scenery_count: sceneryResults.length,
        missing_emblem: emblemResults.length === 0,
        image_insufficient: (landmarkResults.length + sceneryResults.length) < 6,
      },
    }

    return NextResponse.json({
      status: assets.summary.image_insufficient ? 'partial' : 'success',
      assets,
    })
  } catch (error) {
    console.error('Images collect API error:', error)
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 })
  }
}

async function searchByCategory(
  category: ImageCategory,
  keywords: string[],
  perKeyword: number,
  apiKey: string,
  schoolName: string,
): Promise<ImageResult[]> {
  const results = await Promise.allSettled(
    keywords.map((kw) => searchOneKeyword(kw, category, perKeyword, apiKey, schoolName))
  )
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

async function searchOneKeyword(
  keyword: string,
  category: ImageCategory,
  count: number,
  apiKey: string,
  schoolName: string,
): Promise<ImageResult[]> {
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: keyword, num: count + 3, gl: 'cn', hl: 'zh-cn' }),
    })

    if (!res.ok) return []

    const data = await res.json()
    const imgs = (data.images || []) as Array<{ title: string; imageUrl: string; link: string }>

    const filtered = imgs
      .filter((img) => {
        if (!img.imageUrl) return false
        // 校徽特殊过滤：清除带复杂场景的图，优先 logo/icon 尺寸图
        if (category === 'emblem') {
          return !img.imageUrl.includes('news') && !img.imageUrl.includes('video')
        }
        // 地标/风景：排除图标类小图
        return !img.imageUrl.includes('icon') &&
          !img.imageUrl.includes('avatar') &&
          !img.imageUrl.includes('portrait')
      })
      .sort((a) => (a.imageUrl.startsWith('https') ? -1 : 1))
      .slice(0, count)

    return filtered.map((img) => {
      const domain = extractDomain(img.link || img.imageUrl)
      const isOfficial = domain.endsWith('.edu.cn')
      const label = buildLabel(category, keyword, schoolName)

      return {
        category,
        category_label: label,
        search_keyword: keyword,
        title: img.title || keyword,
        imageUrl: img.imageUrl,
        link: img.link || '',
        source_domain: domain,
        is_official: isOfficial,
      }
    })
  } catch {
    return []
  }
}

function buildLabel(category: ImageCategory, keyword: string, schoolName: string): string {
  if (category === 'emblem') return '校徽'
  // 从关键词中提取具体地标/场景名（去掉学校名前缀）
  const suffix = keyword.replace(schoolName, '').trim()
  if (category === 'landmark') return suffix ? `校园地标-${suffix}` : '校园地标'
  return suffix ? `校园风景-${suffix}` : '校园风景'
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function emptyAssets(): ImageAssets {
  return {
    emblem: [],
    landmark: [],
    scenery: [],
    summary: {
      total: 0,
      emblem_count: 0,
      landmark_count: 0,
      scenery_count: 0,
      missing_emblem: true,
      image_insufficient: true,
    },
  }
}
