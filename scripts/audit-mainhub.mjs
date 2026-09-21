#!/usr/bin/env node
// scripts/audit-mainhub.mjs
//
// Static compliance audit for scene_main_hub.js against CODEGEN_SYSTEM_PROMPT
// §5.1.1–§5.1.5 (G.theme tokens, drawButton/drawNavTab/drawIconButton/
// drawSegmented taxonomy, mainHub UE checklist).
//
// Usage:
//   node scripts/audit-mainhub.mjs                        # audit all game-output/pro_*
//   node scripts/audit-mainhub.mjs pro_zhiwu              # one project (folder name)
//   node scripts/audit-mainhub.mjs game-output/pro_zhiwu  # explicit path
//
// Exit code: 0 if every audited project scores ≥ 9/10, else 1.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ---------- helpers ----------
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
}
const PASS = c.green + '✓' + c.reset
const FAIL = c.red + '✗' + c.reset
const WARN = c.yellow + '⚠' + c.reset

function readSafe(p) {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

// strip /* ... */ and // ... comments + string contents (best-effort, single-pass)
function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

// count top-level entries of an array-literal declaration: `name = [ {...}, {...} ]`
function countArrayEntries(src, declRegex) {
  const m = src.match(declRegex)
  if (!m) return 0
  const start = m.index + m[0].length - 1 // pointing at '['
  let depth = 0, i = start, count = 0, sawObj = false
  for (; i < src.length; i++) {
    const ch = src[i]
    if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) break
      if (depth === 1 && ch === '}') { count++; sawObj = false }
    } else if (depth === 1 && ch === '{') sawObj = true
  }
  // fallback: if no brace counted but content exists, return 1
  if (!count && /\{/.test(src.slice(start, i))) count = 1
  return count
}

