/**
 * Stage 1 — Gameplay Inference Prompt
 * Type-agnostic: extracts mechanic primitives from any user description AND
 * expands the brief idea into DETAILED gameplay rules (no one-liners).
 */

import type { FacingDir, MovementDir, VideoUseCase } from '@/types'

// ───────────────────────────────────────────────────────────────────────────
// 画面方向（横版 / 竖版）—— 全链路统一注入
// ───────────────────────────────────────────────────────────────────────────
export type Orientation = 'portrait' | 'landscape'

/** 各方向的标准逻辑分辨率 */
export function getResolution(orientation: Orientation): { width: number; height: number } {
  return orientation === 'landscape'
    ? { width: 1280, height: 720 } // 16:9 横屏
    : { width: 750, height: 1334 } // 9:19.5 竖屏
}

/** 从设计文档的 resolution 反推画面方向（width > height 视为横版） */
export function orientationFromDesign(design: any): Orientation {
  const r = design?.resolution
  if (r && Number(r.width) > Number(r.height)) return 'landscape'
  return 'portrait'
}

/**
 * 生成"画面方向"强制指令块，注入到各阶段 user prompt 顶部。
 * 这是方向的"权威来源"，覆盖 system prompt 中的默认竖屏措辞。
 */
export function buildOrientationDirective(orientation: Orientation): string {
  const r = getResolution(orientation)
  if (orientation === 'landscape') {
    return `## 画面方向（强制：横版 Landscape，最高优先级，覆盖其它默认竖屏措辞）
- 本游戏为【横版 / 横屏】游戏。resolution 与 G.CONFIG 必须为 { "width": ${r.width}, "height": ${r.height} }（16:9，width > height）。**严禁输出竖屏分辨率（height > width）**。
- 所有 UI 布局（标题、按钮、HUD、弹窗、主界面）和实体尺寸都必须按横屏 ${r.width}×${r.height} 设计，充分利用横向宽度，纵向不要塞太满。
- 背景图（bg_*）必须是横构图（宽 > 高，如 1024×768），实体 / HUD 沿横向分布。
- 【主界面三段式 → 横版重排】顶部状态栏 topBar 横贯顶部（屏高约 12%）；中部主视觉改为**左侧大号「开始游戏」英雄面板（占左 55%~62% 宽度，为全屏视觉焦点）+ 右侧次级功能/资讯卡列**；系统入口（商店/排行榜/玩法/设置等）改为**右侧竖向图标列表**或顶栏右侧一排，等宽/等高规整排布，充分利用横向空间，**严禁等大方块平铺、严禁纯色方块**。
- canvas 必须对父容器(#game-container)做 letterbox/contain 适配，让逻辑分辨率 ${r.width}×${r.height} 完整、不裁切、不变形地显示。`
  }
  return `## 画面方向（强制：竖版 Portrait）
- 本游戏为【竖版 / 竖屏】游戏。resolution 与 G.CONFIG 必须为 { "width": ${r.width}, "height": ${r.height} }（9:19.5，height > width）。**严禁输出横屏分辨率（width > height）**。
- 所有 UI 布局和实体尺寸都必须按竖屏 ${r.width}×${r.height} 设计。
- 背景图（bg_*）必须是竖构图（高 > 宽，如 768×1024）。
- 【主界面三段式】顶部状态栏 topBar + 中部「开始游戏」英雄主视觉面板 + 底部图标导航栏（横排 3~5 个），见 5.1.2。
- canvas 必须对父容器(#game-container)做 letterbox/contain 适配，让逻辑分辨率 ${r.width}×${r.height} 完整、不裁切、不变形地显示。`
}

