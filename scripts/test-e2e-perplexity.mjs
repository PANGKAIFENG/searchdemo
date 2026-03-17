/**
 * V3 端到端验证：Perplexity 双通道对 2 所学校的采集效果
 * 测试：池州学院（普通本科）、合肥工业大学（985/211）
 *
 * 用法：node scripts/test-e2e-perplexity.mjs
 */

import { ProxyAgent, fetch } from 'undici'

const apiKey = process.env.PERPLEXITY_API_KEY

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:8118'
const proxyAgent = new ProxyAgent(proxyUrl)
console.log(`🌐 代理：${proxyUrl}\n`)

const SCHOOLS = ['池州学院', '合肥工业大学']

const SCHEMAS = {
  standard_colors: {
    symbols: {
      standard_colors: [
        {
          name: '颜色中文名',
          hex: '#XXXXXX',
          rgb: 'R G B',
          usage: 'primary|secondary|accent',
          source_level: 'L1|L2|L3|L4|L5',
          source_url: '',
          confidence: 0.9,
          is_official: true,
          conflict: false,
          conflict_note: '',
          extraction_note: '',
        },
      ],
    },
  },
  school_song: {
    culture: {
      school_song_excerpt: {
        value: '校歌歌名+歌词节选',
        status: 'confirmed|inferred|insufficient',
        confidence: 0.8,
        source_url: '',
        source_level: 'L1|L2|L3|L4|L5',
      },
    },
  },
}

const DIMENSION_DESC = {
  standard_colors: '标准校色（官方颜色名称、HEX 值、RGB 值及用途）',
  school_song: '校歌（歌名及完整歌词或权威节选）',
}

async function callPerplexity(schoolName, dimension) {
  const schema = SCHEMAS[dimension]
  const start = Date.now()
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    dispatcher: proxyAgent,
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: '你是院校信息提取专家，只输出合法 JSON，不输出任何说明、markdown 标记或代码块。所有信息必须来源于搜索结果，找不到的字段填【暂无】，禁止编造数据。',
        },
        {
          role: 'user',
          content: `请搜索【${schoolName}】的${DIMENSION_DESC[dimension]}，按照以下 schema 提取信息并输出 JSON：\n\n${JSON.stringify(schema)}`,
        },
      ],
      search_domain_filter: ['.edu.cn', 'baike.baidu.com', 'zh.wikipedia.org'],
      search_language_filter: ['zh'],
      max_tokens: 2000,
      temperature: 0.1,
    }),
  })

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`HTTP ${response.status}: ${err.slice(0, 200)}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  const citations = [
    ...(result.search_results?.map((r) => r.url) ?? []),
    ...(result.citations ?? []),
  ].filter(Boolean)

  let data
  try {
    data = JSON.parse(content)
  } catch {
    const match = content?.match(/\{[\s\S]*\}/)
    data = match ? JSON.parse(match[0]) : null
  }

  return { data, citations, elapsed }
}

function scoreColors(colors) {
  if (!Array.isArray(colors) || colors.length === 0) return { score: 0, summary: '无颜色数据' }
  const hexOk = colors.filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c.hex))
  const l1l2 = colors.filter((c) => ['L1', 'L2'].includes(c.source_level))
  return {
    score: colors.length,
    hexHit: hexOk.length,
    l1l2Count: l1l2.length,
    summary: `共${colors.length}条颜色，有效HEX=${hexOk.length}，L1/L2=${l1l2.length}`,
  }
}

function scoreSong(excerpt) {
  if (!excerpt || excerpt.value === '【暂无】') return { score: 0, summary: '暂无歌词' }
  const len = excerpt.value.length
  const hasLyrics = len > 20 && !excerpt.value.includes('暂无')
  return {
    score: hasLyrics ? 1 : 0,
    len,
    confidence: excerpt.confidence,
    source_level: excerpt.source_level,
    summary: hasLyrics ? `有歌词（${len}字，${excerpt.source_level}）` : `内容不足（${len}字）`,
  }
}

async function testSchool(schoolName) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`🏫 ${schoolName}`)
  console.log('─'.repeat(60))

  const results = {}

  // 并行调两个维度
  const [colorRes, songRes] = await Promise.allSettled([
    callPerplexity(schoolName, 'standard_colors'),
    callPerplexity(schoolName, 'school_song'),
  ])

  // ── standard_colors ──
  console.log('\n📊 standard_colors')
  if (colorRes.status === 'fulfilled') {
    const { data, citations, elapsed } = colorRes.value
    const colors = data?.symbols?.standard_colors
    const stat = scoreColors(colors)
    console.log(`   耗时: ${elapsed}s`)
    console.log(`   结果: ${stat.summary}`)
    if (Array.isArray(colors) && colors.length > 0) {
      colors.forEach((c, i) => {
        console.log(`   [${i + 1}] ${c.name} | hex=${c.hex} | ${c.source_level} | ${c.usage}`)
        if (c.extraction_note) console.log(`        备注: ${c.extraction_note}`)
      })
    }
    console.log(`   Citations(${citations.length}): ${citations.slice(0, 3).join(', ')}`)
    results.colors = stat
  } else {
    console.log(`   ❌ 失败: ${colorRes.reason?.message}`)
    results.colors = { score: -1, summary: '调用失败' }
  }

  // ── school_song ──
  console.log('\n🎵 school_song')
  if (songRes.status === 'fulfilled') {
    const { data, citations, elapsed } = songRes.value
    const excerpt = data?.culture?.school_song_excerpt
    const stat = scoreSong(excerpt)
    console.log(`   耗时: ${elapsed}s`)
    console.log(`   结果: ${stat.summary}`)
    if (excerpt?.value && excerpt.value !== '【暂无】') {
      console.log(`   歌词节选: ${excerpt.value.slice(0, 120)}...`)
    }
    console.log(`   Citations(${citations.length}): ${citations.slice(0, 3).join(', ')}`)
    results.song = stat
  } else {
    console.log(`   ❌ 失败: ${songRes.reason?.message}`)
    results.song = { score: -1, summary: '调用失败' }
  }

  return results
}

async function main() {
  console.log('═'.repeat(60))
  console.log('  V3 端到端验证 — Perplexity Sonar-Pro')
  console.log('═'.repeat(60))

  const summary = {}
  for (const school of SCHOOLS) {
    try {
      summary[school] = await testSchool(school)
    } catch (err) {
      console.error(`\n❌ ${school} 整体失败:`, err.message)
      summary[school] = { error: err.message }
    }
  }

  // ── 汇总报告 ──
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  汇总')
  console.log('═'.repeat(60))
  for (const [school, res] of Object.entries(summary)) {
    if (res.error) {
      console.log(`${school}: ❌ ${res.error}`)
      continue
    }
    const colorTag = res.colors?.hexHit > 0 ? '✅' : res.colors?.score > 0 ? '⚠️ ' : '❌'
    const songTag  = res.song?.score > 0 ? '✅' : '⚠️ '
    console.log(`${school}:`)
    console.log(`  颜色 ${colorTag} ${res.colors?.summary}`)
    console.log(`  校歌 ${songTag} ${res.song?.summary}`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