// ---------- check definitions ----------
// Each check returns { status: 'pass'|'fail'|'warn', detail }
const checks = [
  {
    id: 1,
    name: '三段式布局（topBar / hero / navTab 三类绘制都出现）',
    run(stripped) {
      const hasTopBar = /\bdrawTopBar\s*\(/.test(stripped)
      const hasHero = /\bdrawFeatureCard\s*\(/.test(stripped)
      const hasNav = /\bdrawNavTab\s*\(/.test(stripped)
      const hits = [hasTopBar && 'topBar', hasHero && 'hero', hasNav && 'navTab'].filter(Boolean)
      if (hits.length === 3) return { status: 'pass', detail: hits.join(' + ') }
      return { status: 'fail', detail: `仅找到 ${hits.join('、') || '无'}，缺 ${['topBar','hero','navTab'].filter((_,i)=>![hasTopBar,hasHero,hasNav][i]).join('、')}` }
    },
  },
  {
    id: 2,
    name: 'topBar 含 profile + currencies',
    run(stripped) {
      const hasProfile = /\bthis\.profile\s*=/.test(stripped) || /drawTopBar\s*\([^,]+,\s*\w*profile/i.test(stripped)
      const hasCurrencies = /\bthis\.currencies\s*=/.test(stripped) || /drawTopBar\s*\([^)]*currenc/i.test(stripped)
      if (hasProfile && hasCurrencies) return { status: 'pass', detail: 'profile + currencies' }
      if (hasProfile || hasCurrencies) return { status: 'warn', detail: hasProfile ? '只有 profile，缺 currencies' : '只有 currencies，缺 profile' }
      return { status: 'fail', detail: '未声明 profile / currencies' }
    },
  },
  {
    id: 3,
    name: 'hero 通过 drawFeatureCard 绘制（非纯矩形）',
    run(stripped) {
      const m = stripped.match(/\bdrawFeatureCard\s*\(/g)
      if (!m) return { status: 'fail', detail: '未调用 drawFeatureCard' }
      return { status: 'pass', detail: `${m.length} 次调用` }
    },
  },
  {
    id: 4,
    name: 'navItems 数量 3~5',
    run(stripped) {
      const n = countArrayEntries(stripped, /\bnavItems\s*=\s*\[/)
      if (n >= 3 && n <= 5) return { status: 'pass', detail: `${n} 项` }
      if (n === 0) return { status: 'fail', detail: '未声明 navItems' }
      return { status: 'fail', detail: `${n} 项（要求 3~5）` }
    },
  },
  {
    id: 5,
    name: "navItem.icon 使用 ASSETS['icon_*']（非纯 emoji 兜底）",
    run(_stripped, raw) {
      // search inside navItems = [...] block specifically
      const m = raw.match(/navItems\s*=\s*\[([\s\S]*?)\];/)
      if (!m) return { status: 'fail', detail: '未找到 navItems 数组' }
      const body = m[1]
      const itemMatches = body.match(/\{[^}]*\}/g) || []
      let assetIcons = 0, emojiOnly = 0
      for (const it of itemMatches) {
        if (/icon\s*:\s*G\.Assets\.get\(['"]icon_/.test(it)) assetIcons++
        else if (/icon\s*:\s*['"][^'"]{1,4}['"]/.test(it)) emojiOnly++
      }
      if (assetIcons === itemMatches.length && itemMatches.length > 0) return { status: 'pass', detail: `${assetIcons}/${itemMatches.length} 全部 ASSETS['icon_*']` }
      if (assetIcons > 0) return { status: 'warn', detail: `${assetIcons} ASSETS + ${emojiOnly} emoji` }
      return { status: 'fail', detail: `0 ASSETS（${emojiOnly} emoji 兜底）` }
    },
  },
  {
    id: 6,
    name: '所有按钮走 drawButton/drawIconButton/drawNavTab —— 无手画 close ✕',
    run(stripped) {
      // anti-pattern: ctx.arc(...) followed within 200 chars by ctx.fillText('✕') or ctx.fillText('×')
      const handPaintedClose = /ctx\.arc\s*\([^)]*\)[\s\S]{0,400}fillText\s*\(\s*''\s*,/.test(stripped)
        || /ctx\.beginPath\s*\(\s*\)[\s\S]{0,400}closeBtn[\s\S]{0,400}fillText/.test(stripped)
      const usesIconBtn = /\bdrawIconButton\s*\(/.test(stripped)
      // fallback heuristic on RAW source for ✕ literal
      return null // resolved in custom block below
    },
    custom(raw, stripped) {
      const usesIconBtn = /\bdrawIconButton\s*\(/.test(raw)
      // hand-painted close pattern: ctx.arc + fillText('✕'|'×')
      const handPainted = /ctx\.arc\s*\([\s\S]{0,200}?fillText\s*\(\s*['"][✕×][^'"]*['"]/.test(raw)
      // raw fillRect + fillText buy-button anti-pattern in popups (excluding inside drawButton/drawHubIcon)
      const rawRectText = /ctx\.fillRect\s*\([\s\S]{0,200}?ctx\.fillText\s*\(/.test(raw)
      if (usesIconBtn && !handPainted) return { status: 'pass', detail: 'drawIconButton 已使用，未发现手画 ✕' }
      if (handPainted) return { status: 'fail', detail: '检测到手画 close (ctx.arc + fillText ✕)' }
      if (!usesIconBtn) return { status: 'fail', detail: '未调用 drawIconButton（弹窗 close 必须走它）' }
      return { status: 'warn', detail: 'drawIconButton 已用，但仍有 fillRect+fillText 组合' + (rawRectText ? '（疑似裸按钮）' : '') }
    },
  },
  {
    id: 7,
    name: 'G.theme 唯一权威：无硬编码 #rrggbb / "Npx sans-serif"',
    run(stripped, raw) {
      // count hex colors and px sans-serif occurrences in stripped src (no strings/comments)
      const hexHits = (stripped.match(/#[0-9a-fA-F]{6}\b/g) || []).length
      const fontHits = (stripped.match(/\d+px\s+sans-serif/gi) || []).length
      // also count in raw to surface intentional violations even inside strings
      const rawHexHits = (raw.match(/#[0-9a-fA-F]{6}\b/g) || []).length
      const rawFontHits = (raw.match(/['"`]bold\s+\d+px\s+sans-serif['"`]/gi) || []).length
        + (raw.match(/['"`]\d+px\s+sans-serif['"`]/gi) || []).length
      if (rawHexHits === 0 && rawFontHits === 0) return { status: 'pass', detail: '0 硬编码颜色 / 字号' }
      if (rawHexHits + rawFontHits <= 4) return { status: 'warn', detail: `${rawHexHits} 个 #rrggbb，${rawFontHits} 个 字号字面量（应改读 G.theme）` }
      return { status: 'fail', detail: `${rawHexHits} 个 #rrggbb，${rawFontHits} 个 字号字面量（严重违反 §5.1.5 #7）` }
    },
  },
  {
    id: 8,
    name: 'opts.hitRect 与绘制矩形分离',
    run(stripped) {
      const hasHitRect = /\bhitRect\s*[:=]/.test(stripped)
      if (hasHitRect) return { status: 'pass', detail: '检测到 hitRect 字段' }
      return { status: 'warn', detail: '未声明 hitRect（建议在 drawButton opts 中传 hitRect 解耦命中区与绘制区）' }
    },
  },
  {
    id: 9,
    name: '每个 navItem 都有 G.registerPopup 注册',
    run(_stripped, raw) {
      const navItemsMatch = raw.match(/navItems\s*=\s*\[([\s\S]*?)\];/)
      if (!navItemsMatch) return { status: 'fail', detail: '未找到 navItems' }
      const navIds = [...navItemsMatch[1].matchAll(/id\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
      const popupRegs = [...raw.matchAll(/G\.registerPopup\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
      const missing = navIds.filter((id) => !popupRegs.includes(id))
      if (navIds.length && !missing.length) return { status: 'pass', detail: `${navIds.length}/${navIds.length} 已注册` }
      if (!navIds.length) return { status: 'warn', detail: '无 navItems 可校验' }
      return { status: 'fail', detail: `缺失 popup: ${missing.join(', ')}` }
    },
  },
  {
    id: 10,
    name: 'navTab 持久化 selected 状态（非每帧 idle/hover/pressed 三态）',
    run(stripped) {
      const writesSelected = /(this\.selectedNav|this\.activeNav|this\.activeTab|this\.currentNav)\s*=/.test(stripped)
        || /navStates\s*\[[^\]]+\]\s*=\s*['"]selected['"]/.test(stripped)
      const readsSelected = /['"]selected['"]/.test(stripped)
      if (writesSelected) return { status: 'pass', detail: '检测到 selectedNav/activeTab 持久化赋值' }
      if (readsSelected) return { status: 'warn', detail: "出现 'selected' 字面量但未持久化赋值，可能仅作读取" }
      return { status: 'fail', detail: 'navTab 仅 idle/hover/pressed，缺少 selected 持久态（违反 §5.1.5 #4 #10）' }
    },
  },
]

// ---------- runner ----------
function auditProject(projectPath) {
  const sceneFile = join(projectPath, 'code', 'scene_main_hub.js')
  const raw = readSafe(sceneFile)
  if (raw == null) return { skipped: `no code/scene_main_hub.js` }
  const stripped = stripCommentsAndStrings(raw)

  const results = checks.map((chk) => {
    let r
    if (chk.custom) r = chk.custom(raw, stripped)
    else r = chk.run(stripped, raw)
    return { id: chk.id, name: chk.name, ...r }
  })
  const score = results.filter((r) => r.status === 'pass').length
  const warns = results.filter((r) => r.status === 'warn').length
  return { sceneFile, results, score, warns }
}

function fmt(r) {
  const sym = r.status === 'pass' ? PASS : r.status === 'warn' ? WARN : FAIL
  return `  ${sym} ${c.bold}#${r.id}${c.reset} ${r.name}\n     ${c.gray}${r.detail || ''}${c.reset}`
}

function resolveProjects(arg) {
  if (!arg) {
    const root = join(repoRoot, 'game-output')
    return readdirSync(root)
      .map((n) => join(root, n))
      .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'code', 'scene_main_hub.js')))
  }
  // explicit path or folder name
  const candidates = [arg, join(repoRoot, arg), join(repoRoot, 'game-output', arg)]
  for (const cand of candidates) if (existsSync(cand) && statSync(cand).isDirectory()) return [cand]
  console.error(`${c.red}project not found: ${arg}${c.reset}`)
  process.exit(2)
}

function main() {
  const arg = process.argv[2]
  const projects = resolveProjects(arg)
  let worstScore = 10
  let total = 0, totalScore = 0, totalWarn = 0

  console.log(`${c.bold}${c.cyan}mainHub UE/UI compliance audit${c.reset}  ${c.dim}(§5.1.1–§5.1.5)${c.reset}\n`)
  for (const p of projects) {
    const name = basename(p)
    const out = auditProject(p)
    if (out.skipped) {
      console.log(`${c.gray}— ${name}: ${out.skipped}${c.reset}\n`)
      continue
    }
    total++
    totalScore += out.score
    totalWarn += out.warns
    worstScore = Math.min(worstScore, out.score)
    const grade = out.score === 10 ? c.green : out.score >= 7 ? c.yellow : c.red
    console.log(`${c.bold}${name}${c.reset}  ${grade}${out.score}/10${c.reset} ${c.gray}(${out.warns} warn)${c.reset}`)
    console.log(`  ${c.dim}${out.sceneFile.replace(repoRoot + '/', '')}${c.reset}`)
    for (const r of out.results) console.log(fmt(r))
    console.log('')
  }
  if (total === 0) { console.log('no projects audited.'); process.exit(0) }
  const avg = (totalScore / total).toFixed(1)
  console.log(`${c.bold}summary:${c.reset} ${total} projects, avg ${avg}/10, worst ${worstScore}/10, ${totalWarn} warnings total`)
  process.exit(worstScore >= 9 ? 0 : 1)
}

main()
