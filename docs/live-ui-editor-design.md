# 游戏内可视化布局编辑（Live UI Editor）设计文档

> 版本：v1 草案　｜　状态：待评审　｜　**本文档为纯设计方案，不含任何代码改动**
> 目标读者：GameForge 平台开发者
> 一句话目标：**在创意画布中新增「运行窗口」节点，直接在运行中的游戏画面上拖拽/缩放按钮与 UI 元素，改动可即时预览、可持久化、可回写代码。**

---

## 1. 背景与问题

当前 UE/UI 微调链路是：肉眼发现按钮偏了 → 打开 `DeployNode` 的「🛠 修复代码」→ 用自然语言描述（"按钮太靠下"）→ LLM 重新生成/打补丁 → 重新部署 → 再看效果。

问题：

| 痛点 | 说明 |
| --- | --- |
| 反馈环长 | 一次 2px 的位置微调要走一次 LLM 调用（数十秒~分钟级），且结果不可预期 |
| 不可控 | 自然语言无法表达"X=131, W=480"，LLM 可能顺手改动无关代码 |
| 不可复现 | 同样的指令两次生成结果不同，调好的布局会被下一次 Stage4 重生成冲掉 |
| 成本 | 纯布局调整消耗 LLM token，且失败率高 |

而生成游戏的技术形态其实**非常适合做直接操作（direct manipulation）**：单文件 HTML + Canvas 2D + 统一的 `G` 运行时 + UI 元素以 `{x, y, w, h}` 矩形形式存在。

---

## 2. 现状分析（设计前提，均已核实）

### 2.1 生成游戏的运行时形态

以 `game-output/aliasy/pro_fly/code/` 为样本：

- **设计分辨率固定**：`G.CONFIG = { width: 750, height: 1334, fps: 60 }`（横版为 1334×750）。
- **等比缩放 + letterbox**：`core.js` 的 `resizeCanvas()` 计算 `G.scaleX / G.scaleY`（客户端 px → 设计 px 的换算比），并缓存 `G.canvasRect`。所有游戏逻辑坐标都在设计像素空间内。
- **输入映射已现成**：`G.Input.getPos()` 用 `(clientX - rect.left) * G.scaleX` 把指针换算到设计坐标；`G.Input.hitTest(x, y, rect)` 是矩形命中测试的唯一实现。
- **UI 元素 = 场景上的矩形字段**，在 `init()` 里定义，例如：

  ```js
  // scene_title.js
  this.btnRect = { x: (G.CONFIG.width - 480) / 2, y: G.CONFIG.height * 0.72, w: 480, h: 140 };
  // scene_gameplay.js
  this.pauseBtnRect = { x: G.CONFIG.width - 80, y: 20, w: 64, h: 64 };
  this.bombBtnRect  = { x: G.CONFIG.width - 140, y: G.CONFIG.height - 160, w: 120, h: 120 };
  // scene_settle.js
  this.btn1Rect = { x: (G.CONFIG.width - 400) / 2, y: G.CONFIG.height * 0.72, w: 400, h: 120 };
  ```

  且**同一个 rect 同时喂给绘制与命中测试**（`G.ui.drawButton(ctx, r.x, r.y, r.w, r.h, ...)` + `G.Input.hitTest(mx, my, r)`）——这是本方案能低成本落地的关键结构性优势。
- **命名已有事实约定**：可编辑 UI 矩形的字段名基本都是 `xxxRect`（`btnRect / pauseBtnRect / bombBtnRect / btn1Rect / btn2Rect`）。
- **视觉参数已集中**：`G.theme` 是颜色/字号/圆角/动效的唯一权威（`prompts.ts` §6.1 铁律），但**位置尺寸没有对应的集中权威** —— 这正是本设计要补的那一块。
- **场景管理**：`G.Scenes.register / transitionTo / _current / _currentId`，具备 `init / update / render / destroy / onPause / onResume` 生命周期契约。

### 2.2 平台侧现状

| 能力 | 现状 | 文件 |
| --- | --- | --- |
| 画布节点注册 | `getNodeComponent()` 里一张 `type → 组件` 映射表；节点模型 `CanvasNode{position,size,stage,status,data}` | `src/canvas/CanvasEngine.vue` L112-115、`src/types/index.ts` L1-10 |
| 画布拖拽 | 原生 `mousedown/mousemove/mouseup`，无第三方库；节点在 `.canvas-transform` 内被 `translate + scale(zoom)` | `src/canvas/CanvasEngine.vue` L138-174 |
| 画布持久化 | `saveState()` → `design/_canvas.json`；`loadFromProject()` 失败时 `rebuildFromStageFiles()` 从阶段文件重建 | `src/stores/canvas.ts` L79-354 |
| 游戏预览 | `iframe` + Blob URL，`sandbox="allow-scripts allow-same-origin"`，手机框 `phone-frame`，`isLandscape` 推导朝向 | `src/nodes/DeployNode.vue` L23-31、L139-145 |
| 父子通信 | 已有单向：游戏 `window.parent.postMessage({type:'gameforge-error'})` → `DeployNode` 收集运行时错误 | `src/api/pipeline.ts` L2152-2179、`DeployNode.vue` L152-177 |
| 产物打包 | `buildGameHTML(code, assets)` 在 `</body>` 前注入 `errorScript`（含 `window.ASSETS`），落盘 `deploy/game.html`，再 `POST /__game-show/publish` | `src/api/pipeline.ts` L2148-2232、L2128 |
| 代码增量修改 | `patches.ts` 已支持 SEARCH/REPLACE + APPEND，含行尾容错匹配 | `src/api/patches.ts` |
| 文件读写 | `POST /__save-file`、`GET /__save-file/read-file\|list-dir`；`projectStore.saveToProject(stage, file, data)` | `vite-plugin-save-file.ts` L575+、`src/stores/project.ts` L132 |

**结论：注入点、通信通道、持久化通道、代码回写工具全部已存在，本方案是"补一层布局权威 + 一个编辑器节点"，不是重构。**

---

## 3. 总体方案

三层结构：

```
┌─ 编辑器侧（Vue，父窗口） ────────────────────────────────┐
│  RunNode.vue「运行窗口」节点                              │
│   ├ 工具条：运行/暂停/重载 · 编辑模式 · 场景切换 · 设备朝向 │
│   ├ iframe（手机框，复用 DeployNode 样式）                 │
│   └ Inspector：元素树 + 锚点/X/Y/W/H 数值 + 对齐/复位      │
│  stores/uiLayout.ts（override 内存态 + 撤销栈 + 落盘）     │
└───────────────▲ postMessage ▼──────────────────────────┘
┌─ 游戏运行时（iframe 内） ───────────────────────────────┐
│  G.Layout   —— 布局权威（注册表 + override 应用 + 锚点）  │
│  __gfEditorAgent —— 编辑代理（命中/拖拽/手柄/吸附/协议）  │
└──────────────────────▲ 注入 ▼──────────────────────────┘
┌─ 数据与产物 ───────────────────────────────────────────┐
│  design/ui-layout.json  ← 唯一持久化真源                 │
│  deploy/game.html 内 <!--GF_LAYOUT--> 区块（热替换）      │
│  可选：patches.ts 把数值固化回 code/*.js                  │
└────────────────────────────────────────────────────────┘
```

### 3.1 核心设计决策（含否决理由）

