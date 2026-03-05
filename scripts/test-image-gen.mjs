/**
 * 诊断参数问题：逐步排除哪个参数导致失败
 * 运行：node scripts/test-image-gen.mjs
 */

const API_KEY = 'sk-x64wU7UeM3DrGjGDAyCZ7XQfLZW61rF7pgyVNWxd5uTAKCD2'
const BASE_URL = 'https://geekai.co/api/v1'

const ZH_PROMPT = '校服门襟纹样，刺绣风格，对称构图，白色背景，高清'
const EN_PROMPT = 'school uniform pattern, embroidery style, symmetrical, white background, high detail'

const CASES = [
  // 最简参数
  { label: 'nano-banana-pro 最简(无size,中文)', model: 'nano-banana-pro', prompt: ZH_PROMPT },
  { label: 'nano-banana-pro 最简(无size,英文)', model: 'nano-banana-pro', prompt: EN_PROMPT },
  { label: 'nano-banana-pro aspect_ratio', model: 'nano-banana-pro', prompt: EN_PROMPT, aspect_ratio: '1:1' },
  { label: 'nano-banana-2 最简(英文)', model: 'nano-banana-2', prompt: EN_PROMPT },
  { label: 'doubao-seedream-4.5 最简(英文)', model: 'doubao-seedream-4.5', prompt: EN_PROMPT },
  { label: 'doubao-seedream-4.5 中文', model: 'doubao-seedream-4.5', prompt: ZH_PROMPT },
]

async function test(c) {
  const body = { model: c.model, prompt: c.prompt, async: true }
  if (c.aspect_ratio) body.aspect_ratio = c.aspect_ratio
  if (c.size) body.size = c.size
  if (c.n) body.n = c.n

  process.stdout.write(`\n[${c.label}]\n  请求体: ${JSON.stringify(body).slice(0, 150)}\n`)

  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  })
  const rb = await res.json()

  if (!res.ok || !rb.task_id) {
    console.log(`  ✗ 提交失败 ${res.status}: ${JSON.stringify(rb).slice(0, 200)}`)
    return
  }
  console.log(`  task_id: ${rb.task_id}`)

  const start = Date.now()
  while (Date.now() - start < 60_000) {
    await new Promise(r => setTimeout(r, 4000))
    const elapsed = ((Date.now() - start) / 1000).toFixed(0)
    const sr = await fetch(`${BASE_URL}/images/${rb.task_id}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    const sb = await sr.json()
    process.stdout.write(`\r  ${elapsed}s status=${sb.task_status}    `)
    if (sb.task_status === 'succeed') {
      const urls = (sb.data || []).map(d => d.url).filter(Boolean)
      console.log(`\n  ✓ 成功！${urls.length} 张`)
      urls.forEach(u => console.log(`    ${u}`))
      return
    }
    if (sb.task_status === 'failed') {
      console.log(`\n  ✗ 失败: ${JSON.stringify(sb).slice(0, 200)}`)
      return
    }
  }
  console.log(`\n  ✗ 超时 60s`)
}

async function main() {
  console.log('=== 参数诊断测试 ===')
  for (const c of CASES) await test(c)
  console.log('\n=== 完成 ===')
}
main().catch(console.error)
