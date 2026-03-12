/**
 * 从可能包含 markdown 代码块的字符串中提取 JSON 并解析
 * 兼容两种格式：
 *   1. ```json ... ``` 代码块
 *   2. 裸 JSON（直接以 { 开头）
 */
export function extractJSON(text: string): unknown {
  const match = text.match(/```json\s*([\s\S]*?)```/)
  if (match) return JSON.parse(sanitize(match[1].trim()))

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) return JSON.parse(sanitize(text.slice(start, end + 1)))

  throw new Error('No JSON found')
}

/**
 * 将中文弯引号替换为书名号形式，防止 JSON.parse 解析失败
 */
export function sanitize(raw: string): string {
  return raw.replace(/\u201c/g, '「').replace(/\u201d/g, '」')
}

/**
 * 深度合并两个对象，source 中的字段会覆盖 target 中同名字段。
 * 数组直接覆盖（不合并数组元素）。
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = result[key]
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      )
    } else {
      result[key] = sourceVal
    }
  }
  return result
}