| # | 决策 | 否决的替代方案与理由 |
| --- | --- | --- |
| D1 | **拖拽手柄画在游戏内**（iframe 内 Canvas 上），父窗口只做数值面板 | 否决"父窗口 DOM overlay 覆盖 iframe"：需要在父侧复刻 `letterbox 偏移 × G.scaleX × DPR × 画布 zoom` 四重变换，任一环节变化就错位；且 overlay 会吞掉 iframe 事件。游戏内做，坐标天然正确（直接复用 `G.Input.getPos`） |
| D2 | **override 覆盖式生效，源码不动**；另提供显式「固化到代码」 | 否决"每次拖拽都改源码"：会与 LLM 生成/补丁流程互相踩踏，且拖拽是高频操作（一次拖动上百帧），不能每帧改文件 |
| D3 | 新游戏走 **`G.Layout` 注册表约定**（prompts 强制）；老游戏走 **运行时探测 `/Rect$/` 兜底** | 否决"只支持新约定"：仓库里已有 4 个已发布游戏 + 若干项目，必须能用；否决"只做探测"：探测拿不到语义（label/kind/锚点/约束），长期不可维护 |
| D4 | override 以 **锚点 + 设计像素** 存储（非绝对像素、非纯比例） | 否决绝对像素：横竖屏/分辨率变化后右上角按钮会跑到画面中间；否决纯比例：按钮会随分辨率变形，破坏最小触控尺寸铁律 |
| D5 | **新增 `preview` 节点类型**（RunNode.vue），不改造 DeployNode | 否决"塞进 DeployNode"：DeployNode 职责是部署产物 + AI 修复，已 449 行；运行窗口需要独立生命周期（编辑态、场景态、脏数据态），且要能在 Stage4 完成后（尚未部署）就可用 |
| D6 | 编辑模式下 **强制画布 zoom=1 或浮窗脱离 transform 层** | iframe 处于 `.canvas-transform` 的 `scale()` 内时，浏览器会缩放 iframe 内部的 CSS 像素，`getBoundingClientRect` 与实际指针换算会引入 zoom 因子，拖拽产生偏移与手抖。见 §9 风险 R1 |

---

## 4. 数据模型

### 4.1 `design/ui-layout.json`（持久化真源）

```jsonc
{
  "version": 1,
  "designSize": { "width": 750, "height": 1334 },   // 记录编辑时的设计分辨率，用于迁移校验
  "orientation": "portrait",
  "updatedAt": "2026-09-07T10:00:00.000Z",
  "scenes": {
    "title": {
      "startBtn": {
        "anchor": "bottom-center",   // 见 4.3
        "x": 0, "y": -240,            // 相对锚点的设计像素偏移
        "w": 480, "h": 140,
        "visible": true,
        "locked": false,
        "z": 0,
        "origin": "registry"          // registry | probe
      }
    },
    "gameplay": {
      "pauseBtn": { "anchor": "top-right", "x": -80, "y": 20, "w": 64, "h": 64, "visible": true }
    }
  }
}
```

约定：
- **只存被用户改过的字段**（稀疏 override），未出现的键完全走游戏源码默认值 → 后续 LLM 重生成时不会被陈旧数值绑死。
- 元素 key 为 `sceneId.elementId`，`elementId` 小驼峰、语义化（`startBtn / pauseBtn / bombBtn / replayBtn / homeBtn / scoreHud`）。
- `popups` 与 `scenes` 同级同构（弹窗内的按钮同样可编辑），key 用 `popup:<popupId>`。

### 4.2 元素描述符（运行时 → 编辑器）

```ts
interface GFLayoutElement {
  id: string            // 'startBtn'
  scope: string         // 'title' | 'gameplay' | 'popup:pause'
  label: string         // '开始游戏按钮'（registry 提供；probe 由字段名推导）
  kind: 'button' | 'icon' | 'panel' | 'hud' | 'text' | 'slot' | 'other'
  rect: { x: number; y: number; w: number; h: number }   // 当前生效值（设计像素，绝对）
  anchor: Anchor
  editable: { move: boolean; resize: boolean; hide: boolean }
  constraints?: { minW?: number; minH?: number; aspect?: number; keepInside?: boolean }
  origin: 'registry' | 'probe'
  dirty: boolean        // 是否已被 override 覆盖
}
```

### 4.3 锚点语义

`Anchor = 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'`

解析规则（`W/H` 为 `G.CONFIG` 设计尺寸，`safe` 为安全区内边距）：

```
absX = anchorX(W) + x - align(anchor, w)   // 左锚：+0；中锚：-w/2；右锚：-w
absY = anchorY(H) + y - align(anchor, h)
```

- 默认锚点**自动推导**（首次登记时）：元素中心 x 落在 `[0, W/3)` → left，`[W/3, 2W/3)` → center，否则 right；y 同理 → top/center/bottom。
- 用户可在 Inspector 手动改锚点；改锚点时**保持绝对位置不变**，只重算偏移值（无视觉跳动）。

### 4.4 平台侧类型增补（`src/types/index.ts`）

```ts
// CanvasNode.type 增加 'preview'
type NodeType = 'idea' | 'module' | 'asset' | 'code' | 'deploy' | 'preview'

interface PreviewNodeData {
  htmlBlobUrl: string
  scope: string                 // 当前编辑的场景
  editMode: boolean
  paused: boolean
  device: 'phone' | 'phone-lg' | 'fit'
  selectedElementId: string | null
  dirtyCount: number
  elements: GFLayoutElement[]   // 运行时快照（不落 _canvas.json，避免膨胀）
}
```

> `_canvas.json` 序列化时对 `preview.data` 做白名单裁剪（只留 `scope/device/editMode`），`elements` 与 `htmlBlobUrl` 均为运行期数据。

---

## 5. 运行时设计（iframe 内）

### 5.1 `G.Layout` —— 布局权威（写入 `core.js` 骨架，由 prompts 强制）

```js
G.Layout = {
  _defs: {},          // scope -> id -> { def, rect }
  _ovr: (window.__GF_LAYOUT__ && window.__GF_LAYOUT__.scenes) || {},
  _scope: 'global',
  scope(id) { this._scope = id; },

  /**
   * 声明一个可编辑 UI 矩形，返回“引用稳定”的 rect 对象。
   * 场景 init 中调用：this.btnRect = G.Layout.rect('startBtn', {...})
   */
  rect(id, def) {
    const scope = def.scope || this._scope;
    const W = G.CONFIG.width, H = G.CONFIG.height;
    const base = { x: def.x, y: def.y, w: def.w, h: def.h };      // 源码默认（绝对设计像素）
    const anchor = def.anchor || autoAnchor(base, W, H);
    const o = (this._ovr[scope] || {})[id];
    const r = o ? resolveAnchored(o, W, H) : base;
    const entry = {
      def: { id, scope, label: def.label || id, kind: def.kind || 'other', anchor,
             editable: def.editable || { move: true, resize: true, hide: false },
             constraints: def.constraints || { minW: 88, minH: 88, keepInside: true },
             base },
      rect: { x: r.x, y: r.y, w: r.w, h: r.h },                    // ← 场景持有此引用
    };
    (this._defs[scope] = this._defs[scope] || {})[id] = entry;
    return entry.rect;
  },

  list(scope) { /* 返回 GFLayoutElement[] */ },
  set(scope, id, patch) { /* 原地改 entry.rect，场景无需感知 */ },
  reset(scope, id) { /* 回到 def.base */ },
  applyOverrides(ovr) { this._ovr = ovr || {}; this.reapply(); },
  reapply() { /* 遍历 _defs，按 _ovr 重算 rect（resize / 场景重入 / 朝向切换时调用） */ },
};
```