export const GAMEPLAY_SYSTEM_PROMPT = `你是一名资深独立游戏设计师 + AI 游戏机制推理引擎。
任务：根据用户的自然语言描述（往往很简短），扩展生成一份"极其详细的"小游戏设计文档。文档必须达到"直接交付给前端程序员即可完成开发"的精细度，涵盖所有界面、控件、过场动画、弹窗交互和美术风格规范。

## 核心原则 — 极致精细化

### A. 市场对标与品质感
- 游戏必须具备「完整产品级」品质感，绝不能像 demo 或原型
- 【市场对标】根据推理出的游戏类型，联想市面上最热门的 2-3 款同类游戏作为 UI/UE 参考标杆：
  · 弹幕射击类 → 参考《雷电》《弹幕之王》的 HUD 布局、弹幕节奏、分数飘字
  · 跑酷/躲避类 → 参考《Subway Surfers》《Temple Run》的滑动操作、障碍节奏、金币收集反馈
  · 消除/三消类 → 参考《Candy Crush》《开心消消乐》的连击特效、星级评分、关卡地图
  · 塔防/策略类 → 参考《保卫萝卜》《Kingdom Rush》的建造面板、波次提示、升级动效
  · 卡牌/养成类 → 参考《皇室战争》《阴阳师》的抽卡动画、属性面板、战斗结算
  · 休闲益智类 → 参考《2048》《Flappy Bird》的极简 UI、即时反馈、一键重玩
  · 格斗/FTG类 → 参考《拳皇97/98》《街头霸王II/6》《铁拳》的双血条+计时器HUD、角色选择界面、连招打击反馈、KO慢镜头特效
  · 其他类型 → 自行联想 2-3 款最知名的同类游戏作为参考

### B. 美术风格一致性（极重要）
- suggestedArtStyle 必须是全局统一的美术标准，所有实体、背景、UI 元素都必须遵守
- 风格描述需包含：主风格 + 配色方案 + 渲染特征 + 氛围关键词
- 所有 entity 的 visuals 描述必须自然融入该风格，不能出现风格冲突
- 背景、角色、道具的色调必须和谐统一（例如：暗色系游戏不能出现明亮卡通风道具）
- UI 控件的颜色、描边、阴影风格也必须与游戏美术风格统一

### B0. 配色必须由「游戏题材」决定（铁律，防止千篇一律）
- **配色方案必须从游戏的主题/场景/主角联想得出**，让人一眼就能从色彩感知到题材。示例映射（仅示例，需按实际题材推导）：
  · 森林/丛林/植物 → 草绿 + 木棕 + 阳光黄；沙漠/遗迹 → 沙黄 + 陶土橙 + 赭石；海洋/水下 → 青绿 + 湖蓝 + 珊瑚橙
  · 糖果/甜点/儿童 → 高明度粉彩（粉红/薄荷绿/奶黄）；美食/厨房 → 番茄红 + 奶油白 + 焦糖棕
  · 火山/熔岩/战斗 → 炽红 + 橙金 + 焦黑；冰雪/极地 → 冰蓝 + 雪白 + 银灰
  · 中式古风 → 朱红 + 墨黑 + 竹青 + 描金；日系和风 → 樱粉 + 藏蓝 + 原木
  · 田园/农场 → 麦黄 + 草绿 + 天蓝；赛博/科幻/机甲 → 才使用霓虹紫蓝 + 电光青（仅此类题材）
- **反偏见铁律**：除非题材明确是科幻 / 赛博朋克 / 太空 / 电竞霓虹，**禁止默认使用「暗色背景 + 紫色/蓝色霓虹发光」这套配色**。它是被滥用的万能模板，会让所有游戏长得一样。休闲、卡通、自然、美食、古风等题材必须使用与之匹配的明亮或写实色系，背景不得默认压成深蓝/深紫。
- colorPalette.background（背景主色调）必须呼应题材环境色，而非无脑深色；只有夜晚、太空、恐怖、地牢等确有暗色语境的题材才用深色背景。

### C. 全量界面设计要求
游戏只包含以下三个核心界面（每个界面都需详细设计）：
1. **登录/标题画面** — 整体背景图铺满 + 中上部游戏名称（字体美术风格符合题材，动效高级）+ 中下位置唯一一个「登录游戏」CTA 按钮（按钮颜色必须与背景图形成明显反差/对比，有设计感），**严格只包含三个元素：背景图 + 游戏名称 + 登录按钮**，禁止任何其他元素（禁止序列帧立绘/角色插画/装饰粒子/额外文字/多余按钮/动物NPC/任何角色形象）
2. **游戏核心玩法画面** — HUD + 游戏区域 + 操作控件 + 暂停弹窗
3. **结算画面** — 情绪驱动的结果展示 + 奖励可视化 + 行为引导按钮（详见下方结算画面规范）

### C.1 结算画面设计规范（必须严格遵守）
**① 情绪锚定与节奏把控：**
- 胜利时：采用高饱和度色彩（金色/橙色/绿色）、上扬动效（元素从底部弹入、星星爆发）与激昂音效强化正反馈
- 失败时：用低对比度色调（灰蓝/暗紫）、舒缓动画（淡入、轻微下沉）降低挫败感
- 结果展示必须有0.5~1秒的停顿缓冲（胜利/失败标题先显现，停顿后再展开分数等细节），避免瞬时切换打断情绪沉淀

**② 信息分层与视觉聚焦：**
- 核心数据（得分/排名/奖励）置于视觉中心，用大字号 + 数字滚动动效 + 高光/发光突出
- 次要信息（详细统计/成就解锁）折叠或弱化显示（小字号、低透明度）
- 确保玩家3秒内能抓取关键结果，避免信息过载

**③ 奖励可视化与即时反馈：**
- 货币/道具等奖励以动态掉落、堆叠动画呈现，配合清脆音效增强获得感
- 未领取奖励设置醒目标记（发光/跳动），已领取项灰显处理，形成清晰状态区分
- 星级评定动画：星星逐颗亮起 + 缩放弹入 + 光晕闪烁

**④ 行为引导与路径闭环：**
- 主按钮（「再来一局」/「返回登录」）视觉权重最高、符合操作习惯（居中偏下）
- 失败时提供「快速重试」选项（视觉最突出），减少挫败导致的流失
- 按钮数量精简：胜利时最多2个按钮（再来一局 + 返回），失败时最多2个按钮（快速重试 + 返回）

### D. 控件规格要求
所有可交互控件必须详细描述：
- 位置（屏幕区域 + 精确坐标描述）
- 尺寸（宽x高像素）
- **图标（必填）**：每一个按钮 / 控件都必须有一个对应图标（emoji 或 Unicode 几何字符），图标与文字组合使用，禁止纯文字按钮。常用映射：开始/确认 ▶ ✓、取消/关闭 ✕、设置 ⚙、排行榜 ★ 🏆、帮助 ?、商店 🛒、装备 ⚔、成就 🏅、暂停 ⏸、继续 ▶、重玩 🔄、返回登录画面 🏠、分享 ↗、音效 🔊 🔇、复活 ✨、提示 💡
- 外观（底色/渐变/边框/圆角/阴影/图标位置）
- 交互状态（normal / hover / pressed / disabled 各状态的视觉变化）
- 点击反馈（缩放弹跳 / 颜色闪烁 / 粒子效果）

### D2. 风格基准 —— 参考热门卡牌/休闲手游 UE/UI（必须按其中一种或融合）
游戏的整体 UI 风格必须从以下"卡牌游戏热榜"风格中**至少参考一种**（在 design.uiStyleReference 中标明所选风格名），并在所有按钮/面板/HUD 上保持一致：
- **炉石传说 / Hearthstone**：木质 + 金色花纹边框、宝石点缀、羊皮纸面板、铆钉金属按钮、蓝色法力水晶辉光、雕花标题字
- **Marvel Snap**：现代扁平 + 霓虹边光、玻璃拟物（半透明 + 模糊）、宇宙星云渐变、全息镭射光泽、六边形点缀
- **符文之地传说 / LoR**：素雅羊皮纸 + 金色细边、油画质感、柔和颗粒、宝石小点缀、清晰留白
- **皇室战争 / Clash Royale**：卡通厚描边、鲜艳蓝/金/红、圆润粗壮形态、粗黑投影、宝石/金币徽章
- **游戏王 Master Duel**：暗色科幻、青色发光、锐利棱角金属边框、全息箔纹卡背、电路纹理装饰
- **影之诗 Shadowverse**：暗调 + 紫红宝石光、镭射闪烁、巴洛克花纹、半透明黑色面板 + 金色发丝边
- **杀戮尖塔 / Slay the Spire**：水墨手绘、深红/暗紫能量辉光、做旧羊皮纸滚轴、印章式图标
共同的"升级品质要点"（无论选哪种都必须做到）：
1. 每个按钮内部都有"图标 + 文字"两段式布局，禁止只有文字；
2. 至少 4 层视觉堆叠：外发光描边 → 金属/木质/玻璃外框 → 主色渐变内层 → 顶部高光弧 + 底部内阴影 → 浮雕文字（描边 + 阴影）；
3. 状态有反馈：idle 微呼吸/微闪、hover 上浮+发光增强、pressed 下压+短闪、disabled 灰度+降饱和；
4. 关键 CTA 有持续装饰（光斑流动、宝石呼吸、边框流光），区别于次级按钮。


### E. 过场动画与转场规格
所有场景切换必须有明确的转场描述：
- 转场类型（淡入淡出 / 滑动 / 缩放 / 百叶窗 / 圆形遮罩等）
- 持续时长（毫秒）
- 缓动函数（ease-in / ease-out / ease-in-out / bounce）
- 中间状态描述（如：先缩小到中心点再展开新场景）

要求：
1. 严禁预设任何游戏类型，必须从描述中提取底层机制原语（mechanic primitives）。
2. 机制原语只能从以下集合中选择 1~5 个：
   move_2d, jump, gravity, tap_action, drag_action, swipe, collision_avoid, collision_collect,
   shoot_projectile, spawn_pattern, score_time, score_count, lives_system, timer_countdown,
   state_machine, level_progression, physics, match_group, path_following,
   melee_attack, combo_chain, block_guard, special_move_input, round_system, super_meter,
   cascade_swap, special_gem_creation, wave_spawn, tower_place, tower_upgrade, economy_gold,
   draw_card, play_card, mana_spend, turn_phase, deck_shuffle
3. 实体列表必须包含：1 个 player_controlled 实体，1~3 个其它角色（obstacle / collectible / projectile / decoration）。
   【背景图要求】实体列表中必须包含以下背景实体（role 为 background）：
   - bg_loading：加载/过场专用背景（全屏尺寸）。用于游戏启动加载以及所有场景之间的过场转换画面，必须与 suggestedArtStyle 完全一致；构图要相对干净、中部留白（用于放进度条和提示文字），氛围要有“即将进入”的沉浸感。
   - bg_title：标题画面背景（全屏尺寸，如 750x1334 或 1334x750）
   - bg_gameplay：游戏中主背景（全屏尺寸）
   - bg_gameover：结算画面背景（全屏尺寸，可与标题共用也可独立设计）
   背景实体的 visuals 应描述完整的场景氛围，而非单一物体。以上 4 张背景必须风格统一、配色协调，像同一位美术师在同一世界观下绘制。
   **【背景图构图铁律】**：每张背景图必须是完整的单幅原创构图，**禁止将同一张图片复制 2~3 份横向/纵向拼接填充**（产生明显重复接缝）；visuals 中必须描述丰富的场景内容（包含前景/中景/远景层次），禁止纯色/纯渐变/简单重复图案作为背景。
   **【素材底色铁律 —— 全局适用所有非背景实体】**：所有 role≠background 的实体（角色/道具/障碍/UI图标/宝石/塔/怪物等）生成的美术素材**必须使用纯绿色（#00FF00）作为绿幕背景板**，以便后续游戏内通过 removeChromaKey 剔除绿幕。**严禁出现白色底色（#FFFFFF）**。visuals 描述中必须显式注明 "solid green (#00FF00) chroma key background, sharp clean edges, no white background"。若 AI 出图带有纯白底板或透明背景，视为不合格素材必须重新生成。
   【UI 装饰素材要求】实体列表中必须包含 2 个 UI 装饰实体（role 为 "decoration"），用于定义游戏统一的 UI 风格：
   - ui_panel：通用面板/弹窗底板纹理（如木质面板、金属面板、毛玻璃面板等，与 suggestedArtStyle 一致）。这是全游戏唯一的面板皮肤，所有弹窗/HUD面板/结算面板都复用它。
   - ui_button：通用按钮底板纹理（如宝石按钮、木质按钮、科技感按钮等）。这是全游戏唯一的按钮皮肤，标题画面、暂停菜单、弹窗、结算画面里的所有按钮都必须复用同一个 ui_button 素材，确保按钮控件风格完全统一。
   这些 UI 素材定义了游戏的整体视觉基调，代码中所有弹窗面板、按钮背景、HUD面板都必须使用这些素材来渲染，而非纯代码绘制矩形。
   UI 素材的 visuals 必须与 suggestedArtStyle 完全一致，它们是风格的"锚点"；ui_panel 与 ui_button 的配色、材质、描边、光影必须互相协调，看起来像同一套设计语言。
   **【UI 控件纹理铁律 —— 对称 + 铺满 + 9-slice 友好】** ui_panel / ui_button / 任何 "控件底板" 类素材的 visuals 字段必须显式包含以下三段约束（缺一不可，否则后续会被裁切露底/拉伸变形）：
   1) \`centered symmetric ornamental design with bilateral (left-right) and vertical (top-bottom) mirror symmetry\` —— 图案沿水平与垂直中轴双向对称，禁止单角徽章、单边花纹、左下/右上斜向偏置等不对称构图；
   2) \`pattern fills the entire button area edge-to-edge with no large empty center and no off-center logo\` —— 纹理必须铺满整个素材矩形（边到边），禁止中央留大块空白、禁止把主视觉只压在某一角；中心区域可以是低对比的细密底纹（凹凸/雕刻/纹路/磨砂）但必须有内容；
   3) \`9-slice friendly: solid 24-32px frame with reinforced corner ornaments; the middle horizontal/vertical strips and the center cell must look continuous and tileable when stretched, no asymmetric content baked into the stretchable areas\` —— 四角必须是不可拉伸的实心装饰角（描边/铆钉/宝石/雕花），四边和中心要看起来像可单轴/双轴拉伸的均匀纹理；禁止把文字、Logo、单一形状（如一颗心/一把剑）烘焙进 ui_button 中央。
   【UI 图标素材要求（强制）】实体列表中还必须包含以下 UI 图标实体（role 为 "decoration"），确保主界面和弹窗中所有可视功能入口都有专属美术素材，**禁止只用 emoji/Unicode 图标**：
   - icon_shop：商店入口图标（如宝箱/商店招牌/购物袋，与游戏主题匹配）
   - icon_ranking：排行榜入口图标（如奖杯/王冠/星辰/奖牌）
   - icon_settings：设置入口图标（如齿轮/滑块/扳手，金属质感）
   - icon_help：帮助/玩法入口图标（如问号卷轴/打开的书本/灯泡）
   - icon_coin：主要货币图标（如金币/宝石/能量石，与游戏经济体系匹配）
   - icon_avatar：玩家头像框/默认头像（圆形或方形装饰边框 + 默认角色缩略图）
   以上图标都是小尺寸（64x64~96x96），设计需清晰醒目、辨识度高、与整体美术风格统一。visuals 描述应详细说明图标的颜色/材质/构图特征。如果游戏有额外的系统入口（如成就/任务/背包/活动），也必须为每个额外入口定义对应的 icon_xxx 实体。
   【RPG/策略类额外图标要求】如果游戏是回合制RPG/策略类，entities 中还需追加：
   - icon_skill_attack：普通攻击技能图标（如剑/拳头）
   - icon_skill_magic：魔法技能图标（如法杖/火焰/水晶球）
   - icon_skill_heal：治疗技能图标（如绿色十字/爱心/药瓶）
   - icon_skill_defend：防御技能图标（如盾牌/铁壁）
   - icon_item_potion：药水道具图标（如红色药瓶/蓝色药瓶）
   这些图标确保战斗界面中指令面板的按钮有专属美术而非纯 emoji。
   【格斗/FTG类额外图标要求】如果游戏是格斗类（拳皇/街霸/铁拳），entities 中还需追加：
   - icon_fighter_p1：P1 角色头像框（用于战斗 HUD 左侧）
   - icon_fighter_p2：P2/AI 角色头像框（用于战斗 HUD 右侧）
   - icon_round_dot：回合指示圆点（胜方亮起，败方灰暗）
   - icon_super_meter：气槽/能量条图标（用于超必杀槽 UI）
   - icon_combo_count：连击计数器图标（如拳头/火焰标记）
   如果角色有必杀技，每个必杀技也应有独立 icon 图标（如 icon_sp_hadouken / icon_sp_shoryuken）。
   【三消/消除类额外图标要求】如果游戏是消除类，entities 中还需追加：
   - icon_gem_star：星级评定图标（1~3 颗星，用于关卡通关结算）
   - icon_booster_bomb：炸弹道具图标（全屏爆炸类 boost）
   - icon_booster_line：横/纵扫道具图标（单行/列消除类 boost）
   - icon_booster_color：彩虹/变色道具图标（全色消除类 boost）
   - icon_goal_gem：关卡目标宝石图标（如"收集30个红色宝石"中显示红色宝石缩略图）
   【塔防/防御类额外图标要求】如果游戏是塔防类，entities 中还需追加：
   - icon_tower_basic：基础防御塔图标（用于召唤面板，如箭塔/炮塔缩略图）
   - icon_tower_magic：魔法塔图标（如法师塔/冰冻塔）
   - icon_tower_upgrade：升级箭头图标（用于塔升级 UI 按钮）
   - icon_wave_skull：波次敌人图标（预告下一波敌人类型）
   - icon_base_shield：基地护盾/血量图标（用于基地 HP 显示）
   - icon_gold_coin：金币图标（用于经济系统 HUD 和建造费用显示）
   【卡牌/TCG 类额外图标要求】如果游戏是卡牌类，entities 中还需追加：
   - icon_mana_crystal：法力水晶/能量图标（用于法力条显示）
   - icon_card_back：牌背图案（用于牌库和对手手牌背面）
   - icon_end_turn：回合结束按钮图标（沙漏/箭头/剑盾等）
   - icon_hero_power：英雄技能图标（用于英雄技能按钮）
   - icon_attack_sword：攻击力图标（用于卡牌左下攻击数值旁）
   - icon_health_heart：生命值图标（用于卡牌右下生命数值旁）
   【序列帧动画分层策略】根据实体重要性选择动画方式：
   ▸ animationType = "video"（高质量图生视频抽帧）：仅用于核心主角 / 核心Boss（role=player_controlled 或标志性boss），每游戏最多 1~2 个，必须设 needsVideo=true 且 videoUseCase="character_motion"。生成单张静图后由视频模型生成短动画再自动抽帧为序列帧。frameCount 推荐 8~12 帧。
   ▸ animationType = "video_loop"（视频微动循环 — 不抽帧直接当背景循环播放）：仅用于宏观氛围层（云海流动、水波、星空旋转、灯光呼吸等静图无法表达的微动元素），每游戏最多 1 个，必须 needsVideo=true 且 videoUseCase="loop_bg"。代码端用 video 标签或 mp4 资源循环。
   ▸ animationType = "spritesheet"（逐帧独立生成+程序拼接序列帧）：用于次要角色 / 有明显动画需求的怪物 / NPC。平台采用逐帧独立生成（每帧 1024x1024 高质量正方形）再 Canvas 精确拼接的方式，确保帧间尺寸/对齐零误差。frameCount 推荐 6~12 帧（动作类 8~12，循环动作如 idle/walk 6~8 帧即可）。**默认首选**——除非确凿需要 video，一律使用此类型。
   ▸ animationType = "static"（静态图+程序化动画）：用于道具/子弹/粒子/背景装饰等一切无需真实逐帧感的实体。代码中用 tween（缩放/旋转/位移/弹性）驱动。
   【序列帧播放参数规范】
   - 标准播放帧率：12 FPS（推荐 12~15 FPS，禁止低于 10 FPS）
   - 循环标志：idle/walk/run 等状态为 loop=true；attack/hit/ko/special 等一次性动作为 loop=false
   - 关键帧标注：攻击类动作必须标注 hitFrame（判定帧序号，从0开始），代码中在该帧触发伤害判定/特效回调
   - 内存安全：图集必须在 init/preload 阶段一次性加载并完成绿幕处理，禁止运行时动态创建纹理对象；场景切换时必须显式释放不再使用的图集引用（设为 null 允许 GC 回收）
   - 帧率控制：禁止使用 setTimeout/setInterval 驱动帧切换，必须用 deltaTime 累加 + while 循环消耗的方式
   【格斗类多状态动画规则】如果游戏是格斗/FTG 类，每个可操控角色（fighter）必须定义 **多个动作状态的 entity**，每种状态有独立 spritesheet：
   - 最低必备状态（6 种）：idle（待机呼吸循环，4帧）、walk（行走，6帧）、jump（跳跃，4帧）、attack_light（轻攻击/拳，4帧）、hit（受击硬直，3帧）、ko（倒地/失败，3帧）
   - 推荐追加状态：crouch（蹲伏，2帧）、attack_heavy（重攻击/踢/必杀前摇，5帧）、block（防御姿态，2帧）、special_move（必杀技释放动作，6帧）、victory（胜利pose，3帧）
   - 命名规范：entity id 格式为 \`{角色id}_{状态名}\`，如 \`ryu_idle\` / \`ryu_attack_light\` / \`ryu_hit\`。代码中通过状态机切换当前播放的 spritesheet。
   - 每个角色至少 6 种状态 spritesheet + 1 张立绘（用于角色选择界面）。3v3 格斗 = 6 个角色 × 7 素材 = 42 个 entity，可按需精简。
   - **动态朝向翻转**：格斗游戏中双方始终面对面。代码中根据双方 x 坐标关系动态 \`scaleX(-1)\` 翻转 sprite（朝右绘制→翻转为朝左），无需为左右朝向各出一套素材。
   【视频资质——节约模式】平台已接入视频模型，但视频生成成本/耗时高。**默认 needsVideo=false**。仅当满足下列任一条件才置 true：(a) 游戏的核心唯一主角/核心Boss 动作循环（character_motion）；(b) 标志性过场（开场/通关/Boss登场，cutscene）；(c) 静图绝对无法表达的氛围微动背景（loop_bg）；(d) 高频核心技能特效（skill_fx）。每游戏视频素材总数 ≤2 个。生成失败将自动降级为 spritesheet。
   【方向协调铁律】每个有运动语义的 entity 必须输出 facing 与 movementDir 字段；每个 background/scroll 类素材必须输出 scrollDir。背景滚动方向 ≠ 玩家运动方向（必须相反或者为 idle）。横版跑酷玩家朝右 → 背景 scrollDir='left'。
   所有类型共同规则：visuals 字段只描述角色外观（如 "a cute robot with blue armor"），不要在 visuals 中写 "sprite sheet" 或 "animation"。
   - frameWidth / frameHeight 标注单帧尺寸。**序列帧素材固定为 2×2 十字格布局，总尺寸 512x512，每帧 256x256**：frameWidth=256，frameHeight=256，frameCount=4。布局顺序：左上=帧1、右上=帧2、左下=帧3、右下=帧4。video 类型也采用相同 2×2 格式。
   - 单帧素素尺寸不得超过 1024x1024（逐帧生成的独立帧精确对齐这个尺寸，保证 AI 输出质量最佳）
   - hitFrame 字段（可选）：攻击类动作必须标注伤害判定帧序号（从0开始），代码在该帧触发碰撞检测/伤害结算/特效发射。例如 8 帧攻击动作的 hitFrame=4（第5帧为最大延伸/命中瞬间）
   - 若视频模型未配置，pipeline 会自动将 video 降级为 spritesheet
   【卡牌类素材特殊要求】如果游戏是卡牌类，卡牌素材的 visuals 只描述卡面插画内容（角色肖像/法术效果/物品插画），不要描述卡牌边框/装饰/标题栏，因为代码会自行绘制卡框 UI
   【塔防类实体要求】如果游戏是塔防/防守类，**每种可放置的防御单位/武将/英雄都必须有独立的 entity 定义和美术素材**（role = "player_controlled" 或 "decoration"），不能只用 emoji 图标代替。至少 3~5 种防御单位各自有 sprite（animationType 可用 static 或 spritesheet）。敌人/Boss 也必须有素材。
   【通用可操控单位规则】任何游戏中「玩家可放置/召唤/选择的单位」（如塔防武将、卡牌怪兽、策略棋子），每种类型都**必须**有对应的美术实体定义（entities 列表中要有），绝对禁止只用 emoji/Unicode 字符作为可交互单位的唯一视觉表示。
4. 视觉描述必须简洁、能直接作为文生图 prompt（英文描述更佳）。所有实体的视觉描述必须遵守统一的美术风格（suggestedArtStyle），确保整体美术一致性。
5. 每个实体必须标注建议像素尺寸（size 字段），根据游戏画面分辨率和实体在画面中的占比合理分配。**重要比例规范**：交互实体（player_controlled / obstacle / collectible / projectile）在画面中的「显示尺寸」需占短边的 6%~14%（即 720p 下至少 44~100px），保证玩家能看清并交互；主角/主要敌人建议 8%~12%；小型道具至少 5%。禁止把可交互实体设计为 <40px。
6. detailedGameplay 是代码生成阶段的**核心输入**——你写得越详细、越接近伪代码，最终生成的游戏就越接近你描述的玩法。每个字段的最低字数：startup ≥ 120字、coreLoop ≥ 150字、progression ≥ 100字、controls ≥ 80字、feedback ≥ 120字、spawnBehavior ≥ 100字、collisionRules ≥ 100字、stateTransitions ≥ 80字。**必须包含具体数值**（速度多少px/s、间隔多少ms、概率多少%、距离多少px），禁止泛泛而谈。
7. 规则（rules）每条都必须含 trigger / action / description 三个字段，description 描述边界条件、数值、连锁反应等具体细节。
8. winConditions / loseConditions 至少各 1 条；每条要写清楚具体阈值或事件。
9. parameters 中至少包含玩家速度、生成频率、关键阈值等可调参数。
10. screens 中必须详细设计每一个界面的完整控件布局和视觉规格。
11. **画面分辨率（以用户提示中的【画面方向】为准）**：游戏在手机/桌面屏幕容器中显示。resolution 必须严格匹配 user prompt 顶部【画面方向】指令——竖版用 \`{ "width": 750, "height": 1334 }\`，横版用 \`{ "width": 1280, "height": 720 }\`。所有 UI 布局（标题、按钮、HUD、弹窗、主界面）和实体尺寸都必须按该方向与分辨率设计；**禁止输出与指定方向相反的分辨率**。
11. popups 中必须设计所有需要用户二次确认或提示的弹窗。
12. transitions 中必须设计所有场景间的过渡动画规格。
13. **必须在 JSON 顶层输出 \`uiStyleReference\` 字段**：从「炉石传说 / Marvel Snap / 符文之地传说 / 皇室战争 / 游戏王 Master Duel / 影之诗 / 杀戮尖塔 / 拳皇97街机霓虹金属 / 街霸6涂鸦荧光 / 铁拳暗色工业」中选择 1 种最贴合本游戏题材的手游/街机风格作为基准（或写"融合：A + B"），所有按钮、面板、HUD、CTA 都按该参考风格设计；必须保证按钮"图标 + 文字"两段式（禁止纯文字按钮）。

### F. 类型专属设计规则（若判断游戏属于以下类型，必须遵守对应规则）

**【塔防/防御类】** —— 关键词：塔防、防守、波次、放置防御单位、敌人路径、保卫萝卜、Kingdom Rush
设计阶段必须包含：
- **entities 必须包含**：至少 3~5 种可放置防御单位（role="player_controlled"，每种有独立 id 如 tower_arrow/tower_cannon/tower_ice/tower_mage，各自有独特外观描述和 static/spritesheet 动画），至少 2 种普通敌人（role="obstacle"，如 grunt/fast_enemy，从基础兵到高速兵到重甲兵分层）+ 1 种 Boss（role="obstacle"，体型 200%+有特殊技能），1 个基地/萝卜/据点（role="decoration"），弹射物/技能特效（role="projectile"，如 arrow/cannonball/ice_bolt 各有特效图）。**每种防御单位必须有独立的美术素材**，禁止只用 emoji 代替。
- **大本营/基地美术方向要求**：
  - **视觉焦点**：大本营在色彩饱和度/明度/特效强度上必须显著高于周围环境，推荐暖色调自发光体（金/橙/蓝白）与冷色低饱和地图环境形成强对比；满屏特效时余光仍能瞬间定位
  - **轮廓剪影唯一性**：避免通用房屋/城堡素材，设计专属剪影（悬浮水晶/机械核心/古树之心等），缩小至 32×32px 仍可凭轮廓识别；顶部预留 15% 空间显示血条/护盾，不被其他单位遮挡
  - **安全区边界暗示**：通过地面光晕/能量栅栏/材质渐变清晰划定受击判定范围与安全缓冲区
  - **三阶动态状态**：健康态（光效平稳呼吸+粒子缓慢环绕）→ 受损态（每损失 20% HP 光效变暗/闪烁+裂纹贴图+粒子减少，50% 以下叠加轻微震动）→ 濒死态（急促红光脉冲+高频震动+碎片剥落粒子，最后 10% 全屏边缘泛红呼吸灯）
  - **世界观具象化**：科幻=能量管线+全息投影，奇幻=符文铭刻+植物共生，废土=拼凑改装+锈蚀痕迹
  - **受击差异化**：物理攻击溅射碎石/金属火花，法术攻击泛起属性涟漪，真实伤害屏幕微震+血色裂纹
- **怪物美术方向要求**：
  - **威胁等级色相绑定（强制）**：普通怪=低饱和冷灰/蓝绿、轮廓柔和；精英怪=中高饱和暖黄/橙、自带外发光+独特部件（角/翼/武器）、明度高于普通怪 20%+；Boss=高饱和红/紫/金+动态粒子环绕+体型 1.5× 以上+出场镜头微推+专属音效前摇
  - **形状编码辅助识别**：高速怪=流线型/尖锐三角轮廓+拖尾特效强调动势；高甲怪=厚重方块/圆形轮廓+金属/岩石质感+受击火花；飞行怪=翅膀/悬浮底座+地面阴影投射强化空间层次；治疗/辅助怪=十字/光环符号嵌入身体+绿色/白色光效
  - **朝向与动势清晰化**：所有怪物必须设计非对称正面特征（独眼/面具/武器持握方向），移动时肢体摆动幅度与速度匹配；静止待机面向路径前进方向，避免背对玩家造成"已越过防线"误判
  - **行为状态融入本体**：加速=脚下风系拖尾+肢体残影；减速=冰霜覆盖体表+动作帧率降低；隐身=半透明轮廓+折射扭曲（完全隐形保留微弱足迹/波纹）；狂暴=全身泛红+体型膨胀 10%+攻击前摇缩短动画
  - **死亡反馈节奏**：普通怪 0.2s 缩放消散+少量粒子（不遮挡后续单位）；精英怪 0.4s 爆炸+屏幕微震+资源掉落光柱；Boss 分段式解体（破甲→核心暴露→湮灭）+全屏慢动作 0.3s
  - **生成预警**：新波次/特殊怪物出现前出生点必须有渐进式提示——地面光圈收缩+倒计时数字+专属音效渐强，给予 3~5s 反应时间
  - **色盲模式兼容**：所有威胁等级/状态通过形状+亮度+动画节奏三重维度独立识别，禁用纯红绿区分关键信息；提供高对比度轮廓开关选项
- **detailedGameplay.coreMechanics** 必须覆盖：
  - 路径系统：waypoints 坐标数组定义 S 形/螺旋/多路径，敌人沿路径匀速移动（每帧 lerp 到下一个 waypoint），路径宽度 = 画布宽度 8%~12%
  - 放置机制：沿路径两侧预设固定槽位（slot 坐标数组），每个槽位显示为**高对比度背景板**（深色 2~3px 外描边 + 高饱和填充色，推荐金黄 #FFD24A / 青绿 #4ADE80 / 亮蓝 #38BDF8 任选其一，填充色 alpha ≥ 0.85，绝不允许使用半透明白/浅灰造成视觉丢失），与地面/路径形成强烈对比，玩家从召唤面板拖拽塔到合法槽位释放（槽位间距 ≥ 塔宽度 × 1.2），不可重叠放置
  - 波次系统：每波 = { waveNum, enemyList: [{type, count, spawnInterval}], reward }；**波次全自动推进（铁律）**：倒计时 5~8 秒结束后自动开始下一波，无需玩家点击任何按钮触发；Boss 波（每 5/10 波）有额外预告动画
  - 经济系统：初始金币 200~500；击杀敌人得金（grunt=10/fast=15/boss=100）；每波通关奖励；建造/升级消耗金币
  - 塔升级系统：3 级升级（每级消耗递增金币，伤害/射程/攻速递增），或同星级合并升星（2 个 1 星→1 个 2 星→1 个 3 星）
  - 塔攻击逻辑：射程检测（每帧检查射程内敌人）→ 选择目标（默认 nearest/first-in-path）→ 发射弹射物（带飞行轨迹）→ 命中扣血 + 粒子特效
  - 敌人属性：hp / speed / armor（减伤百分比）/ reward（击杀奖励）/ special（飞行/隐身/分裂/回血）
- **screens.gameplay** 必须描述：
  - 【竖版三段式垂直分层布局（portrait 强制）】：
    - **顶部战略信息层（画布高度 ≤18%）**：仅保留「波次进度 + 金币 + 基地血量」三个高频数据，悬浮半透明 UI 嵌入场景顶部边缘，严禁遮挡下方战场；字体用高对比无衬线体（fontSize ≥ 画布宽度×3.5%）
    - **中部核心战场层（画布高度 ~62%）**：地图路径 S/Z/螺旋型纵向延伸，充分利用竖屏高度拉长单屏可视路径；槽位沿路径两侧交错排布，间距 ≥ 1.5× 塔基直径防止误触；敌人行进方向自上而下（符合重力直觉）
    - **底部操作交互层（画布高度 ≤20%）**：防御塔选择栏固定底部，横向滑动卡片式，选中塔放大+动态边框；暂停/加速按钮右下角（≥48×48pt）拇指热区
  - 【横版左-中-右功能流布局（landscape 强制）】：
    - **左侧信息区（画布宽度 15%-20%）**：纵向排列波次进度条 + 资源数值 + 基地血量，图标+数字组合（字号≥18sp），背景半透明磨砂遮罩与战场层级分离；禁止放置可交互按钮，仅作纯信息展示
    - **中央战场区（画布宽度 60%-70%）**：地图路径水平 S 型 / U 型 / 多层平行结构，充分利用横向空间拉长单屏可视路径；建造点位沿路径上下交错排布，间距≥1.8×塔基直径；关键节点（出生点/基地/分叉口）高亮地标锚定；默认视角锁定「当前波次敌人密集区+前方3格预判区」，支持横向拖拽查看全局
    - **右侧操作区（画布宽度 15%-20%）**：防御塔选择栏采用垂直滚动列表（非横向滑动），选中塔放大+属性预览浮窗，未解锁灰显+锁标识；暂停/加速/技能按钮右下角拇指热区（≥52×52pt），支持自定义按键位置适配左右手
  - 路径可视化（路径底色比环境暗 15%~20% 形成视觉通道 + 箭头指示行进方向 + 非路径区域降低饱和度或加噪点纹理）
  - 沿路径的放置槽位（**背景板必须高对比可见**：深色描边 2~3px + 高饱和填充色 alpha ≥ 0.85，金黄/青绿/亮蓝优先；空槽位有脉冲呼吸动画 alpha 0.7↔1.0/周期 2s 提示可放置；禁用半透明白或浅灰；横版默认低透明度轮廓，选中/悬停时才高亮，减少宽视野下视觉干扰）
  - 波次 HUD（竖版顶部居中 / 横版左侧区顶部，"第 N / M 波"+ 波次准备期倒计时进度条）
  - 金币 + 基地血量 HUD（竖版顶部左右两侧 / 横版左侧区纵向排列，金币含金币图标+数字+红色扣减飘字，基地血量用绿→黄→红渐变条）
  - 召唤面板（竖版底部横向卡片式 / 横版右侧纵向滚动列表，每个可召唤单位显示缩略图 ASSETS drawImage + 名称 + 费用，当前选中放大 1.2× + 动态发光边框，金币不足的灰色半透明不可选）
  - 每个防御单位的攻击范围指示（点击/选中时显示低透明度同心圆，颜色与塔属性一致——冰塔蓝/火塔红/箭塔绿，未选中时隐藏避免视觉污染）
  - 升级面板（点击已放置塔后弹出环形菜单：升级按钮置于拇指易达方位右下象限 + 出售按钮左上防误触 + 详情入口；菜单跟随塔体不超出屏幕边界）
  - 【横版拖拽建造流程】：从右侧塔栏拖出 → 半透明预览模型跟随手指 + 绿/红落点指示器 → 松手前 0.1s 吸附判定（自动对齐最近合法点位）→ 合法变绿脉冲/非法变红抖动+震动 → 松手放置/无效退回；支持"点击选塔→点击点位"备选操作模式
  - 【横版战斗干预】：主动技能采用拖拽释放（显示范围预览+蓄力进度条），集火指令长按敌人触发（准星标记+弹道汇聚特效）
  - 【色彩语义化系统】：敌方单位按威胁等级绑定色相——普通怪冷灰/蓝，精英怪暖黄/橙，Boss 高饱和红/紫；同色系用体型大小+轮廓光区分
  - 【层级清晰度】：所有可交互对象（塔/敌人/技能图标）必须有明确投影或描边，与背景拉开 ≥2 级明度差；弹道拖尾 ≤0.3s；采用正交俯视或微仰角（≤15°）确保点击判定精确
  - 【横版信息降噪】：飘字伤害采用聚合显示（同目标 0.3s 内多次伤害合并单次弹出），暴击/特效金色大字号突出、普通白色小字号弱化；非关键 UI 战斗中自动收起，波次间隙展开完整面板
- **parameters** 必须包含：wave_count（总波数≥10）、spawn_interval（每只敌人出生间隔 ms）、base_hp（100~500）、initial_gold（200~500）、towers[]（每种含 name/cost/damage/range/attackSpeed/upgradeCosts[3]/projectileId）、enemies[]（每种含 name/hp/speed/armor/reward/special）、slot_positions[]（槽位坐标数组）
- **比例规范**：塔高度 = 画布短边 8%~12%；敌人高度 = 塔 60%~100%；Boss = 塔 150%~250%；弹射物 = 塔 15%~25%；放置槽位 = 塔 120%~150%；路径宽度 = 画布宽 8%~12%
- **rules** 必须包含：敌人到达基地扣血（不同敌人扣不同血量，通常 1~5）、基地血量归零=失败、全波次清完=胜利、放置槽位冲突规则（每槽位只能放一个塔）、升级条件（金币足够 + 当前等级<3）、出售返还比例

**【卡牌/TCG 类】** —— 关键词：卡牌、手牌、法力/费用、出牌、回合、炉石、皇室战争、游戏王、杀戮尖塔
设计阶段必须包含：
- **entities 必须包含**：至少 5~8 种卡牌插画（role="decoration"，每种独立 id 如 minion_warrior/minion_archer/spell_fireball/spell_heal/weapon_sword，visuals 只描述卡面插画内容不含卡框），玩家英雄/头像（role="player_controlled"），敌方英雄（role="obstacle"），英雄技能特效（role="projectile"，如 hero_power_fire）。每种卡牌类型必须有独立美术素材。
- **detailedGameplay.coreMechanics** 必须覆盖：
  - 牌库系统：开局 30 张卡（预设牌组 or 随机生成），每局开始时 shuffle；牌库耗尽时抽牌触发 fatigue（每次抽牌扣递增伤害 1/2/3...）
  - 手牌系统：起始抽 3~4 张；每回合开始自动抽 1 张；手牌上限 7~10 张，超出自动烧毁/弃牌；手牌在屏幕底部扇形排列展开，鼠标/手指 hover 的卡牌必须突出放大（宽度放大到画布宽度 30%~35%，同时向上偏移 40~60px 凸显显示，添加金色发光边框 + 投影，过渡动画 0.15~0.2s ease-out），拖拽到战场/对手释放
  - 法力/费用系统：初始最大法力 0~1，每回合+1（上限 10）；回合开始时法力回满；出牌消耗法力，法力不足卡牌灰色不可点击
  - 回合结构：回合开始（抽牌+回满法力+刷新随从攻击次数）→ 出牌阶段（自由出牌/攻击）→ 回合结束（点击结束按钮 or 自动倒计时 60~90 秒）→ 对手回合
  - 卡牌效果分类：随从卡（minion）= 打出后站在战场上，有 attack/health 属性，可攻击敌方随从或英雄；法术卡（spell）= 打出后即时结算效果（伤害/治疗/召唤/抽牌）然后进墓地；武器卡（weapon）= 装备到英雄上，英雄可直接攻击
  - 随从战斗：选中己方随从 → 拖拽指向敌方随从/英雄 → 双方互相造成伤害（攻击方 attack 扣防守方 health，防守方 attack 扣攻击方 health）；health≤0 的随从死亡移除；刚出场的随从不能立即攻击（summoning sickness），除非有 charge 关键词
  - 战场/场地：己方/敌方各最多 5~7 个随从位，随从位不够时不能出随从卡
  - 关键词能力：taunt（嘲讽=必须先被攻击）/ charge（冲锋=出场即可攻击）/ divine_shield（圣盾=免一次伤害）/ battlecry（战吼=出场时触发效果）/ deathrattle（亡语=死亡时触发效果）/ lifesteal（吸血=伤害转化为英雄治疗）
- **screens.gameplay** 必须描述：
  - 【竖版垂直三段式布局（portrait 强制）】：
    - **顶部对手区（画布高度 15%-20%）**：仅展示对手头像、血量/护甲、当前法力水晶、手牌数量（背面卡背+数字角标，高度压缩至 30px 以内）；奥秘/任务用图标悬浮于头像右侧，点击展开详情浮层；对手打出卡牌时该区域临时下移展开完整卡牌动画，结算后自动收回
    - **中央战场区（画布高度 45%-50%）**：采用单列纵向排列——己方随从在上半区、敌方随从在下半区，中间预留 20px 分隔线（含攻击指向引导光效）；随从卡宽:高=3:4，宽度占屏幕 85%；每侧最多 7 个随从，超出时自动缩放至 80% 并横向微偏移；战场背景采用低饱和度动态纹理（缓慢流动魔法阵），禁用复杂场景图
    - **底部手牌与操作区（画布高度 30%-35%）**：手牌采用扇形堆叠+滑动展开——默认状态卡牌重叠露出顶部 1/3，手指左右滑动时当前卡牌放大至全尺寸并置顶，相邻卡牌半透明退后；法力水晶条嵌入手牌区顶部边缘（横向排列+数字标注）；结束回合按钮固定于右下角拇指热区（≥ 56×56pt，带冷却进度环动画）；左侧预留空白防误触区，右侧按钮Y轴坐标≥屏幕底边 80px 规避全面屏手势条
  - 手牌区（底部，扇形排列，hover 放大+上浮，拖拽出牌，不可用卡牌灰色半透明）
  - 战场区（中部，己方/敌方各一排随从位，每个随从显示卡面缩略图+attack/health数值+关键词图标）
  - 英雄区（己方左下/敌方右上，圆形头像框+血量条+护甲值+武器栏）
  - 法力条（己方英雄旁，水晶/宝石图标逐个亮起表示可用法力，暗色=已消耗）
  - 回合结束按钮（屏幕右侧中部，大号“结束回合”按钮，倒计时进度条环绕）
  - 牌库剩余数（己方右下角/敌方左上角，牌堆图标+数字）
  - 出牌动画：从手牌拖出 → 卡牌飞到战场/目标 → 落地闪光+粒子 → 战吼特效
  - 【竖版卡牌操作交互】：支持拖拽释放（从手牌拖向战场/对手）与点击选中→点击目标双模式；拖拽时卡牌跟随手指，进入合法目标范围时绿色吸附指示器，非法区域红色禁止标识+短促震动；随从攻击操作点击己方随从触发攻击姿态（前倾+发光边框），敌方合法目标头顶出现红色准星；长按任意卡牌/随从弹出详情浮层（智能避让手指遮挡），双击手牌快速查看详情
- **卡牌视觉规格**：单张卡牌基础宽 ≥ 画布宽度 20%（竖版≥140px，横版≥160px），高宽比 3:4~2:3，卡面结构=顶部费用气泡+中部插画区(用 ASSETS 素材)+底部攻防数值+名称条。hover 放大时宽 ≥ 30%~35%，向上偏移+金色发光边框+z-index 置顶。禁止卡牌基础尺寸 <130px。
- **parameters** 必须包含：max_hand_size（7~10）、max_mana（10）、mana_per_turn_growth（1）、starting_hand（3~4）、deck_size（30）、battlefield_slots（5~7）、fatigue_start_damage（1）、turn_timer（60~90 秒）、cards[]（每种含 name/mana_cost/type[minion/spell/weapon]/attack/health/effect/keywords[]/artId）
- **rules** 必须包含：法力不足不能出牌、英雄血量≤0=失败（对方胜利）、随从 summoning sickness（出场当回合不能攻击，charge 除外）、每回合自动抽一张、手牌满时抽牌烧毁、牌库空时 fatigue 递增伤害、随从 deathrattle 在死亡时触发

**【物理弹射/抛射类】** —— 关键词：弹弓、弹射、抛射、愤怒的小鸟、投石车、物理碰撞、建筑物倒塌
设计阶段必须遵守以下**相对比例协调规则**（确保弹射物、目标、建筑方块在游戏中大小和谐）：
- **统一基准单位 UNIT**：以"弹射物（如小鸟）"的单帧显示尺寸为 1 UNIT（建议 1 UNIT = 画布短边 6%~8%，即 720p 下 ≈ 44~58px）。所有其他实体的尺寸都基于此 UNIT 定义：
  - 弹射物（player_controlled，如小鸟）：1×1 UNIT（正方形 1:1 纵横比）
  - 目标角色（obstacle，如绿猪/敌人）：0.8~1.2 UNIT（正方形或近正方形，最大 1.5:1）
  - 标准方块（obstacle，如木箱/石块）：1×1 UNIT（正方形）或 0.5×2 UNIT（长条板）或 2×0.5 UNIT（横梁）——只允许 1:1、1:2、2:1 三种比例
  - 收集品（collectible，如金蛋/星星）：0.6~0.8 UNIT（正方形）
  - 弹弓/发射器（decoration）：高度 2~3 UNIT，宽度 0.8~1 UNIT
- **素材纵横比强制约束**：
  - 弹射物和目标角色的**单帧**纵横比必须接近 1:1（允许 3:4~4:3 范围，禁止超出 1:2 或 2:1）
  - animationType="spritesheet" 时，size 字段 = "512x512"（2×2 十字格，每帧 256x256）；animationType="video"/"static" 时，size = 单帧尺寸
  - 目标角色（猪/敌人）如用 spritesheet，帧数建议 2~4 帧（idle 动画），单帧正方形（128x128 或 256x256）
- **禁止的比例错误**：
  - 禁止弹射物远大于目标（小鸟不能比猪大 2 倍以上）
  - 禁止方块比弹射物小（建筑方块至少 ≥ 0.8 UNIT）
  - 禁止目标角色是极端纵横比（如 512x128 的 static 猪图——那不是猪的合理形状）
  - 禁止收集品比目标角色大
- **parameters** 建议包含：gravity、launch_force_multiplier、max_drag_distance、block_hp_by_material（wood/glass/stone）、unit_size_px（用于代码中统一尺寸基准）

**【跑酷/无尽奔跑类】** —— 关键词：跑酷、无尽、endless runner、躲避障碍、跳跃、滑动、收集金币
设计阶段必须包含：
- **entities 必须包含**：玩家角色（role="player_controlled"，animationType="spritesheet"，≥4帧跑步动画），≥2 种障碍物（role="obstacle"，高障碍需跳跃、低障碍需滑行），≥1 种收集品（金币/宝石 role="collectible"），可选道具（磁铁/护盾/加速），地面瓷砖（role="decoration"，tileable=true，左右无缝拼接的地面纹理段）
- **coreMechanics** 必须覆盖：自动前进（背景视差滚动 2~3 层）、跳跃（tap/swipe-up）、下滑（swipe-down/长按）、多车道或连续地形、障碍生成器（距离递增难度曲线）、无尽计分（距离+收集品）
- **screens.gameplay** 必须描述：多层视差背景、地面/平台层、角色跑步位置（左 1/3 固定）、HUD（距离/分数/金币 顶部居中）、暂停按钮
- **parameters**：scroll_speed_initial、speed_increase_rate、jump_height、lane_count（2~3）、obstacle_min_gap、coin_value
- **比例规范**：玩家角色高度 = 画布高度 15%~20%；障碍物高度 = 角色 50%~120%；收集品 = 角色 30%~40%；地面高度 = 画布底部 15%~20%
- **tileable 素材规则**：跑酷类地面素材 id 应含 ground/floor/terrain/road，必须标注 tileable=true；视差滚动背景（bg_ 开头且用于滚动的多层背景）在 visuals 描述中需注明 "seamless horizontally repeating"

**【三消/消除/Match-3类】** —— 关键词：三消、match-3、消除、交换、连线、方块、宝石、开心消消乐、Candy Crush
设计阶段必须包含：
- **entities 必须包含**：≥5 种可消除元素（role="collectible"，每种独立 id 如 gem_red/gem_blue/gem_green/gem_yellow/gem_purple，static 类型），可选特殊元素（炸弹/横扫/彩虹，1~3 种 role="projectile"），可选障碍物（冰块/巧克力/藤蔓/锁链，role="obstacle"，需要多次消除才能清除）
  **【三消宝石视觉区分铁律 —— 形状 + 主题 + 颜色三维差异，缺一不可】** 5 种可消除元素之间必须做到"一眼可辨"——即使色盲玩家也能通过形状区分，仅靠颜色差异不合格。每种宝石的 visuals 字段必须同时覆盖以下 3 个维度：
  1) **形状/轮廓完全不同**：每种必须是不同的几何轮廓——从 [圆形/菱形/五角星/六边形/心形/水滴形/三角形/十字形/椭圆形/方形倒角] 中选择，5 种宝石之间禁止重复任何形状。visuals 中必须显式写出 shape 关键词（如 "diamond-shaped crystal" / "star-shaped gem" / "hexagonal rune stone"）
  2) **主题/物体完全不同**：每种必须是不同的具象物体或抽象图腾，不能全是"宝石"。例如：红色=火焰/红宝石，蓝色=水滴/蓝宝石，绿色=树叶/翡翠，黄色=星星/琥珀，紫色=月牙/紫水晶。每个物体有明确的中心图案（火焰/水滴/叶片/星芒/月亮），一眼就能区分
  3) **主色调对比鲜明且使用高饱和纯色**：5 种颜色必须色相差距 ≥ 60°（红-绿-蓝-黄-紫 天然满足），禁止使用相邻色相（如红 vs 橙、蓝 vs 青）。**必须使用高饱和度的纯色填充，禁止渐变、发光、半透明、绚丽特效、彩虹等装饰**。宝石/方块用干净的单一纯色填充，配合清晰的形状轮廓即可，让玩家一眼分辨。
  4) **禁止透明方块与白底素材（铁律）**：所有可消除元素必须是不透明的实心填充（alpha=1.0），禁止任何透明/半透明方块；素材背景必须为纯绿色（#00FF00）绿幕背景板，禁止带白色底色。visuals 中必须注明 "opaque solid fill, solid green (#00FF00) chroma key background, no white background"
  示例 visuals：
  - gem_red: "diamond-shaped red block, flat solid crimson fill (#DC2626), clean angular outline, opaque solid fill, solid green (#00FF00) chroma key background, no white background, no gradient no glow"
  - gem_blue: "teardrop-shaped blue block, flat solid royal blue fill (#2563EB), smooth curved outline, opaque solid fill, solid green (#00FF00) chroma key background, no white background, no gradient no glow"
  - gem_green: "hexagonal green block, flat solid emerald fill (#16A34A), six-sided clean outline, opaque solid fill, solid green (#00FF00) chroma key background, no white background, no gradient no glow"
  - gem_yellow: "star-shaped yellow block, flat solid golden fill (#EAB308), five-pointed sharp outline, opaque solid fill, solid green (#00FF00) chroma key background, no white background, no gradient no glow"
  - gem_purple: "crescent-shaped purple block, flat solid violet fill (#9333EA), moon-arc outline, opaque solid fill, solid green (#00FF00) chroma key background, no white background, no gradient no glow"
- **coreMechanics** 必须覆盖：
  - 网格系统（通常 7x7~9x9，每个格子存储 {type, x, y, targetX, targetY, scale, alpha, locked}）
  - 交换/连线规则（相邻交换 or 手指连线同色）
  - 匹配判定（≥3 同色相连消除）
  - 消除后重力下落 + 顶部补充（cascade 循环直到无匹配）
  - 连锁（cascade）计分加成
  - 特殊元素生成条件（4连→横/纵线炸弹，5连→彩虹球，L/T形→爆炸炸弹，5连T形→超级炸弹）
  - 特殊元素触发效果（线炸弹=清除整行/列，爆炸炸弹=3x3 范围，彩虹球=清除全场同色）
  - 关卡目标类型（限定步数达到目标分数 / 收集 N 个指定颜色宝石 / 清除所有障碍物 / 限时挑战）
  - 道具系统（可选）：锤子（移除单个宝石）、洗牌（重排网格）、加步（+5步）、炸弹（指定范围爆炸）
- **screens** 必须包含：
  - **gameplay**：
    - 【竖版三层式布局（portrait 强制）】：
      - **信息层（顶部 15%~18%）**：仅保留步数/时间、当前分数、关卡目标三要素，左-中-右横向排布，字号 ≥ 画布宽度×3.5%，高对比描边确保可读；禁止在顶部放置可交互按钮（避免与系统状态栏冲突）
      - **棋盘核心区（中部 40%~60%）**：网格垂直位置落在拇指自然摆动弧线舒适区（屏幕中下部）；单格 ≥48×48pt，格间距 ≥4px；7×9 或 8×10 为竖版最优规格；棋盘边缘预留 ≥12px 安全边距防止触发系统侧滑手势
      - **操作层（底部 20%~25%）**：道具栏固定屏幕最下方，图标 ≥56×56pt 横向等距排列；选中态放大 1.2× + 发光边框，未冷却道具灰显 + 倒计时遮罩；暂停/设置按钮右下角拇指热区，左上角留白防误触；所有底部按钮 Y轴 ≥ 屏幕底边 80px 规避全面屏手势条
    - 【视觉语义系统】：棋子色相+形状双编码（确保 0.3s 内传递“可消除性”）；特殊棋子有独立轮廓光 + 动态粒子环绕，与普通棋子明度差 ≥30%；障碍物低饱和冷灰色调与棋子暖色形成主次分离；破损状态用裂纹纹理 + 透明度渐变表达
    - 选中态高亮/放大、消除动画（缩小+粒子爆炸）、分数 HUD、目标/剩余步数、连击提示（combo x3 飘字）
  - **levelSelect**（关卡选择界面）：网格排列关卡按钮（每行 3~5 个），每个按钮显示关卡编号+已获得星级（0~3颗星），未解锁关卡灰色锁定+锁图标
  - **preLevelBriefing**（关卡开始前预览）：显示本关目标（如"消除30个红色宝石"，配对应 icon_goal_gem 缩略图+数量）+ 可用道具 + "开始"按钮
  - **levelResult**（关卡通关结算）：星级评定动画（1~3颗星逐颗亮起+缩放弹入）+ 分数展示 + "继续/重玩"按钮；失败时显示"步数用完" + "重试"按钮
- **parameters**：grid_cols、grid_rows、match_min_count（3）、max_moves 或 time_limit、score_per_gem、combo_multiplier（1.5~2.0）、special_gem_conditions[]（4连/5连/L形/T形各自的生成条件和触发效果）、level_goals[]（每关目标类型+数值）、obstacle_types[]（障碍物名称+需要的消除次数）
- **比例规范**：单个宝石/元素 = 网格单元格 85%~95%（留间距），网格占屏宽 65%~75%，单格至少 40px×40px，关卡选择按钮 = 画布宽度 15%~20%
- **rules** 必须包含：无可用交换时自动洗牌、步数用尽=关卡失败（显示重试）、目标达成=通关（显示星级结算）、特殊宝石触发时清除范围内所有宝石+分数加成、障碍物需要消除指定次数才能清除（冰块2层/巧克力3层）、连锁期间玩家不可操作

**【平台跳跃类】** —— 关键词：平台、跳跃、关卡、马里奥、超级猫里奥、洛克人
设计阶段必须包含：
- **entities 必须包含**：玩家角色（role="player_controlled"，spritesheet ≥4帧跑步+2帧跳跃），≥2 种敌人（role="obstacle"，如巡逻怪+跳跃怪），≥1 种收集品，平台方块/地面瓷砖（role="decoration"，tileable=true，左右无缝可拼接的地形方块纹理）
- **coreMechanics** 必须覆盖：左右移动+跳跃（可选双跳/长按高跳）、重力系统、平台碰撞检测（站立/穿透）、敌人 AI（巡逻/追踪/跳跃）、关卡结构（起点→终点旗帜/传送门）、生命/血量系统
- **screens.gameplay** 必须描述：摄像机跟随玩家（横向滚动）、多层背景视差、地形层（可站立平台）、HUD（生命❤️/金币/关卡号）
- **parameters**：move_speed、jump_force、gravity、max_jump_time、enemy_patrol_speed、level_width（画布宽度的 3~10 倍）
- **比例规范**：角色高度 = 画布高度 10%~14%；单个地面砖块 = 角色高度 60%~100%（正方形 tileable）；敌人 = 角色 70%~120%；收集品 = 角色 40%~50%
- **tileable 素材规则**：平台方块/地面砖块 id 应含 platform/ground/tile/brick/block（如 ground_tile/platform_stone），必须标注 tileable=true；确保水平方向可无缝拼接（左边缘纹理与右边缘纹理完美衔接）

**【射击/弹幕类】** —— 关键词：射击、飞机、弹幕、子弹、boss、space shooter、纵向卷轴
设计阶段必须包含：
- **entities 必须包含**：玩家飞机/战舰（role="player_controlled"），玩家子弹（role="projectile"），≥2 种普通敌人（role="obstacle"，不同行为模式），1 Boss（role="obstacle"，大尺寸），敌人子弹/弹幕（role="projectile"），≥1 种道具（weapon_upgrade/shield/bomb role="collectible"）
- **coreMechanics** 必须覆盖：触屏/鼠标拖拽移动（跟手灵敏）、自动开火（固定频率发射子弹）、敌人编队生成（波次/路径/阵型）、碰撞检测（hitbox 小于视觉）、道具掉落（随机/固定）、Boss 战（多阶段/弹幕 pattern）、无敌帧/被击闪烁
- **screens.gameplay** 必须描述：竖版纵向滚动背景（星空/海洋/云层）、玩家在底部 1/3 移动、敌人从顶部出现、子弹密度可视化、HUD（分数/血量/炸弹数）
- **parameters**：player_speed、fire_rate、bullet_speed、enemy_spawn_interval、boss_hp、invincible_frames
- **比例规范**：玩家飞机 = 画布宽度 10%~14%；普通敌人 = 画布宽度 8%~12%；Boss = 画布宽度 30%~50%；子弹 = 画布宽度 2%~4%；道具 = 画布宽度 5%~7%
- **对称性铁律**：玩家飞机/战舰、所有敌机/敌舰的 visuals 描述中必须显式包含 "perfectly bilaterally symmetric (left-right mirror symmetry), top-down or front view, centered on vertical axis"。飞行器类实体必须严格左右对称（机翼、引擎、武器挂载点等对称分布），禁止生成不对称的飞机/战舰素材

**【休闲点击/放置类】** —— 关键词：点击、idle、放置、升级、自动收益、clicker
设计阶段必须包含：
- **entities 必须包含**：核心点击目标（role="player_controlled"，点击有明显反馈动画），≥3 种升级项图标（role="decoration"），资源/货币图标（role="collectible"），可选自动生产单位（role="decoration"）
- **coreMechanics** 必须覆盖：点击产出（每次点击+N 资源）、升级系统（花费资源提升点击收益/秒产出）、离线收益（可选）、成就/里程碑、数值膨胀（大数显示 K/M/B/T）、prestige/转生（可选高级循环）
- **screens.gameplay** 必须描述：中心大型点击目标（占屏 30%~40%，有弹跳/粒子反馈）、资源显示（顶部）、升级面板（底部可滚动列表/卡片）、每个升级项显示名称+等级+费用+产出、进度条/里程碑指示
- **parameters**：base_click_value、upgrade_costs[]、upgrade_multipliers[]、auto_income_rate、prestige_threshold

**【回合制RPG/策略类】** —— 关键词：回合制、RPG、梦幻西游、最终幻想、回合战斗、队伍、技能、法术、物理攻击、治疗
设计阶段必须包含：
- **entities 必须包含**：≥3 个己方角色（role="player_controlled"，每个有独立 id 如 hero_warrior/hero_mage/hero_healer，各自有独特外观描述和 spritesheet/static 动画），≥3 种敌方怪物（role="obstacle"，从小怪到 Boss 分层），技能特效（role="projectile"，如 fire_spell/heal_effect/sword_slash 各有特效图），UI 元素（血条框/蓝条框/伤害数字背景等 role="decoration"）
- **coreMechanics** 必须覆盖：
  - 回合结构：行动顺序判定（速度排序/固定顺序）→ 玩家选择指令（攻击/法术/道具/防御/逃跑）→ 执行行动动画 → 敌方 AI 行动 → 回合结束检测（全灭/胜利）
  - 队伍系统：己方 2~4 人站位（左侧一列），敌方 1~5 只站位（右侧分布），每个角色有 HP/MP/ATK/DEF/SPD/属性
  - 技能系统：每角色 2~4 个技能（含普攻），每技能有 MP 消耗/伤害公式/目标类型（单体/全体/己方）/附加效果（中毒/减速/回复）
  - 伤害公式：damage = ATK * skill_multiplier - target.DEF * 0.5 + random(-5, 5)，暴击率、属性克制（可选）
  - 敌方 AI：简单优先级（HP<30% 目标优先被攻击/Boss 使用大招/小怪随机攻击），不需要复杂 AI
  - 战斗奖励：经验值/金币/掉落物（战斗结束结算弹窗）
- **screens.gameplay** 必须描述：
  - 战斗场景布局：全屏背景（bg_gameplay）+ 己方队伍在左侧（2~4 角色纵向排列，每个含头像+HP条+MP条）+ 敌方在右侧（按怪物数量分布）
  - 指令面板：底部弹出式菜单（攻击/法术/道具/防御 4个选项，每个选项展开后有子菜单——如法术展开显示可用法术列表）
  - 目标选择：点击/tap 敌方角色选择攻击目标，选中态有高亮框/箭头指示
  - 行动动画：角色前冲/特效播放/伤害数字飘出/被击闪烁
  - 回合信息：顶部显示当前行动角色名 + 回合数，行动顺序条（可选）
- **parameters**：team_size（2~4）、enemy_count_range（1~5）、base_hp、base_mp、base_atk、base_def、base_spd、exp_per_battle、gold_per_battle、skill_list[]（每技能含 name/mp_cost/damage_mult/target_type/effect）
- **比例规范**：角色 sprite 高度 = 画布高度 15%~22%（梦幻西游风格角色要较大较显眼）；指令面板高度 = 画布高度 25%~30%（方便触摸操作）；HP/MP 条宽度 = 角色宽度 80%~100%
- **rules** 必须包含：HP≤0 角色倒下（灰色化+不可行动）、全员 HP≤0=战斗失败、敌方全灭=胜利、MP 不足无法释放法术、防御状态受伤减半、逃跑有概率（50%~80%）

**【格斗/FTG类】** —— 关键词：格斗、fighting、拳皇、KOF、街霸、铁拳、1v1、3v3、连招、必杀技、格挡、KO、血条、气槽
设计阶段必须包含：
- **entities 必须包含**：
  - ≥3 个可选格斗角色（role="player_controlled"，每个有独立 id 如 fighter_ryu/fighter_kyo/fighter_chunli），每个角色需要**多种动作状态的 spritesheet entity**（按【格斗类多状态动画规则】拆分）：最低 6 种——idle/walk/jump/attack_light/hit/ko；推荐追加 crouch/attack_heavy/block/special_move/victory
  - 每个角色至少 1 张**立绘 portrait**（static，role="decoration"，用于角色选择界面和 HUD 头像框）
  - 对战对手（role="obstacle"，可以是同一批角色的 AI 版本，不需要重复定义 entity，代码复用即可）
  - 打击火花 / 必杀技特效（role="projectile"，如 hit_spark/fireball/shoryuken_trail 等，animationType="static" 用 tween 驱动缩放+渐隐）
  - 场景背景 bg_gameplay（格斗场景需有纵深感——擂台/街道/道场/城市天台等，地面线清晰，两侧留有足够的运动空间）
- **coreMechanics** 必须覆盖：
  - **移动系统**：左右行走（walk_speed 匀速）、跳跃（抛物线 vy=-jump_force, gravity 恒定）、蹲伏（按下方向，蹲伏状态下 hitbox 高度减半）、后撤步（快速双击后退方向触发，短暂无敌帧）、冲刺（快速双击前进方向，有惯性滑行）
  - **攻击系统（帧数据驱动）**：每种攻击动作有完整帧数据——startup（出招前摇帧数，无判定）→ active（有效判定帧，hitbox 激活）→ recovery（收招后摇帧数，不可操作）。攻击分轻/中/重三级（伤害/范围/帧数据递增）。示例：轻拳 startup=3, active=4, recovery=6, damage=30；重踢 startup=8, active=5, recovery=12, damage=80
  - **hitbox/hurtbox 系统**：每个角色始终有一个 hurtbox（受击判定区域，约等于角色轮廓缩小 10%~15%）；攻击动作的 active 帧额外生成 hitbox（攻击判定区域，从角色前方延伸）。碰撞检测 = 攻击方 hitbox 与防守方 hurtbox 的 AABB 重叠判定。同一招只命中一次（命中后标记 hitFlag=true，下一招重置）
  - **连招系统（Combo Chain）**：攻击命中后对手进入 hitstun（受击硬直），在 hitstun 结束前可以衔接下一招形成连段。连招伤害递减缩放：第 N 次命中 damage × max(0.3, 1.0 - 0.1×N)。空中连击（juggle）有上限（如最多 3 次空中追打）
  - **防御系统**：按住后退方向 = 站立格挡（挡上段/中段）；按住后退+下 = 蹲防御（挡下段）。格挡后进入 blockstun（防御硬直），受 chip damage（约 10%~15% 正常伤害）。破防技（如投技/防御不能技）需要额外系统
  - **必杀技 / 超必杀技**：必杀技通过方向+按键组合释放（如 ↓↘→+拳 = 波动拳）；超必杀技需要消耗气槽（super_meter）。气槽在攻击命中/被攻击/防御时积累，分 1~3 级。超必杀技释放时画面短暂暗转（100ms）+ 特写慢镜头 + 大伤害
  - **回合制（Round System）**：三局两胜（best of 3）。每回合 60~99 秒倒计时。双方 HP 归零或时间到时判定该回合胜负（HP 更低者输）。回合间隔 3 秒展示"ROUND N"画面，双方位置重置、HP 回满
  - **3v3 队伍系统（KOF 风格）**：每方选择 3 名角色组成队伍，按出场顺序排列。当前角色 KO 后自动切换到下一名角色（剩余 HP 百分比保留），直到 3 人全部被 KO 则输掉比赛。换人时有短暂入场动画
  - **AI 对手**：基于距离的简单 AI——远距离时接近/后退（70%概率前进，30%后退），中距离随机出招（轻/重/必杀按比例 50%/30%/20%），近距离高概率攻击+偶尔防御。难度通过反应延迟和攻击频率控制
- **screens** 必须包含：
  - **characterSelect（角色选择画面，格斗游戏独有核心界面）**：
    - 网格排列所有可选角色头像（每行 3~4 个，共 2 行），P1 光标蓝色框 + P2/AI 光标红色框
    - 选中角色后底部/侧边显示角色立绘 + 角色名 + 简要属性（攻击力/速度/难度 3 项评级）
    - 确认按钮 + 随机选择按钮（?）
  - **vsScreen（VS 过渡画面）**：双方角色立绘左右对半分屏 + "VS" 大字居中 + 角色名，持续 2~3 秒后过渡到战斗
  - **gameplay（战斗 HUD）**：
    - 顶部：左侧 P1 血条（从右向左缩减，红/黄/绿渐变）+ P1 头像框；右侧 P2 血条（从左向右缩减）+ P2 头像框；中央倒计时器（大字号，最后 10 秒变红闪烁）；血条下方回合指示圆点（胜一局亮一颗）
    - 底部：P1 气槽（左下，1~3 格分段）+ P2 气槽（右下）。连击计数器在角色侧面（"3 HIT COMBO" 飘字）
    - 回合公告覆盖层："ROUND 1" 从上方滑入 → "FIGHT!" 居中放大闪入 → 2 秒后淡出开始战斗；"K.O.!" 在最后一击时居中放大 + 屏幕震动 + 慢镜头
  - **gameOver / matchResult**：最终回合结束后，胜利方角色胜利 pose + "YOU WIN!" / "YOU LOSE" 大字 + 重赛/返回按钮。可选展示本轮统计（最高连击数/总伤害/必杀技使用次数）
- **parameters**：walk_speed（2~4 px/frame）、jump_force（12~18）、gravity（0.6~0.8）、round_time（60~99 秒）、max_hp（1000）、super_meter_max（3 级）、combo_damage_scale_start（1.0）、combo_damage_scale_min（0.3）、hitstun_base（12 帧）、blockstun_base（8 帧）、team_size（3）、best_of_rounds（3）、attacks[]（每个攻击含 name/startup/active/recovery/damage/hitbox_offset/knockback/hitstun）
- **比例规范**：格斗角色高度 = 画布高度 22%~30%（格斗游戏角色要大气、醒目）；角色宽度 ≈ 高度 × 0.4~0.5；血条宽度 = 画布宽度 35%~42%（两侧各一条）；血条高度 = 画布高度 2%~3%；气槽宽度 = 画布宽度 30%~35%；倒计时字号 = 画布高度 5%~6%；角色间保持合理距离（不超过画布宽度 60%）
- **rules** 必须包含：HP≤0 该角色 KO（播放倒地动画+K.O.公告）、时间到=HP 低者输该回合、三局两胜/3v3 全灭=比赛结束、连招伤害递减（防止无限连）、同一招式同一回合不可无限使用（可选 stale 机制）、防御不能技/投技需要额外判定、气槽满时才能释放超必杀、KO 后下一回合 HP 回满、3v3 中 KO 角色不可再用

**【通用质量提升规则（所有类型适用）】**：
- entities 列表中每个实体的 visuals 描述必须 ≥ 25 英文单词，必须**结构化**包含以下 5 个维度（按顺序写出，缺一不可）：
  1) 主色 + 副色（明确的色名或十六进制色，如 "vivid crimson red body, golden yellow chest"）
  2) 整体形状/轮廓（圆胖/瘦长/方块/三角等，含比例描述如 "1:1.2 stocky proportions"）
  3) 材质/质感（毛茸茸/金属/橡胶/塑料/水晶等）
  4) 标志性特征（让玩家一眼记住的元素，如 "tiny goggles on forehead, oversized boots"）
  5) 动作姿态/表情（如 "dynamic mid-jump pose, determined eyes, mouth open in shout"）
  反例（禁止）："a red bird"、"cute cartoon character"、"enemy monster"
  正例（推荐）："Vivid crimson red round-body bird with golden yellow chest, 1:1 chubby spherical proportions, soft feathered velvety texture, signature thick angry black eyebrows and small triangular yellow beak, in dynamic mid-flight pose with wings fully spread and determined fierce eyes"
- detailedGameplay 的每个子字段（startup/coreLoop/progression/controls/feedback/spawnBehavior/collisionRules/stateTransitions）必须**严格**达到声明的最低字数，且**必须包含**：≥3 个具体数值/单位（速度 px/s、间隔 ms、概率%、距离 px、HP 数字等）+ ≥1 个边界条件（如 "when score < 100" / "if HP <= 0"）；禁止仅写抽象目标
- suggestedArtStyle 必须具体到风格派别 + 配色方案 + 线条特征 + 材质质感 + 光影氛围（≥50字），禁止只写 "cute cartoon" 这种泛泛描述；必须明确说明**统一光影方向**（如 "top-left lighting, soft ambient occlusion"）让所有素材光影一致
- 每种游戏**至少 7 个**非背景/非UI实体（角色+障碍+收集品+装饰），确保场景丰富度
- colorPalette 的 6 个色值必须互相协调且与 suggestedArtStyle 呼应，**主色与背景色对比度 ≥ 4.5:1**（保证按钮在背景上清晰可见），**文字色与背景色对比度 ≥ 7:1**（保证可读性）
- rules 数组每条**必须**填写 description 字段，包含具体数值边界、连锁反应、特殊情况；禁止 description 为空字符串
- parameters 中所有数值参数必须给出合理 min/max 范围（不允许 min=max），并标注中文 label
- **uiTokens 必须**输出（设计令牌系统，统一 UE/UI 视觉语言）：从颜色/圆角/字号/间距/阴影/动效六个维度给出全局令牌，作为 Stage4 代码生成的 G.theme 直接来源
- **方向协调强约束（每个 entity 必填）**：
  1) 任何 role∈{player_controlled, obstacle, projectile, collectible（如适用）} 的实体必须填 facing + movementDir
  2) 任何 role=background 或 id 含 bg_/scroll/parallax 的素材必须填 scrollDir
  3) **铁律**：玩家 movementDir 与 background.scrollDir 必须方向相反（横版玩家右移→背景左滚；纵版玩家上移→背景下滚），或 scrollDir='idle'。绝不允许同向滚动。
  4) 障碍物的 facing 与 movementDir 应一致（迎面而来的敌人 facing 与 movementDir 都指向玩家方向，例：横版玩家朝右，障碍物从右向左移动 → 障碍物 facing='left' / movementDir='left'）
  5) visuals 文案必须显式包含面朝词汇（"side-view facing right" / "front three-quarter view facing camera"），与 facing 字段互证
- **视频资质强约束（节约模式）**：
  1) 默认 needsVideo=false，**整套实体清单中 needsVideo=true 的素材总数 ≤ 2**
  2) 仅以下 4 类允许 needsVideo=true：character_motion（核心主角/Boss动作循环）/ cutscene（关键过场）/ loop_bg（静图无法表达的微动背景）/ skill_fx（高频核心技能特效）
  3) 普通敌人/收集品/UI/装饰元素**禁止** needsVideo=true

输出 JSON Schema：
{
  "gameConcept": "一句话游戏概要（中文）",
  "styleReference": {
    "genre": "推理出的游戏类型",
    "referenceGames": ["参考游戏1", "参考游戏2", "参考游戏3"],
    "borrowedElements": "从参考游戏中借鉴的具体 UI/UE 元素描述（≥80字）"
  },
  "suggestedArtStyle": "全局统一美术风格标准（≥50字）。格式：主风格 + 配色方案 + 渲染特征 + 氛围关键词。【配色必须由本游戏题材推导，参见 B0 铁律，不得默认写赛博霓虹紫蓝】。正例（根据题材任选其一风格，而非照搬）：森林冒险类 'flat cartoon, cel-shaded, lush green and warm sunlight palette, soft rounded shapes, storybook atmosphere'；糖果休闲类 'glossy candy style, high-brightness pastel palette (pink/mint/cream), bubbly highlights, cheerful mood'；只有科幻题材才写 'vibrant neon colors on dark background, glowing highlights, cyberpunk atmosphere'。所有实体、背景、UI 元素都必须遵守此风格",
  "colorPalette": {
    "primary": "#主色（用于按钮、强调元素）",
    "secondary": "#辅色（用于次要UI元素）",
    "accent": "#点缀色（用于高亮、特效）",
    "background": "#背景主色调",
    "text": "#文字颜色",
    "danger": "#警告/危险色"
  },
  "uiTokens": {
    "_required": "全局 UE/UI 设计令牌（必填）。Stage4 代码生成会直接读取这些令牌挂载到 G.theme，所有 drawButton/drawPanel/drawText/drawHUD 等绘制函数必须读取 G.theme 而非硬编码颜色/尺寸。所有界面共享同一套令牌，保证统一观感。",
    "colors": {
      "primary": "#与 colorPalette.primary 同步",
      "primaryDark": "#主色深色调（按钮渐变下半段、按下态）",
      "primaryLight": "#主色亮色调（高光、hover 发光）",
      "secondary": "#与 colorPalette.secondary 同步",
      "accent": "#与 colorPalette.accent 同步",
      "bgOverlay": "rgba(...) 弹窗遮罩底色（推荐 rgba(0,0,0,0.55)~0.7）",
      "panelBg": "rgba(...) 面板内层底色（半透明磨砂感）。色调必须从 background 派生（同色系加深降亮），而非无脑蓝紫；暗色题材可用 rgba(20,24,40,0.85) 类值，明亮/自然/糖果类题材应用与背景同调的浅色半透底（如暖白/浅米黄/淺绿）",
      "textPrimary": "#与 colorPalette.text 同步",
      "textSecondary": "#次要文字色（约 70% 透明度）",
      "textStroke": "#文字描边色（深色，1.5~2px）",
      "border": "#面板/卡片描边色",
      "success": "#成功反馈（绿系）",
      "warning": "#警告色（橙黄）",
      "danger": "#与 colorPalette.danger 同步"
    },
    "radius": {
      "sm": 8, "md": 16, "lg": 28, "pill": 999,
      "_note": "按钮用 pill/lg，卡片用 lg，面板用 md，HUD 条用 sm"
    },
    "spacing": {
      "xs": 6, "sm": 12, "md": 20, "lg": 32, "xl": 48,
      "_note": "控件内边距用 sm/md，容器外边距用 md/lg，分组间距用 lg/xl"
    },
    "fontSize": {
      "tiny": 18, "small": 24, "body": 30, "title": 44, "hero": 64,
      "_note": "HUD 数值用 body~title，按钮文字用 body~title，主标题用 hero，副标题/提示用 small/tiny"
    },
    "fontFamily": "字体栈（含中英文回退，例如 'Noto Sans SC', 'PingFang SC', 'Arial', sans-serif）",
    "shadow": {
      "card": "0 8px 24px rgba(0,0,0,0.35)（卡片悬浮投影）",
      "button": "0 4px 12px rgba(主色,0.4)（按钮发光）",
      "hudPanel": "0 2px 8px rgba(0,0,0,0.5)（HUD 面板浅投影）"
    },
    "animation": {
      "buttonHoverScale": 1.06,
      "buttonPressedScale": 0.94,
      "idleBreathPeriodMs": 1500,
      "transitionMs": 280,
      "popupOpenMs": 220,
      "_note": "所有界面遵循同一组动效时长，转场 280ms / 弹窗开关 220ms / 按钮按压 60ms"
    },
    "buttonStyle": "统一按钮设计风格关键词（≥30字，描述质感/层次/光影/状态反馈），所有按钮严格遵循；如：'金属质感外框 + 主色双色渐变 + 顶部高光弧 + 底部内阴影 + 外发光描边 + 流动光斑（CTA），idle 微呼吸 / hover 上浮发光 / pressed 下压闪光'",
    "panelStyle": "统一面板/弹窗设计风格关键词（≥30字），所有面板严格遵循；如：'磨砂半透底 + 内发光描边 + 顶部细高光带 + 圆角 24~32 + 整体悬浮投影，开关动效统一缩放+淡入'"
  },
  "resolution": { "width": 750, "height": 1334 },    // 必须匹配 user prompt 指定的【画面方向】：竖版 750x1334 / 横版 1280x720
  "uiStyleReference": "UI 热榜风格基准（选 1 种或融合）：Hearthstone 木质金边宝石点缀 | Marvel Snap 玻璃霓虹宇宙 | Legends of Runeterra 羊皮纸金线油画 | Clash Royale 卡通厚描边鲜艳 | Yu-Gi-Oh Master Duel 暗色科幻青光金属 | Shadowverse 紫红巴洛克镭射 | Slay the Spire 水墨做旧滚轴 | KOF97/98 街机霓虹金属渐变 | Street Fighter 6 涂鸦街头荧光 | 铁拳 暗色金属工业",
  "detailedGameplay": {
    "startup": "完整启动流程：加载画面→标题画面→进入游戏，每步描述视觉细节和持续时间（≥120字）",
    "coreLoop": "核心玩法循环的每一步具体行为，写成流程图式描述——玩家做什么→系统如何响应→视觉/音频反馈→判定结果→下一个决策点，含具体数值/时间/距离阈值（≥150字，必须精确到可直接翻译为 if/else 代码）",
    "progression": "难度递进机制：写出具体的数值变化函数/曲线（如 speed = base + elapsed/10000 * 2），列出每个阶段（时间段或分数段）解锁的新内容/新敌人/新障碍/新机制（≥100字）",
    "controls": "操作方式详细说明：每种输入（tap/swipe/drag/hold/keyboard）对应的精确行为（位移量/速度/角度/持续时间），操作区域在屏幕的哪个位置，响应延迟要求，多点触控处理。格斗类需说明：方向键（左移/右移/蹲伏/跳跃）+ 4 攻击键（轻拳/重拳/轻踢/重踢）+ 必杀技指令输入方式（如屏幕下方虚拟摇杆搓招或直接点击技能按钮）（≥80字）",
    "feedback": "反馈系统：逐一列出每种事件（得分/受伤/死亡/收集/连击/boss出场/关卡通关）对应的视觉特效（粒子数量/颜色/扩散方式/持续时间）+ 屏幕震动参数 + 数字飘字样式。格斗类额外需描述：命中打击火花（位置/粒子数/颜色）、防御护盾闪光、K.O.慢镜头+公告文字、连击计数器飘字、回合公告"ROUND N/FIGHT!/K.O.!"（≥120字）",
    "spawnBehavior": "实体生成/出现的详细规则：生成位置（坐标范围）、生成频率（间隔时间/距离）、生成条件（触发事件/概率）、同屏最大数量限制、出屏回收条件、生成模式（随机/预设/波次/按距离）（≥100字）",
    "collisionRules": "碰撞检测的完整判定表：列出所有实体对之间的碰撞规则（A碰B→发生什么），包含 hitbox 类型（AABB/圆形/点）、hitbox 相对实体的缩放比（如角色 hitbox = 实际尺寸 80%）、碰撞后的具体行为（伤害值/击退距离/无敌帧/消灭/反弹）。格斗类需区分 hurtbox（始终存在的受击判定，角色轮廓缩小 10~15%）与 hitbox（仅攻击 active 帧生成的攻击判定，从角色前方延伸），hitbox vs hurtbox AABB 重叠即命中（≥100字）",
    "stateTransitions": "游戏状态机：列出所有可能的游戏状态（如 ready/playing/paused/combo/boss/gameover；格斗类额外包含 idle/walk/jump/crouch/attack_l/attack_h/special/block/hit_stun/knockdown/ko/victory/round_intro/round_end）及状态间的转换条件和对应动画/行为（≥80字）"
  },
  "screens": {
    "loading": {
      "duration": "持续时间（毫秒）",
      "background": "背景设计（使用哪个bg素材或纯色）",
      "progressBar": {
        "position": "屏幕位置描述（如：屏幕中央偏下1/3处）",
        "size": "宽x高像素",
        "style": "外框样式（颜色/圆角/边框宽度）",
        "fillStyle": "填充样式（渐变色值/方向/发光效果）",
        "animation": "填充动画描述（匀速/先快后慢/分段加速）"
      },
      "text": {
        "content": "显示文字内容",
        "font": "字体大小和样式",
        "animation": "文字动画（呼吸闪烁/逐字显示/渐变色）"
      },
      "transition": "加载完成后直接淡出进入标题画面（_bootPhase fadeOut→title，不再走transitionTo，避免二次Loading）"
    },
    "title": {
      "background": "背景图铺满全屏（必须使用 bg_title 素材，不允许纯色/渐变替代）",
      "logo": {
        "text": "游戏标题文字",
        "position": "屏幕中上部（约 y = canvas.height * 0.25）",
        "style": "字体美术风格必须符合游戏题材（如奇幻用哥特花体/现代用简约几何/武侠用毛笔书法），字号大（≥ canvas.width * 0.08），有字体绘制效果（描边+内阴影+外发光/金属质感）",
        "animation": "动效高级：清晰的入场动画（如字母逐个发光显现 + 光晕扩散） + 循环动效（微幅上下浮动 + 光泽扫过/呼吸缩放，周期 3~5s）"
      },
      "buttons": [
        {
          "text": "登录游戏",
          "icon": "无（纯文字按钮，不需要图标）",
          "_constraint": "登录/标题画面只能有这 1 个按钮，禁止出现任何其他按钮/文字/装饰元素",
          "position": "屏幕中下位置（约 y = canvas.height * 0.72）",
          "size": "宽x高（推荐 480x140，圆角 70）",
          "style": "**按钮底色必须为不透明纯色实底填充（铁律）**（从 G.theme.colors 派生的单一饱和纯色，绝对禁止透明/半透明/ghost空心/无填充按钮），颜色必须与背景图形成明显反差/对比（背景暗色用亮色按钮，背景亮色用深色按钮）。**边缘必须有修饰装饰**（与游戏美术题材匹配的边框装饰：如奇幻用金色花纹边框、科技用发光描边、卡通用厚描边+圆角、古风用木纹/铜钉边框）。整体风格必须与 suggestedArtStyle 完全一致，看起来像游戏世界内的原生 UI 元素。内部质感：纯色实底 + 大圆角 + 边缘装饰描边 + 内部微光泽 + 底部轻微投影，字体粗体居中",
          "hoverStyle": "整体放大 1.05 + 发光增强 + 颜色微调亮",
          "pressedStyle": "整体下压 2px + 发光收缩 + 短暂闪光",
          "clickEffect": "波纹扩散 + 闪光 + 触发 transitionTo('gameplay')"
        }
      ],
      "decorations": "无（登录画面严格只有背景 + 标题 + 按钮三个元素，禁止任何额外装饰/粒子/文字/序列帧立绘/角色插画/NPC/动物形象）"
    },

    "gameplay": {
      "background": "游戏背景（bg_gameplay + 可选滚动/视差效果）",
      "hud": {
        "topLeft": "左上角显示内容（图标+数值+样式）",
        "topRight": "右上角显示内容",
        "topCenter": "顶部居中内容（如波次/关卡提示）",
        "bottom": "底部显示内容（技能栏/道具栏/操作提示）"
      },
      "hudStyle": {
        "font": "HUD字体规格",
        "textColor": "文字颜色",
        "textStroke": "文字描边（颜色+宽度）",
        "iconSize": "图标尺寸",
        "panelBg": "HUD面板底色（半透明/模糊）"
      },
      "controls": {
        "type": "操作类型（虚拟摇杆/触屏拖拽/按钮组/手势）",
        "layout": "控件布局描述",
        "touchArea": "触控有效区域",
        "visual": "控件视觉样式（是否显示/透明度/大小）"
      },
      "inGamePopups": {
        "comboNotice": "连击提示样式（位置/字体/颜色/动画/持续时间）",
        "damageNumber": "伤害数字样式（飘字方向/颜色/大小/淡出时间）",
        "pickupNotice": "拾取提示样式",
        "waveNotice": "波次/关卡提示（居中大字+动画进出）"
      }
    },
    "pause": {
      "overlay": "遮罩层样式（颜色/透明度/模糊程度）",
      "panel": {
        "position": "面板位置",
        "size": "面板尺寸",
        "style": "面板样式（背景色/边框/圆角/阴影）"
      },
      "title": "暂停标题样式",
      "buttons": ["按钮列表：每条形如 { text, icon, style }；继续游戏(▶)/重新开始(🔄)/返回登录画面(🏠)。**每个按钮都必须有 icon 字段**"],
      "animation": "弹出/关闭动画（缩放弹出/淡入淡出+时长）"
    },
    "gameOver": {
      "background": "背景设计（bg_gameover 铺满；胜利时高饱和暖色调，失败时低对比度冷色调 + 暗角）",
      "emotionAnchoring": {
        "win": "高饱和金色/橙色色调 + 上扬动效（元素从底部弹入）+ 星星/光粒子爆发 + 激昂音效",
        "lose": "低对比度灰蓝/暗紫色调 + 舒缓淡入动画 + 轻柔音效",
        "pauseBuffer": "0.5~1秒停顿缓冲：胜利/失败标题先显现，停顿后再展开分数等细节"
      },
      "title": {
        "win": "胜利标题：大字号 + 金色渐变 + 外发光 + 从底部弹入动画",
        "lose": "失败标题：中等字号 + 灰蓝色 + 淡入动画"
      },
      "scoreDisplay": {
        "position": "视觉中心（屏幕中部偏上）",
        "style": "大字号 + 高光/发光效果，确保3秒内可识别",
        "animation": "数字从0滚动到最终分数（时长1~1.5s，先快后慢 easeOut）",
        "breakdown": "分数明细（击杀数/存活时间/连击加分等）—— 小字号、低透明度弱化显示"
      },
      "rewards": {
        "animation": "奖励动态掉落 + 堆叠动画 + 清脆音效",
        "unclaimed": "未领取项发光/跳动标记",
        "claimed": "已领取项灰显处理"
      },
      "rating": {
        "type": "评级类型（星级/字母/段位）",
        "criteria": "评级标准（多少分对应几星）",
        "animation": "星星逐颗亮起 + 缩放弹入 + 光晕闪烁"
      },
      "buttons": {
        "win": ["「再来一局」（主按钮，视觉权重最高，居中偏下）", "「返回登录」（次级按钮）"],
        "lose": ["「快速重试」（主按钮，视觉最突出，减少挫败流失）", "「返回登录」（次级按钮）"]
      },
      "animation": "结算画面入场动画：胜利时元素从底部弹入，失败时柔和淡入"
    }
  },
  "popups": {
    "_note": "为游戏中可能需要的功能入口设计对应的弹窗（如暂停面板内的设置/帮助），并为系统确认类弹窗预留定义",
    "shop": {
      "title": "商店",
      "items": ["至少3~6个可购买商品，每项含 id/name/icon/price/effect，与游戏主题匹配"],
      "currency": "使用的货币类型（金币/钻石等）",
      "style": "弹窗尺寸 80%~90% 画布宽，上下留边；商品列表可滚动或分页"
    },
    "ranking": {
      "title": "排行榜",
      "entries": "10条排名数据（含NPC预设名+玩家最高分），前3名金银铜高亮",
      "highlight": "当前玩家记录黄色底条标注",
      "style": "弹窗尺寸约 75%~85% 画布宽"
    },
    "settings": {
      "title": "设置",
      "options": ["音效开关(toggle，控制G.Audio.sfxGain)","音乐开关(toggle，控制G.Audio.bgmGain)","难度选择(简单/普通/困难)"],
      "persistence": "localStorage 持久化",
      "style": "弹窗尺寸约 70%~80% 画布宽"
    },
    "help": {
      "title": "玩法说明",
      "pages": "2~4页图文教程，支持翻页，页码指示器",
      "content": "每页包含操作说明文字 + emoji/示意图标，覆盖核心玩法操作",
      "style": "弹窗尺寸约 80%~90% 画布宽"
    },
    "exitConfirm": {
      "trigger": "何时触发（如：暂停菜单点击返回主菜单）",
      "title": "弹窗标题",
      "message": "提示文字内容",
      "buttons": ["{ text, icon, style }；确认(✓)按钮 / 取消(✕)按钮（两个按钮必须都带 icon）"],
      "style": "弹窗整体样式（尺寸/背景/边框/动画）"
    },
    "reviveConfirm": {
      "trigger": "何时触发（如：死亡后提供复活选项）",
      "title": "标题",
      "message": "描述文字",
      "cost": "复活代价描述",
      "buttons": ["{ text, icon, style }；复活(✨)按钮 / 放弃(✕)按钮（必须带 icon）"],
      "style": "弹窗样式",
      "countdown": "是否有倒计时（秒数/样式）"
    },
    "achievement": {
      "trigger": "触发条件（首次击杀10个/连击5次/通关等）",
      "position": "出现位置（顶部滑入/中央弹出）",
      "content": "成就内容展示（图标+标题+描述）",
      "style": "视觉样式",
      "duration": "显示持续时间",
      "animation": "进入/退出动画"
    }
  },
  "transitions": {
    "bootToTitle": {
      "type": "淡出（启动Loading画面渐隐后直接进入title，不经过transitionTo）",
      "duration": "300ms",
      "description": "启动Loading结束后的唯一一次完整过渡：Loading画面淡出→title淡入"
    },
    "titleToMainHub": {
      "type": "快速黑幕淡入淡出（transitionTo，无Loading画面）",
      "duration": "600ms",
      "description": "transitionTo快速过渡：当前场景淡出→短暂黑幕→目标场景淡入"
    },
    "titleToGameplay": {
      "type": "快速黑幕淡入淡出",
      "duration": "600ms",
      "easing": "缓动函数",
      "description": "transitionTo快速过渡，禁止显示完整Loading画面"
    },
    "gameplayToPause": {
      "type": "过渡类型（通常为遮罩淡入+面板缩放弹出）",
      "duration": "持续时长",
      "description": "暂停过渡效果"
    },
    "gameplayToGameOver": {
      "type": "过渡类型",
      "duration": "持续时长",
      "easing": "缓动函数",
      "description": "死亡/结束过渡效果（如：画面震动→慢动作→淡出→结算画面淡入）"
    },
    "gameOverToTitle": {
      "type": "过渡类型",
      "duration": "持续时长",
      "description": "返回标题的过渡效果"
    },
    "gameOverToGameplay": {
      "type": "重玩过渡类型",
      "duration": "持续时长",
      "description": "重新开始游戏的过渡效果"
    }
  },
  "winConditions": ["具体胜利条件（含阈值或事件描述）"],
  "loseConditions": ["具体失败条件"],
  "coreMechanics": ["mechanic_1", "mechanic_2"],
  "entities": [
    { "id": "唯一英文id", "name": "中文名称", "role": "player_controlled | obstacle | collectible | projectile | decoration | background", "visuals": "英文视觉描述（只描述外观特征，不要写 sprite sheet / card frame 等技术术语）。静态素材描述单个物体外观；序列帧素材描述角色外观和动作主题（如 a fierce red dragon breathing fire）；背景描述完整场景氛围；卡牌素材只描述插画内容不描述卡框。**如有方向语义，必须包含面朝方向描述**（如 facing right, side-view profile / facing camera, front three-quarter view）", "size": "素材整体像素尺寸（序列帧固定 1280x720，静态素材如 1024x1024）", "animationType": "video | video_loop | spritesheet | static", "frameCount": 6, "frameWidth": 213, "frameHeight": 720, "tileable": false, "facing": "right | left | up | down | left-up | right-up | left-down | right-down | front | none", "movementDir": "right | left | up | down | left-up | right-up | left-down | right-down | idle | omni", "scrollDir": "left | right | up | down | idle（仅 background/scroll 类素材填）", "needsVideo": false, "videoUseCase": "character_motion | cutscene | loop_bg | skill_fx（仅 needsVideo=true 时需要）" }
  ],
  "tileable 字段规则": "当素材需要在游戏中重复平铺拼接时（如跑酷地面、平台方块、管道、墙壁、轨道等），必须设为 tileable=true。tileable 素材的 visuals 描述中必须注明 seamlessly tileable/repeating。默认 false 可省略。",
  "facing/movementDir/scrollDir 字段规则（强约束 — 美术与玩法方向协调）": "1) 横版跑酷 / 横版动作：玩家相对屏幕静止但环境向左滚动 → entity.player.facing='right'，movementDir='right'；地面/背景 scrollDir='left'。障碍物 facing='left'（迎面而来）。2) 纵版射击/纵版跑酷：玩家 facing='up' / movementDir='up'；背景 scrollDir='down'；敌人 facing='down'。3) 自由移动俯视角（割草/RPG）：玩家 facing='front', movementDir='omni'；背景 scrollDir='idle'。4) 弹射/平台跳跃：根据是否横版决定，平台素材 scrollDir 通常为 'idle'。5) 装饰/收集/UI：facing='none', movementDir='idle'。**严禁出现 player.movementDir='right' 但 background.scrollDir='right' 这种与玩法不协调的组合**——背景滚动方向必须与玩家的相对运动方向相反。",
  "needsVideo 字段规则（节约模式 — 默认不启用视频）": "默认 needsVideo=false 全部用 spritesheet/static。仅以下场景才允许 needsVideo=true（每游戏 ≤2 个）：(a) videoUseCase='character_motion' — 主角/核心Boss 的高质量动作循环（动作主体 8~12 帧）；(b) videoUseCase='cutscene' — 开场/通关/Boss登场的过场动画（短片 2~3 秒）；(c) videoUseCase='loop_bg' — 静态图无法表达的微动循环背景（云动/水波/星河/灯光闪烁，animationType='video_loop'）；(d) videoUseCase='skill_fx' — 高频使用的核心技能特效（爆炸/冲击波/魔法）。视频生成依赖宿主平台已配置视频模型；未配置时自动降级 spritesheet。",
  "rules": [
    { "trigger": "触发条件描述", "action": "动作描述", "description": "详细规则说明：边界条件、数值、连锁反应、特殊情况" }
  ],
  "parameters": {
    "参数名": { "default": 数字, "min": 数字, "max": 数字, "label": "中文标签" }
  }
}`

