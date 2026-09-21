#!/usr/bin/env node
// Audit a generated game project against CODEGEN_SYSTEM_PROMPT §6.3.9
// (12-item completeness self-check). Static regex-based; no runtime needed.
//
// Usage:
//   node scripts/audit-completeness.mjs                 # audit all projects in game-output/
//   node scripts/audit-completeness.mjs <project_dir>   # audit a single project
//
// Exit code: 0 only if score >= 11/12 for the inspected project(s).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT_ROOT = join(ROOT, 'game-output');

// ── helpers ──────────────────────────────────────────────────────────
const readSafe = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const has = (s, re) => re.test(s);
const count = (s, re) => (s.match(re) || []).length;

// Required scenes per §6.3.1 + tolerated alias for backwards-compat
const SCENE_FILES = {
  title:    ['scene_title.js'],
  mainHub:  ['scene_main_hub.js', 'scene_mainhub.js'],
  gameplay: ['scene_gameplay.js'],
  settle:   ['scene_settle.js', 'scene_gameover.js'], // gameover = legacy alias
};
function findScene(codeDir, key) {
  for (const f of SCENE_FILES[key]) {
    const p = join(codeDir, f);
    if (existsSync(p)) return { path: p, name: f, content: readSafe(p) };
  }
  return null;
}