要点：
1. **引用稳定**：`rect()` 返回的对象在整个场景生命周期内不被替换，只被原地改写 → 场景代码（render / hitTest）零感知即可实时反映拖拽结果。
2. **`reapply()` 在 `resizeCanvas()` 末尾与 `scene.init()` 之后各调一次** → 覆盖"场景重入 `init()` 重置 rect"和"横竖屏切换"两个失效场景。
3. **最小触控尺寸 88 设计px 作为默认约束**（与 `prompts.ts` 控件规格要求一致），拖小到阈值以下时 Agent 给出警示但不强制阻断（可在 Inspector 关闭）。

### 5.2 场景代码写法（prompts 规范增补）

```js
// scene_title.js —— 改造前
this.btnRect = { x: (G.CONFIG.width - 480) / 2, y: G.CONFIG.height * 0.72, w: 480, h: 140 };

// 改造后（唯一合法写法）
G.Layout.scope('title');
this.btnRect = G.Layout.rect('startBtn', {
  label: '开始游戏', kind: 'button', anchor: 'bottom-center',
  x: (G.CONFIG.width - 480) / 2, y: G.CONFIG.height * 0.72, w: 480, h: 140,
});
```

`render` 与 `pointerup` 处理保持原样（继续读 `this.btnRect`），**零额外改造成本**。

### 5.3 `__gfEditorAgent` —— 编辑代理（由 `buildGameHTML` 注入，仅预览态）

职责与行为：

| 能力 | 设计 |
| --- | --- |
| 事件接管 | 编辑模式开启时，在 `G.canvas` 上以 `capture` 阶段监听 `pointerdown/move/up`，`stopImmediatePropagation()` 阻止游戏逻辑收到；关闭时解绑，游戏恢复正常可玩 |
| 坐标换算 | 直接复用 `(clientX - G.canvasRect.left) * G.scaleX`，与游戏输入完全一致 → 无第二套坐标系 |
| 命中 | 遍历当前 scope 的 `G.Layout.list()`，按 `z` 逆序取最上层；同点重复点击循环切换重叠元素（解决按钮压在面板上的选择问题） |
| 拖拽 | move（整体平移）/ resize（8 方向手柄，命中容差 14 设计px）；`Shift` 等比、`Alt` 以中心缩放 |
| 键盘 | `↑↓←→` 1px 微调、`Shift+方向` 10px、`Tab` 切换元素、`Esc` 取消选择、`Ctrl+Z / Ctrl+Shift+Z` 撤销重做、`Delete` = 隐藏（`visible:false`，非删除） |
| 吸附 | 8px 网格、画面水平/垂直中线、安全区内边距线、同 scope 其他元素的边/中线；吸附阈值 6 设计px，吸附时画洋红辅助线 |
| 约束 | `keepInside` 不出画面；`minW/minH` 提示；`locked` 元素只可选不可改 |
| 覆盖层绘制 | 在 `G.render` 之后追加一次 overlay pass（同一 canvas，不新建 DOM）：网格、安全区框、所有可编辑元素的虚线轮廓 + 标签、选中元素实线框 + 8 手柄、实时 `x,y,w,h` 数值气泡、辅助线 |
| 暂停策略 | 默认「暂停编辑」：`G.Scenes` 暂停 update 只保留 render（避免动画干扰对齐）；可切「实时编辑」查看动效下的观感 |
| 场景跳转 | `gotoScene(id)` 直接 `G.Scenes.transitionTo(id)`；`openPopup(id)` 压栈 `G.popupStack`，让结算/暂停/商店等只在特定状态出现的界面可被直接编辑 |
| 探测兜底 | 无 `G.Layout` 定义时，扫描 `G.Scenes._current` 自有属性：key 匹配 `/Rect$/` 且值为 `{x,y,w,h}` 全数值 → 生成 `id = key.replace(/Rect$/,'')`，`origin='probe'`，`kind` 由 key 关键词猜测（`pause/bomb/btn` → button），并在每次 `init()` 后重新注入 override |

### 5.4 注入策略（`buildGameHTML` 增补）

在现有 `errorScript` 之后追加两个**可独立开关**的注入块：

```html
<!--GF_LAYOUT_START--><script>window.__GF_LAYOUT__ = { ...ui-layout.json... };</script><!--GF_LAYOUT_END-->
<!--GF_EDITOR_START--><script>/* __gfEditorAgent ~10KB，仅 editable 构建注入 */</script><!--GF_EDITOR_END-->
```

- `buildGameHTML(code, assets, { layout, editable })`：`editable=false`（发布态）只注入 LAYOUT 块，不注入 Agent（安全 + 体积）。
- 两个块用注释哨兵包裹 → **保存布局时可以直接字符串替换 `deploy/game.html` 里的 LAYOUT 块，不必重跑 Stage5 打包**（1.5MB 产物，重打包耗时且会重压素材）。

---

## 6. 通信协议 `gf-ui-edit@1`

所有消息形如 `{ ns: 'gf-ui-edit', v: 1, sid: <sessionId>, type, payload }`。

**编辑器 → 游戏**

| type | payload | 语义 |
| --- | --- | --- |
| `hello` | `{ sid }` | 握手；Agent 记住 sid，后续只接受同 sid 消息 |
| `setMode` | `{ edit: boolean, paused: boolean }` | 开/关编辑模式、暂停策略 |
| `snapshot` | `{}` | 请求当前 scope 元素清单 |
| `gotoScope` | `{ scope }` | 切场景 / 开弹窗 |
| `setRect` | `{ scope, id, rect, commit }` | 数值面板输入；`commit=false` 为拖动中间态（不入撤销栈） |
| `setFlag` | `{ scope, id, visible?, locked?, anchor? }` | 可见/锁定/锚点 |
| `reset` | `{ scope?, id? }` | 复位单个 / 整场景 / 全部 |
| `applyOverrides` | `{ scenes }` | 撤销重做后整体回灌 |
| `setOptions` | `{ grid, snap, safeArea, outlineAll }` | 编辑辅助开关 |

**游戏 → 编辑器**

| type | payload | 语义 |
| --- | --- | --- |
| `ready` | `{ sid, designSize, orientation, scopes: string[], capabilities: { registry: boolean } }` | Agent 就绪；`registry=false` 表示走探测兜底（编辑器给出降级提示） |
| `snapshot` | `{ scope, elements: GFLayoutElement[] }` | 元素清单 |
| `scopeChanged` | `{ scope }` | 游戏自身切了场景（用户在预览里点了开始） |
| `selection` | `{ scope, id }` | 游戏内选中变化（同步高亮 Inspector） |
| `rectChanged` | `{ scope, id, rect, commit }` | 拖拽中（节流 ~30ms）/ 松手（`commit=true`，编辑器入撤销栈并标脏） |
| `warn` | `{ code, message }` | 触控尺寸过小 / 元素重叠 / 出安全区 |

安全：
- Blob URL 的 iframe 与父同源，但仍需 **`sid` 随机 token 双向校验 + `event.source === iframe.contentWindow` 校验**，防止其他 iframe 或页面脚本伪造布局指令。
- 沿用现有 `sandbox="allow-scripts allow-same-origin"`（运行窗口需要 Agent 与父窗口通信；`GameRecommend` 的 `allow-scripts` 只读模式不变）。
- 发布态（`game-show/*`）**不注入 Agent**，即"玩家不可能进入编辑模式"。