export function buildGameplayUserPrompt(userInput: string, orientation: Orientation = 'portrait') {
  return `${buildOrientationDirective(orientation)}

用户描述：${userInput}

请输出 JSON 设计文档。`
}

/**
 * Stage 2 — Module Breakdown Prompt
 * 将游戏设计拆分为功能模块，为后续美术和代码生成提供结构化输入。
 */
export const MODULE_BREAKDOWN_SYSTEM_PROMPT = `你是一名资深游戏架构师。
任务：将游戏设计文档拆分为独立的功能模块，每个模块是一个可独立实现的功能单元。

要求：
1. 模块数量：3~8 个，覆盖游戏的所有核心功能。
2. 每个模块需有清晰的名称、详细描述（包括具体实现要点和交互逻辑）。描述字数要求 150~300 字，必须写到**伪代码级别**的具体程度——包含关键数据结构名、核心算法步骤、数值参数、帧级更新逻辑、与其他模块的接口调用关系。**越详细 = 最终代码生成效果越精确**。
   - 好的描述示例（物理弹射模块）："管理弹弓拖拽→释放→飞行→碰撞全流程。数据：bird={x,y,vx,vy,r,launched}; slingshot={ox,oy,stretchX,stretchY}; 常量 GRAVITY=0.3, MAX_DRAG=120, FORCE_MULT=0.18。update：未发射时根据 touch 计算拉伸向量(clamp MAX_DRAG)并画弹弓皮筋(两条线到 bird)；释放后 vx=stretchX*FORCE_MULT, vy=stretchY*FORCE_MULT, 每帧 vy+=GRAVITY, x+=vx, y+=vy；碰撞检测遍历 blocks[](AABB vs circle, 命中→block.hp-=1, 若 hp≤0 播碎裂粒子+移除)；bird 出屏或静止超1s→切换下一只。调用 G.Particles.emit、G.HUD.drawScore。"
   - 差的描述示例（禁止）："处理弹弓射击和物理碰撞"。这种泛泛描述无法指导代码生成。
3. 标注每个模块关联的实体 id（来自设计文档的 entities 列表）。
4. 如果用户提供了自定义模块描述，以此为基础扩展细化，而非完全忽略。
5. 【必须包含 UI/UE 基础样式模块】模块列表中必须有一个 id 为 "ui_ue_base" 的模块，专门负责：
   - 全局 UI 样式系统（按钮、面板、文字的统一风格）
   - 过场动画与转场效果：启动时由 _bootPhase 状态机显示唯一一次完整 Loading 画面（bg_loading + 进度条 + 提示文字），加载完进入**登录/标题画面 title**（背景图 + 游戏名称 + 「登录游戏」按钮），点击登录按钮后**直接进入核心玩法场景 gameplay**；后续所有场景切换（游戏→结算/重开等）统一走 transitionTo 快速淡入淡出（黑幕过渡 ~600ms，**不再显示 Loading 画面/进度条**），禁止直接硬切
   - 二级弹窗系统（暂停弹窗、退出确认、复活确认、成就通知等）
   - 粒子特效系统（通用粒子发射器，被各模块复用）
   - HUD 基础组件（分数显示、血条、进度条的通用渲染逻辑）
   该模块必须关联所有背景实体（bg_loading, bg_gameplay, bg_gameover）和所有 UI 装饰实体（ui_panel, ui_button）。
   这个模块的美术资源定义了整个游戏的视觉基调——其他模块在绘制 UI 元素时必须复用这里的面板/按钮素材。
   描述中需强调：所有 UI 控件的配色、描边、阴影风格必须与 suggestedArtStyle 保持一致；面板背景使用 ASSETS['ui_panel']，按钮背景使用 ASSETS['ui_button']。
6. 【必须包含登录/标题模块，禁止主界面模块】必须生成 scene_title 模块（登录画面：**严格只包含背景 + 标题 + 按钮三个元素**，禁止序列帧立绘/角色插画/NPC/动物形象/装饰粒子），**不要**生成 scene_main_hub 模块。游戏流程为：Loading → title（登录画面）→ gameplay（核心玩法），不需要 mainHub。
7. 【美术风格一致性】每个模块的描述中，如果涉及视觉渲染，必须提到需遵守设计文档的统一美术风格（suggestedArtStyle）和配色方案（colorPalette），确保全游戏视觉一致。
8. 严格输出 JSON，不要任何额外文字。

### 类型感知的标准模块分解参考（根据游戏类型选择适用模块）：
- **卡牌/TCG**：deck_system（牌库/洗牌/抽牌/fatigue）、hand_manager（手牌扇形排列/hover放大/拖拽出牌/法力校验/烧毁溢出牌）、battlefield（己方敌方各5~7随从位/战斗拖拽指向/伤害结算/taunt优先级/divine_shield/deathrattle触发）、mana_system（法力水晶增长/消耗/回满动画/不可用卡牌灰化）、card_effects（法术即时结算/随从战吼/亡语/buff/debuff/AOE/抽牌效果）、turn_manager（回合状态机DRAW→PLAY→END→OPPONENT/计时器/自动结束）、opponent_ai（出牌优先级/攻击目标选择/法力贪心利用）
- **塔防**：path_system（waypoints坐标定义/敌人沿路径lerp移动/多路径分支）、wave_spawner（波次数据/敌人编队生成间隔/Boss波预告/波次状态机PREP→BATTLE→CLEAR）、tower_placement（槽位坐标数组/拖拽放置交互/合法判定/升级3级/出售返还）、combat_system（射程检测/目标选择first-nearest-strongest/弹射物飞行/命中伤害-armor减伤/特殊效果冰冻减速AOE）、economy（初始金币/击杀奖励/波次奖励/建造升级消耗/出售返还）、enemy_ai（基础grunt/高速fast/重甲tank/飞行flyer/healer回血/splitter分裂/Boss多阶段）、base_defense（基地HP/敌人到达扣血/HP条颜色渐变/GAME OVER触发）、level_manager（关卡解锁/星级评定/难度曲线）
- **物理弹射**：physics_engine（重力/碰撞/弹性）、slingshot_control（拖拽瞄准/释放/弹道）、structure_system（方块堆叠/血量/倒塌判定）、level_design（关卡布局/猪+方块预设数组）、scoring（分数/星级/奖励）
- **跑酷/无尽**：runner_controller（跳跃/滑行/多车道切换）、obstacle_generator（障碍物按距离递增生成/无尽拼接）、parallax_background（多层视差背景滚动）、collection_system（金币/道具/磁铁效果）、difficulty_curve（速度递增/间距缩小/新障碍解锁）
- **三消/消除**：grid_system（网格初始化/交换/匹配检测/级联下落/补充/无可用交换自动洗牌）、special_gems（4连→线宝石/5连→彩虹/L形T形→爆炸宝石/特殊+特殊组合超级效果）、obstacle_system（冰块2层/巧克力蔓延/锁链锁定/石头固定障碍/消除相邻清除机制）、animation_system（消除缩小+粒子爆炸/下落lerp动画/连击飘字逐级放大/特殊宝石全屏特效）、level_manager（关卡数据结构/目标类型score-collect-clear-timed/关卡解锁/星级评定1~3星/关卡选择界面）、powerup_system（锤子移除/洗牌重排/加步+5/炸弹范围爆炸/道具HUD+使用次数）、combo_scoring（连锁计分/comboMultiplier递增/分数阈值→星级）
- **平台跳跃**：player_controller（移动/跳跃/重力/动画状态机）、level_map（地形数据/平台碰撞/摄像机跟随）、enemies_ai（巡逻/追踪/跳跃/被踩判定）、collectibles（金币/星星/钥匙触发）、checkpoint_system（存档点/死亡重生/关卡切换）
- **射击/弹幕**：player_ship（拖拽移动/自动射击/技能按钮）、bullet_system（玩家子弹+敌人弹幕的统一管理/对象池）、enemy_waves（编队生成/路径曲线/入场动画）、boss_battle（多阶段/弹幕pattern切换/血条）、powerup_system（道具掉落/武器升级/护盾/炸弹）
- **放置/Idle**：click_handler（点击核心目标/反馈动画/金币飘出）、upgrade_panel（升级项列表/费用/解锁条件）、auto_income（自动收益计时/离线奖励）、prestige_system（转生/重置/永久加成）、milestone_ui（成就/里程碑/奖励弹窗）
- **回合制RPG**：battle_system（回合状态机/行动顺序/指令执行/伤害计算/胜负判定）、team_manager（队伍数据/角色HP-MP-属性/站位/倒下判定）、command_menu（底部指令面板/攻击-法术-道具-防御/子菜单展开/目标选择）、skill_effects（技能特效动画/伤害数字飘出/状态buff-debuff图标）、enemy_ai（敌方行动优先级/Boss多阶段/攻击目标选择）、battle_rewards（经验/金币/掉落物/升级判定/结算弹窗）
- **格斗/FTG**：fighter_controller（移动/跳跃/蹲伏/冲刺/后退步/动画状态机/动态朝向翻转）、input_system（方向键+攻击键缓冲/指令输入识别如↓↘→+拳=必杀技/输入缓冲窗口5~8帧）、combat_system（hitbox-hurtbox碰撞检测/帧数据管理startup-active-recovery/伤害计算/击退距离/受击硬直hitstun/防御硬直blockstun/chip damage）、combo_system（连招链接/cancel窗口/伤害递减缩放/juggle空中追打限制/combo计数飘字）、guard_system（站立防御/蹲防御/破防判定/投技/防御不能技）、special_move_system（必杀技动作定义/指令识别/超必杀气槽消耗/画面暗转特写）、round_manager（回合状态机round_intro→fight→round_end/KO演出/倒计时/胜负判定/3v3队伍轮转/换人入场动画）、ai_opponent（距离感知AI/进攻-防御-接近决策树/难度参数/反应延迟）、fight_hud（双血条+倒计时器+气槽+连击计数+回合指示圆点+K.O.公告覆盖层）、character_select（角色选择网格/P1P2光标/立绘预览/VS过渡画面）

输出 JSON Schema：
{
  "modules": [
    {
      "id": "唯一英文id（如 player_control, enemy_ai, scoring, ui_ue_base）",
      "name": "中文模块名",
      "description": "详细实现描述（150-300字），必须包含：(1) 本模块管理的数据结构/状态变量（如 grid[][], player.x/y/vy, bullets[], waveIndex）；(2) 核心算法/逻辑流程的伪代码级描述（如"每帧 update：遍历 enemies，若 distance(enemy, tower) < range 则 tower.fire()，子弹以 speed=5px/frame 飞向 enemy"）；(3) 与其他模块的接口关系（如"读取 G.score，调用 G.Particles.emit()"）；(4) 涉及视觉的模块注明遵守统一美术风格。写得越像可执行的伪代码，最终生成效果越好",
      "relatedEntities": ["entity_id_1", "entity_id_2"]
    }
  ]
}`

export function buildModuleBreakdownUserPrompt(design: any, userInput?: string, orientation?: Orientation) {
  const o = orientation || orientationFromDesign(design)
  let prompt = `${buildOrientationDirective(o)}

# 游戏设计文档
\`\`\`json
${JSON.stringify(design, null, 2)}
\`\`\``

  if (userInput?.trim()) {
    prompt += `\n\n# 用户自定义模块要求
${userInput}`
  }

  prompt += '\n\n请输出功能模块拆分 JSON。'
  return prompt
}

/**
 * Stage 4 — Code Generation Prompt
 * 严格按"功能模块"组织，生成完整可运行的 Phaser 3 单文件游戏代码。
 */
