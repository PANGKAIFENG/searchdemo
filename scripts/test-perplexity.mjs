/**
 * V2 验证脚本：Perplexity 单函数验证
 *
 * 用法：
 *   PERPLEXITY_API_KEY=pplx-your-key-here node scripts/test-perplexity.mjs
 *
 * 断言：
 *   - 返回非 null
 *   - data.symbols.standard_colors 数组长度 > 0
 *   - citations 中含 .edu.cn 或权威来源
 */

import { ProxyAgent, fetch } from 'undici'

const apiKey = process.env.PERPLEXITY_API_KEY
if (!apiKey || apiKey.startsWith('pplx-xxx')) {
  console.error('❌ 请先设置 PERPLEXITY_API_KEY 环境变量')
  process.exit(1)
}

// ── 代理支持 ──
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.ALL_PROXY ||
  'http://127.0.0.1:8118'
const proxyAgent = new ProxyAgent(proxyUrl)
console.log(`🌐 使用代理：${proxyUrl}`)

const SCHOOL = '池州学院'

async function searchAndExtract(schoolName, dimension) {
  const dimensionDescriptions = {
    standard_colors: '标准校色（官方颜色名称、HEX 值、RGB 值及用途）',
    school_song: '校歌（歌名及完整歌词或权威节选）',
  }

  const dimensionSchemas = {
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

  const schema = dimensionSchemas[dimension]
  const schemaStr = JSON.stringify(schema)

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    // @ts-ignore
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
          content: `请搜索【${schoolName}】的${dimensionDescriptions[dimension]}，按照以下 schema 提取信息并输出 JSON：\n\n${schemaStr}`,
        },
      ],
      search_domain_filter: ['.edu.cn', 'baike.baidu.com', 'zh.wikipedia.org'],
      search_language_filter: ['zh'],
      max_tokens: 2000,
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`API error ${response.status}: ${errText}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  const citations = [
    ...(result.search_results?.map((r) => r.url) ?? []),
    ...(result.citations ?? []),
  ]

  let data
  try {
    data = JSON.parse(content)
  } catch {
    const match = content?.match(/\{[\s\S]*\}/)
    if (match) data = JSON.parse(match[0])
  }

  return { data, citations, rawContent: content }
}

async function main() {
  console.log(`\n🔍 测试学校：${SCHOOL}`)
  console.log('═'.repeat(50))

  // ── 测试 standard_colors ──
  console.log('\n[1/2] 测试 standard_colors...')
  try {
    const result = await searchAndExtract(SCHOOL, 'standard_colors')
    const colors = result.data?.symbols?.standard_colors

    console.log('✅ API 返回成功')
    console.log(`   颜色数量: ${Array.isArray(colors) ? colors.length : '非数组'}`)
    if (Array.isArray(colors) && colors.length > 0) {
      console.log(`   第一个颜色: ${JSON.stringify(colors[0], null, 2)}`)
    }
    console.log(`   Citations (${result.citations.length}):`)
    result.citations.slice(0, 5).forEach((c) => console.log(`   - ${c}`))

    const hasEduCn = result.citations.some((c) => c.includes('.edu.cn'))
    console.log(`\n   断言 - 返回非 null: ✅`)
    console.log(`   断言 - colors.length > 0: ${Array.isArray(colors) && colors.length > 0 ? '✅' : '❌'}`)
    console.log(`   断言 - citations 含 .edu.cn: ${hasEduCn ? '✅' : '⚠️  未命中 .edu.cn（可能来源于其他权威站点）'}`)
  } catch (err) {
    console.error('❌ standard_colors 测试失败:', err.message)
  }

  // ── 测试 school_song ──
  console.log('\n[2/2] 测试 school_song...')
  try {
    const result = await searchAndExtract(SCHOOL, 'school_song')
    const excerpt = result.data?.culture?.school_song_excerpt

    console.log('✅ API 返回成功')
    console.log(`   school_song_excerpt.value: ${excerpt?.value?.slice(0, 100)}...`)
    console.log(`   置信度: ${excerpt?.confidence}`)
    console.log(`   Citations (${result.citations.length}):`)
    result.citations.slice(0, 5).forEach((c) => console.log(`   - ${c}`))

    const hasContent = excerpt?.value && excerpt.value !== '【暂无】'
    console.log(`\n   断言 - 返回非 null: ✅`)
    console.log(`   断言 - 有歌词内容: ${hasContent ? '✅' : '⚠️  返回【暂无】，可能该校无公开校歌记录'}`)
  } catch (err) {
    console.error('❌ school_song 测试失败:', err.message)
  }

  console.log('\n' + '═'.repeat(50))
  console.log('验证完成。确认结果正常后，将 .env.local 中 PERPLEXITY_ENABLED 改为 true。')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