---

## 7. 编辑器侧设计（`RunNode.vue`「运行窗口」节点）

### 7.1 节点形态

- 新节点类型 `preview`，`stage = 5`，默认尺寸 `560 × 900`（编辑模式下自动展宽到 `900 × 900`，右侧展开 Inspector）。
- 创建时机与连线：
  - Stage4 代码完成后自动创建（`code → preview` 连线），**不依赖 Stage5 部署**：内部用 `buildGameHTML(code, assets, { editable: true })` 现场生成 Blob（与 Stage5 同函数，避免两套产物）。
  - 若已有 `deploy` 节点，`preview` 插在 `code` 与 `deploy` 之间，形成 `code → preview → deploy`。
- 支持「浮窗模式」：一键脱离 `.canvas-transform`，以 `position: fixed` 浮层呈现（解决画布缩放问题，见 R1），可拖动标题栏、最大化。

### 7.2 布局

```
┌ 🎮 运行窗口 ─────────────────── 已修改 3 ─ ▣浮窗 ┐
│ ▶暂停 ↻重载 │ ✥编辑模式 │ 场景[标题▾] │ 📱竖版 │ ⤢ │
├──────────────────────┬──────────────────────────┤
│                      │ 元素树                    │
│    ┌ phone-frame ┐   │  ▾ 标题界面                │
│    │             │   │    ● startBtn  开始游戏 ●脏│
│    │   iframe    │   │  ▾ 游戏中                  │
│    │ (游戏+手柄) │   │    ○ pauseBtn  暂停        │
│    │             │   │    ○ bombBtn   炸弹        │
│    └─────────────┘   ├──────────────────────────┤
│                      │ 属性 · startBtn           │
│                      │ 锚点 [bottom-center ▾]    │
│                      │ X [   0] Y [-240]         │
│                      │ W [ 480] H [ 140] 🔗等比   │
│                      │ ☑可见 ☐锁定  层级[0]      │
│                      │ 对齐 ⇤ ⇔ ⇥ ⇧ ⇕ ⇩         │
│                      │ [复位此元素]              │
├──────────────────────┴──────────────────────────┤
│ ⚠ 按钮宽度 64 < 88（触控偏小）                     │
│ [💾 保存布局]  [🔩 固化到代码]  [↺ 全部复位]        │
└─────────────────────────────────────────────────┘
```

### 7.3 `stores/uiLayout.ts`

```ts
state: {
  overrides: Record<scope, Record<id, Override>>   // 内存真源
  history: Override[][]                            // 撤销栈（快照式，深度 50）
  cursor: number
  dirty: boolean
  lastSavedAt: string
}
actions: load(project) / applyLocal(scope,id,patch,commit) / undo() / redo()
       / resetElement() / resetScope() / resetAll()
       / save()      // 写 ui-layout.json + 热替换 deploy/game.html LAYOUT 块 + 同步 game-show
       / bake()      // 通过 patches.ts 固化回 code/*.js
```

- 撤销栈由**编辑器侧统一持有**（游戏内 Agent 不维护历史），保证"iframe 重载后撤销仍可用"。
- 自动保存：`commit` 后 debounce 3s 写盘（与 `canvas.ts saveState` 相同的轻量落盘策略），避免拖一次丢一次。

### 7.4 快捷键（父窗口，编辑模式聚焦时）

| 键 | 行为 |
| --- | --- |
| `E` | 切换编辑模式 |
| `Space` | 暂停 / 继续游戏循环 |
| `R` | 重载 iframe（保留 override） |
| `Ctrl+S` | 保存布局 |
| `Ctrl+Z / Ctrl+Shift+Z` | 撤销 / 重做 |
| `1/2/3` | 跳转 标题 / 游戏中 / 结算 |

---

## 8. 数据链路与生效时序

### 8.1 一次拖拽

```
用户在 iframe 内拖动按钮
 → Agent pointermove：G.Layout.set() 原地改 rect → 下一帧游戏画面立即更新（0 延迟）
 → postMessage rectChanged(commit=false, 节流 30ms) → Inspector 数值实时跟随
 → pointerup：rectChanged(commit=true) → uiLayout.applyLocal(commit) → 入撤销栈 + 标脏
 → debounce 3s → save()
```

### 8.2 `save()`

1. `projectStore.saveToProject('design', 'ui-layout.json', json)`
2. 读 `deploy/game.html`，正则替换 `<!--GF_LAYOUT_START-->…<!--GF_LAYOUT_END-->` 区块后写回（**不重跑 Stage5**）
3. 若项目已发布（`game-show/<user>_<project>` 存在）：调 `/__game-show/publish` 或新增 `/__game-show/patch-layout` 同步同一区块，使广场/推荐页立即生效
4. `DeployNode` 的 `htmlBlobUrl` 重建（保证"试玩"看到的是最新布局）

### 8.3 与 Stage4/Stage5 的关系

| 场景 | 行为 |
| --- | --- |
| 重跑 Stage5 部署 | `buildGameHTML` 从 `ui-layout.json` 读取 layout 注入 → **布局不丢** |
| 重跑 Stage4 代码生成 / AI 修复 | `ui-layout.json` 保留且继续生效（override 是按 `scope.id` 匹配，只要元素 id 不变就命中）；同时把布局摘要写进 codegen user prompt 的「用户已锁定布局，必须以此为默认值」段落，减少 LLM 生成与用户意图打架 |
| 元素 id 变了（LLM 重命名） | 该 override 失配 → 静默回落到源码默认值，并在运行窗口顶部提示"3 项布局覆盖未匹配到元素 [查看/清理]" |
| 「🔩 固化到代码」 | 用 `patches.ts` 对 `code/*.js` 与 `codeNode.data.source` 生成 SEARCH/REPLACE：把 `G.Layout.rect('startBtn', { ... x:…, y:…, w:…, h:… })` 的默认值替换为当前值，然后清空对应 override（源码与显示一致，单一真源）。**纯本地字符串操作，不调 LLM** |

### 8.4 项目恢复（继续创作）

- `canvas.ts loadFromProject()` 之后额外加载 `design/ui-layout.json` → `uiLayout.overrides`
- `rebuildFromStageFiles()` 中：若存在 `code/game.js` 或 `deploy/game.html`，补建 `preview` 节点（与现有 deploy 节点补建逻辑同构）

---

## 9. 风险与对策