export const CODEGEN_SYSTEM_PROMPT = `你是一名资深网页游戏工程师，精通 Canvas 2D、DOM 交互和游戏架构设计。
任务：根据「游戏设计文档」+「功能模块清单」+「美术资源映射」，生成一份**按模块解耦的多文件**网页游戏代码（运行外壳与资源注入由平台自动完成）。

# 三大铁律（违反任意一条即为不合格代码）：
1. **G.theme 全局唯一权威**：core.js 必须按 uiTokens 初始化 G.theme（含 colors/radius/spacing/fontSize/fontFamily/shadow/animation 全套字段）；所有 drawXXX 视觉参数（颜色/字号/圆角/阴影/动效时长）只能从 G.theme 读取，禁止任何颜色字面量与字号写死。详见 6.1。
2. **统一封装强制走单一函数**：所有按钮一律走 drawButton；所有面板一律走 drawPanel；所有 HUD 数字一律统一字号字重描边；图标 emoji 全游戏映射唯一。
3. **零黑屏防御**：每个 ASSETS 取用 + 每个 init/update/render 必须 try/catch + fallback 渲染，任何资源缺失或异常都不许中断主循环。详见 6.2。

## 输出格式（必须严格遵守）
按"多文件"组织代码，文件之间用如下固定分隔标记隔开（每个文件单独一段，标记必须独占一行）：

\`\`\`
/* ==== FILE: core.js ==== */
...该文件的纯 JavaScript 代码...

/* ==== FILE: scene_title.js ==== */
...

/* ==== FILE: main.js ==== */
...
\`\`\`

硬性约束：
- 只输出若干 JS 文件段；**禁止输出 HTML、<script> 标签、<!DOCTYPE>，禁止 Markdown 代码块标记（不要 \`\`\`）**。HTML 外壳、canvas 容器、window.ASSETS 注入都由平台自动完成。
- 所有文件最终会**按你输出的先后顺序拼接进同一个 <script>，共享同一个全局作用域**。因此：禁止 import / export / require / module；**跨文件禁止重复声明同名 const / let / class / function**。
- 文件顺序必须为：**core.js 第一个**（基础设施）→ 各功能模块文件 → **main.js 最后一个**（入口，负责启动）。
- 跨文件共享的对象/类一律挂到唯一全局命名空间 G 上（在 core.js 顶部 \`const G = (window.G = window.G || {});\`），例如 G.CONFIG / G.Assets / G.Input / G.Scenes / G.SpriteAnimation / G.ui / G.Particles / G.HUD。模块文件通过 G 读写共享状态，实现松耦合。
- 文件数量建议 4~8 个：1 个 core.js + 每个功能模块 1 个文件 + 1 个 main.js。文件名用小写英文+下划线，能见名知意（如 scene_title.js / play_logic.js / enemy.js / hud.js）。

## 工程架构要求（必须严格遵守）

### 0. 各文件职责划分（解耦核心）
- **core.js（基础模块，所有游戏通用的底层设施都放这一个文件）**：
  - 命名空间与配置：\`const G = (window.G = window.G || {}); G.CONFIG = { width, height, fps, ... }\`
  - canvas/ctx 创建 + 设备 DPR/resize 自适应 + appendChild 到 #game-container
  - G.Input：键盘 / 鼠标 / 触摸统一输入管理（pointerdown/move/up，含边缘死区 12px 防误触）
  - G.Assets：资源加载器（含 removeChromaKey、loadAll() 返回 Promise，处理结果缓存在 G.Assets.images）
  - G.SpriteAnimation：序列帧动画类（见 5.2，支持 loop/hitFrame/destroy）
  - G.Audio：Web Audio API 合成音效系统（见 6.4）——点击/得分/受伤/死亡/BGM 全部程序化合成，零音频文件依赖
  - G.ui：drawPanel()（9宫格绘制 ui_panel）、drawButton()（统一 ui_button 按钮皮肤，见 5.1.1）、drawHubIcon()（备用系统入口卡片）
  - G.Layout：UI 矩形注册表（所有按钮/面板/HUD 的 x/y/w/h 唯一声明入口，支撑平台侧可视化布局编辑，见 6.1.1）
  - G.Particles：通用粒子系统
  - G.Scenes：场景管理器，内置 **_bootPhase 启动状态机**（只在启动时显示一次 Loading）+ **transitionTo 快速淡入淡出转场**（场景间切换只做黑幕过渡，不再显示 Loading 画面）（见 7 过场规范）
  - G.HUD：分数/血条/进度条等通用 HUD 渲染
- **各功能模块文件**：每个设计模块（标题、玩法、敌人、计分、弹窗等）单独一个文件，实现该模块的 init/update/render/destroy，并把自己注册到 G.Scenes 或挂到 G 上；模块之间只通过 G 通信，互不直接依赖内部实现。
- **main.js（入口，必须最后）**：实例化、绑定输入、**立即启动 requestAnimationFrame 主循环**（不等 loadAll），调用 G.Assets.loadAll()——加载期间由 _bootPhase 状态机渲染启动 Loading 画面，加载完成后 _bootPhase fadeOut→done **进入 title 场景（登录/开始画面）**。整个启动流程包在 try/catch 中防黑屏。

### 1. core.js 骨架（基础设施，第一个文件）
- **画面尺寸（以 user prompt 顶部【画面方向】指令为准）**：G.CONFIG.width/height 必须严格匹配指定方向——竖版 \`width: 750, height: 1334\`（9:16~9:19.5），横版 \`width: 1280, height: 720\`（16:9）。**禁止输出与指定方向相反的比例**。
- canvas 必须根据父容器(#game-container)做 letterbox/contain 适配，让逻辑分辨率完整显示在容器内，不裁切、不变形。
- **G.theme 全局主题对象（强制必有）**：必须从设计文档 uiTokens / colorPalette 直接生成 \`G.theme\` 对象，包含 colors / radius / spacing / fontSize / fontFamily / shadow / animation / buttonStyle / panelStyle 等字段。**所有界面绘制函数（drawButton / drawPanel / drawText / drawHUD / drawTopBar / drawFeatureCard / drawNavTab 等）一律读取 G.theme 取值**，禁止在绘制代码中硬编码任意颜色、字号、圆角、阴影、动效时长——只能从 G.theme 读取。这是 UE/UI 风格统一的唯一手段。
\`\`\`
/* ==== FILE: core.js ==== */
const G = (window.G = window.G || {});
G.CONFIG = { width: 750, height: 1334, fps: 60 }; // 必须匹配【画面方向】：竖版 750x1334 / 横版 1280x720

// ★★★ 全局主题（UI 设计令牌系统，所有绘制函数的唯一颜色/尺寸/动效来源） ★★★
// 必须从设计文档 uiTokens 字段填充，缺失值用 fallback 兜底。绝对禁止在 drawXXX 中写死颜色/圆角/字号。
G.theme = {
  colors: {
    primary: '#6366f1', primaryDark: '#3730a3', primaryLight: '#a5b4fc',
    secondary: '#8b5cf6', accent: '#fbbf24',
    bgOverlay: 'rgba(0,0,0,0.62)', panelBg: 'rgba(20,24,40,0.85)',
    textPrimary: '#ffffff', textSecondary: 'rgba(255,255,255,0.7)', textStroke: '#1e1b4b',
    border: 'rgba(255,255,255,0.18)',
    success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
  },
  radius: { sm: 8, md: 16, lg: 28, pill: 999 },
  spacing: { xs: 6, sm: 12, md: 20, lg: 32, xl: 48 },
  fontSize: { tiny: 18, small: 24, body: 30, title: 44, hero: 64 },
  fontFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
  shadow: { card: '0 8px 24px rgba(0,0,0,0.35)', button: '0 4px 12px rgba(99,102,241,0.4)', hudPanel: '0 2px 8px rgba(0,0,0,0.5)' },
  animation: { buttonHoverScale: 1.06, buttonPressedScale: 0.94, idleBreathPeriodMs: 1500, transitionMs: 280, popupOpenMs: 220, ripplePeriodMs: 420 },
  // ★ 控件渐变色（每种 kind 一对色，drawButton/drawHubIcon/drawIconButton 必须从这里取，禁止硬编码）
  gradient: {
    cta:       ['#fbbf24', '#f59e0b'],   // 关键 CTA：暖金渐变 + 持续流光（最高视觉权重）
    primary:   ['#6366f1', '#3730a3'],   // 主操作：主色渐变
    secondary: ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.04)'], // 次操作：玻璃磨砂
    danger:    ['#ef4444', '#7f1d1d'],   // 危险/破坏性：红
    ghost:     ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.02)'], // 透明描边
    icon:      ['rgba(20,24,40,0.55)', 'rgba(20,24,40,0.35)'],       // 圆形 icon 按钮底
  },
  // ★ 描边宽度（drawButton/drawPanel 内层/外层描边读这里，禁止硬编码）
  border: { hairline: 1, thin: 1.5, base: 2, bold: 2.5, heavy: 3 },
  // ★ 发光强度（外发光阴影模糊半径），各状态/各档位
  glow: { idle: 8, hover: 22, pressed: 10, selected: 18, focus: 16, ctaIdle: 14, ctaHover: 26 },
  // ★ 控件状态视觉差（idle 为基线，其它状态做差量叠加；所有 drawXXX 必须查表，禁止散落 if/else 数值）
  state: {
    idle:     { scale: 1.000, alpha: 1.00, lift: 0,  shadowMul: 1.0 },
    hover:    { scale: 1.060, alpha: 1.00, lift: -3, shadowMul: 1.6 },
    pressed:  { scale: 0.940, alpha: 1.00, lift: 1,  shadowMul: 0.7 },
    selected: { scale: 1.030, alpha: 1.00, lift: -2, shadowMul: 1.4 },
    disabled: { scale: 1.000, alpha: 0.45, lift: 0,  shadowMul: 0.4 },
    loading:  { scale: 1.000, alpha: 0.85, lift: 0,  shadowMul: 1.0 },
  },
  // ★ 控件尺寸档位（取屏幕百分比 / 系数，drawButton 必须按 kind 选档，禁止任意自由值）
  control: {
    minTap: { w: 88, h: 44 },                                                   // 无障碍最小可点（逻辑像素）
    btn:    { cta: 0.090, primary: 0.080, secondary: 0.070, danger: 0.075, ghost: 0.065 }, // 高度 = 屏高 * 该值
    iconBtnSize: 0.064,                                                          // 圆形 icon 按钮尺寸 = 屏短边 * 该值
    paddingX:    0.35,                                                           // 矩形按钮左右内边距 = 高度 * 该系数
    gap:         0.40,                                                           // 同组按钮间距 = 高度 * 该系数
  },
};
// 工具：从 G.theme 取色并附带透明度（绘制时常用）
G.themeColor = (key, alpha = 1) => {
  const c = (G.theme.colors[key] || '#000');
  if (alpha >= 1) return c;
  // 简单将 #rrggbb 转为 rgba
  if (c.startsWith('#') && c.length === 7) {
    const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
    return \`rgba(\${r},\${g},\${b},\${alpha})\`;
  }
  return c;
};

// ★★★ 布局注册表（UI 矩形唯一权威，支撑「游戏内可视化布局编辑」，强制必有）★★★
// 铁律：任何按钮/图标/面板/HUD 的矩形必须经 G.Layout.rect() 声明，绘制与命中共用它返回的同一对象。
G.Layout = {
  __gf: 1,
  _defs: {},                                                     // scope -> id -> { rect, base, label, kind, editable, constraints }
  _ovr: (window.__GF_LAYOUT__ && window.__GF_LAYOUT__.scenes) || {}, // 平台注入的布局覆盖
  _f(a) { const p = String(a || 'top-left').split('-'); const v = (p[0] === 'top' || p[0] === 'bottom') ? p[0] : 'center'; const h = p[0] === 'center' ? (p[1] || 'center') : (p[1] || 'left');
    return { hx: h === 'left' ? 0 : (h === 'center' ? 0.5 : 1), vy: v === 'top' ? 0 : (v === 'center' ? 0.5 : 1) }; },
  _resolve(o) { const f = this._f(o.anchor); return { x: Math.round(G.CONFIG.width * f.hx + o.x - o.w * f.hx), y: Math.round(G.CONFIG.height * f.vy + o.y - o.h * f.vy), w: Math.round(o.w), h: Math.round(o.h) }; },
  /** 声明一个 UI 矩形，返回已应用覆盖的活对象（直接用于 drawXXX 与 hitTest） */
  rect(scope, id, base, meta) {
    const defs = this._defs[scope] || (this._defs[scope] = {});
    const rect = { x: base.x, y: base.y, w: base.w, h: base.h };
    defs[id] = { rect, base: { x: base.x, y: base.y, w: base.w, h: base.h },
      label: (meta && meta.label) || id, kind: (meta && meta.kind) || 'other',
      editable: (meta && meta.editable) || { move: true, resize: true, hide: false },
      constraints: (meta && meta.constraints) || { minW: 24, minH: 24, keepInside: true } };
    this._apply(scope, id);
    return rect;
  },
  _apply(scope, id) { const d = (this._defs[scope] || {})[id]; if (!d) return; const o = (this._ovr[scope] || {})[id];
    Object.assign(d.rect, o ? this._resolve(o) : d.base); },
  listRaw(scope) { const defs = this._defs[scope] || {};
    return Object.keys(defs).map((id) => ({ id, rect: defs[id].rect, label: defs[id].label, kind: defs[id].kind, editable: defs[id].editable, constraints: defs[id].constraints, origin: 'registry' })); },
  set(scope, id, r) { const d = (this._defs[scope] || {})[id]; if (d) Object.assign(d.rect, r); },
  applyOverrides(scenes) { this._ovr = scenes || {}; this.reapply(); },
  reapply() { for (const s in this._defs) for (const id in this._defs[s]) this._apply(s, id); },
};

// canvas / ctx 初始化（含 DPR 适配，appendChild 到 #game-container）
G.canvas = document.createElement('canvas');
G.ctx = G.canvas.getContext('2d');
// ...resize 适配、document.getElementById('game-container').appendChild(G.canvas)...

G.Input = { keys: {}, mouse: { x: 0, y: 0, down: false }, init() {/*...*/} };
G.Assets = { images: {}, loadAll() { /* 返回 Promise，内部对非 bg_ 素材跑 removeChromaKey */ } };
G.SpriteAnimation = class { /* 见 5.2，构造 (img, frameCount, {fps=12, loop, hitFrame, onHitFrame}) + reset() + destroy() */ };
G.ui = { drawPanel(/*...*/) {/*9宫格 ui_panel + G.theme.radius.lg + G.theme.shadow.card*/}, drawButton(/*...*/) {/*统一 ui_button 皮肤，颜色全部读 G.theme.colors*/} };
G.Particles = { list: [], emit(/*...*/) {}, update(dt) {}, render(ctx) {} };
G.HUD = { drawScore(/*...*/) {/*用 G.theme.fontSize.title + G.theme.colors.textPrimary*/}, drawBar(/*...*/) {/*用 G.theme.colors.primary 填充*/} };
G.Scenes = { /* 场景管理器 + _bootPhase 启动状态机 + transitionTo（duration = G.theme.animation.transitionMs），见第 7 节 */ };

// ★★★ 音频系统（Web Audio API 合成音效，强制必须实现） ★★★
G.Audio = {
  ctx: null, masterGain: null, muted: { sfx: false, bgm: false },
  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  // 合成音效：用 OscillatorNode + GainNode 包络线合成短音效
  play(name) { /* 根据 name 调用对应合成函数 */ },
  // 背景音乐：低音 OscillatorNode 循环 + 和弦进行
  playBGM() { /* 启动循环背景音 */ },
  stopBGM() { /* 停止 */ },
  setVolume(type, vol) { /* 'sfx'|'bgm', 0~1 */ },
};
// 首次用户交互后激活 AudioContext（浏览器策略要求）
document.addEventListener('pointerdown', () => G.Audio.resume(), { once: true });

// ★ 弹窗管理器：统一管理主界面功能弹窗（商店/排行榜/设置/帮助等）
G.popups = {}; // 注册表：{ id: { init, update, render, destroy } }
G.popupStack = []; // 当前打开的弹窗栈（支持叠加）
G.openPopup = function(id, params) {
  const popup = G.popups[id];
  if (!popup) { console.warn('Popup not found:', id); return; }
  const instance = { id, ...popup, state: {}, animProgress: 0, closing: false };
  if (popup.init) popup.init.call(instance, params);
  G.popupStack.push(instance);
};
G.closePopup = function(id) {
  // 设置关闭动画状态，动画结束后移除
  const idx = id ? G.popupStack.findIndex(p => p.id === id) : G.popupStack.length - 1;
  if (idx >= 0) G.popupStack[idx].closing = true;
};
G.registerPopup = function(id, handler) { G.popups[id] = handler; };
// 弹窗在主循环中渲染（在场景 render 之后、最顶层绘制）：
// popupStack.forEach(p => { p.update(dt); p.render(ctx); if (p.closing && p.animProgress >= 1) 移除 });
\`\`\`

### 2. 功能模块文件骨架（每个设计模块一个文件，放在 core.js 之后、main.js 之前）
\`\`\`
/* ==== FILE: scene_title.js ==== */
// 登录/标题画面：只有背景图 + 游戏名称 + 「登录游戏」按钮三个元素，禁止任何其他内容
G.Scenes.register('title', {
  init() {
    // 准备 bg_title 全屏背景、标题文字动画状态、唯一的「登录游戏」按钮状态
    this.titleAnimPhase = 0; // 标题入场动画进度
    this.titleGlow = 0; // 循环光泽效果
    // ★ UI 矩形必须经 G.Layout.rect 声明（见 6.1.1），绘制与命中均直接用这个对象
    this.btnRect = G.Layout.rect('title', 'start',
      { x: (G.CONFIG.width - 480) / 2, y: G.CONFIG.height * 0.72, w: 480, h: 140 },
      { label: '登录游戏', kind: 'button' });
  },
  update(dt) {
    // 更新标题动画（入场 + 循环浮动/光泽）+ 按钮 hover/press 状态
    // 点击按钮后 G.Scenes.transitionTo('gameplay')（直接进入玩法）
  },
  render(ctx) {
    // 1) 铺满 bg_title 背景图
    // 2) 中上部绘制游戏标题（字体美术风格符合题材，带描边+发光+浮动动效）
    // 3) 用 G.ui.drawButton(ctx, this.btnRect.x, this.btnRect.y, this.btnRect.w, this.btnRect.h, ...) 画唯一的「登录游戏」按钮
    // 禁止任何其他元素（无装饰粒子/无额外文字/无多余按钮）
  },
  destroy() {}
});

\`\`\`

### 3. main.js 入口骨架（最后一个文件，负责启动）
\`\`\`
/* ==== FILE: main.js ==== */
(function start() {
  try {
    G.Input.init();
    let lastTime = performance.now();
    function loop(now) {
      const dt = Math.min(now - lastTime, 50); lastTime = now;
      try { G.Scenes.update(dt); G.Scenes.render(G.ctx); } catch (e) { console.error(e); }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop); // 立即启动主循环（加载期间显示启动 Loading 画面）

    // ═══ 唯一的启动 Loading 阶段 ═══
    // 在加载期间，G.Scenes._bootPhase = 'loading' 控制渲染启动画面
    G.Scenes._bootPhase = 'loading';
    G.Scenes._bootTimer = 0;
    G.Assets.loadAll().then(() => {
      // 加载完成 → 标记 boot 完成 → 进入 title 场景（登录/开始画面）
      G.Scenes._bootPhase = 'fadeOut';
      G.Scenes._bootTimer = 0;
      G.Scenes._bootTarget = 'title';
    }).catch((e) => {
      console.error(e);
      G.Scenes._bootPhase = 'fadeOut';
      G.Scenes._bootTimer = 0;
      G.Scenes._bootTarget = 'title';
    });
  } catch (e) { console.error(e); }
})();
\`\`\`

**启动流程铁律（极其重要）**：
- 游戏从加载到进入登录画面 **全程只能看到一次 Loading 画面**（即启动 boot 阶段）
- **禁止生成 mainHub 场景**：游戏只包含三个场景：title（登录/开始画面）、gameplay（核心玩法）、settle（结算画面）
- G.Scenes 必须维护 _bootPhase 状态机：'loading'（显示 bg_loading + 进度条）→ 'fadeOut'（渐隐 300ms）→ 'done'（进入 title 场景的 init+render，不再走 transitionTo）
- **启动完毕进入 title 时禁止调用 transitionTo**——因为 transitionTo 内部又会显示一次过场 Loading，导致用户看到连续两次 loading
- boot 阶段的 progress 应挂钩真实加载进度（loadedCount/totalCount），加载本身很快则最低展示 800ms（用 Math.max(elapsed, 800) 兜底）后 fadeOut
- 主循环在 boot 阶段就已运行（显示 loading 画面），不要在 loadAll().then 里才启动 requestAnimationFrame

### 3.1 模块规范
- 每个功能模块文件必须自包含：实现 init/update/render/destroy，并在文件加载时把自己注册进 G.Scenes（或挂到 G 上）
- 模块间只通过 G 上的共享状态/方法通信，禁止跨文件直接引用对方内部变量，保持松耦合
- 同名标识符跨文件唯一；公共能力（按钮、面板、粒子、HUD、动画）一律复用 core.js 里的实现，不要在模块文件里另起一套

### 4. 渲染策略
- 优先使用 Canvas 2D API（适用于大多数 2D 游戏）
- Canvas 自适应：宽高按设备 DPI 缩放，CSS 100% 填满容器
- 如果游戏是纯 UI 交互类（卡牌、棋盘、文字冒险），可用 DOM 元素渲染

### 5. 美术资源处理
- 运行时全局变量 window.ASSETS 是一个对象，key 为资源 ID，value 为 data:image URL
- 加载图片示例：
  \`\`\`
  const img = new Image();
  img.src = window.ASSETS['asset_id'];
  img.onload = () => { /* 使用 img */ };
  \`\`\`
- 必须使用模块清单中列出的 ASSETS[id] 来渲染对应实体，严禁自己绘制矩形占位（除非该模块确实没有关联资源）
- 没有关联资源的模块，才可用 Canvas 绘制彩色几何图形占位（带描边和标签文字）
- 所有图片必须等 onload 后再绘制到 canvas

#### 5.0 去除白边/绿幕处理（重要！所有非背景素材必须执行）
- 美术素材使用纯绿色(#00FF00)色键背景生成，代码中必须在加载后去除绿幕。
- **必须使用邻接扩展法（从纯绿幕向外逐层扩展清理）**，只移除与绿幕背景相连的绿色像素，保留素材自身的绿色部分（如植物、绿色角色等）：
  \`\`\`
  // 去除绿幕背景（邻接扩展法），返回可直接用于 drawImage 的 canvas 元素
  // 三阶段：1) 标记纯绿幕+白底→透明  2) 从已透明区域向内扩展清理边缘（3轮）  3) 去黑边
  function removeChromaKey(img) {
    const cvs = document.createElement('canvas');
    cvs.width = img.naturalWidth || img.width;
    cvs.height = img.naturalHeight || img.height;
    const c = cvs.getContext('2d');
    c.drawImage(img, 0, 0);
    const imageData = c.getImageData(0, 0, cvs.width, cvs.height);
    const d = imageData.data;
    const w = cvs.width, h = cvs.height;
    const totalPx = w * h;
    // —— 1) 标记并移除纯绿幕 + 近白色背景
    const removed = new Uint8Array(totalPx);
    for (let i = 0; i < totalPx; i++) {
      const idx = i * 4;
      const r = d[idx], g = d[idx+1], b = d[idx+2];
      if (g > 150 && r < 100 && b < 100 && g - r > 60 && g - b > 60) {
        removed[i] = 1;
        d[idx+3] = 0;
      } else if (r > 240 && g > 240 && b > 240) {
        removed[i] = 1;
        d[idx+3] = 0;
      }
    }
    // —— 2) 逐层扩展清理边缘（最多3轮，处理JPEG压缩产生的渐变绿边）
    for (let pass = 0; pass < 3; pass++) {
      const changed = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (removed[i]) continue;
          const idx = i * 4;
          if (d[idx+3] === 0) continue;
          let nearRemoved = false;
          if (x > 0 && removed[i-1]) nearRemoved = true;
          else if (x < w-1 && removed[i+1]) nearRemoved = true;
          else if (y > 0 && removed[i-w]) nearRemoved = true;
          else if (y < h-1 && removed[i+w]) nearRemoved = true;
          if (!nearRemoved) continue;
          const r = d[idx], g = d[idx+1], b = d[idx+2];
          if (g > Math.max(r, b) && (g - Math.max(r, b)) > 30) {
            changed.push(i);
            d[idx+3] = 0;
          } else if (g > Math.max(r, b) + 15) {
            d[idx+1] = Math.max(r, b) + 5;
          }
        }
      }
      for (const i of changed) removed[i] = 1;
      if (!changed.length) break;
    }
    // —— 3) 去黑边：邻接透明的极暗像素置透明
    const alpha2 = new Uint8Array(totalPx);
    for (let i2 = 0, p2 = 0; i2 < d.length; i2 += 4, p2++) alpha2[p2] = d[i2 + 3];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (alpha2[p] === 0) continue;
        const idx = p * 4;
        if (d[idx] + d[idx+1] + d[idx+2] >= 60) continue;
        let hasT = false;
        for (let dy = -1; dy <= 1 && !hasT; dy++) {
          for (let dx = -1; dx <= 1 && !hasT; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && alpha2[ny * w + nx] === 0) hasT = true;
          }
        }
        if (hasT) d[idx + 3] = 0;
      }
    }
    c.putImageData(imageData, 0, 0);
    return cvs; // 返回 canvas 元素，可直接作为 drawImage 的 source
  }
  \`\`\`
- **注意：removeChromaKey 返回的是 canvas 元素（不是 Image），可以直接传给 ctx.drawImage() 使用，无需等 onload**
- 加载素材时的正确流程：
  \`\`\`
  function loadAsset(id) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        if (id.startsWith('bg_')) {
          resolve(img); // 背景图直接使用
        } else {
          resolve(removeChromaKey(img)); // 返回处理后的 canvas，立即可用
        }
      };
      img.onerror = () => resolve(null); // 加载失败不阻塞游戏
      img.src = window.ASSETS[id];
    });
  }
  \`\`\`
- 背景图（bg_ 开头的）不需要去绿幕，直接 drawImage 使用
- 所有角色/道具/子弹等非背景素材都必须经过 removeChromaKey 处理后再使用
- **【运行时素材底色铁律（强制）】**：游戏代码在绘制任何非背景素材（角色/道具/宝石/塔/怪物/UI图标等）时，**严禁**在 drawImage 前后使用 fillRect/fillStyle 绘制白色(#FFFFFF/#FFF/rgb(255,255,255)/white)或绿色(#00FF00/rgb(0,255,0)/lime/chroma green)矩形作为"底色/底板/占位/边框填充"。素材已通过 removeChromaKey 去除背景，必须直接绘制在画布上（透明叠加）。若素材加载失败需要 fallback 占位图形，颜色必须从 G.theme.colors 派生（如 primary/secondary/accent），**绝对禁止使用纯白或纯绿作为 fallback 颜色**。违反此规则会导致素材周围出现不应存在的白色/绿色色块。

### 5.0.1 资源加载与防黑屏（core.js 的 G.Assets，必须遵循）
- **黑屏的根本原因是资源未加载完就启动主循环，或初始化阶段出错导致循环从未启动**
- core.js 里的 G.Assets.loadAll() 必须一次性把 window.ASSETS 全部加载并处理好（非 bg_ 素材跑 removeChromaKey），结果缓存到 G.Assets.images，main.js 等它 resolve 后再 transitionTo('title') 并启动循环：
  \`\`\`
  // 写在 core.js 内
  G.Assets.images = {};
  G.Assets.loadAll = function() {
    const ids = Object.keys(window.ASSETS || {});
    if (!ids.length) return Promise.resolve();
    return Promise.all(ids.map(id => new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        G.Assets.images[id] = id.startsWith('bg_') ? img : removeChromaKey(img);
        resolve();
      };
      img.onerror = () => resolve(); // 单张失败不阻塞，绝不卡死
      img.src = window.ASSETS[id];
    })));
  };
  G.Assets.get = function(id) { return G.Assets.images[id]; };
  \`\`\`
- **关键要点**：
  1. canvas 必须先 appendChild 到 #game-container，否则不可见
  2. 加载阶段（transitionTo 之前）由过场 Loading 画面显示进度，证明脚本在运行
  3. 所有资源 Promise.all 完成后才进入标题场景并启动 requestAnimationFrame 主循环
  4. removeChromaKey 返回的 canvas 元素可以直接当 img 使用（drawImage 接受 canvas）
  5. 主循环用 requestAnimationFrame 驱动，使用 dt（毫秒）做帧间隔；update/render 包 try/catch，单帧异常不得中断循环
  6. 永远不要在主循环内创建新 Image 或 canvas 对象

### 5.1 背景图使用（每个界面必须有背景）
- 标题画面必须使用 ASSETS['bg_title'] 作为全屏背景，用 drawImage 铺满 canvas
- 游戏进行中必须使用 ASSETS['bg_gameplay'] 作为背景层，在每帧 render 时最先绘制
- 结算画面使用 ASSETS['bg_gameover']（如果没有则复用 bg_title 加暗色遮罩）
- 背景图绘制方式：ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height) 确保铺满

### 5.1.1 UI 装饰素材使用（面板/按钮全局统一风格，强制）
- 如果 ASSETS 中存在 'ui_panel'，所有弹窗、HUD面板、结算面板的底板**必须**使用该素材绘制，且**必须用九宫格(9-slice)铺满整个面板矩形**（见 drawPanel/draw9Slice）——四角不拉伸变形、四边沿单轴拉伸、中心填充，确保**边缘与圆角处完全贴合、无任何空白或露底**；严禁用纯代码画矩形当面板，也严禁让素材只贴在中间留出空边。
- 如果 ASSETS 中存在 'ui_button'，游戏中**每一个按钮**（标题画面的开始按钮、暂停菜单按钮、所有二级弹窗的确认/取消按钮、结算画面的重玩/返回按钮）都**必须**使用同一个 ui_button 素材作为背景，并**用九宫格铺满整个按钮区域**（边缘无空隙、不变形），再在其上叠加图标+文字。严禁不同界面用不同样式的按钮，必须风格完全统一。
- **【按钮纹理 = 对称 + 平铺 + 风格统一，铁律】** 所有按钮控件的美术底图必须满足以下视觉语言要求，否则视觉立刻"塌"：
  1) **整体美术风格延续** —— ui_button 的配色、描边、材质、光影必须从 suggestedArtStyle 与 G.theme.colors 派生，与 ui_panel / 主背景 / icon_* 是同一套"设计语言锚点"，禁止出现孤立风格的按钮（如卡通游戏里塞一个赛博朋克按钮）。
  2) **沿中轴对称的图形** —— ui_button 的视觉构成必须沿水平中轴 + 垂直中轴**双向镜像对称**：左右半相同、上下半也对称（最低限度也要左右对称）。任何不对称元素（如一颗宝石、一道斜杠光带、一个单边角标）烘焙进 ui_button 都不合格；这些只能在 drawButton 运行期叠加。
  3) **平铺铺满整个按钮范围** —— 纹理必须填满整个按钮控件矩形，**绝对禁止**素材区小于按钮控件区（不允许 +padding/+margin/+inset）；按钮越大，4 边和中心越长 —— 9-slice 必须"看起来像可拉伸的连续纹理"而不是"中间一个 logo 四周空白"。
  4) **角部强化、中部留呼吸** —— 4 角是不可拉伸的实心装饰锚点（铆钉/宝石/雕花/金属角片）；4 边是单轴方向重复的细纹（如金属凹槽、木纹、电路线、丝线编织）；中心是低对比的均匀底纹（磨砂/噪点/雕花纹理）便于叠加文字和图标；状态（hover/press/disabled）由代码层在素材之上加滤镜/光晕/缩放表达，绝不依赖素材里画好的状态。
  5) **draw9Slice 强校验** —— 调用 draw9Slice 时 border 参数必须取 ui_button 实际四角装饰宽度（推荐 28~36px），中段必须可重复；运行期不得对目标矩形做任何 inset；按钮做圆角时由 roundRectPath 的 clip 负责切角，9-slice 仍传完整矩形。
- **铺满 / 无空边铁律（按钮底图必须填满控件，零内缩）**：任何把美术素材当作"控件底板/背景"使用的场景（按钮、面板、卡片、HUD条、图标卡），素材都必须**完整覆盖控件矩形、四边到边、无空余像素**。带边框的素材一律走 \`draw9Slice\`（保边角）；无边框的整张纹理用 \`drawImageCover\`（等比覆盖+裁切，绝不用 contain 留黑边）。
  - **正确**：\`draw9Slice(ctx, btnImg, dx, dy, dw, dh)\` ← 坐标 = 控件外框坐标，尺寸 = 控件尺寸
  - **错误（严禁！）**：\`draw9Slice(ctx, btnImg, dx+4, dy+4, dw-8, dh-8)\` ← 内缩导致四周露底色/露背景
  - **错误（严禁！）**：\`drawImage(btnImg, dx+margin, dy+margin, dw-margin*2, dh-margin*2)\` ← 同上
  - **错误（严禁！）**：不加 clip 直接 \`drawImage(btnImg, dx, dy, btnImg.width, btnImg.height)\` ← 素材原始尺寸 ≠ 控件尺寸会留空或溢出
  - **关键原则**：draw9Slice / drawImageCover 的目标矩形 **必须与控件的 clip 区域完全重合**，不允许任何 padding/inset/margin 使素材区域小于控件区域。
- **控件尺寸适中 + UE 布局**：按钮高度建议取屏幕高度的 7%~9%、宽度按文字+图标自适应并留左右内边距（约高度的 35%）；同组按钮等高等间距（间距≥按钮高度的 40%）；面板四周与屏幕边缘留安全边距（≥屏宽 5%），面板内元素留统一内边距（≥24px）。控件不可过大顶满全屏，也不可过小难以点击（最小可点区域 ≥ 88x44 逻辑像素）。整体遵循"顶部标题区 / 中部主内容区 / 底部操作区"的清晰分区，垂直节奏统一、视觉重心居中。
- **统一封装**：必须实现唯一的 \`drawButton(ctx, x, y, w, h, opts, state)\` 工具函数，参数 opts = { text, icon, kind } —— **icon 必填**（emoji/Unicode 字符），kind 区分 primary/secondary/danger/ghost。所有界面绘制按钮一律走它，确保按钮"图标 + 文字"两段式布局、卡牌手游级视觉档次、状态反馈完全一致。**禁止纯文字按钮**。
- 视觉规格（参考炉石/Marvel Snap/皇室战争等热榜卡牌手游）：
  0) **【按钮底色纯色实底铁律】**：所有按钮（尤其 cta/primary）的 fillStyle 必须为**不透明纯色实底**（alpha=1.0 的单一饱和颜色，从 G.theme.colors 派生），绝对禁止 ghost空心/透明底/无填充。边缘必须有装饰性描边（与游戏美术题材一致的边框风格：如奇幻=金色花纹、科技=发光线框、卡通=厚描边+圆角、古风=木纹/铜钉），确保按钮看起来像游戏世界内的原生 UI 元素；
  1) **外发光描边**：state==='hover' 时模糊 18~24，颜色 = primary 60% 透明；
  2) **边缘装饰框**：2~3px 装饰性描边（配色从 G.theme.colors 派生，风格匹配 suggestedArtStyle），紧贴主体；
  3) **纯色实底内层**：kind==='cta' 用主题色纯色实底（可略带微渐变但必须不透明），primary=主色、danger=红、ghost=半透明白（仅 ghost 允许半透明）；
  4) **顶部高光弧**：在按钮上半部 1/3 区域叠一层白色 18~30% 透明的水平渐变，制造光面反射；
  5) **底部内阴影**：下方 1/3 叠一层黑色 25% 透明渐变，强化立体感；
  6) **图标 + 文字两段式**：图标在左 1/3 居中，文字在右 2/3 居中（带白色填充 + 深色描边 1.5px + 柔阴影）；
  7) **状态**：idle 微呼吸（scale 1±0.005 / 1.5s）、hover scale 1.06 + 发光增强、pressed scale 0.94 + 闪光、disabled 灰度 + alpha 0.5；
 8) 关键 CTA 按钮（如「进入游戏」「开始游戏」）额外加一层流动光斑（沿边框顺时针运动）。
- **控件类目（kind 枚举，drawButton 必须按 kind 切换 G.theme.gradient/glow/control 取值）**：
  · 『cta』        关键号召（标题页「进入游戏」/ 主界面英雄面板 CTA / 复活 / 立即开始）：**不透明纯色实底填充（绝对禁止透明/空心）** + 与美术题材匹配的边缘装饰描边 + 持续流光 + 最大圆角 + 最大阴影；**全游戏同一时刻只允许出现 1 个 cta**，是绝对的视觉焦点。
  · 『primary』    主操作（确认 / 下一步 / 战斗 / 购买）：主色渐变 + hover 时流光；同一面板内 ≤ 1 个。
  · 『secondary』  次操作（取消 / 返回 / 跳过）：玻璃磨砂 + 细描边；与 primary 等高，弱化光泽。
  · 『danger』     危险/破坏性（删除 / 退出 / 放弃 / 解散队伍）：红渐变 + 红外发光。
  · 『ghost』      纯描边轻量入口（关闭遮罩等）：背景接近透明 + 1px 高亮描边。
  · 『icon』       仅图标的圆形/方形按钮（关闭✕ / 返回‹ / 设置⚙ / 音量🔊）：见 §5.1.4 drawIconButton。
- **控件状态（state 枚举，6 态全部读 G.theme.state[state] 做差量叠加）**：『idle / hover / pressed / selected / disabled / loading』。
  · 『idle』      微呼吸（period = G.theme.animation.idleBreathPeriodMs，scale 振幅 ±0.005）；
  · 『hover』     scale + lift（查表）+ 发光增强（blur = G.theme.glow.hover）+ 光标变 pointer；
  · 『pressed』   缩 0.94 + 顶部高光闪一帧 + 立即触发一次 G.Particles.emit 中心扩散波纹（半径动画 ripplePeriodMs）；
  · 『selected』  常驻高亮（边框 = G.theme.colors.accent + 底部 3px 圆角指示条）；用于 navTab 当前项 / segmented 当前选项 / 选中卡片，**只要语义为“已选中”就保留，不能仅在 hover 时短暂亮起**；
  · 『disabled』  alpha 0.45 + 灰度滤镜 + 关闭流光与呼吸 + 不接受输入；
  · 『loading』   禁用输入 + 文字区替换为旋转弧（角速度 2π / (transitionMs * 0.6)），底板与描边保留。
- **尺寸档位（必须从 G.theme.control 取，禁止任意像素字面量）**：
  · 按钮高度 『h = G.canvas.height * G.theme.control.btn[kind]』；
  · 按钮宽度 『w = h * (iconOnly ? 1 : (textChars * 0.55 + 1.6)) + h * paddingX * 2』，且 『w ≥ minTap.w』，『h ≥ minTap.h』；
  · 同组按钮间距 『gap = h * G.theme.control.gap』；
  · 圆形 icon 按钮直径 『d = Math.min(W, H) * iconBtnSize』，最小不低于 minTap 短边。
- **图标取用（强制优先级，禁止颠倒）**：drawButton 同时接收 『opts.iconImg』（HTMLImageElement / Canvas，**优先**）与 『opts.icon』（字符串兜底）。**ASSETS 中存在 『icon_xxx』 时必须传 iconImg**，仅当资源缺失才降级 emoji。同一语义全游戏只允许唯一映射（如「开始」全局只用 ▶ 或 icon_play，二者择其一不混用，列在游戏顶部 ICON_MAP 常量里集中维护）。
- **命中区域（铁律，避免穿透）**：drawButton 必须在每帧把命中矩形写入 『opts.hitRect = {x,y,w,h}』（**未叠加 state.scale 的原始矩形**）。所有 hover/press 检测以 『opts.hitRect』 为准，**禁止用绘制时的 dx/dy/dw/dh（含 scale/lift 偏移）做检测**——否则 pressed 缩小后命中区会跳变导致下一帧瞬间脱离命中。
- **layout 锁定（防错位）**：每个场景在 init() 时一次性预算所有按钮的 hitRect 并存到 this.layout（按 G.canvas.width/height 计算）；resize 后整体重算；update 只读 layout 不重算坐标。

- 使用 UI 素材的示例（icon + label 两段式 + 多层堆叠）：
  \`\`\`
  // 【通用】把一张图按"cover"方式铺满目标矩形：等比放大到完全覆盖、超出部分裁掉，
  // 保证目标区域被完全填满、四边无空隙、不变形（仅可能裁掉极少边缘）。
  function drawImageCover(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(w / iw, h / ih);     // 取较大缩放 => 覆盖（无空边）
    const dw = iw * scale, dh = ih * scale;
    const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2; // 居中，超出裁掉
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }
  // 【通用】九宫格(9-slice)拉伸：四角保持原始像素不变形，四边只沿单轴拉伸，中心双轴拉伸。
  // 用于带边框/描边的 UI 素材(ui_panel / ui_button)，可铺满任意尺寸控件且边缘无空隙、圆角不糊。
  // border = 源图四周不参与拉伸的边距(像素)，按素材边框厚度取值(默认取短边的 1/3，封顶 48px)。
  function draw9Slice(ctx, img, x, y, w, h, border) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const b = Math.max(1, Math.min(border || Math.floor(Math.min(iw, ih) / 3), 48, Math.floor(Math.min(w, h) / 2)));
    const sb = Math.min(b, Math.floor(Math.min(iw, ih) / 2));
    const ix = [0, sb, iw - sb, iw], ox = [x, x + b, x + w - b, x + w];
    const iy = [0, sb, ih - sb, ih], oy = [y, y + b, y + h - b, y + h];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const sw = ix[c + 1] - ix[c], sh = iy[r + 1] - iy[r];
      const dw = ox[c + 1] - ox[c], dh = oy[r + 1] - oy[r];
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      ctx.drawImage(img, ix[c], iy[r], sw, sh, ox[c], oy[r], dw, dh);
    }
  }
  // 面板底板：带边框纹理走 9-slice 铺满（边缘无空隙、不变形）；无明显边框的整张纹理可改用 drawImageCover。
  function drawPanel(ctx, panelImg, x, y, w, h) {
    draw9Slice(ctx, panelImg, x, y, w, h);
  }
  // 全局唯一按钮绘制 —— 必须传入 opts.icon
  function drawButton(ctx, x, y, w, h, opts, state) {
    const { text = '', icon = '▶', kind = 'primary' } = opts || {};
    const scale = state === 'hover' ? 1.06 : (state === 'pressed' ? 0.94 : 1);
    const dw = w * scale, dh = h * scale;
    const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
    const r = Math.min(dh, dw) * 0.32;
    const colors = kind === 'danger'
      ? ['#ef4444', '#7f1d1d']
      : kind === 'ghost'
        ? ['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.04)']
        : [G.theme.primary || '#6366f1', G.theme.primaryDark || '#3730a3'];

    // 1) 外发光描边
    ctx.save();
    ctx.shadowColor = colors[0]; ctx.shadowBlur = state === 'hover' ? 24 : 14;
    roundRectPath(ctx, dx, dy, dw, dh, r);
    ctx.lineWidth = 2.5; ctx.strokeStyle = colors[0]; ctx.stroke();
    ctx.restore();

    // 2) ui_button 素材铺满（铁律：坐标必须 = 按钮外框坐标，零 padding，零 inset）
    const btnImg = G.Assets.images['ui_button'];
    if (btnImg) {
      // ★ draw9Slice 的 x/y/w/h 必须与按钮外框完全重合（dx,dy,dw,dh），绝不能缩小！
      // ★ 禁止写 draw9Slice(ctx, img, dx+pad, dy+pad, dw-pad*2, dh-pad*2) ← 这会导致四周露底色！
      ctx.save(); roundRectPath(ctx, dx, dy, dw, dh, r); ctx.clip();
      draw9Slice(ctx, btnImg, dx, dy, dw, dh);
      ctx.restore();
    } else {
      const grad = ctx.createLinearGradient(dx, dy, dx + dw, dy + dh);
      grad.addColorStop(0, colors[0]); grad.addColorStop(1, colors[1]);
      roundRectPath(ctx, dx, dy, dw, dh, r); ctx.fillStyle = grad; ctx.fill();
    }

    // 3) 顶部高光弧
    ctx.save(); roundRectPath(ctx, dx, dy, dw, dh, r); ctx.clip();
    const hg = ctx.createLinearGradient(0, dy, 0, dy + dh * 0.5);
    hg.addColorStop(0, 'rgba(255,255,255,0.32)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg; ctx.fillRect(dx, dy, dw, dh * 0.5);
    // 4) 底部内阴影
    const sg = ctx.createLinearGradient(0, dy + dh * 0.6, 0, dy + dh);
    sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = sg; ctx.fillRect(dx, dy + dh * 0.6, dw, dh * 0.4);
    ctx.restore();

    // 5) 内层高光描边
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    roundRectPath(ctx, dx + 1.5, dy + 1.5, dw - 3, dh - 3, r - 1.5); ctx.stroke();

    // 6) 图标 + 文字两段式
    const iconSize = Math.floor(dh * 0.55);
    const labelSize = Math.floor(dh * 0.40);
    ctx.font = 'bold ' + iconSize + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(icon, dx + dw * 0.22, dy + dh / 2);
    ctx.fillStyle = '#fff'; ctx.fillText(icon, dx + dw * 0.22, dy + dh / 2);

    ctx.font = 'bold ' + labelSize + 'px sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(text, dx + dw * 0.62, dy + dh / 2);
    ctx.fillStyle = '#fff'; ctx.fillText(text, dx + dw * 0.62, dy + dh / 2);

    // 7) 关键 CTA 流动光斑（仅 kind==='primary' 且 state!=='disabled'）
    if (kind === 'primary' && state !== 'disabled') {
      const t = (performance.now() % 1800) / 1800;
      ctx.save(); roundRectPath(ctx, dx, dy, dw, dh, r); ctx.clip();
      ctx.globalAlpha = 0.35;
      const sx = dx - dw * 0.4 + dw * 1.4 * t;
      const lg = ctx.createLinearGradient(sx, 0, sx + dw * 0.3, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.6)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg; ctx.fillRect(dx, dy, dw, dh);
      ctx.restore();
    }
  }
  // 辅助：roundRectPath / withAlpha / shade 自行实现（CanvasRenderingContext2D 上勾画圆角矩形路径）
  \`\`\`
- 只有当 ASSETS 中确实没有 ui_panel / ui_button 时，才退化为纯代码绘制（按上面的 7 层堆叠走），且仍要保证所有界面按钮"图标+文字+多层视觉"完全一致

### 5.1.2 Gameplay HUD 工具函数 —— drawTopBar / drawFeatureCard / drawNavTab（仅限 gameplay 场景 HUD/弹窗使用，登录画面禁用）
**注意：登录画面（title）严格只有背景图 + 游戏名称 + 登录按钮三个元素，以下函数仅用于 gameplay 场景中的 HUD 和二级弹窗。**

**UI 布局设计系统（gameplay HUD / 弹窗内部适用，禁止随手赋值）**
- **间距系统**：左右安全边 \`pad = W * 0.04\`（竖版）/ \`pad = W * 0.03\`（横版）。卡片间 gap = \`pad / 2\`。
- **对称轴**：\`W/2\` 是全屏对称轴，所有面板居中，偏移不超 8px。
- **图标尺寸（按区域高度 h 派生，禁止随手 px 数）**：
  · topBar 头像直径 = \`barH * 0.62\`（≥ 44px）
  · 资源胶囊高 = \`barH * 0.56\`，图标 = \`ph * 0.70\`，数字 = \`ph * 0.46\`
  · 大标题 = \`heroH * 0.18\`，副标题 = \`heroH * 0.08\`
  · navTab 图标 = \`Math.max(36, navH * 0.44)\`，标签 = \`Math.max(16, navH * 0.18)\`
- **圆角**：从 \`G.theme.radius\` 派生；描边三档 1.5/2.5/3.5。
- **色彩**：从 \`G.theme.accentPalette\` 顺序循环取色，禁止 hex 随手赋值。
- **负空间**：画面至少 12% 为背景，禁止区域贴满。

**A) drawTopBar(ctx, profile, currencies)** —— gameplay HUD 顶部状态栏（屏高约 10%）
- 左侧玩家卡：圆形头像框（2~3px 发光描边）+ 昵称 + 等级 + 经验条。
- 右侧资源胶囊：1~3 个药丸形（半透明磨砂底 + 内发光描边），每个 = 图标 + 数值。
- 无玩家/经济系统时退化为 Logo + 占位。

**B) drawFeatureCard(ctx, x, y, w, h, item, state)** —— 功能卡片/焦点面板（弹窗、系统页中的主视觉区域）
- 大号圆角面板（圆角 28~36）：双色渐变底 + 磨砂噪点 + 径向柔光 + 外层描边 + 底部投影。
- 内容：标题 item.label + 副标题 item.sub + 底部 CTA（drawButton）。
- 动效：idle 微呼吸 + 流动高光；hover 增辉放大；press 波纹回弹。

**C) drawNavTab(ctx, x, y, w, h, item, state)** —— gameplay HUD 底部/侧边导航标签。
- 图标 ≥ 36px（Math.max(36, h*0.44)），标签 ≥ 16px（Math.max(16, h*0.18)）。
- 图标优先 item.icon（Image/canvas），降级 emoji 兜底。
- state 4 态：normal（alpha 0.78）/ hover（上浮+发光）/ pressed（缩+波纹）/ selected（背板+指示条+光点常驻）。
- selected 持久化：当前弹窗对应 navItem 保持 selected，关闭后回 normal。

参考实现（视觉档次参考，用于 gameplay HUD，可微调数值）：
\`\`\`
G.ui.drawTopBar = function (ctx, profile, currencies) {
  const W = G.canvas.width, H = G.canvas.height, barH = H * 0.10, pad = W * 0.04;
  const av = barH * 0.62, ax = pad, ay = (barH - av) / 2 + H * 0.012;
  ctx.save();
  ctx.beginPath(); ctx.arc(ax + av/2, ay + av/2, av/2, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = withAlpha(G.theme.primary, 0.9);
  ctx.shadowColor = G.theme.primary; ctx.shadowBlur = 10; ctx.stroke();
  ctx.restore();
  // 资源胶囊（右侧）
  (currencies || []).slice(0,3).forEach((c, i) => {
    const pw = W*0.16, ph = barH*0.56, px = W - pad - pw - i*(pw+10), py = (barH-ph)/2 + H*0.012;
    ctx.save(); roundRectPath(ctx, px, py, pw, ph, ph/2);
    ctx.fillStyle = 'rgba(20,20,35,0.55)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke(); ctx.restore();
  });
};

G.ui.drawNavTab = function (ctx, x, y, w, h, item, state) {
  const lift = state==='hover'?-5:(state==='pressed'?2:0);
  const sc = state==='hover'?1.15:(state==='pressed'?0.94:1);
  const cx = x+w/2, iconY = y+h*0.36+lift, sz = Math.max(36, Math.floor(h*0.44*sc));
  const active = state==='hover'||state==='pressed';
  if (active) { ctx.save(); ctx.fillStyle='rgba(255,202,40,0.12)'; roundRectPath(ctx, x+6, y+6, w-12, h-12, 16); ctx.fill(); ctx.restore(); }
  ctx.save();
  if (item.icon && (item.icon instanceof HTMLImageElement || item.icon instanceof HTMLCanvasElement)) {
    if (active){ ctx.shadowColor=item.color||G.theme.primary; ctx.shadowBlur=18; }
    ctx.drawImage(item.icon, cx - sz/2, iconY - sz/2, sz, sz);
  } else {
    ctx.font='bold '+sz+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    if (active){ ctx.shadowColor=item.color||G.theme.primary; ctx.shadowBlur=18; }
    ctx.fillStyle = active ? '#fff' : 'rgba(255,255,255,0.82)';
    ctx.fillText(item.icon || '?', cx, iconY);
  }
  ctx.restore();
  ctx.font='bold '+Math.max(16, Math.floor(h*0.18))+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.strokeText(item.label, cx, y+h*0.72);
  ctx.fillStyle = active ? '#fff' : 'rgba(255,255,255,0.75)'; ctx.fillText(item.label, cx, y+h*0.72);
  if (active){
    ctx.save(); ctx.fillStyle=item.color||G.theme.primary; ctx.shadowColor=item.color||G.theme.primary; ctx.shadowBlur=12;
    ctx.beginPath(); ctx.arc(cx, y+h*0.9, 4, 0, Math.PI*2); ctx.fill(); ctx.restore();
  }
};
\`\`\`
- 这三个函数 + drawButton + drawPanel 共同构成 gameplay HUD 视觉；命中检测与绘制坐标严格一致。

### 5.1.3 drawHubIcon —— 备用系统入口卡片（高大上 UE/UI）
当某些场景（如二级“系统大厅”弹窗、功能聚合页）确需用卡片网格陈列入口时，用 **G.ui.drawHubIcon** 统一绘制，做到设计感强、高大上、彼此规格完全一致。规格如下：
- **尺寸**：单卡 280x280（2 列）或 220x220（3 列），圆角 28~32。
- **底板（必须使用 ui_button 素材）**：先用 draw9Slice 将 ASSETS['ui_button'] 铺满整个卡片矩形作为底板纹理，再在其上叠加：双色渐变半透明叠层（左上→右下，颜色取自 themeColor 25% 透明度）；外层 2~3px 发光描边（颜色 = themeColor 50% 透明度，模糊半径 12~20）；内层 1px 高亮（白色 30% 透明度，制造立体悬浮感）；底部投影（黑色 35%，offsetY 6，blur 18）。**禁止只用纯色渐变当底板**——必须有 ui_button 素材铺底。
- **图标**：卡片中央偏上，尺寸约卡片宽度 50%。优先用 emoji/Unicode 字符（▶ ★ ⚙ ?）或几何形状，**渐变填充 + 顶部高光弧 + 底部柔影**，不要纯单色；每张卡都用各自 themeColor。
- **标签**：卡片下半部分中文文字（粗体，字号 32~40），白色填充 + 深色描边 1.5~2px + 柔和阴影，居中。
- **状态**：normal / hover（整体 translateY(-4) + 发光增强 + scale 1.04）/ pressed（scale 0.96 + 发光收缩 + 短暂闪光）。
- **点击反馈**：触发后从图标中心扩散一圈波纹 + 触发 transitionTo / openPopup。
- **网格布局**：在界面居中排列；卡间距 24~32；上下留白给 logo 和装饰带。
- **绝对禁止**降低规格（如简单画一个纯色矩形 + 文字当作图标），任何一个入口看起来都必须像 AAA 手游的系统按钮。

参考实现（drawHubIcon 必须达到此视觉档次）：
\`\`\`
G.ui.drawHubIcon = function (ctx, x, y, w, h, item, state) {
  const lift = state === 'hover' ? -4 : (state === 'pressed' ? 2 : 0);
  const scale = state === 'hover' ? 1.04 : (state === 'pressed' ? 0.96 : 1);
  const dw = w * scale, dh = h * scale;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2 + lift;
  const r = Math.min(dw, dh) * 0.12;

  // 投影
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = state === 'hover' ? 28 : 18;
  ctx.shadowOffsetY = 8;

  // ui_button 素材底板（必须铺满，坐标 = 卡片外框坐标，零 padding！）
  const btnImg = G.Assets.get('ui_button');
  roundRectPath(ctx, dx, dy, dw, dh, r);
  ctx.clip();
  if (btnImg) draw9Slice(ctx, btnImg, dx, dy, dw, dh); // ★ 必须 dx,dy,dw,dh 无任何缩小
  // 主题色半透明叠层
  const grad = ctx.createLinearGradient(dx, dy, dx + dw, dy + dh);
  grad.addColorStop(0, withAlpha(item.color, 0.25));
  grad.addColorStop(1, withAlpha(shade(item.color, -40), 0.35));
  ctx.fillStyle = grad;
  ctx.fillRect(dx, dy, dw, dh);
  ctx.restore();

  // 外发光描边
  ctx.save();
  ctx.shadowColor = item.color;
  ctx.shadowBlur = state === 'hover' ? 24 : 14;
  ctx.lineWidth = 3;
  ctx.strokeStyle = withAlpha(item.color, 0.7);
  roundRectPath(ctx, dx, dy, dw, dh, r); ctx.stroke();
  ctx.restore();

  // 内层高光描边
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  roundRectPath(ctx, dx + 2, dy + 2, dw - 4, dh - 4, r - 2); ctx.stroke();

  // 主题图标（渐变 + 高光弧）
  ctx.save();
  ctx.font = 'bold ' + Math.floor(dh * 0.42) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = item.color; ctx.shadowBlur = 12;
  ctx.fillText(item.icon, dx + dw / 2, dy + dh * 0.40);
  ctx.restore();

  // 标签
  ctx.font = 'bold ' + Math.floor(dh * 0.13) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(item.label, dx + dw / 2, dy + dh * 0.78);
  ctx.fillStyle = '#fff';
 ctx.fillText(item.label, dx + dw / 2, dy + dh * 0.78);
};
\`\`\`

### 5.1.4 drawIconButton / drawSegmented —— 通用辅助控件（弹窗与系统栏专用）
各功能弹窗（商店 / 排行榜 / 设置 / 帮助）需要一批“非主操作”的辅助按钮，必须使用以下两个统一函数绘制，**禁止每个弹窗里各自手画矩形 + 文字**。

**A) drawIconButton(ctx, cx, cy, item, state)** —— 圆形 / 方形 icon-only 按钮（关闭✕、返回‹、设置⚙、音量🔊、刷新🔄、信息ⓘ）
- 直径 d = Math.min(G.canvas.width, G.canvas.height) * G.theme.control.iconBtnSize，圆角 = d/2（圆形）或 d*0.28（方形圆角）。
- 视觉层（5 层堆叠）：
  1) 外发光描边（hover/selected 时 blur = G.theme.glow.hover，颜色 = G.theme.colors.primary）；
  2) 玻璃磨砂底（渐变取 G.theme.gradient.icon，磨砂 noise 6%）；
  3) ui_button 9-slice 铺满（若 ASSETS['ui_button'] 存在）；
  4) 顶部高光弧（白 22%）+ 底部内阴影（黑 22%）；
  5) 居中绘制图标（优先 item.iconImg，否则 emoji），尺寸 = d * 0.55，**禁止图标顶满**。
- 状态：state 完全沿用 §5.1.1 的 6 态 + G.theme.state；selected（如音量开关 = on）时背板替换为 item.color 18% 半透。
- 命中区扩展：圆形 icon 按钮的实际命中矩形必须 ≥ minTap（88×44），即"视觉是圆 + 命中是矩"，避免视觉小但难点。
- 用途清单（必须全部使用本函数）：弹窗右上 ✕ 关闭、子页左上 ‹ 返回、HUD ⏸ 暂停、HUD 🔊/🔇 音量、设置项右侧切换、教程图文翻页 ‹ ›。

**B) drawSegmented(ctx, x, y, w, h, options, selectedIndex, state)** —— 分段切换器（难度选择 / Tab 切换 / 音乐-音效双开关）
- 整体一个圆角 pill（圆角 = h/2）+ 玻璃磨砂底（G.theme.gradient.secondary）+ 1px 高亮描边；内部等宽切分为 N 段。
- 选中段：填充 item.color（或 G.theme.colors.primary）渐变 + 顶部高光弧 + 内层 1px 白描边 + 切换时 280ms 滑动动画（缓动 ease-out-cubic，从旧 index 滑到新 index，不能瞬切）。
- 文本：每段图标 + 文字两段式，**与 drawButton 的字号 / 描边规则完全一致**（保证视觉档次统一）。
- 状态：选中段 = selected；hover 段 = hover；其余段 = normal；切换中保持 loading（短时禁用点击直到动画结束）。
- 用途清单：设置弹窗的难度（简单/普通/困难）、音乐/音效开关、排行榜的（日榜/周榜/总榜）、商店的（道具/装备/外观）。
- **禁止用单选 radio 或多个 checkbox 替代**——分段切换必须是同一个连续的 pill 带滑动指示。

### 5.1.5 Gameplay HUD UE 检查清单（gameplay 场景 HUD 自检）
当 gameplay 场景包含 topBar/navTab 等 HUD 元素时，按此列表自检：
1. ☐ 所有按钮走 drawButton / drawIconButton / drawNavTab 三件套之一，无手写矩形+文字按钮；
2. ☐ 所有颜色/字号/圆角/动效时长来自 G.theme；
3. ☐ 命中矩形 = opts.hitRect，update 只用 hitRect 不用绘制坐标；
4. ☐ 每个 navItem 对应的 popup 已在 G.registerPopup 中注册并实现完整交互；
5. ☐ idle 微呼吸 + hover 流光 + pressed 波纹 + selected 指示条全部生效。


### 5.2 序列帧动画（sprite sheet / video-to-spritesheet）
- **动画分层说明**：animationType 为 "video" 或 "spritesheet" 的素材，在运行时格式完全相同——都是一张 2×2 十字格 sprite sheet 图片。"video" 只影响生成阶段（平台用静图→视频→抽帧得到更高质量帧），代码侧无需区分两者，统一用 SpriteAnimation 播放。animationType 为 "static" 的实体不使用序列帧，改用程序化 tween 动画（见 5.3 节）。
- **固定生图格式（务必按此理解素材）**：每张序列帧素材是一张固定 512x512 的 2×2 十字格画布，分为 4 个 256x256 的等大方格，布局顺序为：左上=帧1、右上=帧2、左下=帧3、右下=帧4。格子之间没有间隙/分隔线/边框，角色在每个格子中 scale、水平居中、底部基线完全一致，只有姿态变化。
- **固定程序使用格式（务必按此契约写代码）**：
  - 布局：2 列 × 2 行，帧序号 i (0~3)
  - 帧宽 = 实际图片宽 / 2；帧高 = 实际图片高 / 2
  - 绝不要硬编码帧宽高，必须从加载后的 naturalWidth/naturalHeight 推导，兼容任何实际返回尺寸
  - 第 i 帧源矩形 = [ (i % 2) * 帧宽, Math.floor(i / 2) * 帧高, 帧宽, 帧高 ]
- 角色/怪物类素材是 2×2 十字格排列的 sprite sheet（4 帧合成在一张图中）
- 序列帧素材也必须先经过 removeChromaKey 处理去除绿幕背景
- **关键：帧尺寸必须在图片加载后从 naturalWidth/naturalHeight 自动计算，不要硬编码尺寸**
- **禁止在 gameLoop/update 中重复创建 Image 对象或重复调用 removeChromaKey，否则会导致严重闪烁**
- 所有 Image 加载和 removeChromaKey 处理必须在初始化阶段（preload/init）一次性完成，gameLoop 中仅使用处理好的结果
- 必须实现帧动画播放逻辑：
  \`\`\`
  // 序列帧动画示例（十字格 2×2 布局）
  class SpriteAnimation {
    constructor(processedImg, frameCount, { fps = 12, loop = true, hitFrame = -1, onHitFrame = null } = {}) {
      this.img = processedImg; // 必须是已经去除绿幕后的 canvas/image，在init阶段准备好
      this.frameCount = frameCount; // 固定 4 帧
      this.cols = 2; // 2×2 十字格布局
      this.rows = 2;
      this.frameWidth = processedImg.width / this.cols;   // 256
      this.frameHeight = processedImg.height / this.rows; // 256
      this.frameDuration = 1000 / fps; // 标准 12FPS
      this.currentFrame = 0;
      this.elapsed = 0;
      this.loop = loop;
      this.hitFrame = hitFrame;
      this.onHitFrame = onHitFrame;
      this.finished = false;
      this._hitFired = false;
    }
    update(dt) {
      if (this.finished) return;
      this.elapsed += dt;
      while (this.elapsed >= this.frameDuration) {
        this.elapsed -= this.frameDuration;
        this.currentFrame++;
        if (this.currentFrame === this.hitFrame && !this._hitFired) {
          this._hitFired = true;
          if (this.onHitFrame) this.onHitFrame();
        }
        if (this.currentFrame >= this.frameCount) {
          if (this.loop) {
            this.currentFrame = 0;
            this._hitFired = false;
          } else {
            this.currentFrame = this.frameCount - 1;
            this.finished = true;
            return;
          }
        }
      }
    }
    reset() {
      this.currentFrame = 0;
      this.elapsed = 0;
      this.finished = false;
      this._hitFired = false;
    }
    destroy() {
      this.img = null;
      this.onHitFrame = null;
    }
    draw(ctx, x, y, displayWidth, displayHeight) {
      if (!this.img) return;
      // 2×2 十字格帧定位：列 = i%2，行 = floor(i/2)
      const col = this.currentFrame % this.cols;
      const row = Math.floor(this.currentFrame / this.cols);
      const sx = col * this.frameWidth;
      const sy = row * this.frameHeight;
      const boxW = displayWidth || this.frameWidth;
      const boxH = displayHeight || this.frameHeight;
      // 保持单帧宽高比，按 contain 方式缩放并在显示框内居中
      const scale = Math.min(boxW / this.frameWidth, boxH / this.frameHeight);
      const dw = this.frameWidth * scale;
      const dh = this.frameHeight * scale;
      const dx = Math.round(x + (boxW - dw) / 2);
      const dy = Math.round(y + (boxH - dh) / 2);
      ctx.drawImage(this.img,
        sx, sy, this.frameWidth, this.frameHeight,
        dx, dy, dw, dh
      );
    }
  }
  \`\`\`
- **防闪烁关键点**：
  1. 初始化阶段：加载图片 → removeChromaKey → 创建 SpriteAnimation 实例 → 全部完成后才开始 gameLoop
  2. gameLoop 中只调用 animation.update(dt) 和 animation.draw()，绝不创建新对象
  3. 使用 while 而非 if 来消耗 elapsed 时间，避免帧堆积导致跳帧闪烁
  4. **目标坐标取整**：drawImage 的目标 x/y 用 Math.round，避免在亚像素位置触发 canvas 双线性插值抖动
  5. 确保 canvas 每帧先 clearRect 整个画面再重绘
  6. 建议在绘制前设置 ctx.imageSmoothingEnabled = false（像素风）或保持默认（写实风），全程保持一致
- 序列帧的显示大小（displayWidth/displayHeight）按游戏设计的实体显示框给出，draw 内部会保持单帧宽高比并在框内居中（contain），不会被拉伸变形：
  \`\`\`
  // 素材为 512x512、4 帧 2×2 十字格，每帧 256x256
  const idleAnim = new SpriteAnimation(processedImg, 4, { fps: 12, loop: true });
  // 攻击动画（非循环 + hitFrame 回调）
  const attackAnim = new SpriteAnimation(attackImg, 4, {
    fps: 12, loop: false, hitFrame: 2,
    onHitFrame: () => { checkDamage(entity, targets); }
  });
  // 传入实体的显示框大小即可，内部自动等比缩放居中
  idleAnim.draw(ctx, monster.x, monster.y, monster.w, monster.h);
  // 场景销毁时释放资源
  function cleanup() { idleAnim.destroy(); attackAnim.destroy(); }
  \`\`\`
- frameCount 固定为 4；frameWidth/frameHeight 仅作参考，真实裁剪一律用 实际图宽/2 与 实际图高/2
- 静态素材（animationType: static）正常使用 drawImage 整图渲染，动画通过程序化 tween 实现（见 5.3）
- 绘制时不要添加任何白色边框/阴影/外发光效果在素材本身上

### 5.3 程序化 Tween 动画（static 类型实体）
- animationType 为 "static" 的实体只有一张静态图片，所有动画效果完全由代码 tween 驱动：
  - **idle 呼吸**：缓慢 sin 缩放 (scale: 1 ± 0.03, 周期 1.5~2s)
  - **移动倾斜**：水平移动时按速度方向 rotate ±5~15°
  - **弹性反馈**：被击中/收集瞬间 squash-and-stretch (scaleX: 1.3, scaleY: 0.7 → 弹回, 200ms)
  - **漂浮悬停**：sin(time) 控制 y 偏移 ±3~5px, 配合轻微旋转
  - **入场/出场**：fadeIn + 从下方弹入 (ease-out-back)；死亡时 fadeOut + 缩小 + 旋转飞出
- **实现模式**：在实体对象上维护 tween 状态 (如 entity.tweenScale, entity.tweenRotation, entity.tweenAlpha)，每帧 update 中用 deltaTime 驱动插值，draw 时应用 ctx.save/translate/rotate/scale/globalAlpha/restore
- **优先使用程序化 tween 而非序列帧**：只要动画需求可以用"缩放+旋转+位移+透明度"组合表达（如弹跳、旋转、闪烁、漂浮），就用 static + tween，不要浪费序列帧资源
- 示例：
  \`\`\`
  // idle 呼吸 tween
  entity.breathPhase = (entity.breathPhase || 0) + dt * 0.003;
  const breathScale = 1 + Math.sin(entity.breathPhase) * 0.03;
  ctx.save();
  ctx.translate(entity.x + entity.w/2, entity.y + entity.h/2);
  ctx.scale(breathScale, breathScale);
  ctx.drawImage(entity.img, -entity.w/2, -entity.h/2, entity.w, entity.h);
  ctx.restore();
  \`\`\`

### 6. 通用规则
- 必须实现设计文档中所有 rules / parameters / 胜负条件
- 游戏必须有完整的生命周期：开始画面 → 游戏进行 → 结束画面（显示得分）
- 必须响应键盘、鼠标/触摸输入（根据游戏类型）
- 代码必须在现代浏览器中无依赖直接运行
- 严禁使用 import / require / module / export

### 6.1 G.theme 全局唯一权威（铁律，UE/UI 统一基石）
- **G.theme 是所有视觉参数的唯一来源**：core.js 必须按设计文档 uiTokens 字段初始化 G.theme（colors / radius / spacing / fontSize / fontFamily / shadow / animation 全套字段）。**所有绘制函数（drawButton / drawPanel / drawText / drawHUD / drawTopBar / drawFeatureCard / drawNavTab / drawHubIcon / 各 popup.render / 各 scene.render）只能从 G.theme 读取颜色、字号、圆角、间距、阴影、动效时长。**
- **禁止硬编码视觉参数**：在所有 UI/HUD 绘制相关代码中，禁止出现 \`'#xxxxxx'\` / \`'rgb(...)'\` / \`'rgba(...)'\` 等颜色字面量（位置坐标和动画进度系数除外），禁止写死字号数字（\`'24px Arial'\` 这种），禁止写死圆角半径数字。所有这些都必须从 G.theme 派生。
  - 例外：粒子系统、tween 进度、坐标位置、相对比例（如 \`canvas.width * 0.1\`）允许用数字字面量
- **同名元素必同款**：所有按钮（标题进入按钮 / 主界面 CTA / 弹窗确认/取消 / 结算重玩 / HUD 操作按钮）必须**全部走同一个 drawButton(ctx, x, y, w, h, opts, state)**，禁止某个界面用自定义按钮绘制；所有面板（暂停/结算/弹窗/HUD底）必须**全部走同一个 drawPanel**；所有数字 HUD（分数/血量/计时）必须**用统一字号字重描边样式**（G.theme.fontSize.title + G.theme.colors.textStroke）。
- **图标统一**：HUD/按钮/标签使用的 emoji 或 Unicode 字符要在全游戏内保持一致映射（金币始终一个字符、生命始终一个字符），不允许同一概念用不同图标。
- **过渡统一**：所有场景切换调用 G.Scenes.transitionTo() 走 G.theme.animation.transitionMs（默认 280ms）；所有弹窗 open/close 走 G.theme.animation.popupOpenMs（默认 220ms）；按钮 hover/pressed 缩放固定走 G.theme.animation.buttonHoverScale / buttonPressedScale。

### 6.1.1 G.Layout 布局唯一权威（铁律，可视化布局编辑基石）
- **所有可交互/可见 UI 矩形必须经 G.Layout.rect(scope, id, base, meta) 声明**（按钮、图标按钮、面板、HUD 容器、槽位、弹窗内控件）。scope = 场景 id（如 'title' / 'gameplay'）或 'popup:' + 弹窗 id；id 用稳定语义名（'start' / 'pause' / 'bomb' / 'shop'）；meta 至少给 label（中文名）与 kind（button / icon / panel / hud / text / slot）。
- **绘制与命中必须共用同一个 rect 对象**：写法固定为 \`this.btnRect = G.Layout.rect('title', 'start', { x, y, w, h }, { label: '开始游戏', kind: 'button' })\`，之后 G.ui.drawButton 与 G.Input.hitTest **均直接传 this.btnRect**。禁止另算一遍坐标、禁止拷贝副本后分开使用（否则布局调整后热区与画面错位）。
- **字段命名约定**：持有矩形的字段名一律以 Rect 结尾（btnRect / pauseBtnRect / bombBtnRect / panelRect / scoreRect），便于存量扫描兼容。
- **矩形只在 init() 中声明一次**，update/render 里不得重新赋值整个 rect（可以读、可以叠动画偏移量画到局部变量，但不得覆写 rect.x/y/w/h），否则会覆盖编辑器的调整结果。
- **置中/百分比取值照旧**：base 内部仍用 G.CONFIG.width/height 派生（如 (G.CONFIG.width - 480) / 2），不要写绝对像素硬值。
- **不得修改/删除 core.js 中的 G.Layout 实现**，也不得读写 window.__GF_LAYOUT__（那是平台注入的布局覆盖，只由 G.Layout 消费）。

### 6.2 错误兜底 / HUD 一致性 / 手感反馈（强约束）
- **资源缺失防黑屏**：每个 ASSETS 取用都必须容错——\`const img = G.Assets.images['xxx']; if (img) draw...; else fallback...\`。背景缺失退化为 G.theme.colors.background 渐变；角色 sprite 缺失退化为彩色圆/胶囊形 + 文字 label；按钮素材缺失退化为 G.theme.colors.primary 渐变填充矩形。**绝不允许因资源缺失出现黑屏或 throw**。整段 init/update/render 都必须包在 try/catch，捕获后在 canvas 中央打印错误简介继续渲染（不阻断主循环）。
- **HUD 一致性**：所有场景的 HUD（gameplay/popup/gameOver）共享同一组 HUD 元素的位置和样式——分数始终在同一位置、字号、颜色、描边；血条始终用同一 drawBar；计时始终用同一格式；图标尺寸始终一致。各场景的 HUD 排版可不同，但共享元素本身样式必须统一。
- **手感反馈强制清单（每条都必须出现在对应事件中）**：
  1) 任何按钮点击 → 短暂闪光（80ms 白色叠加）+ 波纹粒子 + 轻微震动（震屏 2~4px / 80ms）
  2) 玩家受伤 → 红色全屏闪烁（alpha 0.25 → 0 over 200ms）+ 震屏 8px / 150ms + 角色无敌闪烁 1s
  3) 得分/收集 → 数字飘字（从拾取位置向上 60px / 600ms 淡出）+ 黄色粒子爆发 8~12 颗
  4) 连击 → 屏幕中部"Combo xN!" 飘字 + 短暂高光扫过 + 字号随连击数递增
  5) Boss 出场 / 关卡通关 → 全屏轻闪 + 慢镜头 200ms + 大字号居中提示带描边阴影
  6) 玩家死亡 / 游戏结束 → 慢镜头 0.3x speed for 600ms + 屏幕灰度滤镜淡入 + G.Audio.play('death')
  7) 升级 / 道具拾取 / 特殊事件 → 角色/UI 元素短暂高光描边发光 300ms
  8) **格斗命中确认**：hitbox 命中瞬间在接触点生成打击火花（8~12 颗橙黄粒子向外爆射 + 白色闪光圈 80ms 缩放消失）+ 震屏 4~6px/80ms + 攻击方短暂停顿 2~3 帧（hit-stop，增强打击感）
  9) **格斗防御反馈**：格挡成功时蓝色护盾闪光（alpha 0.4→0 over 150ms）+ chip damage 数字飘出（灰色小字）+ 防守方后退 2~3 像素（防御位移）
  10) **格斗 K.O. 演出**：最后一击命中 → 0.3x 慢镜头 600ms + 受击方放大后仰 + "K.O.!" 文字从中心缩放弹入（字号从 0→80px, ease-out-back）+ 屏幕剧烈震动 8px/300ms + 全场灰度滤镜渐入
  11) **格斗连击计数**：每次连击命中在受击方侧面弹出 combo 飘字（"2 HIT" → "3 HIT" → ...），字号随连击数递增（基础 20px + hit×2px），颜色从白→黄→橙→红渐变，最后 1 次消散时放大闪烁
  12) **格斗回合公告**："ROUND N" 从屏幕顶部滑入（300ms）→ 停留 1s → "FIGHT!" 居中放大闪入（scale 0.5→1.2→1.0, 200ms）→ 淡出开始战斗。"TIME'S UP!" 倒计时归零时红字居中闪烁
  13) **消除级联反馈**：每次 cascade 连锁时屏幕轻微闪光（白色 alpha 0.08 全屏 100ms）+ combo 飘字逐级放大（combo x2=24px → x3=30px → x4=36px → x5=42px + 彩虹渐变色）+ G.Audio.play('combo')（pitch 随级联层数递增）
  14) **消除特殊宝石触发**：线炸弹激活 → 整行/列闪光扫过（白色线条 80ms）+ 所有宝石同时缩小消失 + 分数飘字密集弹出；爆炸炸弹 → 3x3 区域圆形冲击波扩散 + 彩色粒子爆发 20+颗；彩虹球 → 全屏同色宝石依次闪光消失（每颗间隔 30ms）+ 屏幕边缘彩虹光晕 300ms
  15) **消除星级结算**：通关时 3 颗星逐颗亮起（每颗间隔 400ms），亮起瞬间 scale(0)→scale(1.3)→scale(1.0) + 金色粒子 8 颗 + 短暂音效；未获得的星灰色半透明
  16) **塔防放置确认**：拖拽建塔时显示半透明预览模型 + 绿色/红色落点指示器；松手簡间塔从 scale(0) 弹入 scale(1.0)（ease-out-back 300ms）+ “吸附”缩放动画 + 底部尘土粒子 6 颗 + 短促震动；不可放置时槽位红色闪烁 + 抖动 4px
  17) **塔防升级反馈**：升级时塔体闪光 500ms + 上方弹出升级箭头（绿色↑+ 等级数字变化 "+Lv"）+ 小型烟花粒子 12 颗 + 底部资源栏对应数值闪烁扣减（因果闭环）
  18) **塔防波次公告**：新波次开始时屏幕中央"WAVE N"大字从上方滑入（200ms）→ 停留 1.5s → 淡出；Boss 波有额外红色边框 + 警告图标 + 屏幕轻微震动
  19) **塔防基地受伤**：敌人到达基地时 → 全屏边缘泛红呼吸灯（alpha 0.3 → 0 over 400ms，伤害越高红光越浓）+ 震屏 6px/200ms + 基地 HP 条闪烁红色 + 伤害数字飘出
  20) **塔防战斗打击感**：敌人受击时短暂白闪 50ms + 位移顿挛 0.05s；死亡爆炸粒子向屏幕中心聚拢（而非四散，避免遮挡其他目标）；塔攻击时炮管后坐力 + 地面震波涟漪
  21) **塔防资源不足提示**：建造按钮变灰 + 抖动反弹，同时资源数字标红脉冲（alpha 0.5↔1.0 快速闪烁 3 次）；横版资源栏在左侧纵列，闪烁方向与文字排列一致
  22) **塔防横版环形菜单**：点击已建塔弹出环形菜单（升级/出售/详情 3 个扇形按钮），菜单跟随塔体位置且自动纠偏不超出屏幕边界；升级按钮置于右下象限（拇指易达）、出售置于左上（防误触）；弹出 ease-out-back 200ms + 收起时缩小淡出
  23) **塔防横版技能释放**：主动技能拖拽时显示半透明范围圈（与技能属性同色）+ 蓄力进度条（从底部填充到顶部）；松手释放时范围圈从当前大小缩小到中心 200ms + 全屏短暂闪光；冷却时技能图标灰显 + 顺时针覆盖遮罩动画
  24) **塔防横版集火指令**：长按敌人 0.5s 触发 → 目标头顶出现红色准星跟随标记 + 友方塔弹道线汇聚到目标（白色虚线引导）；集火期间目标受伤飘字颜色统一为金色大字号；目标死亡后准星缩小淡出
  25) **塔防横版出售回收**：出售时塔体碎裂动画（粒子 8 颗向四周扩散 300ms）+ 金币粒子从塔位置沿贝塞尔曲线飞向左侧资源栏（400ms）+ 资源栏金币数字绿色闪烁增加
  20) **卡牌抽牌反馈**：抽牌时卡牌从牌库位置飞出（贝塞尔曲线飞到手牌区，400ms）+ 牌库数字-1 + 手牌展开动画（其他卡牌平滑让位）；法力不足时卡牌灰色半透明 + 不可拖拽 + 点击时轻微抖动提示
  21) **卡牌出牌/召唤反馈**：随从卡打出 → 从手牌飞到战场槽位 → 落地冲击波圆环扩散 + 金色粒子 10 颗 + 战吼特效（如有）；法术卡打出 → 飞到目标上方 → 法术特效全屏闪光 + 伤害/治疗数字密集飘出
  22) **卡牌随从战斗反馈**：选中随从攻击 → 随从冲向目标（位移+缩放动画 200ms）→ 碰撞闪光 + 双方伤害数字同时飘出（攻击方红色/防守方红色）+ 震屏 3px/80ms；随从死亡 → 缩小+旋转+渐隐 + 碎裂粒子 8 颗 + 亡语特效（如有）
  23) **卡牌回合切换**：回合结束按钮点击 → 按钮缩小消失 → 屏幕中央"你的回合"/"对手回合"提示文字缩放弹入（300ms）→ 淡出；对手回合时手牌区半透明遮罩
- **暂停/恢复必须可用**：必有暂停按钮（HUD 右上角或左上角，使用 ⏸ 图标），点击 → 暂停游戏循环 + 灰度蒙版 + 弹出"已暂停"面板（含"继续/重玩/退出"按钮）；ESC 键也触发；恢复时必须正确恢复 dt（避免大跳帧）。
- **结算画面必须有评级/最高分**：游戏结束后展示得分动画（数字滚动 0 → 实际分用 600ms 缓动）+ 评级（S/A/B/C 由分数阈值决定，含彩色描边大字 + 评级粒子特效）+ 最高分对比（从 \`window.localStorage\` 读写 \`game_best_score\`，破纪录时显示"NEW BEST!" 高亮）+ 重玩/返回登录画面按钮。
- **空内容兜底**：所有列表（商店商品/排行榜/任务）数据为空时显示居中"暂无内容"占位 + 灰色图标，禁止留空白面板。

### 6.4 音频系统（强制必须实现 — Web Audio API 合成音效，零外部依赖）
所有上线游戏**必须有声音**。不使用任何音频文件，完全用 Web Audio API 程序化合成。
#### 6.4.1 G.Audio 实现规范（在 core.js 中）
\`\`\`
G.Audio = {
  ctx: null, masterGain: null, sfxGain: null, bgmGain: null,
  bgmOsc: null, bgmPlaying: false,
  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain(); this.masterGain.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.masterGain);
    this.bgmGain = this.ctx.createGain(); this.bgmGain.gain.value = 0.3; this.bgmGain.connect(this.masterGain);
  },
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); },
  // 合成一次性短音效（正弦波/方波/噪声 + ADSR 包络）
  _synth(type, freq, duration, vol = 0.4) {
    if (!this.ctx || G.gameState.settings.sound === false) return;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain); gain.connect(this.sfxGain);
    osc.start(); osc.stop(this.ctx.currentTime + duration);
  },
  // 必须实现的音效名称 → 合成参数映射
  play(name) {
    this.resume();
    const map = {
      click:    () => this._synth('sine', 800, 0.08, 0.3),
      score:    () => this._synth('sine', 1200, 0.15, 0.35),
      hit:      () => this._synth('square', 200, 0.12, 0.4),
      hurt:     () => this._synth('sawtooth', 150, 0.2, 0.35),
      death:    () => { this._synth('sawtooth', 120, 0.4, 0.3); this._synth('sine', 80, 0.5, 0.2); },
      combo:    () => this._synth('sine', 1400 + Math.random()*400, 0.1, 0.3),
      win:      () => { [523,659,784].forEach((f,i) => setTimeout(() => this._synth('sine',f,0.25,0.35), i*120)); },
      lose:     () => { [400,300,200].forEach((f,i) => setTimeout(() => this._synth('sine',f,0.3,0.3), i*150)); },
      powerup:  () => this._synth('sine', 600, 0.2, 0.3),
      button:   () => this._synth('sine', 660, 0.06, 0.2),
    };
    (map[name] || map.click)();
  },
  // BGM：简单和弦循环（3-4个音符交替，低音量，场景切换时更换和弦）
  playBGM(chords) {
    if (G.gameState.settings.music === false || this.bgmPlaying) return;
    this.resume(); this.bgmPlaying = true;
    // chords = [[freq1,freq2],[freq3,freq4],...] 每组持续 2s 循环
    const playChord = (idx) => {
      if (!this.bgmPlaying) return;
      const chord = chords[idx % chords.length];
      chord.forEach(f => { this._synthBGM(f, 1.8); });
      this._bgmTimer = setTimeout(() => playChord(idx+1), 2000);
    };
    playChord(0);
  },
  _synthBGM(freq, dur) {
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + dur);
    osc.connect(gain); gain.connect(this.bgmGain);
    osc.start(); osc.stop(this.ctx.currentTime + dur);
  },
  stopBGM() { this.bgmPlaying = false; clearTimeout(this._bgmTimer); },
};
document.addEventListener('pointerdown', () => G.Audio.resume(), { once: true });
\`\`\`
#### 6.4.2 音效触发强制清单（每条必须接入 G.Audio.play）
- 任何按钮点击 → \`G.Audio.play('button')\`（同时触发粒子和震动）
- 得分/收集 → \`G.Audio.play('score')\`
- 玩家受伤 → \`G.Audio.play('hurt')\`
- 敌人被击中 → \`G.Audio.play('hit')\`
- 玩家死亡/Game Over → \`G.Audio.play('death')\`
- 连击/combo → \`G.Audio.play('combo')\`（pitch 随连击数递增：freq 基础值 + combo×100）
- 游戏胜利 → \`G.Audio.play('win')\`
- 游戏失败 → \`G.Audio.play('lose')\`
- 道具拾取/升级 → \`G.Audio.play('powerup')\`
- **场景 BGM**：进入 title/gameplay/settle 时各调用 \`G.Audio.playBGM(chords)\` 传入不同和弦组（如 title=[C大调],[E小调]；gameplay=[G大调],[D大调] 等）
- **设置面板的音效/音乐 toggle 必须实际控制 G.Audio**：sfxGain.gain.value / bgmGain.gain.value 设为 0 或恢复
- **首次用户点击后初始化**：main.js 顶部调 \`G.Audio.init()\`，搭配 pointerdown 事件 resume

### 6.5 移动端适配（强制 — 目标平台为手机浏览器）
#### 6.5.1 HTML 模板强制 meta 标签
buildGameHTML 生成的 HTML 中**必须包含**：
\`\`\`html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
\`\`\`
#### 6.5.2 触控策略（core.js G.Input 必须实现）
- canvas 元素设置 CSS \`touch-action: none\`（阻止浏览器默认手势：下拉刷新/左右导航/双指缩放）
- 全局阻止默认行为：\`document.addEventListener('touchmove', e => e.preventDefault(), { passive: false })\`
- G.Input 统一事件：pointerdown/pointermove/pointerup（兼容鼠标+触屏），不单独监听 mouse/touch
- **防误触边缘死区**：屏幕四周 12px 内的 pointer 事件不触发游戏操作（避免 iOS 边缘手势冲突）
- **300ms 点击延迟消除**：canvas CSS 追加 \`touch-action: manipulation\`
#### 6.5.3 安全区适配（刘海屏/底部 Home Indicator）
- game-container 的 CSS：\`padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)\`
- HUD 元素（暂停按钮/分数/血条）距离画布顶部至少 \`G.CONFIG.height * 0.04\`（留给刘海区）
- 底部导航栏/虚拟按键距画布底部至少 \`G.CONFIG.height * 0.03\`（留给 Home Indicator）
#### 6.5.4 横竖屏处理
- resize 事件回调中检测 \`window.innerWidth > window.innerHeight\`，若与设计方向不符 → 显示"请旋转设备"遮罩提示（居中大号旋转图标 + 文字）
- 横版游戏在竖屏设备上可选自动缩放+上下留黑边（已有 letterbox 逻辑覆盖）

### 6.6 性能保障（强制 — 确保低端手机流畅 30fps+）
#### 6.6.1 通用对象池模式（粒子/弹射物/飘字/特效统一使用）
\`\`\`
// G.Particles 必须使用对象池，预分配 MAX_PARTICLES=150 个
G.Particles = {
  pool: Array.from({length: 150}, () => ({active: false, x:0, y:0, vx:0, vy:0, life:0, maxLife:0, color:'', size:0})),
  emit(x, y, count, opts) {
    let spawned = 0;
    for (const p of this.pool) {
      if (p.active || spawned >= count) continue;
      Object.assign(p, {active:true, x, y, vx:(Math.random()-0.5)*opts.spread, vy:-Math.random()*opts.speed, life:0, maxLife:opts.duration||600, color:opts.color||'#fff', size:opts.size||4});
      spawned++;
    }
  },
  update(dt) { for (const p of this.pool) { if (!p.active) continue; p.x+=p.vx*dt*0.06; p.y+=p.vy*dt*0.06; p.vy+=0.1; p.life+=dt; if(p.life>=p.maxLife) p.active=false; } },
  render(ctx) { for (const p of this.pool) { if (!p.active) continue; const alpha=1-p.life/p.maxLife; ctx.globalAlpha=alpha; ctx.fillStyle=p.color; ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size); } ctx.globalAlpha=1; },
};
\`\`\`
- **禁止在主循环中 new Object / push + splice**：所有高频实体（子弹/粒子/飘字/特效/敌人）必须预分配数组 + active 标记
- **同屏粒子上限 = 150**：emit 超出时回收 life 最大的粒子
- **同屏实体上限 = 80**：超出时停止生成新敌人/障碍物，而非持续积累
#### 6.7.2 屏外裁剪
- update 中：实体坐标超出画布边缘 50px 以上 → 标记 active=false 回收（不继续参与碰撞/渲染）
- render 中：绘制前检查 \`if (entity.x + entity.w < -50 || entity.x > G.CONFIG.width + 50) continue\`
#### 6.7.3 destroy 清理检查清单（每个场景 destroy 中必须执行）
1. clearInterval / clearTimeout 所有定时器
2. 移除场景特有的事件监听器（如特殊 keydown handler）
3. 将大型数组/对象引用置 null（如 enemies = null, projectiles = null）
4. 停止场景 BGM：\`G.Audio.stopBGM()\`
5. 重置粒子系统：\`G.Particles.pool.forEach(p => p.active = false)\`
#### 6.7.4 禁止事项
- **禁止在 render 中调用 getImageData**（极慢，每帧读像素会导致 <10fps）
- **禁止在主循环中 new Image / document.createElement('canvas')**
- **禁止使用 setInterval 驱动游戏逻辑**（只用 requestAnimationFrame）
- **drawImage 调用数/帧建议 < 200**（超出考虑合批或减少绘制对象）

### 6.3 游戏完整性闭环 —— 从启动到退出，每个环节都要闭合（铁律，最关键）
生成的不是"能跑的 demo"，是"用户从打开到关闭都能合理使用"的完整产品。任何一个开放节点（dead-end / 半成品 / 没接通 / 无出口）都视为不合格。本节定义全局完整性契约，**所有场景与弹窗必须 1:1 满足**。

#### 6.3.1 三屏闭环主流程（必须严格按此状态机实现，禁止生成 mainHub）
用户从打开页面到结束的全流程**只能**走以下三屏闭环路径，每段都必须存在且唯一：

\`\`\`
BOOT (仅一次 Loading)
   ↓ _bootPhase: loading → fadeOut → done
TITLE (唯一 CTA 「进入游戏」)
   ↓ transitionTo('gameplay')
GAMEPLAY ←→ PAUSE_OVERLAY
   ↓ 胜负判定 → transitionTo('settle', { result, score })
SETTLE
   ↓ 「再来一局」→ transitionTo('gameplay')
   ↓ 「返回登录」→ transitionTo('title')
\`\`\`

- **三个场景一个不能少**：必须存在 G.Scenes.register('title')/'gameplay'/'settle'（'boot' 是虚拟阶段，由 main.js _bootPhase 接管）。**禁止注册 'mainHub' 场景**，游戏不需要主界面。
- **路径唯一**：BOOT→TITLE 走 _bootPhase 状态机（**不走 transitionTo**）；TITLE/GAMEPLAY/SETTLE 互跳全部走 G.Scenes.transitionTo()，禁止裸切 G.Scenes.current = 'xxx'。
- **进入有交接**：transitionTo 允许传交接数据（如 settle 接收 { result:'win'\|'lose', score, reward }），目标场景的 init(handoff) 接收。禁止用全局变量垃圾传参。
- **返回有状态**：settle 返回 title 时必须刷新 G.gameState（金币/最高分/进度同步到 localStorage）。

#### 6.3.2 场景生命周期契约（每个 register 进去的场景都要齐）
每个 G.Scenes.register(id, scene) 的 scene 对象必须实现以下 6 个生命周期钩子（没有逻辑的也要留空函数，统一接口）：

\`\`\`
G.Scenes.register('gameplay', {
\`\`\`
- **不准跳过该契约**：即使 destroy/onPause/onResume 暂时为空体，也要写出函数框架，G.Scenes.transitionTo 会一律调用。
- init/update/render 三者必须全部包 try/catch，捕获后在 canvas 中心输出错误简介继续运行（禁止造成主循环中断）。
- update 不可调用 ctx.* / drawImage 等绘制 API；render 不可修改 this.* 状态字段（只读），权限不能互侵。

#### 6.3.3 按钮→动作全覆盖（无 dead button）
设计文档中所有出现的按钮（screens.title.buttons / screens.gameplay.controls / popups.*.buttons / settle.actions 等）**都必须有一个真实生效的 action() 回调**，该 action 必须在下列几件事中能够处理至少一件：
1. G.Scenes.transitionTo('xxx', handoff)——跳场景
2. G.openPopup('xxx') / G.closePopup('xxx')——开关弹窗
3. G.gameState.* 变更（购买/升级/设置/选择）+ 同步 localStorage
4. G.audio.play('xxx') 或 G.Particles.emit——反馈/手感
5. 触发场景内状态机跳转（如回合制 endTurn / 商店购买 confirm）

- **禁止**：action: () => {} 空函数、action: () => console.log(...)、或者只在泒泡中打间接改变 visual state 但不影响玩法。
- **每个按钮都要有状态反馈**：idle/hover/pressed 三态走 drawButton 的 state 入参；点击瞬间 G.Particles.emit 波纹 + 80ms 闪光。禁止有动作但无反馈。
- **点击区 = drawButton/drawNavTab/drawIconButton 返回的 hitRect**，update 中以此判定，禁止玩状态中重复拼装几何。

#### 6.3.4 弹窗完整性契约（每个 popup 必须三路关闭 + 实质交互）
G.registerPopup(id, handler) 的 handler 必须同时满足：
1. **三种关闭路径**：右上 ✕ （drawIconButton） + 点击背景遮罩（panelRect 之外） + 按 ESC （G.Input.escape）。缺少任意一种都不合格。
2. **至少一个实质交互**：商店 = 购买 + 货币扣除；排行榜 = 上下滚动 或 切换 tab（日/周/总）走 drawSegmented；设置 = 至少 3 个 toggle/segmented 且调用 G.saveSettings()；帮助 = 可翻页且页码指示器同步。**纯静态面板（只看不能动）不合格。**
3. **空态兑底**：列表型 popup 数据为空时，绘制中心点 + 灰色图标 + "暂无 XX" 文字（商店="商品补货中"／排行榜="暂无榜单数据"／帮助="教程整理中"）。
4. **open() 重置 UI**：每次被 open 时重置页码/选中项/滚动偏移，禁止上次状态泄漏。
5. **弹出/关闭动画**：open 时 scale 0.85→1 + alpha 0→1 （220ms ease-out-back）；close 时 scale 1→0.9 + alpha 1→0（160ms）；动画期间不接受交互。

#### 6.3.5 状态持久化契约
G.gameState 是唯一可变游戏数据源，必须落 localStorage：

\`\`\`
G.gameState = {
  coin: 0, gem: 0, exp: 0, level: 1,
  bestScore: 0,
  unlockedLevels: 1,
  settings: { sound: true, music: true, difficulty: 'normal' },
  ownedItems: [],
  // 类型专属字段可添加，但禁止存 DOM/Image/函数
};
\`\`\`
- **存取点**：(1) main.js 启动时调 G.loadState() 从 localStorage 读取并合并到默认值；(2) 每次 settle 结算、商店成交、设置变更、unlockedLevels 变动 → G.saveState()；(3) window.beforeunload 里再调用一次 saveState。
- **G.loadState/saveState 实现必须包 try/catch**：JSON 解析错误、满额、隐私模式都要静默回退，永不造成启动崩溃。
- **错误退路**：读入的 JSON 与当前 schema 不兼容时必须能 merge（以默认值补齐缺字段），禁止直接丢掉玩家进度。

#### 6.3.6 浏览器生命周期接入
main.js 启动时必须注册以下事件钩子（却到其他位置不允许）：
- document.addEventListener('visibilitychange', ...) → hidden 时调当前场景.onPause\?.\(\)；visible 时调 onResume\?.\(\)。
- window.addEventListener('beforeunload', ...) → G.saveState()。
- window.addEventListener('keydown', e => { if (e.key === 'Escape') ... }) → 优先关闭顶层 popup；无 popup 且在 gameplay 场景 → 打开 pause overlay。
- window.addEventListener('resize', ...) → 重算 G.canvas 布局参数（不重创建 context）；所有场景下一帧 render 重新按最新 G.CONFIG.width/height 作比例布局（注意：坐标要按比例计，避免硕点位置被裁掉）。

#### 6.3.7 退出/重启语义（Web 环境专属）
- **标题画面绝不出现「退出」按钮**：web 游戏没有进程退出语义，TITLE 只允许唯一一个「进入游戏」CTA。
- **暂停面板三个出口**：「继续」/「重玩本局」/「返回登录画面」（后者必须二次确认 confirm popup：「未保存进度将丢失」 + 确认/取消）。确认后 transitionTo('title')。
- **结算面板两个出口**：「再来一局」（transitionTo('gameplay') + 重置关卡状态） / 「返回登录」（同步货币/最高分后 transitionTo('title')）。可选「分享」但不强制。
- **玩法场景仅可通过胜负判定或暂停菜单退出**，禁止裸提供「返回」按钮（玩家会误以为丢进度）。

#### 6.3.8 空态 / 错误态 / 网络态（其他出口的兑底）
- 任何 ASSETS.get('xxx') 返回 null 时 → 走 G.theme.colors 渐变退化 + 文字 label，不允许 throw 也不允许黑屏。
- 任何列表状 popup 数据数组为空 → 中心 placeholder 图标 + 文字，**禁止留空面板**。
- 任何异步动作失败时 → 静默重试 或 G.toast("XX失败")，不阻断主循环。
- localStorage 读写失败（隐私模式）→ 降级为内存状态，正常游玩但提示「本场记录将不保存」。

#### 6.3.9 完整性自检清单（生成任何场景代码前逐项打勾，缺一不可）
1. ☐ G.Scenes.register('title') / 'gameplay' / 'settle' 三个场景全部注册；**禁止注册 'mainHub'**；main.js _bootPhase 只走一次 Loading
2. ☐ 每个场景都实现了 init/update/render/destroy/onPause/onResume 六个钩子（空体也要写）
3. ☐ 所有跳场景走 G.Scenes.transitionTo()，无任何「G.Scenes.current = ...」裸切
4. ☐ 设计文档中列出的每个按钮都能找到一个非空的 action，且该 action 处理了 transitionTo / gameState 变更 / particles 反馈 中至少一项
5. ☐ G.gameState 存在，包含 coin/bestScore/settings；main.js 启动调 G.loadState()；settle/设置变更 后调 G.saveState()
6. ☐ visibilitychange → onPause/onResume；beforeunload → saveState；Esc → 关 popup 或起 pause；resize → 重算布局
7. ☐ settle 接收 { result, score } 交接参；胜负都有 2 条出路（再玩 / 返回登录画面）
8. ☐ 任何 init/update/render 均包 try/catch；任何 ASSETS.get 均有 null 退化；任何列表都有空态 placeholder
9. ☐ 标题画面只有唯一「进入游戏」按钮；玩法场景无「退出」按钮；仅暂停面板提供「返回登录画面」且需二次确认
10. ☐ HUD 共享元素（分数/血量/计时）在 gameplay/popup/settle 三个场景位置、字号、颜色、描边完全一致
11. ☐ 所有点击都有反馈（闪光 + 粒子 + 微震屏 + G.Audio.play）且点击区均为 hitRect（禁止项目中出现 dead button）
12. ☐ G.Audio.init() 在 main.js 顶部调用；至少 click/score/hit/hurt/death/win 6 种音效已实现合成；设置面板 toggle 控制 sfx/bgm；场景进入时 playBGM
13. ☐ G.Particles 使用对象池（预分配 150+）；主循环无 new Object；实体超出屏幕 50px 自动回收 active=false； destroy() 中清理定时器/监听/引用
14. ☐ **暂停输入架构（铁律）**：gameplay 场景的 update(dt) 必须在 "if (this.paused) return" **之前**调用输入处理（_handleInput）；_handleInput 内部必须将暂停菜单按钮检测放在**最前面**（当 this.paused 时处理继续/重新开始/返回登录后立即 return，不允许继续执行游戏输入逻辑）。因为如果 update 开头直接 return，暂停菜单点击将永迎无法响应。

以上 14 项与各场景交叉考虑，纵向上必须全部满足。生成后运行 node scripts/audit-completeness.mjs <project> 应达 13/14 以上。

### 7. UI/UE 精细化要求（重点！）
- **严格遵循设计文档中的 screens / popups / transitions 规格**：如果设计文档中提供了详细的界面设计（screens字段）、弹窗设计（popups字段）和过场动画规格（transitions字段），必须逐一实现，不得遗漏
- **启动加载画面（必须实现，全程只此一次！）**：游戏启动后由 _bootPhase 状态机控制显示唯一一次加载画面，使用 ASSETS['bg_loading'] 铺满全屏（缺失时退化为风格一致的渐变背景），画面中央显示精美进度条（圆角矩形外框 + 渐变填充内条 + 发光效果），进度条下方显示"Loading..."或加载提示文字（带呼吸闪烁动画），进度条上方可显示游戏 logo/名称。进度与 G.Assets 真实加载进度挂钩（loadedCount/totalCount），最低展示 800ms，加载完成后 _bootPhase='fadeOut' 渐隐 300ms 并直接 init title 场景（**不通过 transitionTo**）。此后任何场景切换都不再出现此 Loading 画面。
- **登录/标题画面（强制三元素）**：使用 ASSETS['bg_title'] 背景图铺满 + 游戏名称（大号渐变色描边文字）+ **唯一一个 CTA 按钮（文字「登录游戏」）**——禁止任何其他元素（禁止粒子/序列帧立绘/角色插画/多余按钮/NPC）。点击按钮后 G.Scenes.transitionTo('gameplay') 直接进入玩法。
- **禁止生成主界面（mainHub）**：游戏只包含三个界面（登录/标题 title → 核心玩法 gameplay → 结算 settle），**不允许生成 scene_main_hub / mainHub 场景**。所有“返回”操作统一指向 title 登录画面，而非主界面。
- **gameplay 功能弹窗必须实现（铁律：显示了图标就必须有对应功能）**：gameplay HUD navItems 中列出的每一个导航入口（商店/排行榜/设置/玩法帮助/成就等），其 G.openPopup(id) 对应的弹窗**必须通过 G.registerPopup(id, handler) 注册完整实现**，不能只注册空壳。具体要求：
  - **商店弹窗（shop）**：必须有实际可交互的商店 UI——
    - 面板布局：ui_panel 底板 + 顶部标题"商店" + 关闭按钮(✕)
    - 商品列表：至少 3~6 个可购买项（道具/装备/皮肤/消耗品/角色等，贴合游戏主题），每项显示：图标(emoji/素材) + 名称 + 价格 + 购买按钮
    - 购买逻辑：点击购买按钮 → 检查货币是否足够 → 扣除货币 + 加入背包/生效 + 购买成功提示动画（✓+飘字） / 货币不足提示（"金币不足"抖动）
    - 玩家货币显示在面板顶部右侧（与 topBar 同步）
    - 商品数据在 init 中定义（含 id/name/icon/price/effect 描述），购买结果影响游戏状态（如增加伤害/加血量/解锁装饰）
  - **排行榜弹窗（ranking）**：必须有可视化的排名列表——
    - 面板布局：ui_panel 底板 + 顶部标题"排行榜" + 关闭按钮
    - 排名列表：10 条记录（第 1~3 名金银铜高亮），每条显示：排名序号 + 玩家名 + 分数/成绩
    - 当前玩家的记录高亮标注（如黄色底条 + "← 你"）
    - 数据来源：从 G.score / G.bestScore / localStorage 读取玩家最高分，NPC 排名使用预设固定数据（随机生成的名字+递减分数）构成完整榜单
    - 首次超越某名次时可选触发庆祝动画
  - **设置弹窗（settings）**：必须有可操作的设置选项——
    - 面板布局：ui_panel 底板 + 顶部标题"设置" + 关闭按钮
    - 可操作项（至少 3 个）：① 音效开关（toggle 按钮，控制 G.soundEnabled）② 音乐开关（toggle 按钮）③ 画质/难度选择（简单/普通/困难，切换后影响游戏参数如敌人速度/生成频率）
    - 额外可选项：重置进度确认、振动开关、语言切换
    - toggle 实现：自定义绘制的滑块（圆角矩形轨道+圆形滑块，on=绿色/off=灰色），点击切换状态 + 滑块动画
    - 设置值持久化到 localStorage（下次打开游戏恢复）
  - **玩法帮助弹窗（help）**：必须有图文并茂的教程内容——
    - 面板布局：ui_panel 底板 + 顶部标题"玩法说明" + 关闭按钮
    - 内容：2~4 页图文教程（支持左右翻页或上下滚动），每页包含：说明文字 + 操作示意（可用 emoji 图标或简笔示意图），覆盖核心操作（如何移动/攻击/得分/升级等）
    - 页码指示器（底部圆点 ● ○ ○）+ 翻页按钮（← →）
    - 首次进入游戏时可自动弹出（引导新玩家）
  - **其他功能弹窗**（如成就/任务/背包等，根据游戏设计文档确定）：同样必须有实际内容和交互逻辑，不能空面板
  - **通用弹窗 UX 要求**：
    - 弹出动画：从中心 scale(0.8)→scale(1) + opacity(0→1)，300ms ease-out
    - 背景半透明遮罩（rgba(0,0,0,0.6)），点击遮罩或 ✕ 按钮关闭
    - 关闭动画：scale(1)→scale(0.9) + opacity(1→0)，200ms
    - 弹窗打开时当前场景的 update 暂停（不响应底层点击），只处理弹窗内交互
    - 面板使用 draw9Slice(ASSETS['ui_panel']) 铺满，按钮使用统一 drawButton 风格
- **游戏 HUD**：得分用描边白色数字；生命值用图标或彩色条；必要时显示 combo 数/关卡数；所有文字必须有 textShadow 确保可读
- **状态反馈**：得分增加时数字要有弹跳放大动画 + 飘字（+10）；受伤时屏幕边缘红色闪光 + 短暂震动（canvas translate 抖动 2-3 帧）
- **粒子特效**：击中/消除/收集时必须产生 8-15 个小粒子向四周扩散并渐隐；粒子颜色与事件相关（金色=得分，红色=伤害，绿色=回复）
- **结算画面（情绪驱动设计，强制）**：
  - **情绪区分**：胜利时用高饱和金色/橙色 + 上扬动效（元素从底部弹入）+ 星星/光粒子爆发；失败时用低对比度灰蓝/暗紫 + 舒缓淡入动画
  - **节奏缓冲**：胜利/失败标题先显现，停顿 0.5~1秒后再展开分数/奖励等细节，禁止瞬时全部展现
  - **信息分层**：核心数据（得分）大字号 + 数字滚动动效（从0到实际值，easeOut 1~1.5s）+ 发光突出；明细小字号弱化
  - **奖励可视化**：奖励动态掉落 + 堆叠动画 + 清脆音效；星级逐颗亮起 + 缩放弹入
  - **按钮引导**：胜利时「再来一局」+「返回登录」；失败时「快速重试」（视觉最突出）+「返回登录」，最多2个按钮
  - 必须使用 ASSETS['bg_gameover'] 作为背景（如没有则复用 bg_title 加暗色遮罩）
- **二级弹窗（必须实现）**：暂停弹窗（半透明遮罩+居中面板+继续/重新开始/返回按钮）、死亡复活确认（带倒计时的复活/放弃选择）、退出确认（真的要退出吗？+确认/取消）。弹窗需有弹入/弹出动画
- **统一过场转场系统 transitionTo（必须实现，场景间切换走它；但启动→标题除外！）**：在 core.js 的 G.Scenes 内实现 transitionTo(target)，**除启动进入 title 外**的所有场景切换（标题→游戏、游戏→结算、结算→重开/返回标题、关卡切换等）都必须经由它，禁止直接 current = 'xxx' 硬切：
  - 流程：淡出当前场景（globalAlpha 0→1 黑幕，~250ms）→ 短暂黑屏/过渡（100~300ms，可选显示极简转场提示如场景名/关卡号，**不要再显示完整 Loading 画面和进度条**）→ 初始化目标场景（包 try/catch）→ 淡入目标场景（globalAlpha 1→0，~250ms）
  - **转场总时长不超过 600~800ms**（fadeOut 250ms + hold 100~300ms + fadeIn 250ms），节奏明快、不拖沓
  - **禁止在 transitionTo 内再次渲染完整的 Loading 画面（bg_loading + 进度条 + 文字）**——完整 Loading 画面只在启动 boot 阶段出现一次！transitionTo 只做快速淡入淡出/黑屏过渡
  - **严禁过渡卡死导致黑屏**：过渡时间必须基于 dt 累加并 clamp，超时立即完成切换；transitionTo 全程包 try/catch，目标场景初始化失败也要保证进入可见画面而非黑屏
  - **优先用透明度淡入淡出（globalAlpha + fillRect 黑幕）实现**，不要用 destination-out + circularMask 之类合成遮罩做转场（容易因 composite 状态未复位整屏变黑）
  - 过场期间主循环不得停止；过场本身就是一个内部状态，照常 update/render
- **启动加载画面（与 transitionTo 分离！全程只出现一次）**：游戏启动后由 main.js 的 _bootPhase 状态机控制——加载期间显示 bg_loading + 进度条 + 提示文字（见 main.js 骨架），加载完成后 _bootPhase 自动 fadeOut→done 并直接 init title 场景，**不经过 transitionTo**。确保玩家从启动到看到标题画面只经历一次 Loading
- **绝对禁止"重复/连续 Loading"（铁律）**：
  - 用户从启动到进入 gameplay 的全流程中，**最多只能看到一次完整 Loading 画面**（即启动 boot 阶段）
  - 后续所有场景转换（title→gameplay→gameover→...）使用快速淡入淡出，不展示 Loading 画面
  - 如果 current === null（首次进入场景），transitionTo 应直接初始化目标场景 + fadeIn，不走中间过场
  - 禁止在 showInitialLoading + transitionTo 中重复渲染 renderLoading
- **按钮交互**：所有按钮必须有 hover 状态（发光/放大）和 click 状态（缩小回弹）
- **配色一致性**：如果设计文档提供了 colorPalette，所有 UI 元素必须使用指定配色
- **背景层次**：游戏中必须使用 ASSETS['bg_gameplay'] 作为背景铺满，不能纯黑/纯白
- **gameplay 实体尺寸比例（强制）**：所有游戏实体（角色/怪物/障碍物/收集品/弹射物）的绘制尺寸**必须按画布短边的百分比**合理分配，保证视觉上显著可辨、比例匀称：
  - 玩家角色/主要可操作实体（player_controlled）：显示尺寸 ≥ 画布短边的 8%~12%（如 720p 短边=720 → ≥58~86px，建议 64~80px）
  - 敌人/主要障碍物（obstacle，含boss级）：显示尺寸 ≥ 画布短边的 8%~14%（建议 64~100px）；小型障碍物 ≥ 短边 6%~8%
  - 收集品/道具（collectible）：显示尺寸 ≥ 画布短边的 5%~7%（建议 40~54px）
  - 弹射物（projectile）：≥ 画布短边的 3%~5%
  - **绝对禁止**把交互实体画成 <40px（在 720p+ 分辨率上太小看不清、无法点击）
  - 以上是**最终绘制/显示尺寸**（drawImage 的 dw/dh 或 entity.w/h），不是 size 字段的素材像素尺寸
  - 主界面导航图标：emoji/icon 字号 ≥ 36px（Math.max(36, h*0.44)），确保清晰可辨；NavTab 整体区域不要过窄
- **卡牌类游戏专项架构（强制，炉石/皇室战争/杀戮尖塔类卡牌对战）**：
  - **手牌管理系统（最关键）**：
    \`\`\`
    // hand = Card[] 数组，每张卡 = { id, name, manaCost, type, attack, health, effect, keywords[], artId, x, y, targetX, targetY, scale, rotation, isHovered, isDragging }
    // 手牌扇形排列：每张卡 x = centerX + (i - hand.length/2) * cardSpacing，y 按抛物线弧度微调（中间高两端低）
    // hover：卡牌上浮 20px + scale 1.15 + 发光描边 + z-index 提升；相邻卡牌向两侧推开 10px
    // 拖拽出牌：onPointerDown 记录卡牌 → onPointerMove 跟随手指 → onPointerUp 判定释放区域（战场=出随从/敌方=攻击/己方英雄=使用法术治疗）
    // 法力不足时：卡牌 alpha=0.5 + 灰色滤镜，不可拖拽（onPointerDown 时检查 manaCost > currentMana → 抖动反馈）
    \`\`\`
  - **卡牌绘制结构（_drawCardVisual，铁律）**：
    顶部左上角费用气泡（圆形 r=cardW×15% + 白色数字 + 蓝色渐变底）→ 中部插画区（drawImage 渲染 ASSETS[card.artId]，占卡面 50%~60% 高度，contain 模式居中裁切）→ 底部名称条（半透明深色底 + 白色文字 + 字号=cardW×12%）→ 左下攻击值（剑图标 + 黄色数字）+ 右下生命值（心图标 + 红色数字）→ 整体卡框用 ui_panel 的 draw9Slice 铺底 + 2px 金色描边
  - **回合状态机**：
    \`\`\`
    const TURN_PHASE = { DRAW: 0, PLAY: 1, COMBAT: 2, END: 3, OPPONENT: 4 };
    // DRAW: 自动抽牌(动画400ms) + 法力回满(水晶逐个亮起动画) + 刷新随从攻击次数
    // PLAY: 自由出牌(拖拽手牌到战场/目标) + 可攻击(拖拽己方随从指向敌方) + 使用英雄技能
    // END: 点击"结束回合" → 清理buff/触发回合结束效果 → OPPONENT
    // OPPONENT: AI 回合(玩家不可操作，手牌半透明蒙版) → DRAW(下一回合)
    // 可选：回合计时器 60~90 秒，倒计时 10 秒时红色闪烁警告，归零自动结束回合
    \`\`\`
  - **法力系统**：
    \`\`\`
    // mana = { current, max }；max 每回合+1（上限 10）；回合开始时 current = max
    // 出牌消耗：current -= card.manaCost；不足时卡牌不可用
    // 法力水晶 HUD：在英雄旁显示一排小水晶图标（亮蓝=可用，暗灰=已消耗，金色=本回合新增）
    // 每回合开始：新水晶亮起动画（从暗变亮 + 缩放弹入 + 蓝色粒子 3 颗），已有水晶刷新（闪烁 200ms）
    \`\`\`
  - **战场系统**：
    \`\`\`
    // battlefield = { playerSlots: Minion[7], enemySlots: Minion[7] }
    // Minion = { cardId, attack, health, maxHealth, keywords[], canAttack(bool), justPlayed(bool), x, y }
    // 出随从卡 → 找第一个空 slot → 卡牌飞到 slot 位置 → 落地动画(scale 0→1 + 粒子) → justPlayed=true(summoning sickness)
    // 回合开始时所有己方 minion.canAttack=true, justPlayed=false
    // 攻击：拖拽己方 minion → 指向敌方 minion/英雄 → 双方互相扣血 → 死亡检测(health<=0 → 缩小旋转渐隐 + 碎裂粒子 + deathrattle 触发)
    \`\`\`
    - taunt 嘲讽：有 taunt 的随从必须在敌方场上有 taunt 时被优先攻击（无 taunt 时敌方不可攻击非 taunt 随从/英雄）
    - divine_shield 圣盾：第一次受击时 shield 破碎特效（金色圆环碎裂 8 颗粒子）但 health 不扣
    - 战场槽位满（7 个）时不能出随从卡（手牌拖拽到战场时弹回 + 提示"战场已满"）
  - **牌库/抽牌系统**：
    \`\`\`
    // deck = Card[]（初始 shuffle）；drawCard() = deck.pop() → hand.push(card) → 播放抽牌动画
    // 牌库空时抽牌：fatigue 伤害（第 N 次空抽 = N 点伤害给英雄，1/2/3/4...递增）
    // 牌库 HUD：牌堆图标(ASSETS['icon_card_back']) + 剩余数量数字
    // 对手手牌：显示卡背(ASSETS['icon_card_back'])，数量=对手手牌数
    \`\`\`
  - **法术/效果结算**：法术卡打出 → 飞到目标上方 → 按效果类型结算：damage(对目标造成伤害+飘字) / heal(恢复英雄/随从生命+绿色飘字) / aoe(对所有敌方随从造成伤害+逐个飘字) / draw(抽 N 张牌) / summon(在战场生成衍生物) / buff(给目标随从加 attack/health+上浮数字)
  - **英雄区域**：英雄头像（圆形 clip + ASSETS['icon_avatar']）+ 血量条（绿色渐变，高度=头像宽×8%）+ 护甲值（灰色叠加层，如有）+ 武器栏（如有武器显示在头像旁+攻击次数指示）+ 英雄技能按钮（头像下方，点击消耗 2 法力触发效果）
  - **AI 对手（简单有效）**：
    - 出牌优先级：法力足够的卡中，优先出高攻击力随从 → 法术（如有合适目标）→ 低费随从
    - 攻击优先级：优先攻击 taunt 随从 → 可击杀的随从（attack >= health）→ 英雄（direct damage）
    - 法力利用：AI 尝试在回合内用尽所有法力（贪心算法：从最高费卡开始，能出就出）
  - **出牌/攻击动画关键帧**：
    - 随从出牌：手牌位置 → 贝塞尔曲线飞到战场 slot（400ms）→ 落地冲击波圆环 + 金色粒子 10 颗
    - 随从攻击：攻击方冲向目标（位移+scale 1.1, 200ms）→ 碰撞闪光 + 双方伤害飘字 + 震屏 3px/80ms → 攻击方弹回原位
    - 法术效果：卡牌飞到目标 → 溶解消失 → 全屏法术特效（根据法术类型：火=橙红粒子/冰=蓝白结晶/暗影=紫色烟雾）→ 伤害/治疗飘字
  - **回合结束按钮**：屏幕右侧中部，大圆角矩形按钮，文字"结束回合"+ 倒计时环形进度条；hover 上浮+发光；点击后缩小消失 → 回合切换动画
  - **功能按钮必须平铺美术素材（强制）**
  - **路径数据结构（最关键）**：
    \`\`\`
    // 路径由 waypoints 数组定义，敌人沿路径匀速移动
    // 竖版塔防路径必须 S/Z/螺旋型纵向延伸（敌人行进方向自上而下，符合重力直觉）
    // 示例：S型纵向路径（从顶部入口螺旋到底部基地）
    const PATH = [
      {x:0.5, y:0.05},  // 入口（顶部居中）
      {x:0.85, y:0.15}, // 右拐
      {x:0.85, y:0.35}, // 右侧下行
      {x:0.15, y:0.35}, // 横切到左
      {x:0.15, y:0.55}, // 左侧下行
      {x:0.85, y:0.55}, // 横切到右
      {x:0.85, y:0.72}, // 右侧下行
      {x:0.5, y:0.82},  // 汇聚到底部基地
    ];
    // 坐标为画布比例（0~1），绘制时乘以 canvas.width/height
    // 每帧：enemy 从 PATH[currentWP] lerp 到 PATH[currentWP+1]，到达后 currentWP++
    // 速度 = speed_px_per_second * dt，方向向量 = normalize(PATH[next] - PATH[current])
    // 关键节点（分叉口/Boss生成点）用发光地标或粒子特效强化视觉锚点
    //
    // 横版塔防路径必须水平 S 型 / U 型 / 多层平行结构（敌人行进方向从左到右，充分利用横向空间）
    // 示例：水平 S 型路径（从左侧出生点到右侧基地）
    const PATH_LANDSCAPE = [
      {x:0.05, y:0.25},  // 入口（左侧中上）
      {x:0.25, y:0.25},  // 右行
      {x:0.25, y:0.65},  // 下拐
      {x:0.50, y:0.65},  // 横切到中
      {x:0.50, y:0.30},  // 上拐
      {x:0.72, y:0.30},  // 右行
      {x:0.72, y:0.70},  // 下拐
      {x:0.88, y:0.50},  // 汇聚到右侧基地
    ];
    // 横版路径设计原则：
    // 1. x 坐标从小到大→利用横向纵深制造战术原向视觉
    // 2. y 坐标上下往复→充分利用屏幕高度空间，避免路径拉成直线
    // 3. 建造点位沿路径上下交错，距路径中心线偏移 15%~20% 画布高度
    // 4. 出生点在左侧、基地在右侧，符合从左向右阅读直觉
    \`\`\`
  - **横版交互流程（具体动画参数见反馈清单 22~25 条）**：
    - 拖拽建造：右侧塔栏拖出 → 预览跟随 + 绿/红落点 → 0.1s 吸附判定 → 放置/退回；备选“点选塔→点点位”
    - 升级/出售：环形菜单（升级右下拇指易达，出售左上防误触）
    - 战斗干预：主动技能拖拽释放（范围预览+蓄力条），集火指令长按 0.5s（准星标记+弹道汇聚）
    - 视觉语义：威胁色相绑定（见 F 节）+ 状态图标垂直排列不重叠 + 伤害飘字聚合 0.3s
  - **敌人系统**：
    \`\`\`
    // enemies 数组，每个敌人 = { type, x, y, hp, maxHp, speed, armor, reward, currentWP, pathProgress(0~1), alive, special }
    // 每帧 update：if (currentWP < PATH.length-1) { 向 PATH[currentWP+1] 移动; if (到达) currentWP++; } else { 到达基地 → baseHp -= damage; 移除敌人; }
    // 绘制：drawImage(ASSETS[enemy.type], x-w/2, y-h/2, w, h) + 头顶HP条（绿色→黄→红渐变，宽=敌人宽×80%，高=4px）
    \`\`\`
    - 敌人类型差异化：grunt(基础,HP中,速中)/fast(高速,HP低)/tank(低速,HP高,armor=0.3)/flyer(飞行,无视路径直线飞向基地)/healer(给周围敌人回血)/splitter(死亡时分裂为2个小怪)
    - Boss 体型 = 普通敌人 200%~250%，HP条加粗加金色描边，有专属入场动画
  - **塔/防御单位系统**：
    \`\`\`
    // towers 数组，每个塔 = { type, slotIndex, level(1~3), x, y, damage, range, attackSpeed, attackCooldown, target, projectileType }
    // 每帧 update：attackCooldown -= dt; if (cooldown<=0) { target = findTarget(tower); if (target) { fire(tower, target); cooldown = 1/attackSpeed; } }
    // findTarget 策略：默认 'first'（路径进度最远的敌人）；可选 'nearest'/'strongest'/'weakest'
    \`\`\`
    - 攻击动画：塔朝向目标旋转(tween 100ms) → 发射弹射物（ASSETS[projectile_id] drawImage，直线飞行）→ 命中时粒子爆发 + 伤害飘字
    - 升级系统：点击已放置塔 → 弹出升级面板（当前属性 + 下一级属性对比 + 升级费用按钮）；升级时塔发光 500ms + 升级箭头飘出
    - 出售系统：出售返还 50%~70% 建造费用（取整），出售时塔缩小消失 + 金币飘出
  - **波次状态机**：
    \`\`\`
    const WAVE_STATE = { PREP: 0, BATTLE: 1, WAVE_CLEAR: 2, GAME_OVER: 3, VICTORY: 4 };
    // PREP: 倒计时 5~8 秒后**自动**进入 BATTLE（全自动推进，无需点击按钮触发波次），显示下波敌人预览
    // BATTLE: 按 spawnList 间隔生成敌人，全部死亡 + 无存活敌人 → WAVE_CLEAR
    // WAVE_CLEAR: 2 秒奖励金结算 + "波次完成" 提示 → 下一波 PREP 或 VICTORY
    // VICTORY: 全部波次完成 → 结算画面（星级评定+总击杀+剩余基地HP）
    \`\`\`
    - 波次数据：\`waves[N] = { enemyList: [{type:'grunt', count:8, interval:800}, {type:'fast', count:4, interval:600}], reward: 100 }\`
    - Boss 波（每 5/10 波）：额外预告"WARNING: Boss approaching!" + 屏幕红色边缘闪烁 3s
  - **经济系统**：initialGold + 击杀奖励 + 波次奖励 - 建造/升级消耗；金币 HUD 实时更新，扣减时红色数字飘出（-50），获得时金色数字飘入（+10）
  - **放置交互流程**：点击召唤面板中的塔图标 → 进入放置模式（场景半透明蒙版，合法槽位高亮脉冲，非法槽位灰色）→ 拖拽到槽位 → 释放放置（扣金+动画）/ 释放非法区域（取消+退回面板）
  - **基地 HP 管理**：敌人到达终点 → baseHp -= enemy.damage（通常 1~5）→ HP条更新 + 红色闪烁 + 震动；baseHp ≤ 0 → GAME_OVER
  - **大本营动态状态（实现要点，美术规范见 F 节「大本营美术方向」）**：
    - 三阶状态判定：\`if (baseHp/maxHp > 0.5) state='healthy'; else if (baseHp/maxHp > 0.2) state='damaged'; else state='critical';\`
    - 每阶调整：光效alpha/粒子数/裂纹密度/震动幅度（参数见 F 节三阶动态状态）
    - 受击差异化：根据 damage.type 分发不同粒子（physical=碎石/magic=涟漪/true=屏幕微震）
  - **怪物系统（实现要点，美术规范见 F 节「怪物美术方向」）**：
    - 体型基准：普通怪宽高=画布短边 5%~7%，精英 120%~150%，Boss 200%~250%
    - 绘制时根据 enemy.type 选取对应色相/外发光/拖尾特效
    - 死亡动画时长：普通 0.2s / 精英 0.4s / Boss 分段解体
    - 生成预警：出生点光圈收缩 + 倒计时 3~5s
    - 性能红线：同类型合图集，单屏活跃≤ 30 保 60FPS，远距离简化特效
  - **塔防 HUD 布局**：
    - 竖版：顶部=波次信息（"Wave 3/15" + 进度条）+ 金币 + 基地HP条；底部=召唤面板（每个塔图标+名称+费用）
    - 横版：左侧区=波次信息 + 金币 + 基地HP（纵向排列，余光可扫读）；右侧区=塔选择列表（垂直滚动）+ 技能/加速按钮
    - 通用：点击已放置塔=环形菜单（升级/出售/详情），金币不足灰色半透明
- **物理弹射类游戏专项比例（强制，愤怒的小鸟/投石车/弹弓类）**：
  - **必须定义 UNIT_SIZE 常量**：在场景 init 开头声明 \`const UNIT = Math.round(G.CONFIG.height * 0.07)\`（≈画布短边 7%，720p 下 ≈ 50px），所有实体尺寸基于它：
    - 弹射物（小鸟）：半径 r = UNIT * 0.5（即直径 = 1 UNIT），绘制时 drawImage 区域 = UNIT × UNIT
    - 目标角色（猪/敌人）：w = h = UNIT * 0.9~1.1（与弹射物接近，略小或等大），**禁止猪比鸟小超过 30% 或大超过 50%**
    - 标准方块（wood/stone/glass）：正方形 = UNIT × UNIT；长条板 = UNIT×0.5 高 × UNIT×2 宽；竖板 = UNIT×0.5 宽 × UNIT×2 高。**每种方块只用这三种规格组合**
    - 收集品（金蛋等）：w = h = UNIT * 0.7
    - 弹弓/发射器：高度 = UNIT * 3~4，宽度 = UNIT * 1~1.5
  - **纵横比一致性**：弹射物、目标角色的 drawImage/SpriteAnimation 绘制区域必须正方形（w===h），不能把正方形素材画成长条形
  - **视觉比例自检**：弹射物飞行时显示尺寸 ≈ 目标角色尺寸 ≈ 单个标准方块尺寸（三者视觉面积相近），建筑结构由多个方块堆叠组成（整体远大于单个角色，但单块与角色相当）
  - **禁止的比例错误**：
    - 禁止弹射物绘制面积 > 目标角色 2 倍（鸟不能比猪大一圈）
    - 禁止方块比弹射物小（不能出现巨型鸟撞微型积木的画面）
    - 禁止弹弓比弹射物小（弹弓必须能"装下"弹射物）
    - 禁止所有实体全用同一尺寸（方块/弹射物/目标应有 ±20% 的自然差异，但差异不超 2 倍）
- **跑酷/无尽奔跑类游戏专项架构（强制，endless runner/跑酷/无尽类）**：
  - **核心循环架构**：自动滚动背景（多层视差 2~3 层，速率递减：前景 1x / 中景 0.6x / 远景 0.3x）+ 玩家固定在画面左 1/3 水平位置、只做垂直操作（跳跃/下滑/多车道切换）+ 障碍物从右侧生成、以 scrollSpeed 向左移动、超出画面左侧后回收
  - **地面与平台系统**：地面高度 = 画布底部 15%~20%（GROUND_Y = G.CONFIG.height * 0.82）；用地面瓷砖素材 drawImage 平铺（宽度 = 画面宽度 + 一格超出用于无缝循环）；空中平台高度范围 = GROUND_Y 以上 20%~60%
  - **跳跃物理**：tap/swipe-up 触发跳跃（jumpVelocity = -jump_height * 0.018）；每帧 vy += gravity*dt；落地判定 = player.y + player.h >= platform.top 且 vy > 0；可选：长按增加跳跃高度（变量跳跃）
  - **障碍生成器**：最小间距 = obstacle_min_gap（按当前 scrollSpeed 换算成时间确保玩家有足够反应时间）；随距离/时间递增难度：(1) scrollSpeed 缓慢增加（speed_increase_rate per second），(2) 障碍间距缩短，(3) 新障碍类型解锁（地面高障碍→空中障碍→移动障碍）
  - **碰撞检测**：AABB hitbox 比视觉缩小 20%~30%（给玩家容错感），命中后：无敌帧 1.5s + 屏幕震动 + 红色边缘闪光 + 生命-1（或直接死亡进结算）
  - **计分**：距离实时计分（每帧 += scrollSpeed * dt / 10）+ 金币/收集品额外加分（coin_value per piece）；得分 HUD 在顶部居中，数字带描边 + 增加时弹跳动画
  - **视差背景 drawParallax 实现要点**：每层维护 offsetX，每帧 offsetX -= speed * layerFactor * dt；绘制时需画两张图（offsetX 和 offsetX + imgWidth）实现无缝循环；当 offsetX < -imgWidth 时重置为 0
- **三消/消除/Match-3 类游戏专项架构（强制，实体/布局/规则见 F 节三消设计规范）**：
  - **网格系统核心**：二维数组 grid[row][col] = { type, x, y, targetX, targetY, scale, alpha, locked, obstacle, obstacleHP }（type = 0~N 对应不同颜色宝石，type=-1 为空格）；渲染位置画布居中，cellSize = Math.floor(Math.min(canvasW*0.7/cols, canvasH*0.6/rows))；gem 居中占 cellSize 的 85%~90%
  - **交互模式（二选一）**：相邻交换（tap→tap→交换→检测→无匹配则回退 200ms+震动）；连线模式（按住沿同色连线≥3 消除）
  - **匹配检测算法**：横向扫描（每行连续≥match_min_count 同 type→标记）+ 纵向扫描 → 收集标记点 → 消除 → 特殊宝石生成检测（4连→线宝石，5连→彩虹，L/T→爆炸）
  - **级联下落（cascade）**：每列逐格下落填补空位（gem.targetY→每帧 lerp 速率 0.15~0.2）→ 顶部生成新宝石 → 再检测 → 循环至无匹配；locked=true 禁止操作
  - **下落物理感（强制）**：ease-out-bounce + 落地回弹 scaleY(0.9→1.0, 80ms) + 速度随连击递增 baseSpeed×(1+comboCount×0.1)；禁止线性/瞬移
  - **连击计分公式**：comboCount++ per cascade；score = 消除数 × base_score × comboMultiplier^(comboCount-1)；飘字弹出+放大缩小+音效 pitch 升高
  - **连击情绪与反馈（动画阈值见 8.1 质量规则）**：3连→边缘泛光(alpha 0.1+combo×0.05)；5连→粒子雨(8+combo×4)；关键连击→0.3s 慢动作；普通消除 0.2s / 特殊消除径向模糊+微震 / 无效操作≤0.1s 红闪
  - **选中态与消除动画**：选中 scale 1.15+描边发光+弹跳+相邻提示；消除 scale→0+alpha 渐隐+粒子爆炸(8~12 同色粒子)；合成 0.4~0.6s
  - **特殊宝石效果**：线炸弹=整行列闪光 80ms；爆炸炸弹=3×3 冲击波+20 粒子+震屏 4px；彩虹球=全屏同色依次消失(30ms 间隔)+彩虹光晕 300ms；特殊+特殊=超级效果（线+线=十字，爆+爆=5×5）
  - **关卡数据结构**：
    \`\`\`
    // levels[N] = { gridRows, gridCols, maxMoves, goalType, goalData, obstacles[], unlocked, stars }
    // goalType: 'score' | 'collect' | 'clear' | 'timed'；stars: 0~3（1星=目标×1.0, 2星=×1.5, 3星=×2.0）
    \`\`\`
  - **关卡结算动画**：通关=棋子聚拢爆炸+金色粒子升腾→星级逐颗亮起(间隔 400ms, scale 0→1.3→1.0)；失败=下沉+冷灰(saturation→0, 600ms)+碎裂消散
  - **无解检测**：每次 cascade 结束扫描全场合法交换；无解→全部闪烁 500ms+随机重排+"Shuffling..."飘字
- **平台跳跃类游戏专项架构（强制，马里奥/洛克人/超级猫里奥类）**：
  - **关卡数据结构**：levelData = { platforms: [{x,y,w,h,type}], enemies: [{x,y,type,patrolRange}], collectibles: [{x,y,type}], startPos, endPos, width }；关卡宽度 = 画布宽度 × 3~10 倍（横向长关卡）
  - **摄像机跟随**：camera.x 平滑跟随玩家 x（lerp 0.08）；camera.x clamped 在 [0, levelWidth - canvasWidth]；所有实体绘制坐标 -= camera.x（视差背景层按 camera.x × layerFactor 偏移）
  - **玩家状态机**：states = idle/run/jump/fall/hurt/dead；每帧根据 input + vy 判定状态切换；每个状态对应不同 SpriteAnimation 或 tween（idle=呼吸，run=跑步帧动画，jump=腾空拉伸，fall=下落帧）
  - **平台碰撞**：只在玩家 vy > 0（下落中）且 player.bottom 穿过 platform.top 时触发站立（将 player.y 修正到 platform.top - player.h，vy=0，grounded=true）；水平碰撞阻止移动
  - **敌人 AI 模式**：patrol（在 [x-range, x+range] 间来回走动，碰边反向）/ chase（检测玩家进入范围后追踪）/ jump（周期性跳跃的巡逻敌人）；玩家从上方踩踏敌人 → 敌人死亡 + 玩家小跳弹；侧面碰撞 → 玩家受伤
  - **收集品与目标**：金币/星星接触即收集（粒子+音效+分数飘字）；终点旗帜/传送门（到达 endPos → 关卡通关结算）
  - **尺寸规范**：角色高度 = canvasHeight × 0.10~0.14；单个地面砖块 = 正方形 tileSize（= 角色高度 70%~100%）；敌人 ≈ 角色的 70%~120%
- **射击/弹幕类游戏专项架构（强制，space shooter/飞机/纵向弹幕类）**：
  - **核心循环**：背景持续纵向滚动（或星空粒子流）→ 玩家在底部 1/3 区域自由移动（触摸/鼠标拖拽跟手，移动响应延迟 ≤ 1 帧）→ 自动开火（fire_rate 间隔，发射玩家子弹）→ 敌人从顶部/两侧按波次编队入场 → 碰撞判定 → 道具掉落
  - **对象池模式（重要！）**：子弹、粒子、道具等高频创建/回收对象**必须**用对象池（预分配数组 + active 标记），禁止在主循环中 new Object / push+splice —— 这会导致 GC 卡顿：
    \`\`\`
    // 对象池示例
    const BULLET_POOL = Array.from({length: 200}, () => ({active: false, x:0, y:0, vx:0, vy:0, type:'player'}));
    function spawnBullet(x, y, vx, vy, type) {
      const b = BULLET_POOL.find(b => !b.active);
      if (b) { b.active=true; b.x=x; b.y=y; b.vx=vx; b.vy=vy; b.type=type; }
    }
    function updateBullets(dt) {
      for (const b of BULLET_POOL) {
        if (!b.active) continue;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < -20 || b.y > G.CONFIG.height+20 || b.x < -20 || b.x > G.CONFIG.width+20) b.active = false;
      }
    }
    \`\`\`
  - **敌人编队生成**：每波 waveData = [{type, count, formation, path, delay}]；formation 类型：line（横排）、V（V字形）、circle（圆形展开）、path（沿贝塞尔曲线入场）；波间间隔 3~5s
  - **Boss 战**：Boss 占屏宽 30%~50%，多阶段（血量 < 50% 切换弹幕 pattern）；弹幕 pattern：扇形（fan）、螺旋（spiral）、十字（cross）、随机散射（scatter）；Boss 有独立血条（画面顶部/Boss 头顶）
  - **碰撞检测**：hitbox 小于视觉（玩家 hitbox = 中心 6x6~12x12 像素判定点，不是整个飞机轮廓）；敌人 hitbox = 视觉 80%；命中判定用圆形距离或 AABB
  - **无敌帧**：玩家被击后 invincible_frames 帧内不可再次受伤 + 闪烁效果（偶数帧 alpha=0.3 / 奇数帧 alpha=1.0）
  - **道具系统**：击杀特定敌人/随机掉落，下落速度固定（2~3px/frame）；拾取后：weapon_upgrade（fire_rate 提升/子弹扩散）、shield（吸收一次伤害）、bomb（清屏所有敌机+子弹）
- **休闲点击/放置/Idle 类游戏专项架构（强制）**：
  - **核心交互**：画面中央大型可点击目标（占屏 30%~40%），每次点击：(1) 产出 clickValue 资源（飘字 "+N" 从点击位置弹出 → 上浮 → 渐隐），(2) 目标 squash-and-stretch 弹性反馈（scaleX 0.85 → 1.0, scaleY 1.15 → 1.0, 120ms ease-out-back），(3) 粒子从目标中心向外扩散 6~10 个小粒子
  - **大数显示**：资源数值 > 1000 显示 K，> 1M 显示 M，> 1B 显示 B，> 1T 显示 T（formatBigNumber 函数）；数值变化时有滚动动画（从旧值 lerp 到新值，500ms）
  - **升级面板（底部 40%~50% 区域）**：可滚动列表/卡片式，每个升级项 = 图标 + 名称 + 当前等级 + 效果描述 + 费用按钮（可购买时高亮闪烁，不可时灰色）；购买后：费用按 upgrade_costs[level] 指数增长（通常 cost = baseCost * 1.15^level）
  - **自动收益（autoIncome）**：每秒自动产出 autoIncomeRate 资源（UI 显示"每秒 +N"）；收益来源 = 已购买的自动升级项总和；离线收益 = 离线时长 × autoIncomeRate × offlineMultiplier（可选上限）
  - **视觉反馈层级**：(1) 点击反馈最即时（<50ms 视觉响应），(2) 升级购买有金光/星星粒子 + 数值跳动，(3) 里程碑达成有全屏庆祝动画（金币雨/烟花/banner 弹出）
  - **Prestige/转生（可选高级循环）**：达到 prestige_threshold 后解锁"转生"按钮，点击重置所有普通进度但获得永久倍率乘数；转生次数 × 倍率 = 永久加速
  - **UI 布局**：顶部资源显示栏（当前资源 + 每秒收益）→ 中部大点击目标 → 底部升级面板（可滑动查看更多升级项）；升级面板占屏幕下半部分但不遮挡中央点击目标
- **回合制RPG/策略类游戏专项架构（强制，梦幻西游/最终幻想/DQ类回合战斗）**：
  - **战斗场景布局（最关键）**：
    - 背景：bg_gameplay 铺满全屏
    - 己方队伍（左侧）：2~4 个角色纵向排列，每个角色 = sprite/图片 + 下方HP条（绿色渐变）+ MP条（蓝色渐变）+ 角色名。y 坐标从画布高度 15% 到 65% 等间距分布，x 在画布宽度 10%~25%
    - 敌方队伍（右侧）：1~5 个怪物按数量在右半屏分布（y 从 20%~70%，x 在 60%~85%）。Boss 单独居中偏右且尺寸加大（200%~250%）
    - 指令面板（底部 25%~30%）：半透明暗色底板（ui_panel 9-slice），分为主菜单列和子菜单列
    - 顶部信息栏：当前行动角色名 + "第 N 回合" + 可选行动顺序指示器
  - **回合状态机（battleState）**：
    \`\`\`
    // 状态枚举
    const BATTLE_STATE = { INIT: 'init', PLAYER_TURN: 'playerTurn', ENEMY_TURN: 'enemyTurn', EXECUTING: 'executing', ANIMATING: 'animating', VICTORY: 'victory', DEFEAT: 'defeat' };
    // 行动队列：按 SPD 排序所有存活角色+敌人，依次出列执行
    // turnOrder = [...team, ...enemies].filter(u => u.hp > 0).sort((a,b) => b.spd - a.spd);
    // currentActor = turnOrder[turnIndex]
    // 状态流转：INIT → (计算顺序) → PLAYER_TURN(等待选择) → EXECUTING(执行伤害计算) → ANIMATING(播放动画) → 检查胜负 → 下一个行动者...
    \`\`\`
  - **指令系统实现**：
    - 主菜单 = 4 个选项按钮纵向排列：⚔ 攻击 / ✨ 法术 / 🎒 道具 / 🛡 防御
    - 点击"攻击"→ 进入目标选择模式（敌方角色高亮可点，点击选中后执行普通攻击）
    - 点击"法术"→ 展开技能子面板（列出当前角色可用技能，每项显示名称+MP消耗，MP不足灰色不可选）→ 选技能 → 选目标
    - 点击"道具"→ 展开背包面板（药水/道具列表）→ 选道具 → 选目标
    - 点击"防御"→ 直接标记当前角色为防御状态（本回合受伤减半），跳到下一个行动者
    - **指令面板必须用 ui_panel 作底板(draw9Slice 铺满)，每个选项用 drawButton 渲染（图标+文字）**
  - **伤害计算公式（必须实现）**：
    \`\`\`
    function calcDamage(attacker, skill, target) {
      const base = attacker.atk * (skill.multiplier || 1.0);
      const defense = target.defending ? target.def * 1.0 : target.def * 0.5;
      let dmg = Math.max(1, Math.round(base - defense + (Math.random() * 10 - 5)));
      // 暴击判定（10%概率，伤害×1.5）
      const isCrit = Math.random() < 0.1;
      if (isCrit) dmg = Math.round(dmg * 1.5);
      return { dmg, isCrit };
    }
    \`\`\`
  - **行动动画序列（必须有，不能直接扣血）**：
    - 物理攻击：角色向前位移 50~80px(200ms ease-out) → 武器挥动特效 → 目标闪烁白色(100ms) → 伤害数字飘出(红色 -N，暴击加大号 + "暴击!") → 角色退回原位(150ms)
    - 法术攻击：角色原地施法姿势（升高手臂/发光）→ 从角色到目标的特效粒子/光束(300ms) → 目标受击动画 → 伤害数字飘出(带属性颜色：火=橙、冰=蓝、雷=紫)
    - 治疗：目标周围绿色光圈上升 + 数字飘出(绿色 +N)
    - **动画期间 battleState='animating'，指令面板不可操作**
  - **敌方 AI（简单但有效）**：
    \`\`\`
    function enemyDecide(enemy, playerTeam) {
      const alive = playerTeam.filter(u => u.hp > 0);
      // Boss 特殊：HP<30% 时放大招（全体攻击），否则随机单体
      if (enemy.isBoss && enemy.hp < enemy.maxHp * 0.3 && enemy.skills.length > 1) {
        return { skill: enemy.skills[1], targets: alive }; // 全体大招
      }
      // 普通怪物：优先攻击 HP 最低的玩家角色
      const weakest = alive.reduce((a, b) => a.hp < b.hp ? a : b);
      return { skill: enemy.skills[0], targets: [weakest] };
    }
    \`\`\`
  - **角色站位与尺寸**：
    - 己方角色 sprite 高度 = 画布高度 16%~20%（梦幻西游风格较大）
    - 敌方普通怪物 = 画布高度 14%~18%；Boss = 画布高度 25%~35%
    - HP 条宽度 = 角色 sprite 宽度，高度 6~8px，绿色渐变填充 + 深色描边
    - MP 条宽度同上，高度 4~6px，蓝色渐变
    - 角色间纵向间距 = 角色高度 × 30%~50%
  - **伤害数字飘出效果（必须实现）**：
    - 数字从受击位置弹出（初始 vy=-3，每帧 vy+=0.15，持续 60 帧后渐隐移除）
    - 普通伤害：红色 24px 粗体描边
    - 暴击：橙色 36px + "暴击!" 文字 + 放大弹跳动画
    - 治疗：绿色 24px + "+"前缀
    - Miss：灰色 "MISS" 字样
  - **战斗结束处理**：
    - 胜利：敌方全灭 → 敌人逐个播放消失动画(缩小+旋转+渐隐) → 弹出奖励面板(经验+金币+掉落物) → "继续"按钮返回主界面或下一波
    - 失败：己方全员HP≤0 → 屏幕渐暗 + "GAME OVER" 大字 + 重试/返回按钮
- **格斗/FTG类游戏专项架构（强制，拳皇97/街霸/铁拳类1v1或3v3格斗）**：
  - **战斗场景布局（最关键）**：
    - 背景：bg_gameplay 铺满全屏，地面线清晰（GROUND_Y = height × 0.78~0.82），场景有纵深感（擂台围栏/街道建筑/道场墙壁等远景细节）
    - 双方角色站在同一水平面上（y = GROUND_Y - characterHeight），初始间距 = 画布宽度 × 40%~50%
    - 摄像机/视口：双方 x 中点始终居中于画布，当双方距离拉大时视口缩放缩小（可选），确保两人始终同屏可见
    - 角色大小：高度 = 画布高度 × 22%~30%，宽度 = 高度 × 0.4~0.5
  - **双血条 HUD（顶部，必须实现）**：
    - P1 血条（左上）：x=画布宽度×2%, y=画布高度×3%, 宽度=画布宽度×40%, 高度=画布高度×2.5%。填充方向从右向左缩减（满血=全宽，空血=零宽）。颜色渐变：HP>60%绿色 #4CAF50，30%~60%黄色 #FFC107，<30%红色 #F44336
    - P2 血条（右上）：镜像布局，x=画布宽度×58%, 填充方向从左向右缩减
    - 血条外框：2px 深色描边 + 内侧 1px 高光（金属质感）
    - 角色头像框：血条外侧端，圆形/方形 clip + ASSETS['icon_fighter_p1/p2']
    - 回合指示圆点：血条正下方，每方 2~3 颗小圆点（best_of_rounds），胜一回合亮起对应圆点（金色发光），负则灰暗
    - 倒计时器：顶部正中央，字号 = 画布高度×5%，描边+阴影，最后 10 秒变红+闪烁（alpha pulse 0.5↔1.0）
  - **气槽 HUD（底部，必须实现）**：
    - P1 气槽（左下）：x=画布宽度×2%, y=画布高度×92%, 宽度=画布宽度×30%, 高度=画布高度×1.5%。分 1~3 段（每段 = 总宽/3），填充色从蓝到紫渐变。满格时发光脉冲动画（glow pulse 0.6↔1.0 alpha, 600ms cycle）
    - P2 气槽（右下）：镜像布局
  - **格斗状态机（FighterState，核心架构）**：
    \`\`\`
    const FIGHTER_STATE = {
      IDLE: 0, WALK_F: 1, WALK_B: 2, CROUCH: 3,
      JUMP: 4, JUMP_F: 5, JUMP_B: 6,
      ATTACK_L: 10, ATTACK_H: 11, SPECIAL: 12, SUPER: 13,
      BLOCK_STAND: 20, BLOCK_CROUCH: 21,
      HIT_STUN: 30, BLOCK_STUN: 31, KNOCKDOWN: 32, WAKEUP: 33,
      KO: 40, VICTORY: 41
    };
    // 每个 fighter 实例：
    // { x, y, vx, vy, hp, superMeter, state, stateFrame, stateTimer,
    //   facing: 1|-1, isGrounded, hitFlag, comboCount, teamIndex,
    //   currentSpritesheet: ASSETS['fighter_idle'] | ASSETS['fighter_walk'] | ... }
    \`\`\`
    状态转换规则：IDLE→任意移动/攻击/防御；ATTACK 状态中 startup 帧不可取消，active 帧可被 cancel 窗口内的下一招取代（连招核心），recovery 帧可被 hit-confirm 的下一招取代；HIT_STUN 持续 hitstun 帧后→IDLE；KNOCKDOWN 持续固定帧后→WAKEUP→IDLE（起身有无敌帧 10 帧）
  - **帧数据系统（FrameData，攻击核心）**：
    \`\`\`
    const ATTACKS = {
      light_punch:  { startup: 3, active: 4, recovery: 6,  damage: 30, hitstun: 12, blockstun: 8,  knockback: 3,  hitbox: { ox: 30, oy: -10, w: 40, h: 20 } },
      heavy_kick:   { startup: 8, active: 5, recovery: 12, damage: 80, hitstun: 20, blockstun: 14, knockback: 12, hitbox: { ox: 25, oy: 5,   w: 55, h: 30 } },
      special_fireball: { startup: 12, active: 8, recovery: 15, damage: 60, hitstun: 16, blockstun: 10, knockback: 8, hitbox: { ox: 40, oy: -5, w: 30, h: 25 }, projectile: true },
    };
    // hitbox 实际位置 = fighter.x + hitbox.ox * fighter.facing, fighter.y + hitbox.oy
    \`\`\`
  - **输入缓冲系统（InputBuffer，格斗游戏核心）**：
    - 维护一个环形缓冲区（最近 15 帧的输入记录），每帧记录 \`{ dir: 'up'|'down'|'left'|'right'|'neutral', buttons: ['lp','hp','lk','hk'], frame: number }\`
    - 必杀技指令识别：在缓冲区中匹配方向序列模式，如 \`down, down-forward, forward + punch\` = 波动拳（匹配容差 8 帧内完成）。匹配成功 → 消耗对应输入 → 进入 SPECIAL 状态
    - 攻击键映射：轻拳(lp)/重拳(hp)/轻踢(lk)/重踢(hk)，对应不同 ATTACKS 条目
    - 输入优先级：同时按下时 超必杀 > 必杀技 > 重攻击 > 轻攻击
  - **hitbox/hurtbox 碰撞检测**：
    - 每帧检测：如果 A.state 在 ATTACK_* 且 stateFrame 在 [startup, startup+active) 范围内 → 计算 A 的 hitbox 矩形
    - B 的 hurtbox = { x: B.x - B.width*0.4, y: B.y - B.height, w: B.width*0.8, h: B.height }（站立）或 h/2（蹲伏）
    - AABB 重叠 → 命中！如果 B.state === BLOCK_STAND/BLOCK_CROUCH → 格挡（blockstun + chip damage）；否则 → hitstun + 全额伤害 + knockback + comboCount++
    - 命中后 A.hitFlag = true（同一招不再重复命中），A 进入下一状态或继续 active 帧剩余
  - **连招系统**：
    - comboCount：B 处于 HIT_STUN 期间被再次命中 → comboCount++
    - 伤害缩放：实际伤害 = attack.damage × max(combo_damage_scale_min, 1.0 - 0.1 × comboCount)
    - Juggle 限制：B 在空中被命中时 juggleCount++，juggleCount > max_juggle(3) 时 B 不再被空中追打，直接落地 KNOCKDOWN
    - comboCount 归零时机：B 从 HIT_STUN/KNOCKDOWN 恢复后 → comboCount = 0
  - **回合流程状态机**：
    \`\`\`
    const ROUND_STATE = { INTRO: 0, FIGHT: 1, ROUND_END: 2, MATCH_END: 3 };
    // INTRO: 播放"ROUND N" + "FIGHT!" 公告 (3秒) → FIGHT
    // FIGHT: 正常战斗循环 → HP<=0 或 time=0 → ROUND_END
    // ROUND_END: "K.O.!" 公告 (2秒) → 检查 best_of_rounds → INTRO 或 MATCH_END
    // MATCH_END: 胜利/失败画面 → 重赛/返回
    \`\`\`
  - **3v3 队伍轮转（KOF 风格）**：
    - 每方 team = [fighter1, fighter2, fighter3]，activeIndex 指向当前出场角色
    - 当前角色 HP≤0 → KO 动画播放 → activeIndex++ → 新角色入场（2 秒入场 pose 动画）→ 继续 FIGHT
    - 对方 activeIndex 超出 team.length → 该方全部 KO → MATCH_END
    - 换人时双方位置重置到初始站位
  - **AI 对手（简单有效）**：
    - 距离判断：远(>画布宽40%) → 70%概率前进接近，30%后退；中(20%~40%) → 40%攻击/30%前进/20%防御/10%后退；近(<20%) → 50%攻击/30%防御/10%后退/10%投技
    - 攻击选择：轻攻击 50% / 重攻击 30% / 必杀技 20%（如果气槽足够）
    - 反应延迟：easy = 30 帧延迟 / normal = 15 帧 / hard = 5 帧。AI 看到玩家攻击 → 延迟 N 帧后进入防御状态
    - 连招 AI：hard 难度 AI 命中后 70% 概率接一个轻→重连段
  - **K.O. 演出序列（必须实现）**：
    - 最后一击命中 → 游戏速度降至 0.3x 持续 600ms → 受击方播放 KNOCKDOWN 动画（向后飞出+旋转）
    - "K.O.!" 文字：从 scale(0) → scale(1.3) → scale(1.0) 弹入（ease-out-back 400ms），字号 60~80px，红色+金色描边，居中
    - 屏幕震动：8px 振幅 300ms + 短暂白闪 100ms
    - 演出结束后 ROUND_STATE → ROUND_END → 判定胜负 → 进入下一回合或 MATCH_END
  - **角色选择界面（character_select）**：
    - 角色头像网格：每行 3~4 个，间距均匀，头像尺寸 = 画布宽度×12%~15%
    - P1 光标蓝色发光框 + P2 光标红色发光框，方向键移动光标
    - 选中后底部显示角色立绘（ASSETS['{fighter}_portrait']）+ 角色名 + 三属性评级条
    - 双方都确认后 → VS 过渡画面（左右分屏+VS 大字，2 秒）→ 进入战斗
- **功能按钮必须平铺美术素材（强制）**：所有可点击的功能入口（drawHubIcon / 二级卡片 / drawNavTab 中的图标背景）都**必须**使用 ui_button 素材作为底板（通过 draw9Slice 铺满按钮矩形），在其上叠加图标和文字。**禁止**功能按钮只有纯色/半透明背景+emoji。这确保每个按钮看起来都像专业手游的质感按钮。
- **全局图标必须使用 ASSETS 美术素材（铁律：禁止 emoji 充当功能图标）**：
  - 主界面导航栏（drawNavTab）中每个入口的图标**必须**使用对应的 ASSETS 图片素材（icon_shop / icon_ranking / icon_settings / icon_help 等），通过 drawImage 绘制到图标区域，**严禁用 emoji/Unicode 字符(如 🛍/★/⚙/?)作为正式的功能图标**
  - topBar 中玩家头像**必须**使用 ASSETS['icon_avatar']（drawImage 绘制到圆形 clip 区域内），货币图标**必须**使用 ASSETS['icon_coin'] 而非 emoji
  - 弹窗内（商店商品图标/排行榜奖牌/技能按钮图标）如有对应 ASSETS 素材则必须使用，无对应素材时才允许用 emoji 兜底
  - drawNavTab 渲染逻辑：icon 为 Image/canvas 时用 drawImage 居中绘制到图标槽(建议 36x36~48x48)；icon 为字符串时降级 fillText（仅兜底）
  - **回合制 RPG 技能面板**：攻击/法术/道具/防御四个指令按钮的图标必须使用 ASSETS['icon_skill_attack'] / icon_skill_magic / icon_item_potion / icon_skill_defend 等对应素材渲染
  - 这条规则的目的：确保生成的游戏中每个界面看起来都有专业手游美术品质，而不是廉价的 emoji 拼凑感
- **按钮底图铺满零容忍（全局所有按钮适用，反复强调！）**：
  - 无论是 drawButton / drawHubIcon / drawNavTab / 弹窗按钮 / 任何自定义按钮，只要使用了 ui_button 素材，draw9Slice 的目标矩形(x,y,w,h)都**必须 = 按钮控件的外框坐标和尺寸**，不允许对坐标做任何 +padding / +margin / +offset 使素材比控件小
  - 视觉判定标准：按钮美术纹理的最外侧像素必须与按钮 clip 区域的边缘完全对齐（或被 clip 裁掉），**绝不能看到按钮控件背景色/底色从四周露出来**
  - 如果控件有圆角（roundRectPath clip），clip 区域已经裁圆了边角——draw9Slice 仍然传完整矩形，圆角由 clip 负责、不需要手动缩小 9-slice 区域
- **登录画面布局均衡性**：若 title 场景采用丰富布局，不能“上大下小”到二级功能区完全被压缩。hero 区域建议占总高度 30%~40%（而非 >50%），二级功能区占 18%~25% 且与 hero 视觉权重协调，底部导航 12%~14%。整体三段比例保持视觉节奏感。
- 游戏体验要流畅、有反馈（动画、音效提示、视觉特效）

### 8. 游戏类型专项质量规则（根据游戏类型匹配应用）

#### 8.1 三消/消除类
- **竖版布局与网格规范（强制，详见 F 节三消设计规范）**：三层式 portrait（顶部信息层 15%~18% + 中部棋盘 40%~60% + 底部操作层 20%~25%）；网格占宽 65%~75%，单格 ≥48×48pt，格间距 ≥4px；底部按钮 Y ≥ 底边 80px
- **棋子视觉铁律（强制，详见 F 节宝石视觉区分铁律）**：色相+形状双编码，高饱和纯色(70%~85%)，禁止渐变/发光/半透明；alpha=1.0 实心填充，禁白底/绿底素材；棋盘单格与棋子明度差 ≥30%
- **动画时序标准**：交换 150ms，消除（缩小+透明）200ms，下落 lerp 250ms，合成 0.4~0.6s；弹性缓动下落(ease-out-bounce)+落地回弹，禁止线性/瞬移
- **连击情绪累积**：combo 飘字逐级放大+颜色升温（白→黄→橙→红）；3连击起边缘泛光；5连击叠加纵向粒子雨；每次消除必须有粒子爆炸
- **操作反馈**：无效操作左右轻摇+红闪≤0.1s；交换回 200ms+震动；无解时自动洗牌重排
- **通关/失败动效**：通关=棋子聚拢爆炸+金色粒子升腾；失败=下沉+冷灰+碎裂消散
- **性能红线**：棋子/特效合入单张 1024×1024 图集；消除粒子用对象池，单屏活跃 ≤80；棋盘背景纯色/极简渐变；关卡切换异步卸载
- **分辨率自适应**：棋盘宽高比锁定 7:9，两侧模糊填充；UI 相对坐标+安全区适配；折叠屏/平板扩展列数但单格不变

#### 8.2 跑酷/躲避类
- **速度感**：背景视差滚动至少 2 层（远景慢/近景快），地面滚动速度与游戏速度同步
- **操作响应即时**：跳跃/下滑必须在 1 帧内响应，无延迟感；跳跃高度 = 角色高度 × 2.5~3 倍
- **障碍物节奏**：障碍间距至少给玩家 400ms 反应时间，禁止连续无解障碍
- **渐进难度**：速度随距离/时间递增（speed = base + elapsed/10000 * 2），障碍密度递增但有上限
- **收集磁吸效果**：金币/宝石在玩家附近 80px 时自动被吸引过来，降低操作压力

#### 8.3 射击/弹幕类
- **触屏操控灵敏**：玩家飞机跟手拖拽，无延迟，移动范围限制在画布底部 40%
- **自动开火**：按固定频率自动发射（每 120~200ms 一发），玩家只需专注躲避
- **弹幕密度可见**：敌人弹幕颜色必须与背景形成高对比（亮色弹幕 on 暗色背景）
- **击中反馈明确**：敌人被击中闪白 50ms + 伤害飘字；击毁时爆炸粒子 12− 15 颗
- **Boss 战阶段化**：Boss 至少 2 个阶段，血量降到 50% 切换弹幕模式，且有明确血条显示

#### 8.4 平台跳跃类
- **跳跃手感好**：跳跃上升快、下落稍慢（gravity 在下落时 ×1.5），支持长按跳更高
- **土狼时间**：离开平台边缘后仍有 80~120ms 允许跳跃（coyote time）
- **提前输入缓冲**：落地前 100ms 内的跳跃指令自动在落地后执行（jump buffer）
- **摄像机跟随**：摄像机平滑跟随玩家（lerp 0.1），不硬锁，查看前方路径有预判
- **碰撞检测精确**：玩家 hitbox 略小于视觉（宽高 ×0.8），增加容错感；平台碰撞只检测底部

#### 8.5 塔防/策略类
- **路径清晰可见**：敌人行进路线必须有明确视觉引导（路径底色比环境暗 15%~20% 形成视觉通道 + 箭头指示方向）；竖版路径 S/Z/螺旋型纵向延伸；横版路径水平 S 型/U 型/多层平行结构，充分利用横向空间拉长单屏可视路径
- **放置位背景板高对比**：每个放置槽位绘制为「深色 2~3px 描边 + 高饱和填充色（金黄 #FFD24A / 青绿 #4ADE80 / 亮蓝 #38BDF8 任选）+ 填充 alpha ≥ 0.85」，与地面/草地/路径背景形成明显对比；空槽位脉冲呼吸（alpha 0.7↔1.0，周期 2s）；**禁止仅用半透明白色或浅灰色**；竖版槽位间距 ≥ 1.5× 塔基直径，横版 ≥ 1.8×；横版默认低透明度轮廓、选中/悬停时才高亮
- **建造操作直觉**：拖拽放置时显示半透明预览模型 + 绿色/红色落点指示器；合法位置边框加粗 #22C55E，非法位置 #EF4444 + 抖动 4px；松手后"吸附"缩放动画 + 落地震动 + 尘土粒子；横版额外支持松手前 0.1s 吸附判定（自动对齐最近合法点位）+ "点击选塔→点击点位"备选模式
- **波次全自动推进（铁律）**：显示当前波次/总波次，波次间 5~8 秒准备期倒计时结束后**自动开始下一波**，禁止需要玩家手动点击按钮才能触发波次；准备期仅用于建造/升级，倒计时归零即刻出怪
- **射程可视化**：选中防御塔时显示低透明度同心圆，颜色与塔属性一致（冰蓝/火红/箭绿），未选中时隐藏避免视觉污染
- **经济平衡**：初始金币能建 2~3 座塔，每波击杀奖励能再建 1 座，保证策略性
- **竖版三段式布局（portrait 强制）**：顶部 ≤18% + 中部 ~62% + 底部 ≤20%（详见 F 节布局规范）；信息层严禁遮挡战场
- **横版左-中-右布局（landscape 强制）**：左 15%-20% 信息区 + 中 60%-70% 战场 + 右 15%-20% 操作区（详见 F 节布局规范）
- **色彩语义化 + 层级清晰度**：敌方威胁等级色相绑定；可交互对象投影/描边 ≥2 级明度差；弹道拖尾 ≤0.3s；正交俯视或微仰角（≤15°）
- **打击感与反馈**：敌人受击短暂白闪 50ms + 位移顿挛 0.05s；死亡粒子向屏幕中心聚拢（而非四散）；塔攻击时炮管后坐力 + 地面震波涟漪
- **异常状态提示**：资源不足时建造按钮变灰 + 抖动反弹 + 资源数字标红脉冲；基地受损时全屏边缘泛红呼吸灯（伤害越高红光越浓）+ 横版额外辅以横向微震
- **横版操作专项**：升级/出售采用环形菜单（跟随塔体不超屏）；主动技能拖拽释放（显示范围+蓄力条）；集火指令长按敌人 0.5s 触发（准星标记+弹道汇聚）；横版状态效果标记垂直排列不重叠
- **横版信息降噪**：飘字伤害聚合显示（同目标 0.3s 内多次合并），暴击/特效金色大字号突出、普通白色小字号弱化；非关键 UI 战斗中自动收起，波次间隙再展开
- **性能红线**：同类型实体合入同一图集减 DrawCall；粒子用对象池或预烘焙序列帧，竖版单屏活跃粒子 ≤50、横版 ≤100；弹道拖尾使用 Mesh Renderer 替代 Particle System 降低 Overdraw；UI 用相对坐标 + 安全区适配；波次切换时异步卸载上一波专属资源
- **分辨率与设备适配**：战场区域保持固定宽高比（竖版9:16 / 横版16:9），超宽屏（20:9+）两侧模糊背景或战术信息扩展区填充；横版支持横竖屏动态切换检测（意外竖屏时自动暂停+提示旋转）；资源包体大小控制在 50MB 以内
- **内存与加载安全**：首次进入关卡预加载所有塔/敌人基础资源，避免战斗中按需加载导致卡顿；远景背景使用静态图或 ≤10FPS 动态图层，近景交互保持60FPS；LOD 系统在敌人距离镜头＞50%屏宽时切换低模+简化特效
- **大本营三阶视觉（强制）**：禁止静态贴图，必须建立“健康→受损→濒死”三阶视觉反馈（具体参数见 F 节「大本营美术方向」）；视觉焦点必须显著高于环境，轮廓剪影 32×32px 可识别
- **怪物辨识度体系（强制）**：威胁等级色相绑定 + 形状编码 + 死亡反馈分级 + 生成预警 3~5s + 状态融入本体（具体规范见 F 节「怪物美术方向」）
- **色盲模式兼容**：所有威胁等级/状态通过形状+亮度+动画节奏三重维度独立识别，禁用纯红绿区分关键信息

#### 8.6 卡牌/养成类
- **竖版垂直三段布局（portrait 强制）**：顶部对手区 15%-20%（头像+血量+法力+手牌数，手牌区高度压缩至 30px，对手出牌时临时下移展开动画后自动收回）+ 中央战场 45%-50%（单列纵向排列，己方随从上半/敌方下半，中间 20px 分隔线+攻击引导光效）+ 底部手牌操作 30%-35%（扇形堆叠+滑动展开+法力条+结束回合按钮）
- **卡牌可读性**：费用/攻击力/生命值三要素采用色块+大号数字强绑定——费用左上蓝底白字、攻击左下黄底黑字、生命右下红底白字，字号≥ 20sp，确保缩略图状态仍可扫读；卡宽内数值字号 ≥ 卡宽 12%
- **关键词双重编码**：嘲讽=盾牌图标+金色外框，冲锋=闪电图标+橙色脉冲，圣盾=光球图标+白色护罩，避免纯文字依赖；稀有度通过卡面边框光效区分（普通无光、稀有蓝光、史诗紫光、传说橙光+动态粒子）
- **拖拽反馈**：拖拽卡牌时放大 1.15× + 发光描边 + 阴影加深；进入合法目标范围时目标高亮+绿色吸附指示器，非法区域红色禁止标识+短促震动，松手后无效操作不消耗法力且卡牌返回手牌；法术卡拖抽时显示作用范围预览（单体/群体/随机），AOE 用全屏半透明遮罩+脉冲动画提示覆盖区域
- **随从攻击操作**：点击己方随从触发攻击姿态（前倾+发光边框），敌方合法目标头顶出现红色准星；拖拽攻击线连接目标时线条颜色随伤害类型变化（物理白、法术蓝、剧毒绿）；攻击结算后随从回弹+目标受击顿挫 0.05s，伤害数字沿垂直方向向上飘散
- **信息查看与快捷操作**：长按任意卡牌/随从弹出详情浮层（含完整描述、历史操作记录），浮层位置智能避让手指遮挡，松开后 0.3s 延迟消失防误触关闭；双击手牌快速查看详情（无需长按）；上滑手牌呼出快捷操作菜单（弃牌/标记/分享），替代 PC 端右键菜单
- **回合流转清晰**：当前回合方有明确视觉提示（边框发光/全屏色调微调），“AI思考中...”动画让玩家知道在等待
- **法力不足反馈**：费用不够的卡牌灰色半透明，尝试拖拽时抖动反弹回手牌区；法力水晶条在法力不足时短暂变红脉冲
- **动效节奏与情绪引导**：出牌动画 300~400ms，攻击动画 200~300ms，全部带粒子特效；抽卡沿垂直路径从屏幕顶部飞入手牌区 + "唰"声效 + 手部震动，连抽时动画加速+音效叠加营造节奏感；斩杀/关键 combo 时镜头微推+全屏径向模糊 0.2s；失败时手牌灰化下沉+色调转冷，胜利时卡牌向中心聚拢爆炸+金色粒子升腾，配合向上滑动手势引导进入结算页保持垂直动线连贯
- **Buff/Debuff 可视化**：垂直堆叠图标显示于随从右上角，最多显示 3 个，超出合并为“+N”角标；点击展开完整列表；亡语随从死亡时灵魂上浮+墓碑图标闪现，战吼随从登场时地面涟漪+音效同步
- **特殊机制提示**：疲劳伤害时屏幕泛紫+心跳震动，过载时法力水晶栏变灰+锁链图标覆盖；全屏边缘色带提示强化特殊状态感知
- **性能红线**：所有卡牌框架/图标/基础特效合入单张 1024×1024 图集；随从攻击/法术特效用 GPU Instancing 或预烘焙序列帧，单屏活跃粒子 ≤60；手牌区未展开卡牌使用 LOD 降级材质（仅保留色块+数字），展开时异步加载高清贴图；战场随从距离镜头＞50% 屏幕高度时自动切换简化模型
- **分辨率与设备适配**：UI 采用相对坐标+安全区适配，战场保持固定宽高比 3:4，超 tall 屏（21:9+）顶部/底部品牌色渐变填充；支持折叠屏/平板竖屏模式（大屏扩展手牌可见数量至 10 张+随从尺寸放大 1.2×，单卡操作热区不变）
- **内存与加载安全**：卡组切换时异步卸载未使用卡牌资源；高分辨率卡面仅用于收藏/详情界面，战斗中统一使用压缩版本；首包体积控制在 80MB 以内，回合切换时预加载下一阶段可能用到的卡牌特效

#### 8.7 物理弹射类
- **弹弓拖拽手感**：拖拽时显示瘫射轨迹虚线（3~5 个点），力度与拖拽距离成正比
- **物理模拟真实**：重力恒定（GRAVITY=0.3~0.5），碰撞有弹性（反弹系数 0.6~0.8），方块堆叠有重量感
- **破坏特效明显**：方块被击破时爆裂粒子 8~12 颗 + 碎裂音效，方块倒塡有连锁反应
- **关卡设计渐进**：第 1 关只有 2~3 个方块教学，逐渐增加材质（木头 1HP→石头 3HP→钢铁 5HP）
- **星级评定**：根据剩余弹射物数量给星（全用完=1星，剩 1=2星，剩 2+=3星）

#### 8.8 解谜/冒险类
- **提示系统**：卡关超过 30 秒未解开时显示微妙提示（元素闪烁/箭头指向）
- **操作可撤销**：解谜类必须有“撤销上一步”按钮，降低挫败感
- **过关动画庆祝**：解开谜题时有明显的成功动画（光芒扩散 + 粒子奠放 + 分数飘入）
- **关卡进度清晰**：显示当前关卡/总关卡，每关完成后解锁下一关的视觉反馈
- **难度曲线平缓**：前 3 关为教学关，逐步引入新机制，禁止第 1 关就过难`

