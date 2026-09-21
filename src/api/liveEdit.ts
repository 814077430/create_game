/**
 * 游戏内可视化布局编辑（Live UI Editor）—— 协议 / 类型 / 锚点算法 / 注入块 / 编辑代理
 *
 * 设计文档：docs/live-ui-editor-design.md
 *
 * 职责边界：
 * - 本文件是「父窗口」与「游戏运行时」之间的唯一契约层，不含任何 Vue/DOM 逻辑
 * - EDITOR_AGENT_SOURCE 是注入到 game.html 的编辑代理源码（纯 JS 字符串）
 * - 注入块用注释哨兵包裹，便于在已有 HTML 上做幂等替换（无需重新打包）
 */

// ===== 协议常量 =====

export const GF_NS = 'gf-ui-edit'
export const GF_VER = 1

/** 布局覆盖文件名（存于项目 design/ 目录） */
export const LAYOUT_FILE_NAME = 'ui-layout.json'

/** 编辑器 → 游戏 */
export type GFToGameType =
  | 'setMode' | 'snapshot' | 'gotoScope' | 'setRect' | 'setFlag'
  | 'reset' | 'applyOverrides' | 'setOptions'

/** 游戏 → 编辑器 */
export type GFToEditorType =
  | 'ready' | 'snapshot' | 'scopeChanged' | 'selection' | 'rectChanged' | 'hotkey' | 'warn'

export interface GFMessage<T = any> {
  ns: typeof GF_NS
  v: number
  sid: string
  type: string
  payload: T
}

// ===== 数据类型 =====

export type GFAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface GFRect { x: number; y: number; w: number; h: number }

/** 单个元素的布局覆盖（存 design/ui-layout.json） */
export interface GFOverride {
  anchor: GFAnchor
  /** 相对锚点的设计像素偏移 */
  x: number
  y: number
  w: number
  h: number
  visible?: boolean
  locked?: boolean
}

export interface GFLayoutFile {
  version: number
  designSize: { width: number; height: number }
  orientation?: 'portrait' | 'landscape'
  updatedAt: string
  /** scope -> elementId -> override；scope 为场景 id 或 'popup:<id>' */
  scenes: Record<string, Record<string, GFOverride>>
}

export type GFElementKind = 'button' | 'icon' | 'panel' | 'hud' | 'text' | 'slot' | 'other'

/** 运行时上报的元素描述符 */
export interface GFLayoutElement {
  id: string
  scope: string
  label: string
  kind: GFElementKind
  /** 当前生效的绝对设计像素矩形 */
  rect: GFRect
  anchor: GFAnchor
  editable: { move: boolean; resize: boolean; hide: boolean }
  constraints?: { minW?: number; minH?: number; keepInside?: boolean }
  /** registry：源码接入 G.Layout；probe：扫描 *Rect 字段；paint：拦截绘制调用（静态文字/图标） */
  origin: 'registry' | 'probe' | 'paint'
  dirty: boolean
  /** box=自由改宽高；scale=等比缩放（文字按字号整体放缩） */
  resizeMode?: 'box' | 'scale'
  /** 源码默认矩形（paint 元素每帧实测得到，用于换算缩放比例） */
  baseRect?: GFRect | null
  /** 文字内容 / 素材名，仅用于展示 */
  sample?: string
  /** false = 已被隐藏（仅 paint 元素支持） */
  visible?: boolean
}

export interface GFSnapshot {
  scope: string
  scopes: string[]
  popups: string[]
  designSize: { width: number; height: number }
  registry: boolean
  elements: GFLayoutElement[]
}

// ===== 设备预设（逻辑分辨率 = CSS 像素，1:1 呈现） =====

export interface DevicePreset {
  id: string
  label: string
  /** 竖屏逻辑宽（pt/CSS px） */
  width: number
  /** 竖屏逻辑高 */
  height: number
  dpr: number
  /** 圆角与刘海尺寸（纯视觉） */
  radius: number
}

export const DEVICE_PRESETS: DevicePreset[] = [
  // iPhone 17 Pro Max：6.9" 逻辑 440×956（原生 1320×2868 @3x）
  { id: 'iphone17promax', label: 'iPhone 17 Pro Max', width: 440, height: 956, dpr: 3, radius: 56 },
  { id: 'iphone17pro', label: 'iPhone 17 Pro', width: 402, height: 874, dpr: 3, radius: 52 },
  { id: 'iphone15', label: 'iPhone 15 / 16', width: 393, height: 852, dpr: 3, radius: 50 },
]

export const DEFAULT_DEVICE_ID = 'iphone17promax'

export function getDevice(id: string): DevicePreset {
  return DEVICE_PRESETS.find((d) => d.id === id) || DEVICE_PRESETS[0]
}

// ===== 锚点算法（与 agent 内 JS 实现保持一致） =====

function anchorFactors(anchor: GFAnchor): { hx: number; vy: number } {
  const parts = String(anchor || 'top-left').split('-')
  const v = parts[0] === 'top' || parts[0] === 'bottom' ? parts[0] : 'center'
  const h = parts[0] === 'center' ? (parts[1] || 'center') : (parts[1] || 'left')
  const hx = h === 'left' ? 0 : h === 'center' ? 0.5 : 1
  const vy = v === 'top' ? 0 : v === 'center' ? 0.5 : 1
  return { hx, vy }
}

/** 自动推导锚点：按元素中心落在画面九宫格的位置 */
export function autoAnchor(rect: GFRect, W: number, H: number): GFAnchor {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const h = cx < W / 3 ? 'left' : cx < (W * 2) / 3 ? 'center' : 'right'
  const v = cy < H / 3 ? 'top' : cy < (H * 2) / 3 ? 'center' : 'bottom'
  if (v === 'center' && h === 'center') return 'center'
  if (v === 'center') return `center-${h}` as GFAnchor
  return `${v}-${h}` as GFAnchor
}

/** 锚点偏移 → 绝对设计像素 */
export function resolveAnchored(o: GFOverride, W: number, H: number): GFRect {
  const { hx, vy } = anchorFactors(o.anchor)
  return {
    x: Math.round(W * hx + o.x - o.w * hx),
    y: Math.round(H * vy + o.y - o.h * vy),
    w: Math.round(o.w),
    h: Math.round(o.h),
  }
}

/** 绝对设计像素 → 锚点偏移 */
export function toAnchored(rect: GFRect, anchor: GFAnchor, W: number, H: number): GFOverride {
  const { hx, vy } = anchorFactors(anchor)
  return {
    anchor,
    x: Math.round(rect.x - W * hx + rect.w * hx),
    y: Math.round(rect.y - H * vy + rect.h * vy),
    w: Math.round(rect.w),
    h: Math.round(rect.h),
  }
}

export function emptyLayout(
  designSize: { width: number; height: number },
  orientation: 'portrait' | 'landscape' = 'portrait'
): GFLayoutFile {
  return { version: 1, designSize, orientation, updatedAt: new Date().toISOString(), scenes: {} }
}

/** 统计 override 数量 */
export function countOverrides(layout: GFLayoutFile | null): number {
  if (!layout?.scenes) return 0
  return Object.values(layout.scenes).reduce((n, m) => n + Object.keys(m || {}).length, 0)
}

// ===== HTML 注入块（哨兵包裹，幂等替换） =====

const LAYOUT_START = '<!--GF_LAYOUT_START-->'
const LAYOUT_END = '<!--GF_LAYOUT_END-->'
const EDITOR_START = '<!--GF_EDITOR_START-->'
const EDITOR_END = '<!--GF_EDITOR_END-->'