| # | 风险 | 对策 |
| --- | --- | --- |
| R1 | **画布 `scale(zoom)` 内的 iframe** 导致指针换算带 zoom 因子，拖拽偏移/抖动 | 进入编辑模式时：① 自动把画布 `zoom` 归 1 并居中该节点；或 ② 切「浮窗模式」脱离 transform。二者任一必须实现，默认 ②。同时 Agent 在 `pointerdown` 时刷新 `G.canvasRect`（现有代码只在 resize 时缓存，节点移动/画布平移后会失效）|
| R2 | 场景 `init()` 重新赋值 rect，覆盖用户调整 | `G.Layout.rect()` 内部即读 override（init 时就已是最终值）；探测兜底路径由 Agent hook `transitionTo` 在 `init()` 后 `reapply()` |
| R3 | `resizeCanvas` / 横竖屏切换后位置错 | 锚点存储 + `resizeCanvas()` 末尾 `G.Layout.reapply()`；`designSize` 与当前 `G.CONFIG` 不一致时，编辑器提示"布局按旧分辨率保存，是否按锚点迁移" |
| R4 | 老游戏（无 registry）能力受限：无 label/kind、`init` 里的比例表达式丢失 | 探测模式明确降级提示；只开放 move/resize/visible；引导用户"固化到代码"或重跑 Stage4 升级到 registry 写法。能力矩阵见 §10 |
| R5 | render 内联字面量绘制的元素（不经 rect 变量）不可编辑 | prompts 增补铁律禁止；对存量游戏，Agent 只能列出可探测元素，其余提示走 AI 修复。**明确列为已知限制** |
| R6 | Agent 注入增大产物 | Agent 仅 `editable` 构建注入（发布态零负担）；LAYOUT 块为纯 JSON，通常 < 2KB |
| R7 | 多标签/多窗口同时编辑同项目导致覆盖 | `ui-layout.json` 带 `updatedAt`，save 前读盘比对；不一致弹"远端已更新，覆盖 / 放弃 / 查看差异" |
| R8 | 恶意页面伪造 postMessage 改布局 | `sid` token + `event.source` 校验 + 发布态不注入 Agent |
| R9 | 编辑模式误触发游戏逻辑（点到"开始游戏"跳场景） | capture 阶段 `stopImmediatePropagation`；编辑模式下 canvas 加 `cursor: move`，节点边框变洋红色明确态势 |

---

## 10. 兼容能力矩阵

| 能力 | registry 模式（新生成游戏） | probe 模式（存量游戏） |
| --- | --- | --- |
| 列出元素 | ✅ 含 label / kind / 锚点 / 约束 | ⚠️ 仅 `xxxRect` 字段，label 由字段名推导 |
| 拖拽移动 / 缩放 | ✅ | ✅ |
| 隐藏 / 锁定 | ✅ | ✅（隐藏需元素绘制处判空，probe 下不保证生效） |
| 锚点自适应横竖屏 | ✅ | ⚠️ 自动推导，可能与原意不符 |
| 跨场景 / 弹窗编辑 | ✅ `gotoScope` | ⚠️ 依赖 `G.Scenes.transitionTo` 与 `G.popupStack` 存在（现有 4 个样本均满足） |
| 固化回代码 | ✅ 精准替换 `G.Layout.rect` 默认值 | ⚠️ 匹配 `this.xxxRect = { x: …, y: …, w: …, h: … }` 字面量，含表达式（如 `G.CONFIG.height * 0.72`）时整体替换为数值并加注释 |
| 最小触控校验 | ✅ | ✅ |

---

## 11. 非目标（本期不做）

- 不做逻辑编辑（不改按钮点击后干什么）
- 不做**新增/删除** UI 元素（只调既有元素的位置尺寸与可见性）
- 不做美术资源替换（Stage2/3 的职责）
- 不做嵌套容器 / 自动流式布局 / 响应式断点
- 不做游戏内文本内容编辑（后续可扩展 `G.Layout` 到 `G.Text`）
- 不改 `GameRecommend`（推荐页保持 `allow-scripts` 只读沙箱）

---

## 12. 规范增补（`src/api/prompts.ts`）

在 §6.1「G.theme 全局唯一权威」之后新增 **§6.1.1 G.Layout 布局唯一权威（铁律）**：

1. 所有可交互 UI 矩形（按钮 / 图标按钮 / 标签页 / 卡片 / 槽位 / 可点 HUD）**必须**经 `G.Layout.rect(id, def)` 声明后使用，禁止在 `render` 中内联字面量坐标绘制可交互元素。
2. 同一 rect 必须同时用于 `render` 与 `hitTest`，禁止绘制与命中各写一份坐标。
3. `id` 命名规范：语义化小驼峰（`startBtn / pauseBtn / bombBtn / replayBtn / homeBtn / shopBtn`）；必须提供 `label`（中文）、`kind`、`anchor`。
4. `core.js` 必须包含 `G.Layout` 骨架（给出固定骨架代码，与 §5.1 一致），并在 `resizeCanvas()` 末尾调用 `G.Layout.reapply()`。
5. 每个场景 `init()` 开头调用 `G.Layout.scope('<sceneId>')`。
6. 保持既有铁律不变：位置尺寸走 `G.Layout`，颜色字号圆角走 `G.theme`，二者不交叉。

同时在 codegen user prompt 中新增「已锁定布局」段落（存在 `ui-layout.json` 时注入）。

---

## 13. 涉及文件清单（实施阶段才动，本文档不改）

**新增**

| 文件 | 内容 |
| --- | --- |
| `src/nodes/RunNode.vue` | 运行窗口节点（工具条 + iframe + Inspector + 浮窗模式） |
| `src/stores/uiLayout.ts` | override 内存态、撤销栈、保存/固化 |
| `src/api/liveEdit.ts` | 协议常量、消息收发封装、`sid` 校验、`GFLayoutElement` 类型 |
| `src/api/editorAgent.ts` | Agent 源码字符串（导出供 `buildGameHTML` 注入）+ 布局固化的 patch 生成器 |
| `docs/live-ui-editor-design.md` | 本文档 |

**改动**

| 文件 | 改动点 |
| --- | --- |
| `src/types/index.ts` | `CanvasNode.type` 加 `'preview'`；新增 `PreviewNodeData` / `UILayoutOverride` |
| `src/canvas/CanvasEngine.vue` | `getNodeComponent` 注册 `preview`；编辑模式下抑制节点拖拽与 `zoom`（避免与 iframe 内拖拽冲突） |
| `src/stores/canvas.ts` | `saveState` 对 `preview.data` 白名单裁剪；`rebuildFromStageFiles` 补建 preview 节点；加载 `ui-layout.json` |
| `src/api/pipeline.ts` | `buildGameHTML(code, assets, opts)` 增加 LAYOUT / EDITOR 注入块（哨兵注释）；Stage5 读取 `ui-layout.json`；Stage4 prompt 注入已锁定布局 |
| `src/api/prompts.ts` | 新增 §6.1.1；`core.js` 骨架加入 `G.Layout`；场景骨架示例改为 `G.Layout.rect` 写法 |
| `vite-plugin-save-file.ts` | 新增 `POST /__game-show/patch-layout`（只替换已发布 `game.html` 的 LAYOUT 区块） |
| `src/nodes/DeployNode.vue` | 试玩前刷新 layout（复用 preview 的产物）；`phone-frame` 样式抽为可复用 |

---

## 14. 分期与验收

### P0（可用闭环）
`G.Layout` 骨架 + prompts 规范 + Agent（选中/移动/缩放/网格吸附/数值气泡）+ RunNode（iframe + 元素树 + 数值面板）+ `ui-layout.json` 落盘 + LAYOUT 块热替换。

**验收**：新生成一个竖版游戏 → 运行窗口拖动标题界面开始按钮 → 画面即时跟随 → 保存 → 刷新页面/重新进入项目 → 位置保持 → 试玩点击热区与视觉一致（拖完按钮点得中）。

### P1（生产可用）
锚点系统 + 撤销重做 + 场景/弹窗跳转 + 探测兜底（存量游戏）+ 对齐工具 + 触控尺寸校验 + 「固化到代码」+ 已发布游戏同步。

