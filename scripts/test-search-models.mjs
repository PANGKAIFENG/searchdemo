/**
 * GeeKAI 新搜索模型评估脚本
 *
 * 测试目标模型：
 *   glm-search-pro / glm-search-pro-sogou / glm-search-pro-quark / jina-search-v1
 *
 * 评估维度：
 *   - 事实类（basic/history）：edu.cn 官网摘要质量
 *   - 文化符号（symbols）：标准色 HEX、校徽含义
 *   - 校歌（culture）：歌词全文命中
 *   - 地标建筑（landmarks）：微信/公众号来源覆盖（Sogou 优势）
 *   - 校花校树（ecology）：非正式内容覆盖
 *
 * 用法：node scripts/test-search-models.mjs
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) { console.error('❌ .env.local not found'); process.exit(1) }
  const env = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const idx = t.indexOf('=')
    if (idx === -1) continue
    env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim()
  }
  return env
}

const env = loadEnv()
const API_KEY = env.GEEKAI_API_KEY
const BASE_URL = (env.GEEKAI_BASE_URL || 'https://geekai.co/api/v1').replace(/\/$/, '')

if (!API_KEY) { console.error('❌ GEEKAI_API_KEY not found'); process.exit(1) }

// ── 测试模型 ──────────────────────────────────────────────
const MODELS = [
  'glm-search-std',        // 基准
  'glm-search-pro',        // Pro 版
  'glm-search-pro-sogou',  // 搜狗引擎（微信/公众号）
  'glm-search-pro-quark',  // 夸克引擎（移动端内容）
  'jina-search-v1',        // Jina 搜索
]

// ── 测试用例：按字段类型分组 ──────────────────────────────
const TEST_CASES = [
  {
    id: 'basic_edu',
    label: '基本信息 [edu.cn]',
    prompt: '合肥工业大学 学校简介 办学定位 历史沿革',
    domain_filter: 'edu.cn',
    count: 5,
    content_size: 'high',
    // 评估：摘要是否含官网内容
    keywords: ['合肥工业大学', '创办', '本科', '学院'],
  },
  {
    id: 'standard_colors',
    label: '标准校色 [HEX]',
    prompt: '合肥工业大学 校徽 标准色 颜色 HEX RGB VIS',
    count: 5,
    content_size: 'high',
    keywords: ['颜色', '校徽', '标准', 'RGB', '#'],
  },
  {
    id: 'school_song',
    label: '校歌歌词 [全文]',
    prompt: '合肥工业大学 校歌 歌词 完整版 全文',
    count: 5,
    content_size: 'high',
    keywords: ['校歌', '歌词', '合肥工业大学'],
  },
  {
    id: 'landmarks_wechat',
    label: '标志性建筑 [微信/公号]',
    prompt: '合肥工业大学 标志性建筑 图书馆 校园地标 景点',
    count: 8,
    content_size: 'medium',
    // Sogou 优势：微信文章里常有学校建筑介绍
    keywords: ['建筑', '图书馆', '地标', '景观', '广场'],
    checkWechat: true,
  },
  {
    id: 'ecology',
    label: '校花校树 [非正式]',
    prompt: '合肥工业大学 校花 校树 官方认定 校园植物',
    count: 5,
    content_size: 'medium',
    keywords: ['校花', '校树', '植物'],
  },
  {
    id: 'alumni_gossip',
    label: '校友八卦 [社交内容]',
    prompt: '合肥工业大学 知名校友 杰出校友 毕业生 名人',
    count: 5,
    content_size: 'medium',
    keywords: ['校友', '毕业', '工大'],
  },
]

// ── 单次搜索 ──────────────────────────────────────────────
async function search(model, testCase) {
  const start = Date.now()
  try {
    const body = {
      model,
      prompt: testCase.prompt,
      count: testCase.count,
      content_size: testCase.content_size,
    }
    if (testCase.domain_filter) body.domain_filter = testCase.domain_filter

    const resp = await fetch(`${BASE_URL}/web_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })

    const elapsed = Date.now() - start

    if (!resp.ok) {
      const msg = await resp.text().catch(() => '')
      return { ok: false, status: resp.status, msg: msg.slice(0, 100), elapsed }
    }

    const data = await resp.json()
    const results = data.results ?? []

    // 统计指标
    const totalChars = results.reduce((s, r) => s + (r.content?.length ?? 0), 0)
    const keywordHits = testCase.keywords.filter((kw) =>
      results.some((r) => (r.content + r.title).includes(kw))
    ).length
    const wechatCount = testCase.checkWechat
      ? results.filter((r) => r.link?.includes('mp.weixin') || r.link?.includes('weixin.qq')).length
      : null
    const eduCount = results.filter((r) => r.link?.includes('.edu.cn')).length

    return {
      ok: true,
      count: results.length,
      totalChars,
      keywordHits,
      keywordTotal: testCase.keywords.length,
      wechatCount,
      eduCount,
      elapsed,
      topLinks: results.slice(0, 3).map((r) => r.link),
    }
  } catch (err) {
    return { ok: false, status: 'timeout/err', msg: String(err).slice(0, 80), elapsed: Date.now() - start }
  }
}

// ── 格式化单行 ────────────────────────────────────────────
function fmtResult(r) {
  if (!r.ok) return `❌ ${r.status} ${r.msg ?? ''}`
  const kw = `关键词${r.keywordHits}/${r.keywordTotal}`
  const chars = `${Math.round(r.totalChars / 1000)}k字`
  const edu = r.eduCount > 0 ? ` edu=${r.eduCount}` : ''
  const wx = r.wechatCount !== null ? ` wx=${r.wechatCount}` : ''
  const t = `${r.elapsed}ms`
  return `✅ ${r.count}条 ${chars} ${kw}${edu}${wx} [${t}]`
}

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(70))
  console.log('  GeeKAI 搜索模型字段适配评估')
  console.log(`  学校：合肥工业大学  |  模型数：${MODELS.length}  |  用例数：${TEST_CASES.length}`)
  console.log('═'.repeat(70))

  // 存储所有结果，用于最终对比矩阵
  const matrix = {}  // matrix[testCase.id][model] = result

  for (const tc of TEST_CASES) {
    console.log(`\n📋 ${tc.label}`)
    console.log(`   查询：「${tc.prompt.slice(0, 50)}」`)
    console.log('─'.repeat(60))
    matrix[tc.id] = {}

    // 并行测试所有模型
    const results = await Promise.all(MODELS.map((m) => search(m, tc)))

    for (let i = 0; i < MODELS.length; i++) {
      const model = MODELS[i]
      const r = results[i]
      matrix[tc.id][model] = r
      console.log(`  ${model.padEnd(28)} ${fmtResult(r)}`)
      if (r.ok && r.topLinks?.length) {
        r.topLinks.forEach((link) => console.log(`    → ${link}`))
      }
    }
  }

  // ── 汇总矩阵：关键词命中率 ──
  console.log('\n\n' + '═'.repeat(70))
  console.log('  汇总：关键词命中率（hits/total）')
  console.log('═'.repeat(70))

  const header = '用例'.padEnd(20) + MODELS.map((m) => m.replace('glm-search-', '').padEnd(16)).join('')
  console.log(header)
  console.log('─'.repeat(header.length))

  for (const tc of TEST_CASES) {
    let row = tc.label.slice(0, 18).padEnd(20)
    for (const m of MODELS) {
      const r = matrix[tc.id][m]
      if (!r?.ok) {
        row += '❌'.padEnd(16)
      } else {
        const rate = `${r.keywordHits}/${r.keywordTotal}`
        const wx = r.wechatCount !== null ? `(wx${r.wechatCount})` : ''
        row += (rate + wx).padEnd(16)
      }
    }
    console.log(row)
  }

  // ── 推荐配置 ──
  console.log('\n' + '═'.repeat(70))
  console.log('  字段 → 推荐模型（基于关键词命中率）')
  console.log('═'.repeat(70))

  for (const tc of TEST_CASES) {
    const ranked = MODELS
      .filter((m) => matrix[tc.id][m]?.ok)
      .sort((a, b) => {
        const ra = matrix[tc.id][a]
        const rb = matrix[tc.id][b]
        // 优先关键词命中，其次内容总字数
        const diff = (rb.keywordHits / rb.keywordTotal) - (ra.keywordHits / ra.keywordTotal)
        return diff !== 0 ? diff : rb.totalChars - ra.totalChars
      })
    const best = ranked[0]?.replace('glm-search-', '') ?? 'n/a'
    console.log(`  ${tc.label.padEnd(25)} → ${best}`)
  }

  console.log('\n✅ 评估完成\n')
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