const LAYOUT_BLOCK_RE = /<!--GF_LAYOUT_START-->[\s\S]*?<!--GF_LAYOUT_END-->/
const EDITOR_BLOCK_RE = /<!--GF_EDITOR_START-->[\s\S]*?<!--GF_EDITOR_END-->/

/** 布局数据块：必须在游戏代码之前执行（core.js 的 G.Layout 需要读它） */
export function buildLayoutBlock(layout: GFLayoutFile | null): string {
  const json = JSON.stringify(layout || null)
  return `${LAYOUT_START}<script>window.__GF_LAYOUT__=${json};<\/script>${LAYOUT_END}`
}

/**
 * 写入/更新布局数据块。
 * 已存在则原地替换；否则插入到 <head> 之后（保证早于游戏代码执行）。
 */
export function upsertLayoutBlock(html: string, layout: GFLayoutFile | null): string {
  const block = buildLayoutBlock(layout)
  if (LAYOUT_BLOCK_RE.test(html)) return html.replace(LAYOUT_BLOCK_RE, block)
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${block}`)
  if (html.includes('<body')) return html.replace(/<body[^>]*>/i, (m) => `${m}\n${block}`)
  return `${block}\n${html}`
}

/** 写入/更新编辑代理块（仅编辑态注入，追加到 </body> 前，确保游戏代码已执行） */
export function upsertEditorBlock(html: string): string {
  const block = `${EDITOR_START}<script>${EDITOR_AGENT_SOURCE}<\/script>${EDITOR_END}`
  if (EDITOR_BLOCK_RE.test(html)) return html.replace(EDITOR_BLOCK_RE, block)
  if (html.includes('</body>')) return html.replace('</body>', `${block}\n</body>`)
  return `${html}\n${block}`
}

/** 移除编辑代理块（发布/落盘前调用，保证玩家侧不含编辑能力） */
export function stripEditorBlock(html: string): string {
  return html.replace(EDITOR_BLOCK_RE, '')
}

/** 从 HTML 中读回布局数据（用于校验/恢复） */
export function readLayoutFromHtml(html: string): GFLayoutFile | null {
  const m = /<!--GF_LAYOUT_START--><script>window\.__GF_LAYOUT__=([\s\S]*?);<\/script><!--GF_LAYOUT_END-->/.exec(html)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as GFLayoutFile
  } catch {
    return null
  }
}

/** 生成随机会话 id（通过 blob url hash 传给 agent，agent 只认同 sid 的消息） */
export function newSessionId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// ===== 编辑代理源码（注入到 iframe 内运行） =====
//
// 约束（务必遵守，否则模板字符串会被 TS 解析破坏）：
//   1) 内部禁止使用反引号与 ${ }
//   2) 只依赖 window.G（core.js 已建立的运行时），不依赖任何外部库
//   3) 无 sid（location.hash 无 gfedit=）时直接静默退出 —— 发布态安全兜底
export const EDITOR_AGENT_SOURCE = `
(function(){
  if (window.__gfEditorAgent) return;
  var NS = 'gf-ui-edit', VER = 1;
  var sm = /gfedit=([A-Za-z0-9_-]+)/.exec(location.hash || '');
  if (!sm) return;                 // 非编辑会话：不激活任何能力
  var SID = sm[1];
  window.__gfEditorAgent = true;

  var G = null;
  var st = {
    edit: false, paused: false,
    sel: null,                     // { scope, id }
    ovr: {},                       // scope -> id -> 锚点式 override
    opts: { grid: true, gridSize: 8, snap: true, safeArea: true, outlineAll: true, paintProbe: true },
    drag: null,
    lastScope: '',
    lastSent: 0,
    wantPopup: null,                // 待场景就绪后再打开的弹窗 id
    wantScene: null,                // 待离开加载页后再转过去的场景 id
    switchUntil: 0                  // 编辑器发起切换的放行截止时刻（见 switching()）
  };

  // ---------- 通信 ----------
  function send(type, payload) {
    try { parent.postMessage({ ns: NS, v: VER, sid: SID, type: type, payload: payload || {} }, '*'); } catch (e) {}
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.ns !== NS || d.sid !== SID) return;
    try { handle(d.type, d.payload || {}); } catch (err) { send('warn', { code: 'handle', message: String(err && err.message || err) }); }
  });

  // ---------- 锚点算法（与 src/api/liveEdit.ts 保持一致） ----------
  function factors(anchor) {
    var parts = String(anchor || 'top-left').split('-');
    var v = (parts[0] === 'top' || parts[0] === 'bottom') ? parts[0] : 'center';
    var h = parts[0] === 'center' ? (parts[1] || 'center') : (parts[1] || 'left');
    return { hx: h === 'left' ? 0 : (h === 'center' ? 0.5 : 1), vy: v === 'top' ? 0 : (v === 'center' ? 0.5 : 1) };
  }
  function autoAnchor(r, W, H) {
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var h = cx < W / 3 ? 'left' : (cx < W * 2 / 3 ? 'center' : 'right');
    var v = cy < H / 3 ? 'top' : (cy < H * 2 / 3 ? 'center' : 'bottom');
    if (v === 'center' && h === 'center') return 'center';
    if (v === 'center') return 'center-' + h;
    return v + '-' + h;
  }
  function resolveAnchored(o, W, H) {
    var f = factors(o.anchor);
    return { x: Math.round(W * f.hx + o.x - o.w * f.hx), y: Math.round(H * f.vy + o.y - o.h * f.vy), w: Math.round(o.w), h: Math.round(o.h) };
  }

  // ---------- 元素访问层（registry / probe 双模） ----------
  function isRegistry() { return !!(G.Layout && G.Layout.__gf); }
  function W() { return G.CONFIG.width; }
  function H() { return G.CONFIG.height; }

  // ---------- 场景管理器适配层 ----------
  // 各代模版的字段名不统一，已见四种：
  //   场景表   _scenes / _registry
  //   当前 id  _currentId / currentId / current
  //   当前实例 _current / _currentScene / _currentObj / current
  //   转场     _transition 为 null↔对象  或  常驻对象 + .active
  //   加载页   _renderBoot / _renderLoading
  // 所以不能硬编码字段名，这里运行时探测一次。
  var SA = null;
  function sa() {
    var S = G && G.Scenes;
    if (!S) return null;
    if (SA && SA.S === S) return SA;
    var a = { S: S, regKey: '', idKey: '', objKey: '', bootFn: '', transKey: '' };
    var regKeys = ['_scenes', '_registry', 'scenes'];
    for (var i = 0; i < regKeys.length; i++) {
      if (S[regKeys[i]] && typeof S[regKeys[i]] === 'object') { a.regKey = regKeys[i]; break; }
    }
    // id 字段：优先名字明确的；current 在部分模版里是 id，在另一些里是实例
    if ('_currentId' in S) a.idKey = '_currentId';
    else if ('currentId' in S) a.idKey = 'currentId';
    else if ('current' in S) a.idKey = 'current';
    var objKeys = ['_current', '_currentScene', '_currentObj', 'currentScene', 'inst'];
    for (var j = 0; j < objKeys.length; j++) if (objKeys[j] in S) { a.objKey = objKeys[j]; break; }
    if (!a.objKey && a.idKey !== 'current' && ('current' in S)) a.objKey = 'current';
    // 转场字段同样不统一，已见 _transition / _trans / trans 三种命名。认不出来时
    // inTransition() 恒为 false，暂停钩子会把转场所需的 update 一起冻结，
    // 于是转场卡在 active=true，之后每次 transitionTo 都被其首行 return 掉。
    var transKeys = ['_transition', '_trans', 'trans', 'transition'];
    for (var t = 0; t < transKeys.length; t++) if (transKeys[t] in S) { a.transKey = transKeys[t]; break; }
    if (typeof S._renderBoot === 'function') a.bootFn = '_renderBoot';
    else if (typeof S._renderLoading === 'function') a.bootFn = '_renderLoading';
    SA = a;
    return a;
  }
  function sceneReg() { var a = sa(); return (a && a.regKey) ? a.S[a.regKey] : null; }
  function sceneInst() { var a = sa(); return (a && a.objKey) ? a.S[a.objKey] : null; }
  function sceneId() {
    var a = sa();
    if (!a) return '';
    if (a.idKey) { var v = a.S[a.idKey]; if (typeof v === 'string' && v) return v; }
    // 兜底：拿当前实例反查场景表（有的模版直接引用，有的是 Object.create）
    var inst = sceneInst(), reg = sceneReg();
    if (inst && reg) {
      var proto = null;
      try { proto = Object.getPrototypeOf(inst); } catch (e) {}
      for (var k in reg) if (reg[k] === inst || (proto && reg[k] === proto)) return k;
    }
    return '';
  }
  function hasBootScreen() { var a = sa(); return !!(a && a.bootFn); }
  function bootDone() {
    var S = G && G.Scenes;
    if (!S || !('_bootPhase' in S)) return true;
    return S._bootPhase === 'done';
  }
  /** 转场中？（常驻对象形态要看 .active，否则永远为真） */
  function inTransition() {
    var a = sa();
    if (!a || !a.transKey) return false;
    var t = a.S[a.transKey];
    if (!t) return false;
    if (typeof t === 'object' && 'active' in t) return !!t.active;
    return true;
  }
  /** 取消在途转场；常驻对象形态绝不能置 null，否则游戏自己的 update 会报错 */
  function cancelTransition() {
    var a = sa();
    if (!a || !a.transKey) return;
    var t = a.S[a.transKey];
    if (t && typeof t === 'object' && 'active' in t) { t.active = false; return; }
    if (t) a.S[a.transKey] = null;
  }
  /** 编辑器发起的切换是否还在放行窗口内：转场字段认不出来时也能推进完这一次转场 */
  function switching() { return st.switchUntil > Date.now(); }

  function currentScope() {
    if (G.popupStack && G.popupStack.length) {
      var top = G.popupStack[G.popupStack.length - 1];
      if (top && top.id) return 'popup:' + top.id;
    }
    return sceneScope();
  }
  /** 场景级作用域：忽略弹窗栈，用于绘制探针给「场景那一段」打标 */
  function sceneScope() {
    if (!bootDone()) return 'boot';
    return sceneId() || 'boot';
  }
  /** 全部可编辑画面：加载页 + 已注册场景 */
  function sceneList() {
    var reg = sceneReg(), keys = reg ? Object.keys(reg) : [], out = [];
    if (hasBootScreen()) out.push('boot');
    for (var i = 0; i < keys.length; i++) if (out.indexOf(keys[i]) < 0) out.push(keys[i]);
    return out;
  }
  function scopeTarget(scope) {
    if (scope.indexOf('popup:') === 0) {
      var pid = scope.slice(6);
      for (var i = 0; i < (G.popupStack || []).length; i++) if (G.popupStack[i].id === pid) return G.popupStack[i];
      return null;
    }
    return sceneId() === scope ? sceneInst() : null;
  }

  function humanize(id) {
    var s = String(id).replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function guessKind(id) {
    var s = String(id).toLowerCase();
    if (/btn|button|cta|start|play|replay|home|back|close|confirm|cancel|pause|bomb|shop/.test(s)) return 'button';
    if (/icon|avatar|badge/.test(s)) return 'icon';
    if (/panel|card|dialog|board|bg/.test(s)) return 'panel';
    if (/hud|score|coin|life|hp|timer|bar|combo|wave/.test(s)) return 'hud';
    if (/slot|cell|grid|tile/.test(s)) return 'slot';
    if (/text|label|title|tip/.test(s)) return 'text';
    return 'other';
  }

  /** probe 模式：扫描场景/弹窗实例上形如 xxxRect 的矩形字段 */
  function probeList(scope) {
    var t = scopeTarget(scope);
    var out = [];
    if (!t) return out;
    for (var k in t) {
      if (!Object.prototype.hasOwnProperty.call(t, k)) continue;
      if (!/Rect$/.test(k)) continue;
      var r = t[k];
      if (!r || typeof r !== 'object') continue;
      if (typeof r.x !== 'number' || typeof r.y !== 'number' || typeof r.w !== 'number' || typeof r.h !== 'number') continue;
      if (r.w <= 0 || r.h <= 0) continue;
      var id = k.replace(/Rect$/, '');
      out.push({ id: id, key: k, target: t, rect: r, label: humanize(id), kind: guessKind(id), origin: 'probe',
                 editable: { move: true, resize: true, hide: false },
                 constraints: { minW: 24, minH: 24, keepInside: true } });
    }
    return out;
  }

  /** 统一列表：registry 优先，退化到 probe；无论哪种都叠加绘制探针的文字/图标 */
  function listRaw(scope) {
    var base = [];
    if (isRegistry()) {
      var arr = G.Layout.listRaw ? G.Layout.listRaw(scope) : [];
      if (arr && arr.length) base = arr;
    }
    if (!base.length) base = probeList(scope);
    var pl = paintList(scope);
    return pl.length ? base.concat(pl) : base;
  }

  // ---------- 绘制探针：静态文字 / 图标（零侵入，存量项目同样可编辑） ----------
  //
  // 原理：接管 2D 上下文的 fillText / strokeText / drawImage：
  //   1) 从绘制参数 + 当前变换矩阵反推出「设计像素 bbox」，登记为可编辑元素
  //   2) 若存在 override，则在真正绘制前改写坐标（文字额外按比例改字号）
  // base 每帧从源码参数重算，所以复位无需重载，也不会被自己的修改污染。
  // 已知边界：旋转/斜切变换下的绘制不纳入；9 参数精灵图（动画帧）不纳入；整屏背景图不纳入。
  var paint = {
    installed: false,
    enabled: true,
    live: false,          // 仅在一帧游戏渲染期间收集（避开覆盖层自身的绘制）
    buf: [],              // 本帧收集中
    items: [],            // 上一帧已提交（供选中/命中/Inspector 使用）
    counts: null,
    scope: '',            // 当前渲染段的作用域（场景段 or 某个弹窗段）
    sig: '',
    sigAt: 0,
    pending: false,
    cap: 200
  };

  function isPaintId(id) { return String(id).indexOf('txt:') === 0 || String(id).indexOf('img:') === 0; }

  function paintSlug(s) {
    var t = String(s).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    t = t.replace(/[0-9]+/g, '#');          // 数字归一，使分数/计时类文字 id 稳定
    return t.length > 20 ? t.slice(0, 20) : t;
  }
  function fontPx(font) {
    var m = /([0-9.]+)px/.exec(String(font || ''));
    return m ? parseFloat(m[1]) : 16;
  }
  /** 取当前变换（仅支持轴向缩放+平移；旋转/斜切返回 null），换算到设计像素 */
  function axisTf(ctx) {
    var m = null;
    try { m = ctx.getTransform(); } catch (e) { return null; }
    if (!m || !m.a || !m.d) return null;
    if (Math.abs(m.b) > 0.0001 || Math.abs(m.c) > 0.0001) return null;
    var d = dpr();
    return { sx: m.a / d, sy: m.d / d, tx: m.e / d, ty: m.f / d };
  }
  function tfPt(tf, x, y) { return { x: tf.sx * x + tf.tx, y: tf.sy * y + tf.ty }; }
  function tfInv(tf, x, y) { return { x: (x - tf.tx) / tf.sx, y: (y - tf.ty) / tf.sy }; }

  /** 图片反查素材名（内联产物的 src 是 base64，只能靠 G.Assets 对象同一性） */
  function assetName(img) {
    if (!img) return 'image';
    if (img.__gfName) return img.__gfName;
    try {
      var m = G.Assets && G.Assets.images;
      if (m) for (var k in m) if (m[k] === img) { img.__gfName = k; return k; }
    } catch (e) {}
    var s = String(img.src || '');
    if (s && s.indexOf('data:') !== 0) {
      var b = s.split('/').pop().split('?')[0].replace(/\.[a-zA-Z0-9]+$/, '');
      if (b) { img.__gfName = b; return b; }
    }
    return 'image';
  }

  /** 登记一个绘制元素；同名近位（描边/阴影）复用同一元素，保证整体一起移动 */
  function paintRegister(kind, key, label, base, sample) {
    var buf = paint.buf, scope = paint.scope;
    for (var i = buf.length - 1; i >= 0; i--) {
      var q = buf[i];
      if (q.slug !== key || q.pkind !== kind || q.pscope !== scope) continue;
      if (Math.abs(q.base.x - base.x) <= 6 && Math.abs(q.base.y - base.y) <= 6) return q;
    }
    if (buf.length >= paint.cap) return null;
    var ck = scope + '|' + key;
    var n = paint.counts[ck] || 0;
    paint.counts[ck] = n + 1;
    var item = {
      id: (kind === 'text' ? 'txt:' : 'img:') + (key || 'x') + (n ? '#' + n : ''),
      slug: key, pkind: kind, kind: kind === 'text' ? 'text' : 'icon',
      pscope: scope,                 // 按渲染段归属：弹窗段的文字不会污染场景，反之亦然
      label: label, origin: 'paint', paint: true,
      base: { x: base.x, y: base.y, w: base.w, h: base.h },
      rect: { x: base.x, y: base.y, w: base.w, h: base.h },
      editable: { move: true, resize: true, hide: true },
      constraints: { minW: 8, minH: 8, keepInside: true },
      resizeMode: kind === 'text' ? 'scale' : 'box',
      sample: sample || label,
      hidden: false
    };
    buf.push(item);
    return item;
  }

  /** 取该元素的 override（null = 无覆盖，按源码原样绘制） */
  function paintOvr(item) {
    var o = (st.ovr[item.pscope] || {})[item.id];
    if (!o) {
      item.rect.x = item.base.x; item.rect.y = item.base.y;
      item.rect.w = item.base.w; item.rect.h = item.base.h;
      item.hidden = false;
      return null;
    }
    var want = resolveAnchored(o, W(), H());
    item.rect.x = want.x; item.rect.y = want.y; item.rect.w = want.w; item.rect.h = want.h;
    item.hidden = o.visible === false;
    return { want: want, hidden: item.hidden };
  }

  /** 文字实测 bbox（设计像素）+ 绘制原点在 bbox 内的偏移 */
  function textBox(ctx, s, x, y) {
    var tf = axisTf(ctx); if (!tf) return null;
    var m; try { m = ctx.measureText(s); } catch (e) { return null; }
    if (!m || !(m.width > 0)) return null;
    var fs = fontPx(ctx.font);
    var asc = (typeof m.actualBoundingBoxAscent === 'number' && isFinite(m.actualBoundingBoxAscent)) ? m.actualBoundingBoxAscent : fs * 0.78;
    var desc = (typeof m.actualBoundingBoxDescent === 'number' && isFinite(m.actualBoundingBoxDescent)) ? m.actualBoundingBoxDescent : fs * 0.22;
    var al = String(ctx.textAlign || 'start'), bl = String(ctx.textBaseline || 'alphabetic');
    var lx = (al === 'center') ? x - m.width / 2 : ((al === 'right' || al === 'end') ? x - m.width : x);
    var ly;
    if (bl === 'top' || bl === 'hanging') ly = y;
    else if (bl === 'middle') ly = y - (asc + desc) / 2;
    else if (bl === 'bottom' || bl === 'ideographic') ly = y - (asc + desc);
    else ly = y - asc;
    var tl = tfPt(tf, lx, ly), org = tfPt(tf, x, y);
    var w = m.width * Math.abs(tf.sx), h = (asc + desc) * Math.abs(tf.sy);
    if (!(w > 0) || !(h > 0)) return null;
    return { tf: tf, x: tl.x, y: tl.y, w: w, h: h, offx: org.x - tl.x, offy: org.y - tl.y };
  }

  function hookText(orig, ctx, args) {
    if (!paint.live) return orig.apply(ctx, args);
    var raw = args[0];
    if (typeof raw !== 'string' && typeof raw !== 'number') return orig.apply(ctx, args);
    var s = String(raw);
    if (!s.replace(/\s+/g, '')) return orig.apply(ctx, args);
    var box = textBox(ctx, s, args[1], args[2]);
    if (!box) return orig.apply(ctx, args);
    var it = paintRegister('text', paintSlug(s), s.length > 14 ? s.slice(0, 14) + '\u2026' : s, box, s);
    if (!it) return orig.apply(ctx, args);
    var ov = paintOvr(it);
    if (!ov) return orig.apply(ctx, args);
    if (ov.hidden) return;
    var k = it.base.h > 0 ? ov.want.h / it.base.h : 1;
    if (!isFinite(k) || k < 0.05) k = 1;
    // 同元素多次绘制（描边/阴影）保留彼此相对偏移，且随字号同比缩放
    var nx = ov.want.x + (box.x - it.base.x) * k + box.offx * k;
    var ny = ov.want.y + (box.y - it.base.y) * k + box.offy * k;
    var lp = tfInv(box.tf, nx, ny);
    var prev = ctx.font, changed = false;
    if (Math.abs(k - 1) > 0.01) {
      var nf = prev.replace(/([0-9.]+)px/, function (mm, v) { return (parseFloat(v) * k).toFixed(2) + 'px'; });
      if (nf !== prev) { ctx.font = nf; changed = true; }
    }
    var out;
    if (typeof args[3] === 'number') out = orig.call(ctx, s, lp.x, lp.y, args[3] * k);
    else out = orig.call(ctx, s, lp.x, lp.y);
    if (changed) ctx.font = prev;
    return out;
  }

  function hookImage(orig, ctx, args) {
    if (!paint.live || args.length < 3) return orig.apply(ctx, args);
    if (args.length >= 9) return orig.apply(ctx, args);          // 精灵图动画帧：不纳入
    var img = args[0];
    if (!img) return orig.apply(ctx, args);
    var has = args.length >= 5;
    var dx = args[1], dy = args[2];
    var dw = has ? args[3] : (img.width || 0);
    var dh = has ? args[4] : (img.height || 0);
    if (!(dw > 0) || !(dh > 0)) return orig.apply(ctx, args);
    var tf = axisTf(ctx); if (!tf) return orig.apply(ctx, args);
    var tl = tfPt(tf, dx, dy);
    var bw = dw * Math.abs(tf.sx), bh = dh * Math.abs(tf.sy);
    if (bw < 8 || bh < 8) return orig.apply(ctx, args);                         // 碎图不纳入
    if (bw >= W() * 0.98 && bh >= H() * 0.98) return orig.apply(ctx, args);     // 整屏背景不纳入
    var name = assetName(img);
    var it = paintRegister('image', name, name, { x: tl.x, y: tl.y, w: bw, h: bh }, name);
    if (!it) return orig.apply(ctx, args);
    var ov = paintOvr(it);
    if (!ov) return orig.apply(ctx, args);
    if (ov.hidden) return;
    var kw = it.base.w > 0 ? ov.want.w / it.base.w : 1;
    var kh = it.base.h > 0 ? ov.want.h / it.base.h : 1;
    var p = tfInv(tf, ov.want.x + (tl.x - it.base.x) * kw, ov.want.y + (tl.y - it.base.y) * kh);
    return orig.call(ctx, img, p.x, p.y, dw * kw, dh * kh);
  }

  function installPaint() {
    if (paint.installed) return;
    var c = G.ctx || (G.canvas && G.canvas.getContext ? G.canvas.getContext('2d') : null);
    if (!c || !c.fillText) return;
    paint.installed = true;
    var oFill = c.fillText, oStroke = c.strokeText, oImg = c.drawImage;
    c.fillText = function () { return hookText(oFill, this, arguments); };
    c.strokeText = function () { return hookText(oStroke, this, arguments); };
    c.drawImage = function () { return hookImage(oImg, this, arguments); };
  }

  /**
   * 弹窗实例的 render 包一层：进入时把绘制段切到 popup:<id>。
   * 否则弹窗打开的那一帧，底下场景的文字会被一并归到弹窗作用域。
   */
  function wrapPopup(inst) {
    if (!inst || typeof inst.render !== 'function' || inst.__gfSeg) return;
    inst.__gfSeg = true;
    var orig = inst.render;
    inst.render = function () {
      var prev = paint.scope;
      if (paint.live) paint.scope = 'popup:' + (this.id || '');
      try { return orig.apply(this, arguments); } finally { paint.scope = prev; }
    };
  }

  function paintBegin() {
    if (!paint.enabled) { paint.live = false; return; }
    paint.scope = sceneScope();
    paint.buf = [];
    paint.counts = {};
    paint.live = true;
    // 弹窗可能由 openPopup 或直接 push 入栈，每帧补包最稳
    for (var i = 0; i < (G.popupStack || []).length; i++) wrapPopup(G.popupStack[i]);
  }
  function paintEnd() {
    if (!paint.live) return;
    paint.live = false;
    paint.items = paint.buf;
    // 元素集合变化（进入新画面/新文字出现）时节流上报，保证 Inspector 列表不陈旧
    var sig = currentScope() + '|' + paint.items.length;
    for (var i = 0; i < paint.items.length; i++) sig += ',' + paint.items[i].pscope + ':' + paint.items[i].id;
    if (sig !== paint.sig) {
      var now = performance.now();
      if (now - (paint.sigAt || 0) > 400) { paint.sig = sig; paint.sigAt = now; paint.pending = true; }
    }
  }
  function paintList(scope) {
    if (!paint.enabled) return [];
    var src = paint.items || [], out = [];
    for (var i = 0; i < src.length; i++) if (src[i].pscope === scope) out.push(src[i]);
    return out;
  }

  function toElements(scope) {
    var raw = listRaw(scope), W0 = W(), H0 = H(), o = st.ovr[scope] || {}, out = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      var anchor = (o[e.id] && o[e.id].anchor) || e.anchor || autoAnchor(e.rect, W0, H0);
      out.push({
        id: e.id, scope: scope, label: e.label || humanize(e.id), kind: e.kind || 'other',
        rect: { x: Math.round(e.rect.x), y: Math.round(e.rect.y), w: Math.round(e.rect.w), h: Math.round(e.rect.h) },
        anchor: anchor, editable: e.editable || { move: true, resize: true, hide: false },
        constraints: e.constraints || { minW: 24, minH: 24, keepInside: true },
        origin: e.origin || 'registry', dirty: !!o[e.id],
        resizeMode: e.resizeMode || 'box',
        baseRect: e.base ? { x: Math.round(e.base.x), y: Math.round(e.base.y), w: Math.round(e.base.w), h: Math.round(e.base.h) } : null,
        sample: e.sample || '',
        visible: !(o[e.id] && o[e.id].visible === false)
      });
    }
    return out;
  }

  function findRaw(scope, id) {
    var raw = listRaw(scope);
    for (var i = 0; i < raw.length; i++) if (raw[i].id === id) return raw[i];
    return null;
  }

  /** 写入矩形：registry 走 G.Layout.set，probe 直接改活引用，paint 由 override 在绘制时生效 */
  function writeRect(scope, id, rect) {
    if (isPaintId(id)) {
      var pit = findRaw(scope, id);          // 同步更新选框，避免拖拽时延迟一帧
      if (pit) { pit.rect.x = rect.x; pit.rect.y = rect.y; pit.rect.w = rect.w; pit.rect.h = rect.h; }
      return true;
    }
    if (isRegistry() && G.Layout.set) { G.Layout.set(scope, id, rect); return true; }
    var e = findRaw(scope, id);
    if (!e) return false;
    e.rect.x = rect.x; e.rect.y = rect.y; e.rect.w = rect.w; e.rect.h = rect.h;
    return true;
  }

  /** 每帧巡检：把 override 强制写回（覆盖场景 init() 的重置）；paint 元素在绘制时已处理 */
  function enforce() {
    var scope = currentScope(), o = st.ovr[scope];
    if (!o) return;
    var raw = listRaw(scope), W0 = W(), H0 = H();
    for (var i = 0; i < raw.length; i++) {
      if (raw[i].paint) continue;
      var ov = o[raw[i].id];
      if (!ov) continue;
      var want = resolveAnchored(ov, W0, H0);
      var r = raw[i].rect;
      if (r.x !== want.x || r.y !== want.y || r.w !== want.w || r.h !== want.h) {
        r.x = want.x; r.y = want.y; r.w = want.w; r.h = want.h;
      }
    }
  }

  // ---------- 坐标换算（每次事件重新取 rect，兼容外层 CSS 缩放/位移） ----------
  function toDesign(ev) {
    var rect = G.canvas.getBoundingClientRect();
    var sx = W() / Math.max(1, rect.width), sy = H() / Math.max(1, rect.height);
    return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
  }

  // ---------- 拖拽 / 手柄 ----------
  var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function handlePos(r, dir) {
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (dir === 'nw') return { x: r.x, y: r.y };
    if (dir === 'n') return { x: cx, y: r.y };
    if (dir === 'ne') return { x: r.x + r.w, y: r.y };
    if (dir === 'e') return { x: r.x + r.w, y: cy };
    if (dir === 'se') return { x: r.x + r.w, y: r.y + r.h };
    if (dir === 's') return { x: cx, y: r.y + r.h };
    if (dir === 'sw') return { x: r.x, y: r.y + r.h };
    return { x: r.x, y: cy };
  }
  function hitHandle(p, r) {
    var tol = 20;
    for (var i = 0; i < HANDLES.length; i++) {
      var hp = handlePos(r, HANDLES[i]);
      if (Math.abs(p.x - hp.x) <= tol && Math.abs(p.y - hp.y) <= tol) return HANDLES[i];
    }
    return null;
  }
  function hitElement(p, els) {
    for (var i = els.length - 1; i >= 0; i--) {
      var r = els[i].rect;
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return els[i];
    }
    return null;
  }

  var guides = [];
  function snapValue(v, cands, out) {
    if (!st.opts.snap) return v;
    var best = null, bd = 7;
    for (var i = 0; i < cands.length; i++) {
      var d = Math.abs(v - cands[i]);
      if (d < bd) { bd = d; best = cands[i]; }
    }
    if (best !== null) { out.push(best); return best; }
    return Math.round(v);
  }
  function snapCandidatesX(els, selfId) {
    var c = [0, W() / 2, W()];
    for (var i = 0; i < els.length; i++) { if (els[i].id === selfId) continue; c.push(els[i].rect.x, els[i].rect.x + els[i].rect.w / 2, els[i].rect.x + els[i].rect.w); }
    return c;
  }
  function snapCandidatesY(els, selfId) {
    var c = [0, H() / 2, H()];
    for (var i = 0; i < els.length; i++) { if (els[i].id === selfId) continue; c.push(els[i].rect.y, els[i].rect.y + els[i].rect.h / 2, els[i].rect.y + els[i].rect.h); }
    return c;
  }

  function applyDrag(p, ev) {
    var d = st.drag; if (!d) return;
    var els = toElements(d.scope);
    var gx = [], gy = [];
    var r = { x: d.base.x, y: d.base.y, w: d.base.w, h: d.base.h };
    var dx = p.x - d.start.x, dy = p.y - d.start.y;

    if (d.mode === 'move') {
      var nx = snapValue(d.base.x + dx, snapCandidatesX(els, d.id), gx);
      var ny = snapValue(d.base.y + dy, snapCandidatesY(els, d.id), gy);
      // 右/下边也参与吸附
      var nx2 = snapValue(nx + r.w, snapCandidatesX(els, d.id), gx) - r.w;
      var ny2 = snapValue(ny + r.h, snapCandidatesY(els, d.id), gy) - r.h;
      r.x = Math.abs(nx2 - (d.base.x + dx)) < Math.abs(nx - (d.base.x + dx)) ? nx2 : nx;
      r.y = Math.abs(ny2 - (d.base.y + dy)) < Math.abs(ny - (d.base.y + dy)) ? ny2 : ny;
    } else {
      var dir = d.dir, minW = (d.cons && d.cons.minW) || 24, minH = (d.cons && d.cons.minH) || 24;
      var left = d.base.x, top = d.base.y, right = d.base.x + d.base.w, bottom = d.base.y + d.base.h;
      if (dir.indexOf('w') >= 0) left = snapValue(left + dx, snapCandidatesX(els, d.id), gx);
      if (dir.indexOf('e') >= 0) right = snapValue(right + dx, snapCandidatesX(els, d.id), gx);
      if (dir.indexOf('n') >= 0) top = snapValue(top + dy, snapCandidatesY(els, d.id), gy);
      if (dir.indexOf('s') >= 0) bottom = snapValue(bottom + dy, snapCandidatesY(els, d.id), gy);
      if (d.scale && d.base.w > 0 && d.base.h > 0) {
        // 文字类：任何手柄都是整体等比缩放（等价于改字号），固定对侧边
        var side = (dir.indexOf('e') >= 0 || dir.indexOf('w') >= 0) ? (right - left) / d.base.w : (bottom - top) / d.base.h;
        if (!isFinite(side) || side < 0.05) side = 0.05;
        var sw = Math.max(minW, d.base.w * side), sh = Math.max(minH, d.base.h * side);
        left = (dir.indexOf('w') >= 0) ? (d.base.x + d.base.w - sw) : d.base.x;
        top = (dir.indexOf('n') >= 0) ? (d.base.y + d.base.h - sh) : d.base.y;
        right = left + sw; bottom = top + sh;
      } else if (ev && ev.shiftKey && d.base.h > 0) {           // 等比
        var ratio = d.base.w / d.base.h;
        if (dir === 'se' || dir === 'ne' || dir === 'sw' || dir === 'nw') {
          var nw = Math.max(minW, right - left);
          var nh = Math.max(minH, nw / ratio);
          if (dir.indexOf('n') >= 0) top = bottom - nh; else bottom = top + nh;
        }
      }
      r.x = Math.min(left, right - minW); r.y = Math.min(top, bottom - minH);
      r.w = Math.max(minW, right - left); r.h = Math.max(minH, bottom - top);
    }

    // 边界约束：至少保留 24px 在画面内
    if (!d.cons || d.cons.keepInside !== false) {
      r.x = Math.max(-r.w + 24, Math.min(W() - 24, r.x));
      r.y = Math.max(-r.h + 24, Math.min(H() - 24, r.y));
    }
    r.x = Math.round(r.x); r.y = Math.round(r.y); r.w = Math.round(r.w); r.h = Math.round(r.h);
    guides = [];
    for (var i = 0; i < gx.length; i++) guides.push({ axis: 'x', v: gx[i] });
    for (var j = 0; j < gy.length; j++) guides.push({ axis: 'y', v: gy[j] });

    writeRect(d.scope, d.id, r);
    recordLocal(d.scope, d.id, r, d.anchor);
    var now = performance.now();
    if (now - st.lastSent > 30) { st.lastSent = now; send('rectChanged', { scope: d.scope, id: d.id, rect: r, anchor: d.anchor, commit: false }); }
    d.last = r;
  }

  function recordLocal(scope, id, rect, anchor) {
    var f = factors(anchor);
    if (!st.ovr[scope]) st.ovr[scope] = {};
    var prev = st.ovr[scope][id] || {};
    var next = {
      anchor: anchor,
      x: Math.round(rect.x - W() * f.hx + rect.w * f.hx),
      y: Math.round(rect.y - H() * f.vy + rect.h * f.vy),
      w: Math.round(rect.w), h: Math.round(rect.h)
    };
    if (typeof prev.visible === 'boolean') next.visible = prev.visible;
    if (typeof prev.locked === 'boolean') next.locked = prev.locked;
    st.ovr[scope][id] = next;
  }

  // ---------- 输入接管 ----------
  function onDown(ev) {
    // 无论是否编辑态，都刷新游戏缓存的 canvasRect（修正窗口缩放/位移后的点击偏移）
    try { G.canvasRect = G.canvas.getBoundingClientRect(); } catch (e) {}
    if (!st.edit) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var scope = currentScope(), els = toElements(scope), p = toDesign(ev);
    var sel = st.sel && st.sel.scope === scope ? findEl(els, st.sel.id) : null;
    var dir = sel ? hitHandle(p, sel.rect) : null;
    if (sel && dir && sel.editable.resize) {
      st.drag = { mode: 'resize', dir: dir, scope: scope, id: sel.id, anchor: sel.anchor, cons: sel.constraints, scale: sel.resizeMode === 'scale', base: cp(sel.rect), start: p };
      return;
    }
    var hit = hitElement(p, els);
    if (!hit) { st.sel = null; send('selection', { scope: scope, id: null }); return; }
    st.sel = { scope: scope, id: hit.id };
    send('selection', { scope: scope, id: hit.id });
    if (hit.editable.move) st.drag = { mode: 'move', scope: scope, id: hit.id, anchor: hit.anchor, cons: hit.constraints, scale: hit.resizeMode === 'scale', base: cp(hit.rect), start: p };
  }
  function onMove(ev) {
    if (!st.edit || !st.drag) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    applyDrag(toDesign(ev), ev);
  }
  function onUp(ev) {
    if (!st.edit) return;
    if (st.drag) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      var d = st.drag, r = d.last || d.base;
      st.drag = null; guides = [];
      send('rectChanged', { scope: d.scope, id: d.id, rect: r, anchor: d.anchor, commit: true });
      checkWarn(d.scope, d.id, r);
    }
  }
  function onKey(ev) {
    if (!st.edit) return;
    var k = ev.key;
    if ((ev.ctrlKey || ev.metaKey) && (k === 'z' || k === 'Z' || k === 'y' || k === 's' || k === 'S')) {
      ev.preventDefault();
      send('hotkey', { key: k.toLowerCase(), shift: !!ev.shiftKey });
      return;
    }
    if (!st.sel) return;
    var step = ev.shiftKey ? 10 : 1, dx = 0, dy = 0;
    if (k === 'ArrowLeft') dx = -step; else if (k === 'ArrowRight') dx = step;
    else if (k === 'ArrowUp') dy = -step; else if (k === 'ArrowDown') dy = step;
    else if (k === 'Escape') { st.sel = null; send('selection', { scope: currentScope(), id: null }); return; }
    else return;
    ev.preventDefault();
    var scope = st.sel.scope, el = findEl(toElements(scope), st.sel.id);
    if (!el) return;
    var r = { x: Math.round(el.rect.x + dx), y: Math.round(el.rect.y + dy), w: el.rect.w, h: el.rect.h };
    writeRect(scope, el.id, r);
    recordLocal(scope, el.id, r, el.anchor);
    send('rectChanged', { scope: scope, id: el.id, rect: r, anchor: el.anchor, commit: true });
  }
  function findEl(els, id) { for (var i = 0; i < els.length; i++) if (els[i].id === id) return els[i]; return null; }
  function cp(r) { return { x: r.x, y: r.y, w: r.w, h: r.h }; }

  function checkWarn(scope, id, r) {
    var el = findEl(toElements(scope), id);
    if (!el) return;
    if (el.kind === 'button' && (r.w < 88 || r.h < 44)) {
      send('warn', { code: 'tapTooSmall', message: el.label + ' 尺寸 ' + r.w + 'x' + r.h + ' 小于最小触控 88x44' });
    }
  }

  // ---------- 覆盖层渲染 ----------
  /**
   * 画布底图像素 ÷ 设计像素。
   * 有的模版 canvas.width = CONFIG.width * dpr 并 setTransform(dpr)，
   * 有的直接 canvas.width = CONFIG.width（根本不用 dpr）。
   * 因此不能拿 devicePixelRatio 当真，必须从画布实际尺寸反推。
   */
  function dpr() {
    var c = G && G.canvas, w = W();
    if (c && c.width && w) {
      var k = c.width / w;
      if (isFinite(k) && k > 0.05) return k;
    }
    return Math.min(window.devicePixelRatio || 1, 2);
  }
  function drawOverlay(ctx) {
    var W0 = W(), H0 = H(), scope = currentScope(), els = toElements(scope);
    var d = dpr();
    ctx.save();
    ctx.setTransform(d, 0, 0, d, 0, 0);

    if (st.opts.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
      var g = 50;
      for (var x = g; x < W0; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H0); ctx.stroke(); }
      for (var y = g; y < H0; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W0, y); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath(); ctx.moveTo(W0 / 2, 0); ctx.lineTo(W0 / 2, H0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H0 / 2); ctx.lineTo(W0, H0 / 2); ctx.stroke();
    }
    if (st.opts.safeArea) {
      var pad = Math.round(W0 * 0.045);
      ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(56,189,248,0.30)'; ctx.lineWidth = 2;
      ctx.strokeRect(pad, pad * 1.6, W0 - pad * 2, H0 - pad * 3.2);
      ctx.setLineDash([]);
    }

    var sel = st.sel && st.sel.scope === scope ? findEl(els, st.sel.id) : null;
    if (st.opts.outlineAll) {
      for (var i = 0; i < els.length; i++) {
        var e = els[i]; if (sel && e.id === sel.id) continue;
        var r = e.rect;
        var hid = e.visible === false;
        ctx.setLineDash(hid ? [3, 4] : [6, 5]);
        ctx.strokeStyle = hid ? 'rgba(148,163,184,0.55)' : (e.dirty ? 'rgba(251,191,36,0.75)' : (e.origin === 'paint' ? 'rgba(52,211,153,0.5)' : 'rgba(99,179,237,0.55)'));
        ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
        label(ctx, hid ? e.label + ' (已隐藏)' : e.label, r.x, r.y - 6, hid ? 'rgba(203,213,225,0.9)' : (e.dirty ? '#fbbf24' : (e.origin === 'paint' ? 'rgba(110,231,183,0.95)' : 'rgba(147,197,253,0.9)')));
      }
    }

    for (var j = 0; j < guides.length; j++) {
      ctx.strokeStyle = 'rgba(236,72,153,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (guides[j].axis === 'x') { ctx.moveTo(guides[j].v, 0); ctx.lineTo(guides[j].v, H0); }
      else { ctx.moveTo(0, guides[j].v); ctx.lineTo(W0, guides[j].v); }
      ctx.stroke();
    }

    if (sel) {
      var s = sel.rect;
      ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 3; ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(236,72,153,0.10)'; ctx.fillRect(s.x, s.y, s.w, s.h);
      for (var k = 0; k < HANDLES.length; k++) {
        var hp = handlePos(s, HANDLES[k]), hs = 18;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 2;
        ctx.fillRect(hp.x - hs / 2, hp.y - hs / 2, hs, hs);
        ctx.strokeRect(hp.x - hs / 2, hp.y - hs / 2, hs, hs);
      }
      var info = Math.round(s.x) + ', ' + Math.round(s.y) + '  ' + Math.round(s.w) + ' x ' + Math.round(s.h);
      label(ctx, sel.label + '  [' + info + ']', s.x, s.y + s.h + 30, '#fff', '#ec4899');
    }
    ctx.restore();
  }
  function label(ctx, text, x, y, color, bg) {
    ctx.font = 'bold 20px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var w = ctx.measureText(text).width;
    ctx.fillStyle = bg || 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 4, y - 20, w + 10, 26);
    ctx.fillStyle = color || '#fff';
    ctx.fillText(text, x + 1, y);
  }

  // ---------- 指令处理 ----------
  function handle(type, p) {
    if (type === 'setMode') {
      st.edit = !!p.edit; st.paused = !!p.paused;
      if (!st.edit) { st.drag = null; guides = []; }
      try { G.canvas.style.cursor = st.edit ? 'move' : ''; } catch (e) {}
      pushSnapshot();
    } else if (type === 'snapshot') {
      pushSnapshot();
    } else if (type === 'setOptions') {
      for (var k in p) st.opts[k] = p[k];
      if (typeof p.paintProbe === 'boolean') {
        paint.enabled = p.paintProbe;
        if (!paint.enabled) { paint.items = []; paint.buf = []; paint.live = false; }
        pushSnapshot();
      }
    } else if (type === 'applyOverrides') {
      st.ovr = p.scenes || {};
      if (isRegistry() && G.Layout.applyOverrides) G.Layout.applyOverrides(st.ovr);
      enforce(); pushSnapshot();
    } else if (type === 'setRect') {
      var r = { x: Math.round(p.rect.x), y: Math.round(p.rect.y), w: Math.round(p.rect.w), h: Math.round(p.rect.h) };
      writeRect(p.scope, p.id, r);
      recordLocal(p.scope, p.id, r, p.anchor || autoAnchor(r, W(), H()));
      if (p.select !== false) st.sel = { scope: p.scope, id: p.id };
      pushSnapshot();
    } else if (type === 'setFlag') {
      if (p.anchor) {
        var el = findEl(toElements(p.scope), p.id);
        if (el) { recordLocal(p.scope, p.id, el.rect, p.anchor); pushSnapshot(); }
      }
      if (typeof p.visible === 'boolean') {
        var elv = findEl(toElements(p.scope), p.id);
        if (elv) {
          if (!st.ovr[p.scope] || !st.ovr[p.scope][p.id]) recordLocal(p.scope, p.id, elv.rect, elv.anchor);
          st.ovr[p.scope][p.id].visible = p.visible;
          pushSnapshot();
        }
      }
      if (typeof p.select === 'boolean' && p.select) { st.sel = { scope: p.scope, id: p.id }; }
    } else if (type === 'reset') {
      if (p.scope && p.id) { if (st.ovr[p.scope]) delete st.ovr[p.scope][p.id]; }
      else if (p.scope) { delete st.ovr[p.scope]; }
      else { st.ovr = {}; }
      if (isRegistry() && G.Layout.applyOverrides) G.Layout.applyOverrides(st.ovr);
      if (isRegistry() && G.Layout.reapply) G.Layout.reapply();
      else location.reload();          // probe 模式无法还原源码默认值，重载最可靠
      pushSnapshot();
    } else if (type === 'gotoScope') {
      gotoScope(p.scope);
    }
  }

  function closePopups() {
    while (G.popupStack && G.popupStack.length) G.popupStack.pop();
  }
  function defaultScene() {
    var m = sceneReg() || {};
    if (m.gameplay) return 'gameplay';
    var k = Object.keys(m);
    return k.length ? k[0] : '';
  }
  /** 重新回到加载画面：资源已加载完，进度直接置满，不会自己跑掉 */
  function enterBoot() {
    if (!hasBootScreen()) {
      send('warn', { code: 'scope', message: '这个游戏没有独立的加载画面' });
      return;
    }
    cancelTransition();
    G.Scenes._bootPhase = 'loading';
    G.Scenes._bootTimer = 0;
    if (typeof G.Scenes._bootProgress === 'number') G.Scenes._bootProgress = 1;
  }
  function leaveBoot(target) {
    G.Scenes._bootTarget = target;
    G.Scenes._bootPhase = 'fadeOut';
    G.Scenes._bootTimer = 999;      // 下一帧即落地，不用等渐隐
  }
  /** 结算类画面缺少对局数据时会退化成空壳，从编辑器进入时给一份演示数据 */
  function demoHandoff(scope) {
    if (!/settle|result|over|win|lose|end|score/i.test(scope)) return undefined;
    return { result: 'win', score: 8888, coin: 888, stars: 3, wave: 10, level: 3, time: 90, best: 8888, __gfEditor: true };
  }

  function gotoScope(scope) {
    if (!scope || !G.Scenes) return;
    if (scope.indexOf('popup:') === 0) {
      var pid = scope.slice(6);
      if (!G.popups || !G.popups[pid]) { send('warn', { code: 'scope', message: '未找到弹窗 ' + pid }); return; }
      // 弹窗需要宿主场景：还在加载页/转场中就先落到一个场景，就绪后再开
      if (!bootDone() || inTransition()) {
        st.wantPopup = pid;
        if (!bootDone()) leaveBoot(defaultScene());
        return;
      }
      closePopups();
      openPopupSafe(pid);
      return;
    }
    closePopups();
    st.wantPopup = null;
    st.wantScene = null;
    if (scope === 'boot') { enterBoot(); return; }
    var reg = sceneReg();
    if (!reg || !reg[scope]) {
      send('warn', { code: 'scope', message: '未找到画面 ' + scope });   // 否则当前场景会被置空，游戏变黑屏
      return;
    }
    if (!bootDone()) {
      // 加载页落地时核心是 init() 无参调用，拿不到演示数据，所以先落默认场景再转场
      var ds = defaultScene();
      if (ds && scope !== ds) { st.wantScene = scope; leaveBoot(ds); }
      else leaveBoot(scope);
      return;
    }
    cancelTransition();                                            // 否则切换请求会被 transitionTo 首行吞掉
    if (sceneId() === scope) return;
    // 暂停态下转场仍靠游戏自己的 update 推进，开个窗口让暂停钩子放行
    st.switchUntil = Date.now() + 6000;
    if (G.Scenes.transitionTo) G.Scenes.transitionTo(scope, demoHandoff(scope));
    else send('warn', { code: 'scope', message: '游戏未实现 transitionTo，无法切到 ' + scope });
  }
  function openPopupSafe(pid) {
    try { G.openPopup(pid); }
    catch (e) { send('warn', { code: 'popup', message: '打开弹窗 ' + pid + ' 失败：' + (e && e.message || e) }); }
  }

  function pushSnapshot() {
    var scope = currentScope();
    send('snapshot', {
      scope: scope,
      scopes: sceneList(),
      popups: G.popups ? Object.keys(G.popups) : [],
      designSize: { width: W(), height: H() },
      registry: isRegistry(),
      elements: toElements(scope)
    });
  }

  // ---------- 启动 ----------
  function boot() {
    G = window.G;
    st.ovr = (window.__GF_LAYOUT__ && window.__GF_LAYOUT__.scenes) || {};

    // 渲染钩子：收集本帧绘制探针 → 叠加覆盖层，并做 override 巡检 + 场景变更上报
    installPaint();
    var origRender = G.Scenes.render.bind(G.Scenes);
    G.Scenes.render = function (ctx) {
      paintBegin();
      try { origRender(ctx); } finally { paintEnd(); }
      try {
        var settled = bootDone() && !inTransition();
        // 待转的场景 / 待开的弹窗：等前一步落定后再执行
        if (settled && st.wantScene) {
          var ws = st.wantScene; st.wantScene = null;
          if (sceneId() !== ws && G.Scenes.transitionTo) { st.switchUntil = Date.now() + 6000; G.Scenes.transitionTo(ws, demoHandoff(ws)); }
          settled = false;
        }
        if (settled && st.wantPopup) {
          var wp = st.wantPopup; st.wantPopup = null; openPopupSafe(wp);
        }
        enforce();
        var sc = currentScope();
        if (sc !== st.lastScope) { st.lastScope = sc; st.sel = null; st.switchUntil = 0; send('scopeChanged', { scope: sc }); pushSnapshot(); }
        else if (paint.pending) { paint.pending = false; pushSnapshot(); }
        if (st.edit) drawOverlay(ctx);
      } catch (e) {}
    };
    // 暂停钩子：编辑态可冻结逻辑，只保留渲染
    var origUpdate = G.Scenes.update.bind(G.Scenes);
    G.Scenes.update = function (dt) {
      if (st.edit && st.paused && bootDone() && !inTransition() && !switching()) return;
      origUpdate(dt);
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('keydown', onKey, true);

    send('ready', {
      designSize: { width: W(), height: H() },
      registry: isRegistry(),
      scopes: sceneList(),
      popups: G.popups ? Object.keys(G.popups) : []
    });
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.G && window.G.Scenes && window.G.CONFIG && window.G.canvas) { clearInterval(timer); try { boot(); } catch (e) { send('warn', { code: 'boot', message: String(e && e.message || e) }); } }
    else if (tries > 200) { clearInterval(timer); send('warn', { code: 'noRuntime', message: '未检测到 G 运行时，布局编辑不可用' }); }
  }, 50);
})();
`