**验收（回归 4 个存量游戏）**：`aliasy_pro_fly`（竖版射击）、`aliasy_pro_tafa`（塔防）、`aliasy_pro_xiaoxiaole`（三消）、`aliasy_pro_zhiwu`（横版）——探测模式均能列出并拖动 HUD 按钮；横版项目切朝向后锚点不错位；固化后源码可读、重新部署效果一致。

### P2（增强）
多选批量对齐、分布；等比缩放组；布局预设（一键"大按钮/易触达"模板）；与 `G.theme` 联动的样式面板；布局 diff 视图；截图对比。

### 关键测试用例

| # | 用例 | 期望 |
| --- | --- | --- |
| T1 | 拖动后立即点击该按钮 | 视觉与热区一致（同一 rect） |
| T2 | 编辑 → 切场景 → 切回 | 调整保持（`init()` 不覆盖） |
| T3 | 竖版调完切横版预览 | 按锚点合理迁移，不出画面 |
| T4 | 缩小按钮到 60px | 出现 ⚠ 触控偏小告警，仍可保存 |
| T5 | 保存后重跑 Stage5 部署 | 布局不丢 |
| T6 | 保存后跑一次 AI 修复代码 | 布局不丢（id 未变） |
| T7 | 固化到代码 → 清空 override → 重载 | 效果与固化前完全一致 |
| T8 | 画布 zoom=0.5 时进入编辑模式 | 自动归一/浮窗，拖拽无偏移 |
| T9 | 关闭编辑模式 | 游戏完全可玩，输入无残留拦截 |
| T10 | 广场页打开已发布游戏 | 布局为最新；页面内无任何编辑能力（Agent 未注入） |

---

## 15. 实施记录（第一版落地，2026-09）

### 15.1 与设计文档的偏差

| 项 | 设计文档 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 宿主 | D5：创意画布新增 `preview`（运行窗口）节点 | **复用「部署 / 测试」节点（DeployNode）**，新增「✥ 布局编辑」按钮打开全屏浮层 | 用户明确要求在部署测试框内扩展；部署节点已持有 `htmlBlobUrl`、错误回传与修复入口，链路最短，无需新节点类型/连线/持久化改造 |
| 编辑窗口尺寸 | 未定 | **iPhone 17 Pro Max 逻辑分辨率 440×956，1:1 呈现**（横版交换为 956×440）；视口不足时整体 CSS 等比缩小并显示比例 | 用户要求「游戏窗口做到和 iPhone 17 Pro Max 屏幕大小」；坐标由 agent 每次事件重新取 `getBoundingClientRect()` 换算，外层缩放不产生偏移（R1 收口） |
| 部署节点预览框 | 未涉及 | 预览框新增「真机 1:1 / 缩略」切换，默认真机 1:1（440×956），节点宽高随之自适应 | 同上，便于不开浮层也能按真实尺寸观察 |
| 复位 / 撤销 | 运行时还原默认值 | 去掉 override 后**重建 blob 重新装载 iframe**，并自动回到原画面 | probe 模式下运行时已无源码默认值，重载是唯一可靠还原路径 |
| 「固化到代码」 | P1 范围 | 本版未做（patches.ts 通道保留） | 布局块热替换已能满足部署/发布一致性；固化留待 P1 |

### 15.2 交付文件

| 文件 | 说明 |
| --- | --- |
| `src/api/liveEdit.ts`（新增） | 协议常量、类型、设备预设（iPhone 17 Pro Max 等）、锚点算法、哨兵注入块工具、`EDITOR_AGENT_SOURCE` 编辑代理源码 |
| `src/stores/uiLayout.ts`（新增） | override 状态、快照式撤销栈（深度 50）、落盘（`design/ui-layout.json` + 热替换 `deploy/game.html` + 同步已发布版本） |
| `src/panels/LayoutEditor.vue`（新增） | Teleport 到 body 的 1:1 编辑浮层：设备框 + 元素树 + 锚点/数值 Inspector + 对齐/复位 + 告警 |
| `src/nodes/DeployNode.vue` | 新增「✥ 布局编辑」入口、预览框真机 1:1 切换 |
| `src/api/pipeline.ts` | `buildGameHTML(code, assets, layout)` 统一经 `finalizeLayout` 注入布局块并剥离编辑块；Stage5 打包前读取 `design/ui-layout.json` |
| `src/api/prompts.ts` | core.js 骨架新增 `G.Layout` 注册表实现；新增 §6.1.1 布局唯一权威铁律；title 场景示例改用 `G.Layout.rect` |
| `vite-plugin-save-file.ts` | 新增 `POST /__game-show/sync-layout`：校验 `meta.author` 后把最新 `deploy/game.html` 覆盖到已发布目录，未发布则返回 `skipped` |

### 15.3 安全与兼容边界

- **编辑能力永不进入产物**：agent 仅注入到编辑器浮层的临时 blob；`finalizeLayout` 在落盘/发布路径统一 `stripEditorBlock`；agent 自身在 `location.hash` 无 `gfedit=<sid>` 时直接 return。
- **消息双向校验** `ns + sid`，sid 每次打开编辑器随机生成。
- **存量项目可用**：无 `G.Layout` 时走 probe 模式（扫描场景/弹窗实例上的 `*Rect` 字段），并每帧 `enforce()` 把 override 写回，覆盖 `init()` 重置。
- **点击偏移修复**：agent 在每次 `pointerdown` 刷新 `G.canvasRect`，顺带修掉存量游戏窗口尺寸变化后缓存过期导致的热区偏移。

### 15.4 本轮验证

- `vue-tsc --noEmit` 通过；`vite build` 通过（1641 modules）。
- Node 侧脚本校验：`EDITOR_AGENT_SOURCE` 语法可解析；布局块注入幂等、可读回、可剥离且位置早于 `<body>`；锚点 `toAnchored/resolveAnchored` 往返无损；prompts 中的 `G.Layout` 骨架实测「override 生效 / set 改的是同一活对象 / applyOverrides({}) 回到 base」。
- 待人工回归：T1–T10（尤其 T1 拖后点得中、T2 切场景保持、T5 重跑 Stage5 不丢、T10 广场页无编辑能力）。

---

## 16. 静态文字 / 图标编辑（绘制探针，2026-09）

第一版只能编辑「注册进 `G.Layout` 的矩形」或「运行时扫描到的 `*Rect` 字段」——也就是按钮、面板这类本来就有矩形数据的元素。标题文字、分数、金币图标等直接 `fillText / drawImage` 画出来的内容没有矩形可言，因此不可选中。本章记录把这类元素也纳入编辑范围的做法。

### 16.1 思路：拦截绘制调用，而不是要求源码改造

在编辑代理内接管画布上下文的三个方法：

| 方法 | 用途 |
| --- | --- |
| `ctx.fillText` / `ctx.strokeText` | 捕获文字，反推 bbox；应用 override 时改写坐标并按比例改字号 |
| `ctx.drawImage` | 捕获图标 / 图片，反推目标矩形；应用 override 时改写目标坐标与尺寸 |

由此得到第三种元素来源 `origin: 'paint'`（另两种是 `registry` / `probe`），**存量项目无需改一行游戏代码即可编辑**。探针只存在于注入了编辑块的 blob 会话中（URL 无 `#gfedit=<sid>` 时代理直接退出），落盘 / 发布仍走 `stripEditorBlock`。

关键性质：元素的 `base`（源码默认矩形）**每帧由绘制参数重算**，override 只在真正绘制前做一次坐标改写。因此复位无需重载页面，反复修改也不会累积漂移。

