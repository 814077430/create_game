export interface CanvasNode {
  id: string
  type: 'idea' | 'module' | 'asset' | 'code' | 'deploy'
  position: { x: number; y: number }
  size: { width: number; height: number }
  stage: 1 | 2 | 3 | 4 | 5
  status: 'idle' | 'processing' | 'completed' | 'error'
  data: any
  createdAt: string
}

export interface CanvasEdge {
  id: string
  sourceId: string
  targetId: string
  type: 'pipeline' | 'reference'
}

/** 动画类型：spritesheet 为图生序列帧，video 为图生视频抽帧(高质量)，static 为静态图+程序化动画 */
export type AnimationType = 'spritesheet' | 'video' | 'static' | 'video_loop'

export type FacingDir = 'left' | 'right' | 'up' | 'down' | 'left-up' | 'right-up' | 'left-down' | 'right-down' | 'front' | 'none'
export type MovementDir = 'left' | 'right' | 'up' | 'down' | 'left-up' | 'right-up' | 'left-down' | 'right-down' | 'idle' | 'omni'
export type VideoUseCase = 'character_motion' | 'cutscene' | 'loop_bg' | 'skill_fx'

export interface EntityDef {
  id: string
  name: string
  role: string
  visuals: string
  /** 素材尺寸描述 */
  size?: string
  /** 动画类型 */
  animationType?: AnimationType
  /** 序列帧帧数 */
  frameCount?: number
  /** 单帧宽度 */
  frameWidth?: number
  /** 单帧高度 */
  frameHeight?: number
  /** 是否需要无缝拼接（地面/平台/管道/滚动背景等重复铺设的素材） */
  tileable?: boolean
  /** 角色/物件素材"面朝方向"——必须与玩法运动方向、背景滚动方向协调 */
  facing?: FacingDir
  /** 主要运动方向（玩法语义）——用于 Stage3 出图时让美术朝向、姿态与运动一致 */
  movementDir?: MovementDir
  /** 背景类素材的滚动方向（仅 background/scroll 类素材使用） */
  scrollDir?: MovementDir
  /** 是否需要视频生成（默认 false——节约模式仅必需场景启用） */
  needsVideo?: boolean
  /** 视频用途（决定 motion prompt 形态） */
  videoUseCase?: VideoUseCase
}

export interface RuleDef {
  trigger: string
  action: string
  /** 规则的详细说明，包含具体数值、边界条件、特殊情况等 */
  description?: string
}

export interface ParameterDef {
  default: number
  min: number
  max: number
  label: string
  value?: number
}

/** 详细玩法描述（Stage 1 由 AI 扩展生成，不是简写） */
export interface DetailedGameplay {
  /** 游戏开始时的初始状态、出生位置、初始资源等 */
  startup: string
  /** 核心玩法循环（player → action → feedback → reward 的完整描述） */
  coreLoop: string
  /** 难度递进 / 关卡推进逻辑 */
  progression: string
  /** 操作方式说明（鼠标/触屏/键盘等具体交互） */
  controls: string
  /** 玩家反馈与手感（视觉、音效、震屏、粒子等） */
  feedback: string
}

export interface GameDesign {
  /** 一句话游戏概要（保留以兼容已有用法） */
  gameConcept: string
  /** 详细玩法说明（AI 扩展，不允许简写） */
  detailedGameplay?: DetailedGameplay
  /** 胜利条件（得分阈值 / 关卡通过 / 时间维持等） */
  winConditions?: string[]
  /** 失败条件（生命耗尽 / 时间到 / 碰撞等） */
  loseConditions?: string[]
  coreMechanics: string[]
  entities: EntityDef[]
  rules: RuleDef[]
  parameters: Record<string, ParameterDef>
  suggestedArtStyle?: string
  resolution?: { width: number; height: number }
  /** 全局配色方案 */
  colorPalette?: {
    primary?: string
    secondary?: string
    accent?: string
    background?: string
    text?: string
    danger?: string
  }
  /** 全局 UE/UI 设计令牌（统一视觉语言，Stage4 G.theme 直接来源） */
  uiTokens?: {
    colors?: Record<string, string>
    radius?: Record<string, number>
    spacing?: Record<string, number>
    fontSize?: Record<string, number>
    fontFamily?: string
    shadow?: Record<string, string>
    animation?: Record<string, number | string>
    buttonStyle?: string
    panelStyle?: string
  }
  /** 全量界面设计（新版，替代旧版 uiDesign） */
  screens?: Record<string, any>
  /** 二级弹窗设计 */
  popups?: Record<string, any>
  /** 过场动画规格 */
  transitions?: Record<string, any>
  /** 旧版 UI 设计（兼容） */
  uiDesign?: Record<string, any>
  /** 市场对标参考 */
  styleReference?: {
    genre?: string
    referenceGames?: string[]
    borrowedElements?: string
  }
}

export interface IdeaNodeData {
  userInput: string
  expandedDesign: GameDesign | null
}

/** Stage 2：功能模块拆分（每个模块节点一个） */
export interface ModuleArtAsset {
  id: string
  entityName: string
  prompt: string
  style: string
  url: string
  status: 'idle' | 'generating' | 'done' | 'error'
  errorMessage?: string
  /** 实体角色类型（来自 game-design entities.role） */
  role?: string
  /** 动画类型 */
  animationType?: AnimationType
  /** 序列帧帧数 */
  frameCount?: number
  /** 单帧宽度 */
  frameWidth?: number
  /** 单帧高度 */
  frameHeight?: number
  /** 是否需要无缝拼接 */
  tileable?: boolean
  /** 朝向（与 EntityDef 同步） */
  facing?: FacingDir
  /** 运动方向（玩法层语义） */
  movementDir?: MovementDir
  /** 背景滚动方向 */
  scrollDir?: MovementDir
  /** 是否需要视频生成 */
  needsVideo?: boolean
  /** 视频用途分类 */
  videoUseCase?: VideoUseCase
}

export interface ModuleNodeData {
  /** 模块名称 */
  name: string
  /** 模块描述 */
  description: string
  /** 关联的实体 id 列表（来自 GameDesign.entities） */
  relatedEntities: string[]
  /** 用户手动备注 */
  userInput: string
  /** 内嵌的美术资源列表 */
  assets: ModuleArtAsset[]
  /** 生成方式标记 */
  source: 'auto' | 'manual'
}

export interface AssetVariant { url: string; selected: boolean }

export interface AssetNodeData {
  entityId: string
  entityName: string
  role: string
  prompt: string
  style: string
  variants: AssetVariant[]
  status: 'pending' | 'generating' | 'done' | 'error'
  errorMessage?: string
}

export interface CodeVersion {
  id: string
  source: string
  label: string
  createdAt: string
}

export interface CodeNodeData {
  codeType: 'frontend' | 'backend' | 'config'
  fileName: string
  language: string
  source: string
  buildStatus: 'pending' | 'success' | 'error'
  /** 代码版本历史 */
  history: CodeVersion[]
  /** 当前激活的版本 id */
  activeVersionId?: string
  /** 用户输入的优化指令 */
  optimizeInstruction?: string
}

export interface TestResult { name: string; status: 'pass' | 'warn' | 'fail'; value: string }

export interface DeployNodeData {
  platform: string
  htmlBlobUrl: string
  fileName: string
  bundleSize: number
  testResults: TestResult[]
}

export interface PipelineState {
  currentStage: 0 | 1 | 2 | 3 | 4 | 5
  status: 'idle' | 'running' | 'completed' | 'error'
  progress: number
  message: string
}
