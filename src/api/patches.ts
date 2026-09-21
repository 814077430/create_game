/**
 * 增量补丁工具
 * 解析 LLM 输出的 SEARCH/REPLACE 或 APPEND 补丁块，并应用到现有源代码。
 *
 * 支持的格式：
 *   <<<<<<< SEARCH
 *   <existing-code>
 *   =======
 *   <new-code>
 *   >>>>>>> REPLACE
 *
 *   <<<<<<< APPEND
 *   <new-code>
 *   >>>>>>> APPEND
 */

export interface Patch {
  type: 'replace' | 'append'
  search?: string
  replace: string
}

export interface ApplyResult {
  source: string
  applied: number
  failed: number
  failedDetails: string[]
  totalPatches: number
}

/** 将文本拆分为补丁块数组。允许大小写任意（容错）。 */
export function parsePatches(text: string): Patch[] {
  if (!text) return []
  const patches: Patch[] = []

  // 去除可能的 Markdown 代码块包裹（容错）
  const cleaned = text.replace(/^```(?:\w+)?\s*\n?|\n?```\s*$/gm, '')

  // SEARCH ... ======= ... REPLACE
  const replaceRe = /<{5,}\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n={5,}\s*\r?\n([\s\S]*?)\r?\n>{5,}\s*REPLACE/gi
  let m: RegExpExecArray | null
  while ((m = replaceRe.exec(cleaned)) !== null) {
    patches.push({ type: 'replace', search: m[1], replace: m[2] })
  }

  // APPEND ... APPEND
  const appendRe = /<{5,}\s*APPEND\s*\r?\n([\s\S]*?)\r?\n>{5,}\s*APPEND/gi
  while ((m = appendRe.exec(cleaned)) !== null) {
    patches.push({ type: 'append', replace: m[1] })
  }

  return patches
}

/** 容错的子串匹配：先精确匹配；失败则尝试忽略行尾空白后再匹配。 */
function findMatch(source: string, search: string): { start: number; end: number } | null {
  const idx = source.indexOf(search)
  if (idx >= 0) return { start: idx, end: idx + search.length }

  // 退化策略：按行剪掉行尾空白后重新尝试匹配
  const norm = (s: string) => s.split('\n').map((l) => l.replace(/\s+$/g, '')).join('\n')
  const ns = norm(source)
  const nq = norm(search)
  const ni = ns.indexOf(nq)
  if (ni < 0) return null

  // 还原到原始 source 中的位置（按行计数恢复）
  const beforeLines = ns.slice(0, ni).split('\n').length - 1
  const matchLines = nq.split('\n').length
  const sourceLines = source.split('\n')
  const start = sourceLines.slice(0, beforeLines).join('\n').length + (beforeLines > 0 ? 1 : 0)
  const end = sourceLines.slice(0, beforeLines + matchLines).join('\n').length + (beforeLines > 0 ? 1 : 0)
  return { start, end }
}

/** 应用补丁数组到源代码，按补丁先后顺序逐个应用。 */
export function applyPatches(source: string, patches: Patch[]): ApplyResult {
  let result = source
  let applied = 0
  let failed = 0
  const failedDetails: string[] = []

  for (const p of patches) {
    if (p.type === 'replace') {
      if (!p.search) {
        failed++
        failedDetails.push('SEARCH 块为空')
        continue
      }
      const m = findMatch(result, p.search)
      if (!m) {
        failed++
        const preview = p.search.slice(0, 100).replace(/\n/g, '⏎')
        failedDetails.push(`SEARCH 未匹配: "${preview}${p.search.length > 100 ? '…' : ''}"`)
        continue
      }
      result = result.slice(0, m.start) + p.replace + result.slice(m.end)
      applied++
    } else if (p.type === 'append') {
      const sep = result.endsWith('\n') ? '' : '\n'
      const tail = p.replace.endsWith('\n') ? '' : '\n'
      result = result + sep + p.replace + tail
      applied++
    }
  }

  return { source: result, applied, failed, failedDetails, totalPatches: patches.length }
}

/** 一步解析+应用 */
export function applyPatchText(source: string, patchText: string): ApplyResult {
  const patches = parsePatches(patchText)
  return applyPatches(source, patches)
}