### 16.2 坐标换算

游戏侧 `render()` 里是 `setTransform(dpr,0,0,dpr,0,0)` 之后再 `ctx.translate(G.Shake…)`，所以绘制方法收到的是局部坐标。探针用 `ctx.getTransform()` 反解：

```
tf = { sx: m.a/dpr, sy: m.d/dpr, tx: m.e/dpr, ty: m.f/dpr }
设计坐标 = tf.s * 局部坐标 + tf.t        // 登记 base 时
局部坐标 = (设计坐标 - tf.t) / tf.s      // 写回绘制参数时
```

仅接受轴向矩阵（`|b|, |c| ≤ 0.0001`）；存在旋转 / 斜切时该次绘制**不纳入**编辑。

文字 bbox 由 `measureText()` 的 `width` 与 `actualBoundingBoxAscent/Descent` 得到，再按当前 `textAlign / textBaseline` 反推左上角。

### 16.3 元素 id 规则

| 类型 | id | 说明 |
| --- | --- | --- |
| 文字 | `txt:` + slug | slug 把数字串归一为 `#`（`得分 120` → `txt:得分 #`），截断 20 字符；分数 / 计时类文字不会每帧换 id |
| 图片 | `img:` + 资产名 | 内联产物的 `src` 是 base64，只能靠与 `G.Assets.images` 的**对象同一性**反查名字，命中后缓存到 `img.__gfName` |

同名且 base 位置相差 ≤ 6px 的绘制视为同一元素（`fillText` + `strokeText`、文字阴影），保留彼此相对偏移，整体同步移动 / 缩放。同名多处出现时追加序号后缀 `#n`。

### 16.4 噪声过滤

| 规则 | 原因 |
| --- | --- |
| 9 参数 `drawImage` 不纳入 | 精灵动画帧，逐帧变化 |
| `w < 8` 或 `h < 8` 不纳入 | 碎图、粒子 |
| 覆盖 ≥ 98% 画面的图片不纳入 | 全屏背景 |
| 每帧 `cap = 200` | 防止粒子类绘制刷爆列表 |

面板另提供「文字/图标」总开关（`opts.paintProbe`，默认开）与名称 / 文字筛选框；元素集合签名变化时以 400ms 节流推快照，避免列表陈旧又不刷屏。

### 16.5 交互差异

- 文字元素 `resizeMode: 'scale'`：任何手柄都等价于等比改字号（`k = want.h / base.h`，用正则改写 `font` 里的 `px` 数值），Inspector 用「缩放（%）+ 只读尺寸」替代 W/H 输入。
- 图标元素 `resizeMode: 'box'`：可自由改宽高。
- 支持隐藏：列表项的 ◉ / ⊘ 按钮写 `visible` 标记；因 paint 元素初始没有 override 记录，`uiLayout.setFlag` 增加了 `seedRect/seedAnchor` 参数，用当前矩形先建一条记录。
- 选框配色：paint 元素绿色轮廓，已隐藏元素灰色虚线 + 「(已隐藏)」标签。

### 16.6 已知边界

1. **旋转 / 斜切绘制不可编辑**：`getTransform()` 非轴向矩阵时跳过，元素不会出现在列表里。
2. ~~**弹窗打开时作用域归属粗糙**~~ —— 已在第 17 章修复（绘制段按场景/弹窗切分）。
3. **按钮与其标签文字可能脱钩**：override 是绝对定位语义，若给按钮矩形和它的标签文字分别设过 override，移动按钮时标签不会跟随。

### 16.7 本轮验证

- `vue-tsc --noEmit` 通过；`vite build` 通过（1641 modules）。
- Node 侧逻辑级 smoke（假 ctx / 假 G，跑真实 `EDITOR_AGENT_SOURCE`）：
  - dpr=1 无变换：捕获集合、base 矩形、fill+stroke 去重、override 后坐标与字号、字号复原、`drawImage` 目标矩形、隐藏后不绘制、`visible=false` 上报、复位回 base、关探针后无 paint 元素 —— 10 项全部通过。
  - dpr=2 + `translate(10,15)` 震屏：id 数字归一、文字 / 图标 base、override 后写回坐标与字号、旋转矩阵不纳入、复位后 base 未被污染 —— 全部通过。
- **未做浏览器内真实回归**：拖动静态文字后的实际位置 / 字号观感、隐藏是否生效、切场景与保存后是否保持，仍需人工在 dev server 中确认。

---

## 17. 全部画面可选中编辑（2026-09）

此前只能编辑「游戏当前恰好停在的那个画面」。加载页启动后就再也回不去，结算页要真的打完一局才能看到，弹窗要在特定场景里触发才会出现。本章记录把**加载页 / 全部场景 / 全部弹窗**都变成可直接切过去编辑的画面。

### 17.1 画面列表来源

```
scopes = ['boot'（存在 _renderBoot 时）] + Object.keys(G.Scenes._scenes)
popups = Object.keys(G.popups)
```

`boot` 此前不在列表里（它不是注册场景），因此加载页完全不可编辑。面板对场景 id 附加人话名称（`settle（结算页）`），匹不上就原样显示 id。

### 17.2 各类画面的进入方式

| 画面 | 进入方式 |
| --- | --- |
| `boot` 加载页 | 把 `_bootPhase` 重置为 `'loading'`、`_bootProgress` 置满。核心的推进是 `loadAll().then()` 里的一次性 `setTimeout`，所以重新进入后**不会自己跑掉**，可以稳定停在加载页编辑 |
| 普通场景 | 先清空弹窗栈 → 清掉在途转场（否则 `transitionTo` 的首行 `if (this._transition) return` 会吞掉请求）→ `transitionTo(scope, demoHandoff)` |
| 结算类场景 | 匹配 `/settle\|result\|over\|win\|lose\|end\|score/i` 时附带演示数据 `{result:'win', score:8888, stars:3, …}`，否则 `init(undefined)` 会退化成「失败 / 0 分 / 无星星」的空壳 |
| 弹窗 | 弹窗需要宿主场景。若当前仍在加载页或转场中，先落到默认场景（优先 `gameplay`），用 `st.wantPopup` 挂起，等 `_bootPhase==='done' && !_transition` 后在渲染钩子里补开 |
| 从加载页跳结算页 | 核心的 boot 落地是 `init()` **无参**调用，拿不到演示数据。因此先落默认场景，再用 `st.wantScene` 走一次正常转场，确保 handoff 生效 |

选择场景时会先清空弹窗栈，所以「选回场景」天然就是「关掉弹窗」。

### 17.3 绘制段按画面切分（修复第 16 章边界 2）

核心的 `render()` 里场景与弹窗在**同一帧**依次绘制，原先整帧共用一个 `paint.scope`，导致弹窗打开时场景文字被误归到 `popup:*`。

现在给每个弹窗实例的 `render` 包一层，进入时把 `paint.scope` 切到 `popup:<id>`、退出时还原；每个捕获项带上 `pscope` 标签：

- `paintList(scope)` 按 `pscope` 过滤 → 弹窗作用域只含弹窗自己的元素
- `paintOvr(item)` 用 `item.pscope` 查 override → 同名元素（如 `img:icon_settings` 同时出现在标题页与暂停弹窗）互不串改
- 同名去重与序号计数也按 `pscope` 分桶