// ── audit ────────────────────────────────────────────────────────────
function auditProject(projectDir) {
  const codeDir   = join(projectDir, 'code');
  const designDir = join(projectDir, 'design');
  if (!existsSync(codeDir)) return null;

  const main     = readSafe(join(codeDir, 'main.js'));
  const core     = readSafe(join(codeDir, 'core.js'));
  const game     = readSafe(join(codeDir, 'game.js'));
  const title    = findScene(codeDir, 'title');
  const mainHub  = findScene(codeDir, 'mainHub');
  const gameplay = findScene(codeDir, 'gameplay');
  const settle   = findScene(codeDir, 'settle');
  const allCode  = [main, core, game, title?.content, mainHub?.content,
                    gameplay?.content, settle?.content].filter(Boolean).join('\n\n');

  // design.json — used to enumerate buttons / popups expected
  const designJsonPath = join(designDir, 'game-design.json');
  let design = null;
  try { design = JSON.parse(readSafe(designJsonPath) || 'null'); } catch { design = null; }

  const checks = [];
  const warns  = [];
  const notes  = [];

  // 1. Four scenes registered + bootPhase Loading-once
  const scenesPresent = [title, mainHub, gameplay, settle].filter(Boolean).length;
  const bootPhaseOk   = has(main, /_bootPhase\s*[:=]/) || has(main, /bootPhase\s*[:=]/);
  checks.push({
    id: 1, name: 'four scenes registered + boot loading once',
    pass: scenesPresent === 4 && bootPhaseOk,
    detail: `scenes=${scenesPresent}/4 (title=${!!title}, mainHub=${!!mainHub}, gameplay=${!!gameplay}, settle=${!!settle}); bootPhase=${bootPhaseOk}`,
  });
  if (settle && settle.name === 'scene_gameover.js') {
    warns.push('settle scene uses legacy filename scene_gameover.js (new prompt expects scene_settle.js)');
  }

  // 2. Six lifecycle hooks per scene
  const HOOKS = ['init', 'update', 'render', 'destroy', 'onPause', 'onResume'];
  const sceneHookGaps = [];
  for (const [k, s] of Object.entries({ title, mainHub, gameplay, settle })) {
    if (!s) continue;
    const missing = HOOKS.filter((h) => !new RegExp(`\\b${h}\\s*[:(]`).test(s.content));
    if (missing.length) sceneHookGaps.push(`${k}:[${missing.join(',')}]`);
  }
  checks.push({
    id: 2, name: 'six lifecycle hooks (init/update/render/destroy/onPause/onResume)',
    pass: sceneHookGaps.length === 0,
    detail: sceneHookGaps.length ? `missing in ${sceneHookGaps.join(' ')}` : 'all hooks present',
  });

  // 3. transitionTo only — no naked G.Scenes.current = 'xxx'
  const transitionToCalls = count(allCode, /G\.Scenes\.transitionTo\s*\(/g);
  const nakedSwitches     = count(allCode, /G\.Scenes\.current\s*=\s*['"]/g);
  checks.push({
    id: 3, name: 'all scene jumps via G.Scenes.transitionTo (no naked current=)',
    pass: transitionToCalls > 0 && nakedSwitches === 0,
    detail: `transitionTo=${transitionToCalls}; nakedAssign=${nakedSwitches}`,
  });

  // 4. Every design button has a non-empty action
  let designButtons = 0, deadButtons = 0;
  if (design && typeof design === 'object') {
    const stack = [design];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { stack.push(...node); continue; }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'buttons' && Array.isArray(v)) {
          for (const btn of v) {
            if (!btn || typeof btn !== 'object') continue;
            designButtons++;
            const label = (btn.label || btn.text || btn.name || '').toString();
            if (!label) continue;
            // Heuristic: search for a code reference handling that label
            const pat = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            if (!pat.test(allCode)) deadButtons++;
          }
        } else if (typeof v === 'object') {
          stack.push(v);
        }
      }
    }
  }
  checks.push({
    id: 4, name: 'every design button has a code reference (label search)',
    pass: designButtons === 0 || deadButtons === 0,
    detail: designButtons === 0 ? 'no design buttons enumerated (skip)' :
            `total=${designButtons}; deadInCode=${deadButtons}`,
  });

  // 5. Each navItem popup registered with three close paths + interaction
  const popupIds = Array.from(allCode.matchAll(/G\.registerPopup\s*\(\s*['"]([^'"]+)['"]/g)).map((m) => m[1]);
  const openPopupIds = Array.from(allCode.matchAll(/G\.openPopup\s*\(\s*['"]([^'"]+)['"]/g)).map((m) => m[1]);
  const popupSet = new Set(popupIds);
  const missingPopups = [...new Set(openPopupIds)].filter((id) => !popupSet.has(id));
  // Three close paths in core: drawIconButton-style ✕, mask click, ESC
  const closeMaskOk = has(allCode, /panelRect|panel_rect|outsidePanel|maskClick|backdrop.*close/i);
  const closeEscOk  = has(allCode, /G\.Input\.escape|key\s*===?\s*['"]Escape['"]|e\.key\s*===?\s*['"]Escape['"]/);
  const closeXOk    = has(allCode, /drawIconButton|['"]✕['"]|['"]×['"]|closeButton/);
  checks.push({
    id: 5, name: 'every openPopup id is registered + three close paths exist (✕/mask/ESC)',
    pass: missingPopups.length === 0 && closeMaskOk && closeEscOk && closeXOk && popupIds.length > 0,
    detail: `registered=${popupIds.length}; openPopupCalls=${openPopupIds.length}; missing=[${missingPopups.join(',')}]; ✕=${closeXOk} mask=${closeMaskOk} ESC=${closeEscOk}`,
  });

  // 6. G.gameState shape + load/save points
  const gsHasCoin      = has(allCode, /G\.gameState[^=]*\bcoin\b/);
  const gsHasBestScore = has(allCode, /G\.gameState[^=]*\bbestScore\b|game_best_score/);
  const gsHasSettings  = has(allCode, /G\.gameState[^=]*\bsettings\b/);
  const loadStateCall  = has(allCode, /G\.loadState\s*\(/);
  const saveStateCall  = has(allCode, /G\.saveState\s*\(/);
  checks.push({
    id: 6, name: 'G.gameState (coin/bestScore/settings) + loadState/saveState wired',
    pass: gsHasCoin && gsHasBestScore && loadStateCall && saveStateCall,
    detail: `coin=${gsHasCoin} bestScore=${gsHasBestScore} settings=${gsHasSettings} load=${loadStateCall} save=${saveStateCall}`,
  });

  // 7. Browser lifecycle hooks
  const hookVis      = has(main, /visibilitychange/);
  const hookUnload   = has(main, /beforeunload/);
  const hookEsc      = has(main, /keydown[\s\S]{0,80}Escape|Escape[\s\S]{0,80}keydown/);
  const hookResize   = has(main, /\baddEventListener\s*\(\s*['"]resize['"]/);
  checks.push({
    id: 7, name: 'browser lifecycle (visibilitychange / beforeunload / Escape / resize)',
    pass: hookVis && hookUnload && hookEsc && hookResize,
    detail: `vis=${hookVis} unload=${hookUnload} esc=${hookEsc} resize=${hookResize}`,
  });

  // 8. settle handoff { result, score } + two exits
  let settleHandoffOk = false, settleTwoExitsOk = false;
  if (settle) {
    const s = settle.content;
    settleHandoffOk = has(s, /\b(result|won|win)\b/) && has(s, /\bscore\b/) &&
                      (has(s, /init\s*\(\s*\w+\s*\)/) || has(s, /init\s*\(\s*\{[^}]*\}/));
    const toGameplay = count(s, /transitionTo\s*\(\s*['"]gameplay['"]/g);
    const toMainHub  = count(s, /transitionTo\s*\(\s*['"]mainHub['"]/g);
    settleTwoExitsOk = toGameplay >= 1 && toMainHub >= 1;
  }
  checks.push({
    id: 8, name: 'settle receives { result, score } + has 2 exits (replay / mainHub)',
    pass: !!settle && settleHandoffOk && settleTwoExitsOk,
    detail: settle ? `handoff=${settleHandoffOk} twoExits=${settleTwoExitsOk}` : 'settle scene missing',
  });

  // 9. try/catch in scene methods + ASSETS.get null guard
  const tryCatchInScenes = [title, mainHub, gameplay, settle].filter(Boolean)
      .every((s) => /try\s*\{[\s\S]*?\}\s*catch/.test(s.content));
  const assetsGetCalls   = count(allCode, /ASSETS\.get\s*\(/g) + count(allCode, /ASSETS\[['"]/g);
  const assetsNullGuard  = has(allCode, /ASSETS(?:\.get\([^)]+\)|\[[^\]]+\])\s*(?:&&|\?|\|\|)/) ||
                           has(allCode, /if\s*\(\s*ASSETS/) || has(allCode, /img\s*&&\s*img\.complete/);
  const emptyStateOk     = has(allCode, /暂无|empty|placeholder/i);
  checks.push({
    id: 9, name: 'try/catch in scene methods + ASSETS null guard + empty-state placeholder',
    pass: tryCatchInScenes && (assetsGetCalls === 0 || assetsNullGuard) && emptyStateOk,
    detail: `tryCatchAllScenes=${tryCatchInScenes}; assetsGetCalls=${assetsGetCalls} nullGuard=${assetsNullGuard}; emptyState=${emptyStateOk}`,
  });

  // 10. Title only one CTA "进入游戏"; gameplay no exit; pause has 返回主界面 confirm
  let titleSingleCta = false, gameplayNoExit = false, pauseConfirmOk = false;
  if (title) {
    const t = title.content;
    const enterMatches = count(t, /进入游戏|开始游戏|Start Game|Play/g);
    // crude heuristic: title shouldn't reference settings/help/exit popups
    const titleHasOtherCta = has(t, /openPopup\s*\(\s*['"](?:shop|settings|ranking|help|exit)['"]/);
    titleSingleCta = enterMatches >= 1 && !titleHasOtherCta;
  }
  if (gameplay) {
    gameplayNoExit = !has(gameplay.content, /['"]退出['"]|['"]Exit['"]|exitButton/);
  }
  pauseConfirmOk = has(allCode, /未保存|进度.*丢失|确认.*返回|confirmExit|二次确认/) ||
                  has(allCode, /openPopup\s*\(\s*['"]confirm['"]/);
  checks.push({
    id: 10, name: 'title single CTA + gameplay no exit-button + pause→mainHub confirm',
    pass: titleSingleCta && gameplayNoExit && pauseConfirmOk,
    detail: `titleSingleCta=${titleSingleCta} gameplayNoExit=${gameplayNoExit} pauseConfirm=${pauseConfirmOk}`,
  });

  // 11. HUD shared elements consistent across gameplay/popup/settle (font + color)
  // Heuristic: drawTopBar or drawHud helper is shared (referenced from >=2 scenes).
  const hudHelperCalls = count(allCode, /\b(drawTopBar|drawHud|drawScoreBar|drawHUD)\b/g);
  checks.push({
    id: 11, name: 'shared HUD helper used in multiple scenes (drawTopBar/drawHud)',
    pass: hudHelperCalls >= 2,
    detail: `hudHelperCalls=${hudHelperCalls}`,
  });

  // 12. Click feedback (particles + flash) and hitRect-driven click test
  const particlesCall = has(allCode, /G\.Particles\.emit|emitParticles|spawnRipple/);
  const flashOnClick  = has(allCode, /flashAlpha|pressFlash|state\s*===?\s*['"]pressed['"]/);
  const hitRectUsage  = has(allCode, /hitRect|opts\.hitRect|button\.hitRect/);
  checks.push({
    id: 12, name: 'click feedback (particles + flash) + hitRect-driven hit test',
    pass: particlesCall && flashOnClick && hitRectUsage,
    detail: `particles=${particlesCall} flash=${flashOnClick} hitRect=${hitRectUsage}`,
  });

  const score = checks.filter((c) => c.pass).length;
  return { project: basename(projectDir), score, total: checks.length, checks, warns, notes };
}

// ── runner ───────────────────────────────────────────────────────────
function listProjects() {
  if (!existsSync(OUTPUT_ROOT)) return [];
  return readdirSync(OUTPUT_ROOT)
      .map((n) => join(OUTPUT_ROOT, n))
      .filter((p) => statSync(p).isDirectory())
      .filter((p) => existsSync(join(p, 'code')));
}

function printReport(rep) {
  if (!rep) return;
  const head = `\n=== ${rep.project} === ${rep.score}/${rep.total}`;
  console.log(head);
  for (const c of rep.checks) {
    const tag = c.pass ? ' ok ' : 'FAIL';
    console.log(`  [${tag}] ${c.id.toString().padStart(2)}. ${c.name}`);
    if (!c.pass) console.log(`         ↳ ${c.detail}`);
  }
  for (const w of rep.warns) console.log(`  WARN ${w}`);
}

function main() {
  const arg = process.argv[2];
  let projects;
  if (arg) {
    const p = resolve(process.cwd(), arg);
    projects = [existsSync(join(p, 'code')) ? p : join(OUTPUT_ROOT, arg)];
  } else {
    projects = listProjects();
  }
  if (!projects.length) {
    console.log('no projects found under', OUTPUT_ROOT);
    process.exit(1);
  }

  const reports = projects.map(auditProject).filter(Boolean);
  reports.sort((a, b) => a.score - b.score);
  for (const r of reports) printReport(r);

  // summary
  console.log('\n--- summary ---');
  const counts = {};
  for (const r of reports) {
    counts[r.score] = (counts[r.score] || 0) + 1;
    console.log(`${r.project.padEnd(22)} ${r.score}/${r.total}`);
  }
  const avg = reports.reduce((a, r) => a + r.score, 0) / reports.length;
  console.log(`\navg score: ${avg.toFixed(2)}/12 across ${reports.length} project(s)`);

  // per-check pass-rate for prioritising prompt fixes
  const tally = Array(12).fill(0);
  for (const r of reports) for (const c of r.checks) if (c.pass) tally[c.id - 1]++;
  console.log('\nper-check pass-rate:');
  for (let i = 0; i < 12; i++) {
    const ratio = `${tally[i]}/${reports.length}`;
    console.log(`  #${(i + 1).toString().padStart(2)}  ${ratio.padEnd(8)} ${reports[0].checks[i].name}`);
  }

  const minScore = Math.min(...reports.map((r) => r.score));
  process.exit(minScore >= 11 ? 0 : 2);
}

main();