export interface CodegenModuleInfo {
  name: string
  description: string
  userInput?: string
  relatedEntities?: string[]
  /** 已生成完成的美术资源 */
  assets: Array<{
    id: string
    entityName: string
    requirement?: string
    animationType?: string
    frameCount?: number
    frameWidth?: number
    frameHeight?: number
    facing?: FacingDir
    movementDir?: MovementDir
    scrollDir?: MovementDir
    needsVideo?: boolean
    videoUseCase?: VideoUseCase
  }>
}

/**
 * 模块驱动的代码生成 prompt：以「详细玩法 + 功能模块」为主线组织信息。
 */
export function buildCodegenUserPromptFromModules(design: any, modules: CodegenModuleInfo[], orientation?: Orientation) {
  const o = orientation || orientationFromDesign(design)
  const artStyle = design?.suggestedArtStyle || ''
  const uiStyleRef = design?.uiStyleReference || ''
  const moduleSections = modules
    .map((m, i) => {
      const assetLines = m.assets.length
        ? m.assets.map((a) => {
            let line = `  - ASSETS['${a.id}']  // ${a.entityName}`
            if (a.requirement) line += ` — ${a.requirement}`
            if (a.animationType === 'video_loop') {
              line += ` [视频循环背景: 用<video>标签+autoplay+loop+muted+playsinline播放，作为DOM层叠在canvas上方，opacity=0.3~0.5营造氛围]`
            } else if ((a.animationType === 'spritesheet' || a.animationType === 'video') && a.frameCount) {
              line += ` [序列帧: ${a.frameCount}帧, 用 new SpriteAnimation(processedImg, ${a.frameCount}) 播放, frameWidth由图片宽度/${a.frameCount}自动计算]`
            } else if (a.animationType === 'static' && !a.id?.startsWith('bg_') && !a.id?.startsWith('ui_')) {
              line += ` [静态图+程序化tween动画: idle呼吸/移动倾斜/弹性反馈, 不使用序列帧]`
            } else if (a.id?.startsWith('bg_')) {
              line += ` [背景图: 用drawImage(img,0,0,canvas.width,canvas.height)铺满]`
            }
            // 方向约束透传
            if (a.facing && a.facing !== 'none') line += ` 面朝方向:${a.facing}`
            if (a.movementDir && a.movementDir !== 'idle' && a.movementDir !== 'omni') line += ` 移动方向:${a.movementDir}`
            if (a.scrollDir && a.scrollDir !== 'idle') line += ` 滚动方向:${a.scrollDir}`
            return line
          }).join('\n')
        : '  （该模块没有关联美术资源；如需图形请用 Canvas 绘制几何图形占位）'
      const userLine = m.userInput?.trim() ? `\n用户额外要求：${m.userInput.trim()}` : ''
      const entitiesLine = Array.isArray(m.relatedEntities) && m.relatedEntities.length
        ? `\n关联实体：${m.relatedEntities.join(', ')}`
        : ''
      // UI/UE 模块额外注入美术风格和配色约束
      const isUiModule = /ui_ue_base|ui.*flow|界面|流程控制/i.test(m.name) || m.assets.some(a => a.id?.startsWith('bg_'))
      const styleHint = isUiModule && artStyle
        ? `\n⚠️ 美术风格约束：所有UI控件（按钮、面板、文字描边、进度条）的配色和风格必须与游戏美术风格一致：${artStyle}`
        : ''
      return `## 模块 ${i + 1}: ${m.name}
**实现说明（必须严格遵循）**：${m.description}${entitiesLine}${userLine}${styleHint}
关联美术资源：
${assetLines}`
    })
    .join('\n\n')

  // 结构化呈现详细玩法（如果存在）
  const dg = design?.detailedGameplay
  const detailedSection = dg
    ? `# 详细玩法（必须严格按以下流程实现，这是游戏核心逻辑的权威描述）
- 起始流程：${dg.startup}
- 核心循环（每帧 update 的主逻辑）：${dg.coreLoop}
- 难度递进：${dg.progression}
- 操作方式：${dg.controls}
- 反馈手感：${dg.feedback}${dg.spawnBehavior ? `\n- 实体生成规则：${dg.spawnBehavior}` : ''}${dg.collisionRules ? `\n- 碰撞判定表：${dg.collisionRules}` : ''}${dg.stateTransitions ? `\n- 游戏状态机：${dg.stateTransitions}` : ''}

⚠️ 以上每一条描述都是**强制实现要求**，不是建议。代码必须逐条对应实现所有描述的行为、数值和反馈效果。`
    : ''

  const winLose = []
  if (Array.isArray(design?.winConditions) && design.winConditions.length) {
    winLose.push('# 胜利条件\n' + design.winConditions.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n'))
  }
  if (Array.isArray(design?.loseConditions) && design.loseConditions.length) {
    winLose.push('# 失败条件\n' + design.loseConditions.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n'))
  }

  const rulesSection = Array.isArray(design?.rules) && design.rules.length
    ? '# 规则细则\n' + design.rules
        .map((r: any, i: number) => `${i + 1}. 触发：${r.trigger}\n   动作：${r.action}${r.description ? '\n   细节：' + r.description : ''}`)
        .join('\n')
    : ''

  // UI/UE 精细化设计要求（兼容新版 screens/popups/transitions 和旧版 uiDesign）
  const screens = design?.screens
  const popups = design?.popups
  const transitions = design?.transitions
  const uiDesign = design?.uiDesign
  const colorPalette = design?.colorPalette

  let uiSection = ''
  if (screens) {
    // 新版：结构化界面设计
    const screenLines = []
    if (uiStyleRef) {
      screenLines.push(`## UI 风格基准（必须严格按此风格落实所有按钮/面板/HUD/CTA）\n${uiStyleRef}\n要求：所有按钮 = 图标 + 文字两段式（禁止纯文字按钮）；至少 4 层视觉堆叠（外发光描边 → 金属/玻璃外框 → 主色渐变内层 → 顶部高光弧 + 底部内阴影 → 浮雕文字）；状态：idle 微呼吸 / hover 上浮+发光 / pressed 下压+闪光 / disabled 灰度`)
    }
    if (colorPalette) {
      screenLines.push(`## 全局配色方案\n主色：${colorPalette.primary}，辅色：${colorPalette.secondary}，点缀色：${colorPalette.accent}，背景：${colorPalette.background}，文字：${colorPalette.text}，警告：${colorPalette.danger}`)
    }
    const uiTokens = (design as any)?.uiTokens
    if (uiTokens) {
      screenLines.push(`## 全局 UE/UI 设计令牌（必须 1:1 注入到 G.theme，所有绘制函数读 G.theme 取值，禁止硬编码）\n\`\`\`json\n${JSON.stringify(uiTokens, null, 2)}\n\`\`\`\n实施要求：\n1) core.js 中初始化 G.theme = { colors, radius, spacing, fontSize, fontFamily, shadow, animation } 完全使用上述令牌；缺失字段才走默认值\n2) 所有 drawButton / drawPanel / drawText / drawHUD / drawTopBar / drawFeatureCard / drawNavTab / drawHubIcon 等函数**只能从 G.theme 读取颜色/圆角/字号/间距/阴影/动效时长**——禁止任何 \`'#xxx'\` / 数字字面量出现在视觉参数位置（位置坐标和动画进度除外）\n3) 弹窗、HUD、结算面板、过场遮罩——所有 UI 矩形元素必须遵循 G.theme.radius；所有阴影走 G.theme.shadow；所有过场动画时长走 G.theme.animation.transitionMs；所有按钮 hover/pressed 缩放走 G.theme.animation.buttonHoverScale/buttonPressedScale\n4) buttonStyle / panelStyle 文字描述作为视觉风格参考，drawButton/drawPanel 必须严格还原其描述的层次（外发光描边/金属外框/主色渐变/顶部高光/底部内阴影/装饰元素）`)
    }
    if (screens.loading) {
      screenLines.push(`## 加载画面\n持续${screens.loading.duration || '2000ms'}，背景：${screens.loading.background || 'bg_loading'}，进度条：${JSON.stringify(screens.loading.progressBar || {})}，文字：${JSON.stringify(screens.loading.text || {})}，过渡：${screens.loading.transition || '淡出'}`)
    }
    if (screens.title) {
      screenLines.push(`## 登录/标题画面\n背景：${screens.title.background || 'bg_title 铺满'}\n标题：${JSON.stringify(screens.title.logo || {})}\n按钮：${JSON.stringify(screens.title.buttons || [])}\n装饰：${screens.title.decorations || '无'}\n【重要】登录画面只有背景图 + 游戏名称 + 「登录游戏」按钮三个元素，禁止任何其他内容。点击按钮后 transitionTo('gameplay') 直接进入玩法。`)
    }
    if (screens.gameplay) {
      screenLines.push(`## 游戏画面\n背景：${screens.gameplay.background || 'bg_gameplay'}，HUD布局：${JSON.stringify(screens.gameplay.hud || {})}，HUD样式：${JSON.stringify(screens.gameplay.hudStyle || {})}，操作控件：${JSON.stringify(screens.gameplay.controls || {})}，游戏内提示：${JSON.stringify(screens.gameplay.inGamePopups || {})}`)
    }
    if (screens.pause) {
      screenLines.push(`## 暂停弹窗\n遮罩：${screens.pause.overlay || '半透明黑'}，面板：${JSON.stringify(screens.pause.panel || {})}，按钮：${JSON.stringify(screens.pause.buttons || [])}，动画：${screens.pause.animation || '缩放弹出'}`)
    }
    if (screens.gameOver) {
      screenLines.push(`## 结算画面（情绪驱动设计）\n背景：${screens.gameOver.background || 'bg_gameover'}\n情绪区分：${JSON.stringify(screens.gameOver.emotionAnchoring || screens.gameOver.title || {})}\n得分：${JSON.stringify(screens.gameOver.scoreDisplay || {})}\n奖励：${JSON.stringify(screens.gameOver.rewards || {})}\n评级：${JSON.stringify(screens.gameOver.rating || {})}\n按钮：${JSON.stringify(screens.gameOver.buttons || {})}\n入场动画：${screens.gameOver.animation || '淡入'}\n【强制】胜利/失败必须有明显不同的视觉风格（色调+动效），分数展示有 0.5~1s 停顿缓冲，按钮最多2个。`)
    }
    if (popups) {
      screenLines.push(`## 二级弹窗设计\n${JSON.stringify(popups, null, 2)}`)
    }
    if (transitions) {
      screenLines.push(`## 过场动画规格\n${Object.entries(transitions).map(([k, v]: [string, any]) => `- ${k}：类型=${v.type}，时长=${v.duration}，缓动=${v.easing || 'ease-out'}，效果=${v.description}`).join('\n')}`)
    }
    uiSection = `# UI/UE 完整界面设计（必须严格按以下规格实现每个界面、控件、弹窗和过场动画）\n${screenLines.join('\n\n')}`
  } else if (uiDesign) {
    // 旧版兼容
    uiSection = `# UI/UE 精细化设计（必须实现以下界面）
- 标题画面：${uiDesign.titleScreen || '需要包含游戏标题、开始按钮、背景动效'}
- HUD 布局：${uiDesign.hud || '左上角显示分数，右上角显示生命值，底部显示技能/道具栏'}
- 暂停菜单：${uiDesign.pauseMenu || '居中弹窗、半透明模糊背景、继续/重新开始/返回按钮'}
- 结算画面：${uiDesign.gameOver || '得分展示动画、最高分记录、重玩/返回按钮'}
- 过渡动画：${uiDesign.transitions || '场景切换使用淡入淡出或滑动过渡效果'}`
  } else {
    uiSection = `# UI/UE 精细化设计（必须实现以下界面）
- 标题画面：需要包含游戏标题（带描边/阴影）、开始按钮（hover 动效）、背景动态效果
- HUD 布局：左上角显示分数，右上角显示生命值，底部显示技能/道具栏，字体清晰有描边
- 暂停菜单：居中弹窗、半透明模糊背景、继续/重新开始/返回按钮
- 结算画面：得分展示动画、最高分记录、重玩/返回按钮
- 过渡动画：场景切换使用淡入淡出或滑动过渡效果
- 按钮交互：所有按钮需有 hover/active 视觉反馈（缩放/颜色变化/阴影）
- 背景层次：使用多层背景营造深度感（视差滚动或渐变叠加）`
  }

  // 汇总所有去重后的美术资源，生成"必须全部使用"的强制清单
  const assetMap = new Map<string, { id: string; entityName: string; kind: string }>()
  for (const m of modules) {
    for (const a of m.assets) {
      if (!a.id || assetMap.has(a.id)) continue
      let kind = '静态素材（drawImage 整图渲染）'
      if (a.id.startsWith('bg_')) kind = '背景图（drawImage 铺满全屏）'
      else if (a.id.startsWith('ui_button')) kind = '统一按钮皮肤（所有界面按钮共用）'
      else if (a.id.startsWith('ui_panel')) kind = '统一面板皮肤（所有弹窗/HUD面板共用）'
      else if (a.animationType === 'video_loop') kind = '视频循环背景（<video>标签+autoplay+loop+muted，DOM层叠canvas上方）'
      else if ((a.animationType === 'spritesheet' || a.animationType === 'video') && a.frameCount) kind = `序列帧动画（${a.frameCount}帧，用 SpriteAnimation 播放）`
      else if (a.animationType === 'static' && !a.id.startsWith('bg_') && !a.id.startsWith('ui_')) kind = '静态素材+程序化tween动画（idle呼吸/弹性反馈/移动倾斜）'
      assetMap.set(a.id, { id: a.id, entityName: a.entityName, kind })
    }
  }
  const assetChecklist = assetMap.size
    ? `# 美术资源总清单（⚠️ 强制：以下每一个资源都必须在代码中通过 window.ASSETS['id'] 实际加载并渲染，禁止任何一个被遗漏或用纯色矩形/几何图形代替）
${[...assetMap.values()].map((a) => `- ASSETS['${a.id}']  // ${a.entityName} —— ${a.kind}`).join('\n')}

【自检要求】生成代码前，请在心里逐一核对：上面 ${assetMap.size} 个资源 id 是否每一个都在代码里出现并被绘制？背景必须铺在每个对应界面，角色/道具/子弹必须用对应素材而非色块，按钮必须用 ui_button，面板必须用 ui_panel。`
    : ''

  const parts = [
    buildOrientationDirective(o),
    detailedSection,
    winLose.join('\n\n'),
    rulesSection,
    uiSection,
    assetChecklist,
    `# 完整设计文档（参考）\n\`\`\`json\n${JSON.stringify(design, null, 2)}\n\`\`\``,
    `# 功能模块清单（请严格按模块组织代码，每个模块用注释块包裹）\n${moduleSections || '（无模块；请基于设计文档自行划分模块）'}`,
    `请根据上述详细玩法、规则、胜负条件、UI/UE 设计和功能模块，按系统提示要求输出**多文件**游戏代码（core.js 基础模块 + 各功能模块文件 + main.js 入口，用 /* ==== FILE: 文件名 ==== */ 分隔，禁止输出 HTML/script 标签和 Markdown 代码块）。要求架构清晰、模块分明、界面精美专业、可直接运行。再次强调：(1) 启动到标题只有一次 Loading 画面（_bootPhase），后续场景切换走 transitionTo 快速淡入淡出（禁止再出现 Loading 画面/进度条）；(2) 美术资源总清单里的每一个资源都必须被实际使用。`,
  ].filter(Boolean)

  return parts.join('\n\n')
}

/**
 * 兼容旧调用：仅基于设计 + 素材 ID 列表生成代码（不推荐，建议使用模块驱动版本）。
 */
export function buildCodegenUserPrompt(design: any, assetIds: string[]) {
  return `# 游戏设计文档
\`\`\`json
${JSON.stringify(design, null, 2)}
\`\`\`

# 可用素材 (通过 ASSETS[id] 访问)
${assetIds.map((id) => `- ASSETS['${id}']`).join('\n')}

请输出完整的单文件 HTML 网页游戏代码。`
}

/**
 * Stage 4+ — 增量代码优化 Prompt
 * 严格只输出 SEARCH/REPLACE 或 APPEND 补丁块，禁止重新生成完整代码。
 */
export const CODE_OPTIMIZE_SYSTEM_PROMPT = `你是一名资深网页游戏工程师，专精于"增量补丁"式代码改进。
任务：根据用户提供的【运行时报错】和【补充说明】，对已有的网页游戏代码做最小化的"局部修改/新增"。严禁重新生成完整代码。

# 输出格式（仅允许下列两种补丁块，可混合多个）

## 1. 替换 / 修改已有代码
<<<<<<< SEARCH
[完整复制现有代码片段，包括缩进、空行、空格，必须能在源代码中精确匹配且唯一]
=======
[替换后的新代码片段]
>>>>>>> REPLACE

## 2. 在文件末尾追加新代码
<<<<<<< APPEND
[要追加到文件末尾的新代码，例如新增模块、新增事件监听等]
>>>>>>> APPEND

# 严格规则
1. 只输出补丁块，不输出任何说明文字、不输出 Markdown 代码块标记 (\`\`\`)、不重复完整源代码。
2. SEARCH 块必须与源代码完全一致（字符级别），否则补丁无法匹配。
3. SEARCH 块要包含足够上下文行以保证唯一匹配；过短可能匹配多处，过长容易不一致。
4. 仅新增功能时优先使用 APPEND；修改已有逻辑用 SEARCH/REPLACE。
5. 删除某段代码：在 REPLACE 中给出空内容（保留必要的占位结构以保证语法）。
6. 多处修改 = 多个补丁块，按从前到后顺序输出。
7. 不得使用 import / require / module / export。
8. 保持其它未修改部分原样，绝不重写整个文件。

# 运行时报错诊断指南

当用户提供运行时报错信息时，你需要：
1. 根据错误信息和行号定位源代码中的对应位置
2. 分析错误的根因（不仅修表象，要修根本原因）
3. 确保修复不会引入新问题

## 常见错误类型与修复思路

### 资源加载相关
- "Cannot read property of undefined" 与 ASSETS 相关 → window.ASSETS[key] 不存在，检查资源 ID 是否与 window.ASSETS 中的 key 完全匹配
- 图片加载失败/白屏 → 检查 new Image() + src 赋值后是否正确等待 onload 再使用
- 资源 ID 使用错误 → 对照用户提供的【可用资源清单】确认正确的 key 名

### Canvas 渲染相关
- "Cannot read property 'getContext'" → canvas 元素未创建或未正确获取
- drawImage 报错 → 图片未加载完成就调用 drawImage，需要在 onload 回调中使用
- 画面不刷新/静止 → requestAnimationFrame 未调用或 gameLoop 函数报错中断
- 白边/绿边/黑边残留 → removeChromaKey 必须使用本提示中给出的邻接扩展法实现（纯绿幕标记 + 逐层扩展清理边缘 + 去黑边），不要私自简化。邻接扩展法只移除与绿幕背景相连的绿色像素，不会误伤素材本身的绿色部分（如植物角色等）。第3步"去黑边"处理去绿后边缘变黑的问题：邻接透明像素且亮度极低(r+g+b<60)的像素直接置透明

### 序列帧动画相关
- 动画不播放 → frameIndex 未递增或 animationTimer 未正确计时
- 帧裁剪错误 → drawImage 的 sx, sy, sw, sh 参数计算错误，检查 frameWidth/frameHeight
- 序列帧图片显示异常 → spritesheet 未经过 removeChromaKey 处理

### 游戏逻辑相关
- "x is not defined" → 变量作用域问题，可能在错误的函数内声明
- "x is not a function" → 函数未定义或拼写错误
- 游戏卡在某个界面无法进入下一步 → 状态机 (gameState) 切换逻辑有误或条件永远不满足
- 碰撞检测不触发 → 坐标/尺寸计算有误或碰撞判定函数参数顺序错误
- 操作无响应 → 事件监听绑定时机不对或 gameState 条件判断阻止了操作

### 加载与初始化相关
- 游戏黑屏 → init/preload 阶段出错导致后续代码未执行
- "Cannot read property of null" → DOM 元素未就绪就操作，需要 DOMContentLoaded 或确保元素已创建
- Promise rejected → 异步操作失败未 catch

# 你可以进行的优化类型
- Bug 修复（空引用、越界、计时器泄漏、事件未解绑等）
- 性能优化（对象池、缩小碰撞检测范围、减少每帧分配）
- 玩法增强（难度递增、连击、奖励倍数、新机制）
- 视觉效果（粒子、震屏、过渡、UI）
- 音效合成（Web Audio API）
- 代码重构（提升可读性、模块化）`

export interface OptimizePromptOptions {
  currentCode: string
  /** 运行时报错信息列表（试玩卡点） */
  runtimeErrors?: string[]
  /** 用户补充说明 */
  description?: string
  /** 传统的组合指令（兼容预设按钮） */
  instruction?: string
  /** 游戏设计文档 */
  design?: any
  /** 可用美术资源 ID 列表 */
  availableAssets?: string[]
}

export function buildOptimizeUserPrompt(opts: OptimizePromptOptions) {
  const { currentCode, runtimeErrors, description, instruction, design, availableAssets } = opts
  // 加行号方便 LLM 引用，但 SEARCH 块不应包含行号
  const numbered = currentCode
    .split('\n')
    .map((line, i) => `${(i + 1).toString().padStart(4, ' ')} | ${line}`)
    .join('\n')

  let prompt = `# 当前游戏代码（左侧行号仅供参考；补丁的 SEARCH 块中不要带行号）
${numbered}

# 运行环境说明
- 代码是一个完整的单文件 HTML 网页游戏
- 美术资源通过 window.ASSETS 对象获取（key 为资源 ID, value 为 data URL）
- 代码中不可使用 import/export/require，所有内容必须自包含
- 游戏使用 Canvas 2D API 或 DOM 渲染（取决于现有代码的方案）`

  // 可用资源清单（让AI知道有哪些资源可用）
  if (availableAssets && availableAssets.length > 0) {
    prompt += `\n\n# 可用资源清单（window.ASSETS 中的 key）
以下是当前游戏中已注入的所有美术资源 ID，代码中使用 window.ASSETS["xxx"] 时必须使用以下之一：
${availableAssets.map(a => `- "${a}"`).join('\n')}`
  }

  // 运行时报错（试玩卡点）
  if (runtimeErrors && runtimeErrors.length > 0) {
    prompt += `\n\n# 运行时报错（试玩时捕获的错误）
以下是游戏试玩过程中自动捕获的运行时错误，请逐一分析并修复根因：
${runtimeErrors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

注意：
- 错误中的 "line X" 对应上面源代码的行号
- 优先修复第一个错误，因为后续错误可能是连锁反应
- 如果多个错误有共同根因，用一个补丁修复即可`
  }

  // 用户补充说明（如果有的话）
  if (description) {
    prompt += `\n\n# 用户补充说明（游戏运行时的卡点现象）
${description}`
  }

  // 传统指令（兼容预设按钮）
  if (instruction) {
    prompt += `\n\n# 修复/优化指令
${instruction}`
  }

  if (design) {
    prompt += `\n\n# 游戏设计文档（参考）
\`\`\`json
${JSON.stringify(design, null, 2)}
\`\`\``
  }

  prompt += `\n\n请仅输出补丁块（SEARCH/REPLACE 或 APPEND）。不要重新生成完整代码，不要任何说明文字。`
  return prompt
}

/**
 * 预设优化指令列表（快捷操作）
 */
export const CODE_OPTIMIZE_PRESETS = [
  { label: '黑屏修复', icon: '🖥️', instruction: '游戏打开后完全黑屏无任何画面。请排查并修复：1) Phaser config 的 parent、width/height、scene 注册是否正确；2) preload 中是否有资源加载失败阻塞 create；3) create 函数中是否有未定义变量/语法错误导致脚本中断；4) 是否缺少 new Phaser.Game(config) 的调用或调用位置不对；5) scene 的 key 与 config 中注册的是否一致。逐一修复所有可能导致黑屏的问题。' },
  { label: '修复 Bug', icon: '🐛', instruction: '检查代码中的常见 bug（空引用、越界访问、计时器泄漏等），修复所有发现的问题。' },
  { label: '优化性能', icon: '⚡', instruction: '优化游戏性能：减少每帧的对象创建、使用对象池、优化碰撞检测范围、减少不必要的计算。' },
  { label: '增强视觉', icon: '✨', instruction: '添加视觉效果增强：粒子特效（爆炸/拖尾）、屏幕震动反馈、平滑过渡动画、改善 UI 显示效果。' },
  { label: '增强玩法', icon: '🎮', instruction: '增强游戏玩法：添加难度递增系统、增加得分倍数奖励机制、添加连击系统或连续消除奖励。' },
  { label: '添加音效', icon: '🔊', instruction: '使用 Phaser 内置的声音系统，通过 Web Audio API 合成简单的游戏音效（得分音、爆炸音、背景音）。不依赖外部音频文件。' },
  { label: '完善 UI', icon: '📱', instruction: '完善游戏 UI：添加开始界面、暂停功能(ESC键)、游戏结束界面（显示分数和重新开始按钮）、实时 HUD（分数、生命值）。' },
] as const