弹窗可能由 `openPopup` 也可能被直接 `push` 入栈，所以每帧在 `paintBegin()` 里补包（`__gfSeg` 标记幂等）。

### 17.4 健壮性修复

- **选到不存在的画面会黑屏**（原有缺陷）：`transitionTo` 会把当前场景置为 `undefined`，整个游戏画面变空。现在先校验场景表里有这个 id、`G.popups` 里有这个弹窗，不存在则拒绝并回 `warn`。（场景表字段名各模版不同，见第 18 章）
- 面板侧 `<select>` 在发出请求后立刻回正到当前真实画面，避免切换被拒绝时下拉框显示一个游戏并未处于的画面。

### 17.5 本轮验证

- `vue-tsc --noEmit` 通过；`vite build` 通过。
- Node 侧 smoke（假运行时严格照抄 `core.js` 的 `Scenes` 状态机与 `openPopup` 语义）**20 项全部通过**，覆盖：加载页在列表中 / 加载页文字可编辑 / 加载页整屏背景被过滤 / 启动后可退回加载页 / 从加载页直达结算页且拿到演示数据（胜利 + 3 颗星）/ 场景元素齐全 / 弹窗可直接打开 / 弹窗作用域只含自身元素 / 选回场景即关闭弹窗 / 加载页选弹窗自动落到宿主场景 / 不存在的画面被拒绝且不弄坏当前画面 / 四个画面依次进入都有可编辑元素 / 同名图标跨画面不串改。
- **未做浏览器内真实回归**：真实游戏的画面切换观感、结算页演示数据是否与美术预期一致、各弹窗在非原生宿主场景下是否渲染正常，仍需人工确认。

### 17.6 遗留边界

1. 弹窗若强依赖宿主场景的运行时状态（例如复活弹窗读取当前分数），在编辑器里打开可能显示默认值；`render` 抛错会被核心的 `try/catch` 吞掉，表现为该弹窗元素列表为空。
2. 结算页只提供「胜利」演示数据，失败态的差异部分（星星数、文案）需要真实打一局才能看到。
3. 反复进入结算页会触发其 `init()` 里的 `gameState.coin += …` 与 `saveState()`，会写脏本地存档（仅影响试玩存档，不影响产物）。

---

## 18. 多模版字段适配（第五轮迭代）

### 18.1 问题

用户实测反馈「pro_zhiwu 项目不能从下拉列表中选中所有界面」——下拉里的场景是空的。

根因是第 17 章的实现**把 pro_fly 的字段命名当成了唯一形态**。实际核对 `game-output/aliasy/` 下四个项目的 `core.js`，场景管理器有四套彼此不同的命名：

| 项目 | 场景表 | 当前 id | 当前实例 | 转场状态 | 加载页渲染 | 画布 |
|---|---|---|---|---|---|---|
| pro_fly | `_scenes` | `_currentId` | `_current` | `null` ↔ 对象 | `_renderBoot` | `width × dpr` |
| pro_tafa | `_registry` | `currentId` | `current` | **常驻对象 + `.active`** | `_renderBoot` | `width × dpr` |
| pro_xiaoxiaole | `_scenes` | `current` | `_currentObj` | `null` ↔ 对象 | `_renderLoading` | `width × dpr` |
| pro_zhiwu | `_registry` | `current` | `_currentScene` | `null` ↔ 对象 | `_renderLoading` | **`width`（1:1）** |

pro_zhiwu 用 `_registry`，于是 `Object.keys(G.Scenes._scenes)` 返回 `[]`，画面列表只剩加载页。注意 `current` 这个名字在 pro_tafa 里是**实例**、在 pro_xiaoxiaole / pro_zhiwu 里是 **id**，不能按名字想当然。

### 18.2 适配层

不再硬编码字段名，改为运行时探测一次并缓存（`SA.S === G.Scenes` 失效重探）：

- 场景表：依次试 `_scenes` / `_registry` / `scenes`，取第一个存在且为对象的。
- 当前 id：优先 `_currentId`、`currentId`，都没有才用 `current`。
- 当前实例：依次试 `_current` / `_currentScene` / `_currentObj`；若都没有且 `current` 没被当作 id 用，则 `current` 就是实例。
- 加载页渲染：`_renderBoot` 或 `_renderLoading`，两者都没有就认为该游戏没有独立加载画面（选 `boot` 时回 `warn`）。

`sceneId()` 另有一层兜底：拿当前实例去场景表里反查 key，同时比对 `reg[k] === inst` 与 `reg[k] === Object.getPrototypeOf(inst)`——因为有的模版直接引用注册对象，有的用 `Object.create(scene)` 派生。

### 18.3 转场状态的两种形态

pro_tafa 的 `_transition` 是**常驻对象**，靠 `.active` 标记是否在转场。这让原先的 `!G.Scenes._transition` 判定永远为假，连带两个后果：延迟切换（`wantScene` / `wantPopup`）永不触发，**编辑态的「暂停」也永远不生效**；而原先取消转场写的 `_transition = null` 会让 pro_tafa 自己的 `update` 在读 `this._transition.active` 时抛错。

现在统一走两个函数：

- `inTransition()`：`'active' in t` 就看 `t.active`，否则看对象是否存在。
- `cancelTransition()`：常驻对象形态只置 `active = false`，**绝不置 null**。

### 18.4 画布倍率必须反推

`dpr()` 原先返回 `Math.min(devicePixelRatio, 2)`，但 pro_zhiwu 是 `canvas.width = CONFIG.width` 且没有 `setTransform`，根本不用 dpr。在 2 倍屏上这会让探针采集的坐标错一半，`drawOverlay` 里的 `setTransform(d)` 还会让选框整体偏大偏移。

现在改为从画布实际尺寸反推真实倍率：`canvas.width / CONFIG.width`，取不到才回退 `devicePixelRatio`。这个值表达的是「画布底图像素 ÷ 设计像素」，与屏幕 dpr 无关。

### 18.5 本轮验证

- `vue-tsc --noEmit` 通过；`vite build` 通过。
- Node 侧 smoke 把四种字段形态参数化（场景表/id/实例/加载页函数名、转场是否常驻对象、画布是否 1:1、实例是否直接引用注册对象），每种形态 11 项断言，**44 项全部通过**。除第 17 章的画面切换项外，另有三项专门覆盖本轮缺陷：加载页文字坐标必须是设计像素（验倍率反推）、编辑态暂停必须真的冻结场景 `update`（验常驻转场对象）、拖动写回的坐标必须落在设计像素。
- 过程中有 4 项断言曾失败，定位为**验证脚本的桩失真**而非实现缺陷：叠加层画标签时会改 `textBaseline`，浏览器靠 `ctx.save()/restore()` 隔离，而桩里这两个方法是空实现，污染泄漏到了下一帧的加载页渲染。把桩改成真实的状态栈后全绿。
- **未做浏览器内真实回归**：pro_zhiwu 的下拉列表是否确实出现全部画面、1:1 画布下选框是否与元素严格贴合，仍需在「部署 / 测试 → 布局编辑」里人工确认。

### 18.6 后续新增模版的注意事项

适配层是「按已知命名穷举 + 能力探测」，不是万能的。若将来新模版又换了字段名（例如场景表叫 `_sceneMap`），表现仍是画面列表为空。届时只需在 `sa()` 的候选名数组里补一项，不必改动其它逻辑。更稳妥的长期做法是让代码生成模板统一场景管理器的字段契约。
