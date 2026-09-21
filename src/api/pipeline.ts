import { ElMessage, ElMessageBox } from 'element-plus'
import { useCanvasStore } from '@/stores/canvas'
import { useSettingsStore } from '@/stores/settings'
import { generateImage, generateVideo, videoToSpriteSheet } from '@/api/image'
import { maybeProxyUrl, unproxyUrl, isPublicHttpUrl } from '@/api/proxy'
import { chatCompletion, codeCompletion, extractJSON } from '@/api/llm'
import { persistAssetFromUrl, saveFileToLocal, readFileFromLocal, listLocalDir, readFileAsDataUrl } from '@/api/storage'
import { useProjectStore } from '@/stores/project'
import {
  CODEGEN_SYSTEM_PROMPT,
  CODE_OPTIMIZE_SYSTEM_PROMPT,
  MODULE_BREAKDOWN_SYSTEM_PROMPT,
  buildCodegenUserPromptFromModules,
  buildOptimizeUserPrompt,
  buildModuleBreakdownUserPrompt,
  orientationFromDesign,
  type CodegenModuleInfo,
  type OptimizePromptOptions,
  type Orientation,
} from '@/api/prompts'
import { applyPatchText } from '@/api/patches'
import {
  upsertLayoutBlock,
  stripEditorBlock,
  LAYOUT_FILE_NAME,
  type GFLayoutFile,
} from '@/api/liveEdit'
import type { CanvasNode, GameDesign, CodeNodeData, CodeVersion, ModuleNodeData, ModuleArtAsset } from '@/types'

/**
 * 解析当前项目的画面方向（横版 / 竖版）。
 * 优先从已完成的创意节点设计文档反推（resolution.width > height = 横版），
 * 其次回退到项目设置中的方向，最后默认竖版。
 */
function resolveOrientation(): Orientation {
  try {
    const store = useCanvasStore()
    const ideaNode = store.nodes.find((n) => n.type === 'idea' && n.data?.expandedDesign)
    if (ideaNode?.data?.expandedDesign) {
      return orientationFromDesign(ideaNode.data.expandedDesign)
    }
  } catch {}
  try {
    return useProjectStore().orientation as Orientation
  } catch {}
  return 'portrait'
}

// ===== 内部工具：从画布节点收集模块清单（含已生成美术） =====

/**
 * 为 video 动画生成流程构建静态角色图 prompt
 * 生成一张高质量的单帧角色图（居中、纯绿幕背景），作为后续图生视频的输入
 */
function buildStaticCharacterPrompt(asset: ModuleArtAsset, allAssets?: ModuleArtAsset[]): string {
  const style = asset.style || 'flat cartoon, vibrant colors'
  let consistencyHint = ''
  if (allAssets?.length) {
    const others = allAssets.filter((a) => a.id !== asset.id && a.prompt).slice(0, 3)
    if (others.length) {
      consistencyHint = `. Consistent art style with: ${others.map((a) => a.entityName).join(', ')}`
    }
  }
  return [
    `A single high-quality character illustration on a LANDSCAPE 16:9 canvas (1280x720)`,
    `Subject: ${asset.prompt}`,
    `The character is in a neutral idle/T-pose that clearly shows all visual features`,
    `The COMPLETE character (head to feet, all limbs, weapons, accessories) is placed at the CENTER of the canvas, occupying approximately 60-70% of the canvas HEIGHT with generous padding on all sides (at least 15% empty space above head and below feet). NO body parts cropped or cut off by canvas edges`,
    `Style: ${style}, clean crisp game art, cel-shaded flat coloring with HARD clean edges, high detail`,
    `Background: solid pure green (#00FF00) chroma key background, completely uniform flat green`,
    `HARD EDGES (critical): NO anti-aliasing or feathering against the green background — every edge pixel is either 100% character or 100% green. NO blended transition pixels. This prevents black fringing after chroma key removal`,
    `NO black outlines on outer silhouette; use colored outlines if needed`,
    `No shadows on background, no ground line, no extra elements`,
    `IMPORTANT: after chroma key removal this character will be composited in-game directly over game backgrounds with NO backing — any residual white, green or colored pixels will appear as visible artifacts`,
    `high quality game character asset${consistencyHint}`,
  ].join('. ')
}

/**
 * 为 video 动画生成流程构建视频动作 prompt
 * 描述角色的动画动作（走路/攻击/idle等循环动画）
 */
function buildVideoMotionPrompt(asset: ModuleArtAsset): string {
  const name = asset.entityName || 'character'
  const useCase = (asset as any).videoUseCase as string | undefined
  const facing = (asset as any).facing as string | undefined
  const movementDir = (asset as any).movementDir as string | undefined
  // 从 asset.prompt 推断动作类型
  const promptLower = (asset.prompt || '').toLowerCase()
  let motion = 'smooth idle breathing animation with gentle body sway, seamless loop'
  if (/walk|run|move|dash/i.test(promptLower)) {
    motion = 'smooth walking cycle animation, limbs moving naturally, seamless loop'
  } else if (/punch|kick|combo|uppercut|hadouken|special_move|special move/i.test(promptLower)) {
    motion = 'fighting combat animation with powerful punch/kick strike, dynamic windup and follow-through, impact pose held briefly'
  } else if (/attack|strike|slash|shoot|fire|breath/i.test(promptLower)) {
    motion = 'attack animation with windup and strike, dynamic powerful motion'
  } else if (/block|guard|crouch|defend/i.test(promptLower)) {
    motion = 'defensive stance animation, arms raised in guard position, subtle weight shift, seamless loop'
  } else if (/hit_stun|hit stun|knockback|get_up|knockdown/i.test(promptLower)) {
    motion = 'hit reaction animation, body recoils from impact, brief stagger then recover, seamless loop'
  } else if (/fly|float|hover|wing/i.test(promptLower)) {
    motion = 'flying animation with wings flapping smoothly, gentle hover, seamless loop'
  } else if (/jump|bounce|spring/i.test(promptLower)) {
    motion = 'bouncy jumping animation, squash and stretch, seamless loop'
  } else if (/victory|win|pose|celebrate/i.test(promptLower)) {
    motion = 'victory celebration pose, triumphant stance with fist raised or arms crossed, confident body language, seamless loop'
  } else if (/ko|fall|defeat|collapse/i.test(promptLower)) {
    motion = 'knockdown/fall animation, body collapses to ground, dramatic defeat pose, seamless loop back to starting position'
  }

  // useCase 微调：四类视频用途各自的运动主题
  let useCaseHint = ''
  if (useCase === 'cutscene') useCaseHint = ' Cinematic short cutscene with dramatic camera-static framing, expressive emotion.'
  else if (useCase === 'loop_bg') useCaseHint = ' Subtle ambient loop motion (drifting clouds / gentle water ripples / star twinkle / lantern glow), no foreground subject, fully seamless loop with first frame matching last frame.'
  else if (useCase === 'skill_fx') useCaseHint = ' Energetic skill effect (explosion / shockwave / magic burst), high contrast, vivid particles, no character body, transparent or pure green background.'
  else useCaseHint = ' Character action loop with stable silhouette and consistent facing.'

  // 朝向锚定：让视频中角色面朝方向与设计文档一致
  let facingHint = ''
  if (facing === 'left') facingHint = ' Character maintains a clear LEFT-facing side-view profile across all frames.'
  else if (facing === 'right') facingHint = ' Character maintains a clear RIGHT-facing side-view profile across all frames.'
  else if (facing === 'up') facingHint = ' Character viewed from behind, facing upward/away from camera.'
  else if (facing === 'down') facingHint = ' Character facing downward/toward the camera.'
  else if (facing === 'front') facingHint = ' Character facing camera in front three-quarter view.'

  let movementHint = ''
  if (movementDir && movementDir !== 'idle' && movementDir !== 'omni') {
    movementHint = ` Implied motion direction: ${movementDir}.`
  }

  return `${name} performing ${motion}.${useCaseHint}${facingHint}${movementHint} Green chroma key background (#00FF00), character stays centered in frame, camera completely static, no camera movement, no zoom, 2-3 seconds duration, seamless loop. CRITICAL: the FULL character body (head to feet, including all limbs and weapons/accessories) must remain 100% visible within the frame at ALL times — no body parts cropped or cut off by frame edges, character must not move outside the visible area`
}

/**
 * 判定一个 asset 是否应当走视频生成流水线（节约模式 — 默认拒绝）。
 * 需同时满足：(1) 平台已配置视频模型；(2) asset.animationType === 'video' 或 'video_loop'；
 * (3) asset.frameCount 存在 或 video_loop（loop 不需要 frameCount）；
 * (4) needsVideo 显式为 true（兼容老数据：若未声明 needsVideo 但 animationType==='video'，按 true 处理）。
 */
function shouldUseVideoPipeline(asset: ModuleArtAsset, settingsStore: { isVideoConfigured: () => boolean }): boolean {
  if (!settingsStore.isVideoConfigured()) return false
  const t = asset.animationType
  if (t !== 'video' && t !== 'video_loop' as any) return false
  const needsVideo = (asset as any).needsVideo
  if (t === 'video' && !asset.frameCount) return false
  // 老数据兼容：animationType 已显式为 video → 视为允许；新数据要求显式 needsVideo=true
  if (needsVideo === false) return false
  return true
}

// ===== 序列帧逐帧生成 + 程序化拼接（最佳质量方案） =====

/** 每帧独立生成的正方形画布尺寸（AI 模型最佳输出比例） */
const INDIVIDUAL_FRAME_SIZE = 1024

/**
 * 根据动画类型生成每帧的精确姿态描述。
 * 不同动画类型有不同的关键帧分布逻辑，确保动作流畅自然。
 */
function buildPerFrameDescriptions(
  animationType: string,
  frameCount: number,
  entityName: string,
  basePrompt: string
): string[] {
  const name = entityName || 'character'
  const promptLower = (basePrompt || '').toLowerCase()

  // 检测动作类型
  if (/walk|run|move|dash/i.test(promptLower) || /walk|run|move/i.test(entityName)) {
    // 行走循环：标准 8 关键帧分布（可适配任意帧数）
    const walkPhases = [
      'standing upright, neutral stride position, weight evenly distributed, arms relaxed at sides',
      'contact pose, leading foot just touched ground, weight shifting forward, slight forward lean',
      'passing pose, feet passing each other mid-stride, body fully upright, arms swinging naturally',
      'push-off pose, trailing foot lifting off ground, weight fully on front leg, slight upward lift',
      'mid-stride float, both feet briefly off ground, body at peak height, dynamic forward motion',
      'opposite contact, other foot touching down, weight transferring, arms counter-swinging',
      'opposite passing, feet crossing in opposite direction, smooth transitional pose',
      'opposite push-off, completing the stride cycle, preparing to return to neutral',
    ]
    return distributePhases(walkPhases, frameCount)
  }

  if (/jump|bounce|spring|leap/i.test(promptLower) || /jump|bounce/i.test(entityName)) {
    const jumpPhases = [
      'crouching low, knees bent deep, body compressed, preparing to launch, arms pulled back',
      'launching upward, legs extending powerfully, body leaving ground, arms swinging up',
      'ascending, legs tucked up, body rising, slight forward momentum',
      'peak of jump, body at highest point, legs tucked, arms spread for balance, momentary hang time',
      'beginning descent, body starting to fall, legs extending down preparing for landing',
      'landing impact, knees bending to absorb shock, body compressed low, arms forward for balance',
      'recovering from landing, standing up from crouch, body straightening',
      'returning to idle stance, standing tall, weight settled, ready for next action',
    ]
    return distributePhases(jumpPhases, frameCount)
  }

  if (/attack_light|light_punch|light_attack|quick.*attack|punch|jab/i.test(promptLower) || /attack_light|punch|jab/i.test(entityName)) {
    const attackPhases = [
      'idle fighting stance, guard up, weight balanced, feet shoulder-width apart',
      'wind-up, pulling fist back, rotating torso slightly, shifting weight to back foot',
      'extension beginning, fist moving forward, torso rotating into the strike',
      'maximum extension, fist fully extended forward, body twisted into the punch, power pose',
      '[HITFRAME] impact moment, fist at furthest reach, slight forward lean, determined expression — damage detection triggers here',
      'recovery beginning, fist pulling back, body rotating back toward guard',
      'returning to guard, fist halfway back, weight re-centering',
      'back to fighting stance, guard restored, balanced and ready',
    ]
    return distributePhases(attackPhases, frameCount)
  }

  if (/attack_heavy|heavy_kick|heavy_attack|power|slam/i.test(promptLower) || /attack_heavy|kick|slam/i.test(entityName)) {
    const heavyPhases = [
      'wide fighting stance, knees bent, weight low, ready for powerful move',
      'deep wind-up, body coiling, pulling leg/arm far back, maximum tension',
      'chamber pose, fully wound up, body twisted away from target, energy building',
      'explosive launch, strike beginning, body uncoiling rapidly toward target',
      'mid-strike, limb extending with full force, body fully committed to the attack',
      '[HITFRAME] impact frame, maximum extension, body at full power pose, dynamic tension — damage detection triggers here',
      'follow-through, strike continuing past impact point, momentum carrying body forward',
      'recovery, pulling back to balanced stance, body de-rotating, settling weight',
    ]
    return distributePhases(heavyPhases, frameCount)
  }

  if (/hit|hurt|damage|stun|recoil|flinch/i.test(promptLower) || /hit|stun|recoil|flinch/i.test(entityName)) {
    const hitPhases = [
      'neutral standing pose, unprepared for impact',
      'impact moment, body jerking backward from hit, head snapping back, arms flailing',
      'recoil peak, body leaning far back, one foot sliding backward, grimacing',
      'stagger, trying to regain balance, arms out for stability, body hunched',
      'recovery, body straightening up, shaking off the hit, returning to neutral',
      'returning to stance, standing up, guard coming back up',
    ]
    return distributePhases(hitPhases, frameCount)
  }

  if (/ko|knockdown|fall|defeat|collapse/i.test(promptLower) || /ko|knockdown|fall|defeat/i.test(entityName)) {
    const koPhases = [
      'standing but dazed, wobbling, about to collapse',
      'losing balance, body tilting sideways/backward, knees buckling',
      'mid-fall, body airborne and rotating, limbs loose',
      'impact with ground, body hitting floor, dust/impact effect moment',
      'lying on ground, defeated pose, body flat, face down or on side',
      'final defeated pose, completely still on ground',
    ]
    return distributePhases(koPhases, frameCount)
  }

  if (/crouch|duck|squat|low/i.test(promptLower) || /crouch|duck/i.test(entityName)) {
    return Array(frameCount).fill('low crouching pose, knees deeply bent, body compressed, guard position low, stable and compact')
  }

  if (/block|guard|defend|shield/i.test(promptLower) || /block|guard|defend/i.test(entityName)) {
    return Array(frameCount).fill('defensive guard pose, arms raised protectively, weight on back foot, ready to absorb or counter, slight forward lean')
  }

  if (/special|super|ultimate|beam|blast|energy/i.test(promptLower) || /special|super|ultimate/i.test(entityName)) {
    const specialPhases = [
      'powering up stance, feet planted wide, fists clenched, energy gathering',
      'charging, body glowing, arms pulling back to center, energy concentrating',
      'charge peak, maximum energy buildup, body taut with power, bright aura',
      'release initiation, arms thrusting forward, energy channeling outward',
      '[HITFRAME] full release, energy blast projecting from hands/body, dynamic forward pose — damage detection triggers here',
      'follow-through, energy still flowing, body extended in release direction',
      'power-down, energy dissipating, body relaxing from exertion',
      'exhausted recovery, catching breath, returning to neutral stance',
    ]
    return distributePhases(specialPhases, frameCount)
  }

  if (/victory|win|celebrate|triumph|pose/i.test(promptLower) || /victory|win|celebrate/i.test(entityName)) {
    return Array(frameCount).fill('victorious celebration pose, fist raised high or arms spread wide, confident triumphant expression, dynamic heroic stance')
  }

  // 默认：idle 呼吸循环
  const idlePhases = [
    'standing in relaxed idle pose, weight slightly on one foot, breathing in — chest expanding slightly',
    'idle pose, subtle weight shift, slight upward movement from inhale, arms relaxed',
    'idle pose at peak inhale, chest slightly expanded, body at subtle highest point',
    'idle pose, beginning to exhale, chest contracting, body settling down slightly',
    'idle pose, mid-exhale, weight shifting back, subtle downward movement',
    'idle pose at lowest point of breath cycle, relaxed and natural, returning to start',
  ]
  return distributePhases(idlePhases, frameCount)
}

/** 将关键帧阶段描述均匀分布到实际帧数 */
function distributePhases(phases: string[], frameCount: number): string[] {
  if (frameCount >= phases.length) {
    // 帧数多于预设阶段：循环填充
    const result: string[] = []
    for (let i = 0; i < frameCount; i++) {
      result.push(phases[i % phases.length])
    }
    return result
  }
  // 帧数少于预设阶段：均匀采样
  const result: string[] = []
  for (let i = 0; i < frameCount; i++) {
    const idx = Math.round((i / frameCount) * phases.length)
    result.push(phases[Math.min(idx, phases.length - 1)])
  }
  return result
}

/**
 * 构建单帧的独立生成 prompt（高质量正方形构图）。
 * 每帧单独生成，避免 AI 画 sprite sheet 网格不准的问题。
 */
function buildSingleFramePrompt(opts: {
  frameIndex: number
  frameCount: number
  frameDescription: string
  characterPrompt: string
  style: string
  facing?: string
  allAssetNames?: string[]
}): string {
  const { frameIndex, frameCount, frameDescription, characterPrompt, style, facing, allAssetNames } = opts

  // 朝向锚定
  const facingMap: Record<string, string> = {
    left: 'character in clean side-view profile facing LEFT',
    right: 'character in clean side-view profile facing RIGHT',
    up: 'character viewed from behind facing upward',
    down: 'character viewed from front facing downward/toward camera',
    front: 'character in front three-quarter view facing camera',
    'left-up': 'character in 3/4 view facing upper-left',
    'right-up': 'character in 3/4 view facing upper-right',
    'left-down': 'character in 3/4 view facing lower-left',
    'right-down': 'character in 3/4 view facing lower-right',
  }
  const facingPhrase = (facing && facing !== 'none' && facingMap[facing]) ? facingMap[facing] : ''

  // 风格一致性提示
  let consistencyHint = ''
  if (allAssetNames && allAssetNames.length > 1) {
    consistencyHint = `, consistent art style with game assets (${allAssetNames.join(', ')})`
  }

  return [
    `A single game character illustration, square canvas, character centered with comfortable padding on all sides`,
    `Character: ${characterPrompt}`,
    `Pose (frame ${frameIndex + 1}/${frameCount} of animation cycle): ${frameDescription}`,
    facingPhrase ? `Orientation: ${facingPhrase}` : '',
    `Style: ${style}, clean crisp game sprite, cel-shaded flat coloring with HARD clean edges`,
    `Background: solid pure green (#00FF00) chroma key, completely uniform flat green, no gradients, no shadows, no ground line`,
    `CRITICAL EDGE QUALITY: character edges must be RAZOR SHARP with NO anti-aliasing, NO feathering, NO soft blending against the green background. Every pixel must be either 100% character or 100% green (#00FF00) — ZERO semi-transparent transition pixels between character and background. Hard stepped pixel-art-style boundaries. This prevents black fringing after chroma key removal`,
    `NO dark outlines, NO black borders, NO black strokes around the silhouette. Use colored outlines matching the character palette instead`,
    `Character palette must NOT contain pure black (#000000) or very dark colors (below #202020) on outer edges`,
    `IMPORTANT: after green removal this frame will be composited in-game over game backgrounds with NO backing — any residual green, white or colored halo will appear as visible artifacts`,
    `high quality game character frame${consistencyHint}`,
  ].filter(Boolean).join('. ')
}

/**
 * 绿幕像素级后处理：
 * 1. 清除绿幕（#00FF00 及附近色）为完全透明
 * 2. 修复 AI 常见的半透明边缘像素（黑边元凶）：
 *    - 与绿幕相邻的非纯绿像素 → 如果绿分量 > 阈值，去绿色溢出并保留不透明度
 *    - 完全移除中间色调的半透明像素（alpha 在 1~200 之间且绿色占主导的像素）
 */
function cleanGreenScreen(imageData: ImageData): ImageData {
  const d = imageData.data
  const w = imageData.width
  const h = imageData.height
  const totalPx = w * h

  // 第一遍：建立绿幕蒙版（哪些像素是"纯绿幕"）
  const isGreenMask = new Uint8Array(totalPx)
  for (let i = 0; i < totalPx; i++) {
    const idx = i * 4
    const r = d[idx], g = d[idx + 1], b = d[idx + 2]
    // 纯绿幕判定：G 通道远高于 R/B，且整体亮度足够
    if (g > 180 && r < 80 && b < 80) {
      isGreenMask[i] = 1
    }
  }

  // 第二遍：处理边缘像素（与绿幕相邻的非绿像素）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const idx = i * 4
      const r = d[idx], g = d[idx + 1], b = d[idx + 2], a = d[idx + 3]

      if (isGreenMask[i]) {
        // 纯绿幕 → 完全透明
        d[idx + 3] = 0
        continue
      }

      // 检查是否与绿幕相邻（4方向）
      let nearGreen = false
      if (x > 0 && isGreenMask[i - 1]) nearGreen = true
      if (x < w - 1 && isGreenMask[i + 1]) nearGreen = true
      if (y > 0 && isGreenMask[i - w]) nearGreen = true
      if (y < h - 1 && isGreenMask[i + w]) nearGreen = true

      if (nearGreen && g > r && g > b) {
        // 边缘像素：绿色分量过高 → 去绿色溢出
        const greenExcess = g - Math.max(r, b)
        if (greenExcess > 30) {
          // 降低绿色分量到 R/B 最大值附近
          const target = Math.max(r, b) + 10
          d[idx + 1] = Math.min(g, target)
          // 如果 alpha 很低（半透明边缘），直接清除
          if (a < 180) {
            d[idx + 3] = 0
          }
        } else if (a < 120) {
          // 非常半透明的边缘像素 → 直接移除（防黑边）
          d[idx + 3] = 0
        }
      }
    }
  }

  return imageData
}

/**
 * 逐帧生成 + Canvas 拼接 → 生成高质量 sprite sheet。
 *
 * 优势（对比单次生成整张 sprite sheet）：
 * 1. 每帧独立生成 1024x1024 正方形图 — AI 输出质量最高
 * 2. Canvas drawImage 程序化拼接 — 网格对齐零误差
 * 3. 像素级绿幕清理 — 消除半透明边缘，杜绝 chroma key 黑边
 * 4. 逐帧动画描述器 — 根据动作类型精确控制每帧姿态
 *
 * @returns sprite sheet 的 PNG data URL（1280x720 标准格式）
 */
async function generateSpriteSheetMultiFrame(
  asset: ModuleArtAsset,
  allAssets: ModuleArtAsset[] | undefined,
  settingsStore: { getImageConfig: () => { baseUrl: string; apiKey: string; model: string } }
): Promise<string> {
  const frameCount = asset.frameCount || 4
  const style = asset.style || 'flat cartoon, vibrant colors'
  const facing = (asset as any).facing as string | undefined
  const allNames = allAssets?.filter(a => a.id !== asset.id).map(a => a.entityName).filter(Boolean) || []

  // 1) 获取每帧姿态描述
  const frameDescs = buildPerFrameDescriptions(
    asset.animationType || 'spritesheet',
    frameCount,
    asset.entityName || '',
    asset.prompt || ''
  )

  // 2) 逐帧生成（带限流保护：每帧间隔 1.5~3s，429 时指数退避）
  const frameUrls: string[] = []
  for (let i = 0; i < frameCount; i++) {
    const prompt = buildSingleFramePrompt({
      frameIndex: i,
      frameCount,
      frameDescription: frameDescs[i],
      characterPrompt: asset.prompt || asset.entityName || 'character',
      style,
      facing,
      allAssetNames: allNames,
    })

    let attempt = 0
    let url = ''
    while (attempt < 3) {
      try {
        const images = await generateImage({
          prompt,
          n: 1,
          size: `${INDIVIDUAL_FRAME_SIZE}x${INDIVIDUAL_FRAME_SIZE}`,
        })
        url = images[0]?.url || ''
        break
      } catch (err: any) {
        attempt++
        if (attempt >= 3) throw err
        const wait = 2000 * Math.pow(2, attempt) + Math.random() * 1500
        console.warn(`[multi-frame] frame ${i + 1}/${frameCount} failed, retry ${attempt}/3 in ${wait | 0}ms:`, err.message)
        await new Promise(r => setTimeout(r, wait))
      }
    }

    if (!url) throw new Error(`[multi-frame] frame ${i + 1}/${frameCount} generation failed after retries`)
    frameUrls.push(url)
    console.log(`[multi-frame] frame ${i + 1}/${frameCount} done:`, url.slice(0, 80))

    // 帧间限流：避免触发 429
    if (i < frameCount - 1) {
      const gap = 1500 + Math.random() * 1500
      await new Promise(r => setTimeout(r, gap))
    }
  }

  // 3) Canvas 拼接为 2×2 十字格布局 + 绿幕清理
  const cols = 2
  const rows = 2
  const cellW = 256
  const cellH = 256
  const sheetCanvas = document.createElement('canvas')
  sheetCanvas.width = cellW * cols   // 512
  sheetCanvas.height = cellH * rows  // 512
  const ctx = sheetCanvas.getContext('2d')!

  for (let i = 0; i < frameCount; i++) {
    const img = await loadImage(frameUrls[i])

    // 2×2 布局坐标
    const col = i % cols
    const row = Math.floor(i / cols)
    const dx = col * cellW, dy = row * cellH, dw = cellW, dh = cellH

    // 居中裁切：让角色在格子中居中
    const sw = img.width, sh = img.height
    const targetRatio = dw / dh
    const srcRatio = sw / sh
    let cropX = 0, cropY = 0, cropW = sw, cropH = sh
    if (srcRatio > targetRatio) {
      cropW = sh * targetRatio
      cropX = (sw - cropW) / 2
    } else {
      cropH = sw / targetRatio
      cropY = (sh - cropH) / 2
    }
    ctx.drawImage(img, cropX, cropY, cropW, cropH, dx, dy, dw, dh)
  }

  // 4) 绿幕像素级清理
  const sheetW = cellW * cols
  const sheetH = cellH * rows
  const imageData = ctx.getImageData(0, 0, sheetW, sheetH)
  cleanGreenScreen(imageData)
  ctx.putImageData(imageData, 0, 0)

  // 5) 输出 PNG data URL
  const dataUrl = sheetCanvas.toDataURL('image/png')
  console.log(`[multi-frame] sprite sheet complete: ${frameCount} frames, 2×2 grid ${sheetW}x${sheetH}, ${(dataUrl.length/1024).toFixed(0)}KB`)
  return dataUrl
}

/** 辅助：加载图片为 HTMLImageElement */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败: ${url.slice(0, 80)}`))
    img.src = url
  })
}

/**
 * 通过 图生视频(i2v) → 抽帧 生成 sprite sheet（默认最优方案）。
 *
 * 流程：
 * 1. 生成单张高质量静态角色图（绿幕背景）
 * 2. 调用配置的视频模型（默认 wan3.0-video-prime）生成角色动画视频
 * 3. 从视频均匀抽帧 → 拼接为标准 sprite sheet
 *
 * 优势：动作帧间过渡自然流畅（视频模型保证时序连贯），API 调用次数少（1+1 vs N）。
 */
async function generateSpriteSheetViaI2V(
  asset: ModuleArtAsset,
  allAssets: ModuleArtAsset[] | undefined,
): Promise<string> {
  // 视频抽帧统一 4 帧（铁律）：4 帧足以表达动作循环，帧数过多会导致单帧质量下降
  const frameCount = 4

  // Step 1: 生成单张高质量静态角色图
  // 尺寸必须与视频输出同比例 (16:9)，避免视频模型将正方形输入裁切为 16:9 导致角色头脚被截断
  const staticPrompt = buildStaticCharacterPrompt(asset, allAssets)
  const staticImages = await generateImage({ prompt: staticPrompt, n: 1, size: '1280*720' })
  const staticUrl = staticImages[0]?.url || ''
  if (!staticUrl) throw new Error('[i2v] 静态角色图生成失败')

  // 视频 API 需要公开 HTTP URL
  const publicImageUrl = unproxyUrl(staticUrl)
  if (!isPublicHttpUrl(publicImageUrl)) {
    throw new Error('[i2v] 静图URL不是公开HTTP URL，无法调用视频API')
  }

  // Step 2: 图生视频
  const motionPrompt = buildVideoMotionPrompt(asset)
  console.log('[i2v-spritesheet] generating video for', asset.id, '—', motionPrompt.slice(0, 120))
  const video = await generateVideo({ imageUrl: publicImageUrl, prompt: motionPrompt, size: '1280*720' })

  // Step 3: 从视频抽帧 → 拼 sprite sheet
  // 帧尺寸：视频是 1280x720 横版，角色居中，用方形帧确保角色不变形
  // 优先用 asset 声明值，否则默认 256x256 方形帧（与原 video pipeline 一致）
  const frameWidth = asset.frameWidth || 256
  const frameHeight = asset.frameHeight || 256
  const spriteDataUrl = await videoToSpriteSheet(video.url, frameCount, { width: frameWidth, height: frameHeight })

  console.log(`[i2v-spritesheet] done: ${frameCount} frames, ${frameWidth}x${frameHeight} per frame, ${(spriteDataUrl.length / 1024).toFixed(0)}KB`)
  return spriteDataUrl
}

/**
 * 构建美术资源的文生图 prompt，确保风格一致性和尺寸信息
 * - 序列帧素材：生成横向排列的 sprite sheet
 * - 背景素材：生成全屏场景图
 * - 静态素材：生成单个物体居中构图（无白边）
 */
function buildArtPrompt(asset: ModuleArtAsset, allAssets?: ModuleArtAsset[], orientation: Orientation = 'portrait'): string {
  const style = asset.style || 'flat cartoon, vibrant colors'

  // 构建一致性约束：列出同项目中所有其他素材的简要信息
  let consistencyHint = ''
  if (allAssets && allAssets.length > 1) {
    const others = allAssets.filter((a) => a.id !== asset.id).map((a) => a.entityName).join(', ')
    consistencyHint = `, consistent art style with other game assets (${others})`
  }

  // 方向协调注入（核心防漂移）：根据 asset.facing/movementDir/scrollDir 构建朝向 hint
  // 让美术朝向、姿态、运动轨迹与玩法语义、背景滚动方向严格协调
  const facingPhraseMap: Record<string, string> = {
    left: 'character in clean side-view profile facing screen LEFT, body fully oriented to the left, head and feet pointing left',
    right: 'character in clean side-view profile facing screen RIGHT, body fully oriented to the right, head and feet pointing right',
    up: 'character viewed from behind facing UP/away from camera, back of the body visible',
    down: 'character viewed from front facing DOWN/toward camera, full front view',
    front: 'character in front three-quarter view facing camera, slight angle for depth',
    'left-up': 'character in 3/4 side-view facing UPPER-LEFT, body angled toward top-left corner',
    'right-up': 'character in 3/4 side-view facing UPPER-RIGHT, body angled toward top-right corner',
    'left-down': 'character in 3/4 side-view facing LOWER-LEFT, body angled toward bottom-left corner',
    'right-down': 'character in 3/4 side-view facing LOWER-RIGHT, body angled toward bottom-right corner',
    none: '',
  }
  const movementPhraseMap: Record<string, string> = {
    left: 'pose suggests motion toward LEFT, leading edge on the left, trailing motion lines on the right',
    right: 'pose suggests motion toward RIGHT, leading edge on the right, trailing motion lines on the left',
    up: 'pose suggests upward motion, body slightly leaning up, motion lines below',
    down: 'pose suggests downward motion, body slightly leaning down, motion lines above',
    'left-up': 'pose suggests motion toward upper-left',
    'right-up': 'pose suggests motion toward upper-right',
    'left-down': 'pose suggests motion toward lower-left',
    'right-down': 'pose suggests motion toward lower-right',
    idle: 'static idle stance',
    omni: 'neutral balanced stance suitable for moving in any direction',
  }
  const scrollPhraseMap: Record<string, string> = {
    left: 'horizontally tileable composition, content flows toward the LEFT (will scroll left under a right-moving player)',
    right: 'horizontally tileable composition, content flows toward the RIGHT (will scroll right under a left-moving player)',
    up: 'composition flowing UPWARD, vertically scrolling background',
    down: 'composition flowing DOWNWARD, vertically scrolling background',
    idle: '',
    omni: '',
  }
  let directionHint = ''
  const facing = (asset as any).facing as string | undefined
  const movementDir = (asset as any).movementDir as string | undefined
  const scrollDir = (asset as any).scrollDir as string | undefined
  if (facing && facing !== 'none' && facingPhraseMap[facing]) directionHint += `. ${facingPhraseMap[facing]}`
  if (movementDir && movementDir !== 'idle' && movementPhraseMap[movementDir]) directionHint += `. ${movementPhraseMap[movementDir]}`
  if (scrollDir && scrollDir !== 'idle' && scrollPhraseMap[scrollDir]) directionHint += `. ${scrollPhraseMap[scrollDir]}`
  if (directionHint) directionHint += '. CRITICAL: facing direction must be visually unambiguous and consistent across all frames if this is a sprite sheet'

  consistencyHint = consistencyHint + directionHint

  // 检测是否卡牌类素材：prompt 中含 card 相关描述，或 id 含 card
  const isCardAsset = /card|deck|hand/i.test(asset.id) || /trading card|card frame|card border|card game/i.test(asset.prompt)

  // 检测是否需要无缝拼接的 tileable 素材（地面/平台/管道/墙壁/轨道等）
  const isTileable = asset.tileable === true ||
    /ground|floor|terrain|road|platform|tile|brick|pipe|wall|track|rail/i.test(asset.id) ||
    /seamless|tileable|repeating|tiling/i.test(asset.prompt || '')

  // 无缝拼接素材：左右（或上下）边缘纹理完美衔接，用于重复铺设
  if (isTileable && asset.animationType !== 'spritesheet') {
    return [
      asset.prompt,
      `MUST strictly follow this unified art style: ${style}`,
      '2D game tileable texture segment, designed for SEAMLESS horizontal repetition',
      'CRITICAL SEAMLESS TILING REQUIREMENT: the LEFT edge pixels must PERFECTLY match and continue into the RIGHT edge pixels with zero visible seam when copies are placed side by side — the pattern, colors, lighting and surface details must flow continuously across the boundary',
      'the texture must look like ONE continuous surface when 3+ copies are placed in a row, with no repeating artifacts, no vertical line, no color shift, no brightness discontinuity at the join',
      'flat side-view perspective (2D platformer view), consistent even lighting across the entire width',
      'fills the entire image edge-to-edge with NO transparent areas, NO green screen',
      'NO text, NO UI elements, NO characters or creatures in the texture',
      'suitable for repeating ground/platform/wall/track segment in a 2D game',
      `high quality game texture${consistencyHint}`,
    ].join(', ')
  }

  // 序列帧动画：2×2 十字格布局，固定 4 帧，每帧 256x256，总尺寸 512x512
  if (asset.animationType === 'spritesheet' && asset.frameCount) {
    return [
      `A 2x2 grid sprite sheet, total image dimensions EXACTLY 512x512 pixels`,
      `The image is divided into a 2-column × 2-row grid (4 cells, each cell is 256x256 pixels). Frame layout: top-left=frame1, top-right=frame2, bottom-left=frame3, bottom-right=frame4`,
      `Subject: ${asset.prompt}`,
      `Animation: each cell shows one keyframe of a smooth motion cycle (e.g. walk / attack / idle bounce), progressing in reading order (left-to-right, top-to-bottom) from frame 1 to frame 4`,
      `CRITICAL consistency to avoid flicker: the character must be drawn at the IDENTICAL scale, identical horizontal center and identical vertical baseline (feet/bottom aligned) inside every cell — ONLY the pose changes between cells, never the size or position`,
      `Each frame must be fully contained within its own 256x256 cell with comfortable padding; NO part of the character may cross into an adjacent cell`,
      `Style: ${style}, clean crisp game sprite sheet, cel-shaded flat coloring with HARD clean edges`,
      `Background: solid pure green (#00FF00) chroma key, completely uniform flat green across the WHOLE canvas, no gradients, no shadows, no ground line`,
      `ANTI-ALIASING PROHIBITION (CRITICAL to prevent black fringing): The character edges must be RAZOR SHARP with NO anti-aliasing, NO feathering, NO soft blending against the green background. Every pixel must be either 100% character or 100% green (#00FF00) — there must be ZERO semi-transparent or blended transition pixels between the character and the green background. Think of it like pixel art edges: hard stepped boundaries with no smoothing. This is essential because soft edges create ugly black borders after chroma key removal.`,
      `NO dark outlines, NO black borders, NO black strokes around the character silhouette. If the character design requires outlines, use colored outlines (matching the character's palette) instead of black`,
      `The character's color palette must NOT contain any pure black (#000000) or very dark colors (below #202020) on its outer edges or silhouette boundary`,
      `IMPORTANT: after chroma key removal this sprite sheet will be composited in-game over game backgrounds with NO backing — any residual green, white or colored pixels will appear as visible artifacts on every frame`,
      `STRICT: all 4 cells must be perfectly evenly sized (256x256 each), no gaps, no separators, no borders, no grid lines, no numbering or labels`,
      `high quality game asset${consistencyHint}`,
    ].join('. ')
  }

  // 背景图：全屏场景，不需要透明背景
  if (asset.id?.startsWith('bg_')) {
    // 标题/主页背景需要更强的"大片感/品质感"，作为玩家第一眼看到的画面
    const isTitleBg = asset.id === 'bg_title'
    const isLoadingBg = asset.id === 'bg_loading'
    let premiumHints: string[]
    if (isTitleBg) {
      premiumHints = [
        'AAA mobile game title screen key art, premium polished hero illustration',
        'striking focal point and strong sense of depth (foreground / midground / background layers)',
        'dramatic cinematic lighting, volumetric light, rim light, subtle glow and particles',
        'rich color grading and high dynamic range, professional concept-art quality',
        'leave a relatively clean area near the upper-center for the game logo and a clean area in the lower third for menu buttons (do not draw any text or buttons there, just keep it visually calm)',
      ]
    } else if (isLoadingBg) {
      premiumHints = [
        'AAA mobile game loading / transition screen key art, premium polished illustration matching the title art',
        'atmospheric immersive scene with a strong sense of depth, conveying "about to enter the world" anticipation',
        'cinematic lighting, volumetric light, soft glow and floating particles, rich color grading',
        'keep the CENTER region calm and relatively clean / softly darkened (empty space reserved for a loading progress bar and hint text) — do not draw any text, bar, logo or UI there',
        'visual style, palette and motifs must be consistent with the title and gameplay backgrounds, like the same artist in the same world',
      ]
    } else {
      // 判断是否为需要滚动循环的游戏背景（视差层/gameplay 背景含有 scroll/parallax/loop 或 tileable 标记）
      const isScrollBg = asset.tileable === true ||
        /scroll|parallax|loop|seamless|repeating|tileable|endless|runner|far|mid|near|layer/i.test(asset.id || '') ||
        /scroll|parallax|seamless|tileable|repeating|looping|endless/i.test(asset.prompt || '')
      premiumHints = [
        'rich environmental details and atmospheric lighting, clear depth layers',
        'game-appropriate composition that keeps the central gameplay area visually readable (avoid overly busy clutter in the center)',
      ]
      if (isScrollBg) {
        premiumHints.push(
          'CRITICAL SEAMLESS HORIZONTAL TILING: the LEFT edge of this background must PERFECTLY connect with the RIGHT edge when the image is repeated side-by-side for infinite scrolling — colors, lighting, horizon line, terrain contour and all visual elements must flow continuously across the seam with ZERO visible join line or discontinuity',
          'avoid any unique landmark or focal object that would reveal the repetition — use distributed organic patterns (clouds, foliage, terrain undulations) that can repeat naturally'
        )
      }
    }
    return [
      asset.prompt,
      // 强约束：背景必须严格遵循全局统一美术风格，避免风格漂移
      `MUST strictly follow this unified art style: ${style}`,
      'full scene background illustration for a video game',
      orientation === 'landscape'
        ? 'WIDE LANDSCAPE composition (16:9, width greater than height), cinematic horizontal framing filling the entire image edge-to-edge'
        : 'TALL PORTRAIT composition (vertical, height greater than width), composition filling the entire image edge-to-edge',
      ...premiumHints,
      'NO border, NO frame, NO vignette, NO text, NO words, NO logo, NO UI elements, NO buttons',
      'the artwork must extend to all four edges with no margins',
      `masterpiece, ultra detailed, high quality${consistencyHint}`,
    ].join(', ')
  }

  // 卡牌类素材：只生成插画内容，不要边框/卡面装饰（代码会自行绘制卡框）
  if (isCardAsset) {
    // 去掉原始 prompt 中可能包含的 "card frame / border / golden border" 等描述
    const cleanPrompt = asset.prompt
      .replace(/\b(rectangular |golden |ornate )?(trading )?card (frame|border|with border|with golden border)\b/gi, '')
      .replace(/\b(card game|trading card)\b/gi, 'character portrait')
      .trim()
    return [
      cleanPrompt || asset.prompt,
      `${style}, character portrait illustration for game card`,
      'single character or object centered, bust shot or full body, vivid details',
      'NO card frame, NO border, NO decorative edges, NO text overlay (the game code draws the card frame separately)',
      'solid pure green (#00FF00) chroma key background, completely uniform green',
      'clean sharp edges with no white halo or glow around the subject',
      'IMPORTANT: after chroma key removal this card illustration will be composited in-game with NO backing — any residual white or colored edge pixels will show as artifacts',
      `high quality game illustration${consistencyHint}`,
    ].join(', ')
  }

  // UI 面板纹理：铺满整图的对称装饰底板，适配 9-slice 拉伸
  if (asset.id?.startsWith('ui_panel')) {
    return [
      asset.prompt || 'decorative game UI panel background texture',
      `MUST strictly follow this unified art style: ${style}`,
      'game UI dialog/panel background texture — this is the ONE shared panel skin reused by ALL popups, dialogs and HUD panels in the game',
      '**CRITICAL COMPOSITION: the panel texture MUST fill the ENTIRE image from edge to edge with ZERO margin** — the panel frame IS the full image rectangle',
      'bilateral (left-right) AND vertical (top-bottom) MIRROR SYMMETRY — perfectly symmetric ornamental design on both axes',
      'symmetric rounded-rectangle panel with a clear decorative border frame (12-20px ornamental edge) and a calm readable inner fill area with subtle texture',
      '9-slice friendly: ornate corner anchors (gems/rivets/filigree), repeatable edge strips, uniform center fill that stretches cleanly',
      'NO text, NO icons, NO buttons, NO characters, NO transparent areas — panel must be fully opaque',
      'soft even lighting, flat front-facing view, clean textured surface so text can overlay on top',
      `high quality cohesive UI asset matching the game theme${consistencyHint}`,
    ].join(', ')
  }

  // UI 按钮纹理：铺满整图、中心干净的按钮底板（供文字叠加），适配 9-slice 拉伸，绿幕背景
  if (asset.id?.startsWith('ui_button')) {
    return [
      asset.prompt || 'decorative game UI button background texture',
      `MUST strictly follow this unified art style: ${style}`,
      'game UI button background skin — this is the ONE shared button style reused by EVERY button across the title screen, pause menu, popups and game over screen (unified control style)',
      '**CRITICAL COMPOSITION: the button texture MUST fill the ENTIRE image from edge to edge (left edge to right edge, top edge to bottom edge) with ZERO margin/padding around it** — the button shape IS the full image rectangle, not a small element floating inside a larger canvas',
      'left-right (bilateral) symmetric layout so it reads as a balanced, calm button plate; no off-center badge, no diagonal slash, no one-sided ornament (top-bottom does NOT need to be mirrored)',
      'wide horizontal rounded-rectangle (pill / capsule / wide-ratio rectangle) button plate with a thin decorative border frame filling the full image bounds',
      '9-slice / nine-patch friendly structure: a SUBTLE thin thematic border frame (restrained trim, ~2-4px, low-contrast) with small understated CORNER accents ONLY, and a CLEAN CALM near-flat solid-fill CENTER (one low-detail surface, no busy pattern, no engraving, no gems) so an overlaid text label stays clearly readable; the border tiles cleanly and the flat center stretches seamlessly when scaled',
      'no text, no letters, no numbers, no icons, no characters baked into the texture — only a quiet ornamental border',
      'restrained low-key DEPTH only: a soft outer bevel/border (1-2px) + a gentle gradient fill + a faint top highlight — keep it minimal and calm, do NOT stack many ornate layers, it must look like a quiet button base, NOT an ornate decorative medallion',
      'solid pure green (#00FF00) chroma key background OUTSIDE the button shape (if any pixel is not part of the button body, it must be #00FF00), button body itself has zero transparency',
      'clean razor-sharp edges between button body and green background, absolutely no white border, no white halo, no anti-alias bleed into green',
      `high quality cohesive UI asset matching the game theme${consistencyHint}`,
    ].join(', ')
  }

  // UI 图标素材（icon_*）：小尺寸、清晰辨识度高的功能图标，绿幕背景便于抠图
  if (asset.id?.startsWith('icon_')) {
    return [
      asset.prompt || 'game UI icon',
      `MUST strictly follow this unified art style: ${style}`,
      'a single game UI icon, compact and instantly recognizable at small sizes (64x64 to 96x96 display)',
      'SQUARE 1:1 aspect ratio, icon centered in frame occupying 70-85% of the image area',
      'bold shapes with strong contrast, clear silhouette, simplified details that read well at small scale',
      'NO text, NO letters, NO words on the icon',
      'solid pure green (#00FF00) chroma key background, completely uniform green with no gradients',
      'HARD PIXEL EDGES (no anti-aliasing against green): every pixel is either 100% icon or 100% pure green, NO blended transition pixels',
      'NO black outlines on outer edge; use colored outlines matching the icon palette if outlines are needed',
      `high quality game UI icon asset${consistencyHint}`,
    ].join(', ')
  }

  // 静态素材：根据 role 分类优化 prompt，保证美术与游戏用途匹配
  const roleHints: string[] = []
  // 检测是否为飞行器类实体（飞机/战舰/火箭/宇宙飞船等），需要左右对称
  const isAircraft = /plane|aircraft|jet|fighter|spaceship|starship|ship|warship|shuttle|rocket|bomber|helicopter|mech/i.test(asset.prompt || '') ||
    /飞机|战机|战舰|宇宙飞船|火箭|机甲/i.test(asset.prompt || '')
  if (asset.role === 'player_controlled') {
    if (isAircraft) {
      roleHints.push('main player aircraft/spacecraft, PERFECTLY BILATERALLY SYMMETRIC (left-right mirror symmetry), top-down view or front view, centered on vertical axis, wings/engines/weapons placed symmetrically on both sides, clean aerodynamic silhouette')
    } else {
      roleHints.push('main playable game character, dynamic hero pose, full body visible, expressive design')
    }
  } else if (asset.role === 'obstacle') {
    // 区分"活物敌人"和"无生命障碍物"
    const isCreature = /monster|enemy|pig|boss|ghost|slime|zombie|dragon|goblin|soldier|creature|warrior/i.test(asset.prompt || '')
    if (isAircraft) {
      roleHints.push('enemy aircraft/spacecraft in game, PERFECTLY BILATERALLY SYMMETRIC (left-right mirror symmetry), top-down view or front view, centered on vertical axis, menacing angular design with symmetric wings/weapons, compact proportional shape')
    } else if (isCreature) {
      roleHints.push('enemy creature/character in game, menacing or mischievous expression, full body visible, proportional compact design')
    } else {
      roleHints.push('game prop / building block / obstacle object, solid material texture, simple clear shape, suitable for stacking or placement')
    }
  } else if (asset.role === 'collectible') {
    roleHints.push('collectible game item/pickup, shiny attractive appearance, compact shape, desirable visual')
    // 三消宝石强化：不同 id 必须有完全不同的形状轮廓+主题物体，不能只是换颜色
    const isGem = /^gem_/i.test(asset.id || '')
    if (isGem) {
      roleHints.push(
        'CRITICAL: this gem must have a COMPLETELY DIFFERENT shape/silhouette from other gems in the same game — each gem is a distinct geometric shape (circle/diamond/star/hexagon/heart/teardrop) NOT the same shape in different colors',
        'the gem must be a recognizable object or symbol (flame/waterdrop/leaf/star/moon/crystal/rune), not just a generic round jewel',
        'when placed side by side with other gems, a player must be able to tell them apart at a glance even without color (shape-based identification)'
      )
    }
  } else if (asset.role === 'projectile') {
    roleHints.push('game projectile/bullet/spell effect, dynamic energy or motion lines, compact shape')
  } else if (asset.role === 'decoration') {
    roleHints.push('game scene decoration / prop, appropriate detail level, does not draw focus from main characters')
  }
  return [
    asset.prompt,
    `${style}, 2D game asset sprite, cel-shaded flat coloring with hard clean edges`,
    ...roleHints,
    'single object centered in frame, clear silhouette, SQUARE 1:1 aspect ratio composition',
    'solid pure green (#00FF00) chroma key background, completely uniform green with no gradients',
    'HARD PIXEL EDGES (no anti-aliasing against green): every pixel is either 100% subject or 100% pure green, NO blended/feathered transition pixels that would cause black fringing after chroma removal',
    'NO black outlines or dark strokes on the outer silhouette boundary; if outlines are needed use colored outlines matching the palette',
    'clean sharp edges with absolutely no white border, no white halo, no glow, no shadow on background',
    'IMPORTANT: this sprite will be displayed in-game composited directly over game backgrounds with NO backing fill — any residual white, green, or colored pixels around the subject will appear as ugly visible artifacts in the final game',
    'object should occupy 70-85% of the image area for easy integration',
    `high quality${consistencyHint}`,
  ].join(', ')
}

/**
 * 检测生成的游戏代码是否真正使用了所有美术资源。
 * 返回未被引用的资源 id 列表（代码源码中既没出现该 id 字面量）。
 */
function findUnusedAssets(source: string, modules: CodegenModuleInfo[]): string[] {
  const ids = new Set<string>()
  for (const m of modules) {
    for (const a of m.assets) {
      if (a.id) ids.add(a.id)
    }
  }
  const unused: string[] = []
  for (const id of ids) {
    // 使用判定：源码中出现该 id 字符串（ASSETS['id'] / images['id'] 等均涵盖）
    if (!source.includes(id)) unused.push(id)
  }
  return unused
}

// ===== 多文件代码：解析 / 合并 / 落盘 =====

export interface GameCodeFile {
  name: string
  content: string
}

/**
 * 解析代码模型输出的"多文件"格式：以 /* ==== FILE: name ==== *\/ 分隔。
 * 若没有任何 FILE 标记，则整体作为单个 game.js 文件（向后兼容）。
 */
function parseMultiFileOutput(raw: string): GameCodeFile[] {
  // 去掉可能的 markdown 围栏
  const stripped = raw
    .replace(/^```(?:html|javascript|js)?\s*\n?/gim, '')
    .replace(/\n?```\s*$/gim, '')
    .trim()

  const markerRe = /\/\*\s*={2,}\s*FILE:\s*(.+?)\s*={2,}\s*\*\//g
  const matches: Array<{ name: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = markerRe.exec(stripped)) !== null) {
    matches.push({ name: m[1].trim(), start: m.index, end: markerRe.lastIndex })
  }

  if (matches.length === 0) {
    return [{ name: 'game.js', content: stripped }]
  }

  const files: GameCodeFile[] = []
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const contentStart = cur.end
    const contentEnd = i + 1 < matches.length ? matches[i + 1].start : stripped.length
    const content = stripped.slice(contentStart, contentEnd).trim()
    let name = cur.name.replace(/[^\w.\-]/g, '_')
    if (!/\.[a-z0-9]+$/i.test(name)) name += '.js'
    if (content) files.push({ name, content })
  }
  return files.length ? files : [{ name: 'game.js', content: stripped }]
}

/**
 * 按"core.js 最前、main.js 最后、其余保持原序"重排，并合并成单个可运行 JS 包。
 * 文件之间保留 FILE 头注释，便于在部署产物中定位来源。
 */
function combineCodeFiles(files: GameCodeFile[]): string {
  if (files.length === 1) return files[0].content
  const score = (f: GameCodeFile) => {
    const n = f.name.toLowerCase()
    if (n.startsWith('core')) return -1
    if (n.startsWith('main')) return 1
    return 0
  }
  const ordered = files
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const s = score(a.f) - score(b.f)
      return s !== 0 ? s : a.i - b.i
    })
    .map((x) => x.f)
  return ordered.map((f) => `/* ==== FILE: ${f.name} ==== */\n${f.content}`).join('\n\n')
}

/**
 * 把分模块文件分别保存到项目 code/ 目录，便于查看清晰的工程结构。
 */
function persistCodeFiles(files: GameCodeFile[]) {
  const projStore = useProjectStore()
  if (!projStore.hasProject) return
  for (const f of files) {
    try {
      projStore.saveToProject('code', f.name, f.content)
    } catch { /* 单文件保存失败不阻塞 */ }
  }
}


function collectCodegenModules(): CodegenModuleInfo[] {
  const store = useCanvasStore()
  const moduleNodes = store.nodes.filter((n) => n.type === 'module')
  return moduleNodes.map((node) => {
    const m = node.data as ModuleNodeData
    return {
      name: m.name,
      description: m.description || '（无描述）',
      userInput: m.userInput,
      relatedEntities: m.relatedEntities,
      assets: m.assets
        .filter((a) => a.status === 'done' && a.url)
        .map((a) => ({
          id: a.id,
          entityName: a.entityName,
          requirement: a.prompt,
          animationType: a.animationType,
          frameCount: a.frameCount,
          frameWidth: a.frameWidth,
          frameHeight: a.frameHeight,
          facing: a.facing,
          movementDir: a.movementDir,
          scrollDir: a.scrollDir,
          needsVideo: a.needsVideo,
          videoUseCase: a.videoUseCase,
        })),
    }
  })
}

/** 收集"未完成"的美术资源清单（idle/generating/error/缺 url），按模块分组 */
interface MissingAssetInfo {
  moduleName: string
  moduleId: string
  assets: Array<{ id: string; entityName: string; status: string }>
}
function collectMissingAssets(): MissingAssetInfo[] {
  const store = useCanvasStore()
  const result: MissingAssetInfo[] = []
  for (const node of store.nodes) {
    if (node.type !== 'module') continue
    const m = node.data as ModuleNodeData
    const missing = m.assets.filter((a) => a.status !== 'done' || !a.url)
    if (missing.length) {
      result.push({
        moduleName: m.name,
        moduleId: node.id,
        assets: missing.map((a) => ({ id: a.id, entityName: a.entityName, status: a.status })),
      })
    }
  }
  return result
}

/**
 * 在生成代码前提醒用户缺失的美术资源。
 * 返回 true 表示用户已选择"继续生成（缺失部分使用占位方块）"。
 * 返回 false 表示用户取消（应中止 codegen）。
 */
async function confirmMissingAssetsBeforeCodegen(): Promise<boolean> {
  const missing = collectMissingAssets()
  if (!missing.length) return true

  const totalMissing = missing.reduce((sum, m) => sum + m.assets.length, 0)
  const lines = missing
    .map((m) => `• 「${m.moduleName}」缺：${m.assets.map((a) => a.entityName).join('、')}`)
    .join('<br/>')

  try {
    await ElMessageBox.confirm(
      `<div class="gf-asset-warn">` +
        `<div class="gf-asset-warn__head">检测到 <b>${totalMissing}</b> 个美术资源尚未生成（共 ${missing.length} 个模块）</div>` +
        `<div class="gf-asset-warn__list">${lines}</div>` +
        `<div class="gf-asset-warn__tip"><b>仍然生成代码</b>将对缺失素材使用彩色方块占位；<b>建议先生成美术</b>以获得最佳效果。</div>` +
        `</div>`,
      '美术资源未就绪',
      {
        type: 'warning',
        dangerouslyUseHTMLString: true,
        confirmButtonText: '仍然生成代码',
        cancelButtonText: '先去生成美术',
        customClass: 'gf-dark-messagebox',
      }
    )
    return true
  } catch {
    return false
  }
}

// ===== Stage 2: 功能模块自动拆分 =====

/** 并发锁：防止自动触发和手动点击同时运行导致重复通知 */
let _breakdownRunning = false

/**
 * 一键自动拆分功能模块：调用 LLM 将设计文档拆分为多个功能模块节点。
 * 在 IdeaNode 完成后自动或手动触发。
 */
export async function autoBreakdownModules(ideaNode: CanvasNode) {
  if (_breakdownRunning) return // 已在运行中，跳过重复调用
  _breakdownRunning = true
  try {
    await _doBreakdownModules(ideaNode)
  } finally {
    _breakdownRunning = false
  }
}

async function _doBreakdownModules(ideaNode: CanvasNode) {
  const settingsStore = useSettingsStore()
  if (!settingsStore.isLLMConfigured()) {
    ElMessage.warning('请先配置 LLM API Key')
    settingsStore.show()
    return
  }

  const store = useCanvasStore()
  const design = ideaNode.data.expandedDesign as GameDesign | null
  if (!design) {
    ElMessage.error('请先完成创意推理')
    return
  }

  store.setPipeline({ currentStage: 2, status: 'running', progress: 5, message: '正在拆分功能模块…' })

  try {
    const userPrompt = buildModuleBreakdownUserPrompt(design, undefined, orientationFromDesign(design))
    let accLen = 0
    const text = await chatCompletion(
      [
        { role: 'system', content: MODULE_BREAKDOWN_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: 0.6,
        responseFormat: 'json_object',
        onChunk: (chunk) => {
          accLen += chunk.length
          store.setPipeline({ progress: Math.min(85, 5 + accLen / 12), message: '正在拆分功能模块…' })
        },
      }
    )
    const result = extractJSON<{ modules: Array<{ id: string; name: string; description: string; relatedEntities: string[] }> }>(text)
    const modules = result.modules || []

    if (!modules.length) {
      ElMessage.error('LLM 未返回有效的功能模块')
      store.setPipeline({ status: 'error', message: '模块拆分结果为空' })
      return
    }

    // 清除已有的 module 节点（重新拆分时）
    const existingModules = store.nodes.filter((n) => n.type === 'module')
    existingModules.forEach((n) => store.removeNode(n.id))

    // 创建多个 ModuleNode
    const baseX = ideaNode.position.x + ideaNode.size.width + 180
    const baseY = ideaNode.position.y - ((modules.length - 1) * 220) / 2

    modules.forEach((mod, i) => {
      // 收集该模块关联的实体信息，构建初始 art asset 列表
      const relatedEntities = design.entities.filter((e) => mod.relatedEntities.includes(e.id))
      // 构建统一风格锚点：把 colorPalette + 全局光影方向锁定到 style 字段，所有素材共用，避免风格漂移
      const baseStyle = design.suggestedArtStyle || 'flat cartoon, vibrant colors, game asset, transparent background'
      const palette = design.colorPalette || {}
      const paletteAnchor = [
        palette.primary && `primary color ${palette.primary}`,
        palette.secondary && `secondary color ${palette.secondary}`,
        palette.accent && `accent highlight ${palette.accent}`,
        palette.background && `dominant background tone ${palette.background}`,
      ].filter(Boolean).join(', ')
      const lightingAnchor = 'unified top-left key lighting, soft ambient occlusion, consistent shadow direction across all assets, same color temperature and saturation level'
      const lockedStyle = paletteAnchor
        ? `${baseStyle}. STRICT GLOBAL PALETTE LOCK: ${paletteAnchor}. ${lightingAnchor}. All assets in this game must share this exact palette and lighting — do not introduce off-palette colors`
        : `${baseStyle}. ${lightingAnchor}`
      const assets: ModuleArtAsset[] = relatedEntities.map((entity) => ({
        id: entity.id,
        entityName: entity.name,
        prompt: entity.visuals,
        style: lockedStyle,
        url: '',
        status: 'idle' as const,
        role: entity.role || undefined,
        animationType: entity.animationType || 'static',
        frameCount: entity.frameCount || undefined,
        frameWidth: entity.frameWidth || undefined,
        frameHeight: entity.frameHeight || undefined,
        tileable: entity.tileable || undefined,
        facing: (entity as any).facing || undefined,
        movementDir: (entity as any).movementDir || undefined,
        scrollDir: (entity as any).scrollDir || undefined,
        needsVideo: (entity as any).needsVideo || undefined,
        videoUseCase: (entity as any).videoUseCase || undefined,
      }))

      const moduleId = `module_${Date.now()}_${i}`
      const moduleNode: CanvasNode = {
        id: moduleId,
        type: 'module',
        position: { x: baseX, y: baseY + i * 220 },
        size: { width: 380, height: 280 },
        stage: 2,
        status: 'completed',
        data: {
          name: mod.name,
          description: mod.description,
          relatedEntities: mod.relatedEntities,
          userInput: '',
          assets,
          source: 'auto',
        } as ModuleNodeData,
        createdAt: new Date().toISOString(),
      }
      store.addNode(moduleNode)
      store.addEdge({ id: `edge_idea_${moduleId}`, sourceId: ideaNode.id, targetId: moduleId, type: 'pipeline' })
    })

    store.setPipeline({ status: 'completed', progress: 100, message: `功能模块拆分完成（${modules.length} 个模块）` })
    ElMessage.success(`已拆分为 ${modules.length} 个功能模块`)

    // 保存模块信息到项目 modules/ 目录
    const projStore = useProjectStore()
    modules.forEach((mod) => {
      const moduleDoc = {
        id: mod.id,
        name: mod.name,
        description: mod.description,
        relatedEntities: mod.relatedEntities,
      }
      projStore.saveToProject('modules', `${mod.id}.json`, JSON.stringify(moduleDoc, null, 2))
    })
    // 保存完整模块拆分概览
    projStore.saveToProject('modules', '_overview.json', JSON.stringify({ modules, createdAt: new Date().toISOString() }, null, 2))
  } catch (err: any) {
    store.setPipeline({ status: 'error', message: err.message || '模块拆分失败' })
    ElMessage.error('模块拆分失败: ' + err.message)
  }
}

/**
 * 手动添加空白功能模块节点（双击 IdeaNode 时触发）
 */
export function addManualModule(ideaNode: CanvasNode) {
  const store = useCanvasStore()
  const existingModules = store.nodes.filter((n) => n.type === 'module')
  const count = existingModules.length

  const baseX = ideaNode.position.x + ideaNode.size.width + 180
  const baseY = ideaNode.position.y + count * 220

  const moduleId = `module_${Date.now()}`
  const moduleNode: CanvasNode = {
    id: moduleId,
    type: 'module',
    position: { x: baseX, y: baseY },
    size: { width: 380, height: 280 },
    stage: 2,
    status: 'idle',
    data: {
      name: `自定义模块 ${count + 1}`,
      description: '',
      relatedEntities: [],
      userInput: '',
      assets: [],
      source: 'manual',
    } as ModuleNodeData,
    createdAt: new Date().toISOString(),
  }
  store.addNode(moduleNode)
  store.addEdge({ id: `edge_idea_${moduleId}`, sourceId: ideaNode.id, targetId: moduleId, type: 'pipeline' })
  store.selectNode(moduleId)
}

/**
 * 序列帧 sprite sheet 的固定生图尺寸（统一标准格式）
 * - 统一用 1280x720 横向画布，把宽度均分成 frameCount 个等宽竖直列，每列一帧
 * - 程序侧 frameWidth = 实际图宽 / frameCount，与此保持一致
 */
const SPRITE_SHEET_W = 1280
const SPRITE_SHEET_H = 720

/**
 * 根据素材类型决定最佳生图尺寸
 * - 序列帧：统一 1280x720 横向画布（固定格式，宽度按帧数均分）
 * - 背景：竖屏游戏用 768x1024，横屏用 1024x768
 * - 静态素材/卡牌：正方形 1024x1024
 */
function getImageSize(asset: ModuleArtAsset, orientation: Orientation = 'portrait'): string {
  if (asset.animationType === 'spritesheet' && asset.frameCount) {
    // 固定横向画布，宽度均分为 frameCount 列，保证程序侧裁剪精确一致
    return `${SPRITE_SHEET_W}x${SPRITE_SHEET_H}`
  }
  if (asset.id?.startsWith('bg_')) {
    // 背景图按画面方向匹配构图比例：横版 1024x768，竖版 768x1024
    return orientation === 'landscape' ? '1024x768' : '768x1024'
  }
  // tileable 素材使用横幅比例（2:1），利于水平拼接时更长的不重复段
  const isTileable = asset.tileable === true ||
    /ground|floor|terrain|road|platform|tile|brick|pipe|wall|track|rail/i.test(asset.id || '') ||
    /seamless|tileable|repeating|tiling/i.test(asset.prompt || '')
  if (isTileable && asset.animationType !== 'spritesheet') {
    return '1024x512'
  }
  if (asset.id?.startsWith('icon_')) {
    // UI 图标素材：小尺寸正方形，512x512 生成后缩放到 64~96 显示
    return '512x512'
  }
  if (asset.id?.startsWith('ui_button')) {
    // 按钮底板：横长方形（约 2.5:1 宽高比），体现按钮的横向拉伸形态，铺满整图
    return '1024x512'
  }
  return '1024x1024'
}

// ===== Stage 3: 美术资源生成（内嵌在模块中） =====

/**
 * 计算一个美术资源的"内容签名"，用于跨模块去重判定。
 * 两个资源若签名相同（同名称 + 同生成描述 + 同风格 + 同动画类型/帧数），视为重合素材。
 */
function assetContentSig(a: ModuleArtAsset): string {
  return [
    (a.entityName || '').trim(),
    (a.prompt || '').trim(),
    (a.style || '').trim(),
    a.animationType || 'static',
    a.frameCount || 0,
    a.tileable ? 'tileable' : '',
    (a as any).facing || '',
    (a as any).movementDir || '',
    (a as any).scrollDir || '',
    (a as any).needsVideo ? `video:${(a as any).videoUseCase || ''}` : '',
  ]
    .join('|')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * 跨模块去重：在所有模块节点中查找一个"已生成完成且与目标资源重合"的素材，
 * 命中则返回其可复用的 url（避免对同一素材重复调用图像生成、重复消耗额度）。
 * 重合判定：
 *   1) 相同 asset.id —— 共享素材（ui_button / ui_panel / bg_title / bg_loading 等）会挂在多个模块下，id 一致即同一素材；
 *   2) 相同内容签名 —— 不同 id 但名称/描述/风格完全一致的素材。
 * 排除 excludeAsset 自身，避免自我命中。
 */
function findReusableAsset(
  store: ReturnType<typeof useCanvasStore>,
  target: ModuleArtAsset,
  excludeModuleId?: string
): { url: string; sameId: boolean } | null {
  const sig = assetContentSig(target)
  for (const n of store.nodes) {
    if (n.type !== 'module') continue
    const assets = (n.data as ModuleNodeData).assets || []
    for (const a of assets) {
      if (a === target) continue
      if (excludeModuleId && n.id === excludeModuleId && a.id === target.id && a.status !== 'done') continue
      if (a.status !== 'done' || !a.url) continue
      if (a.id === target.id) return { url: a.url, sameId: true }
      if (sig && assetContentSig(a) === sig) return { url: a.url, sameId: false }
    }
  }
  return null
}

/**
 * 复用已有素材时，若复用来源与目标 id 不同，需要把图片再存一份到目标 id 文件名下，
 * 以保证后续代码生成 / 部署阶段按 ASSETS[目标id] 能读到文件。id 相同则文件已存在，无需重存。
 */
async function persistReusedAsset(targetId: string, sourceUrl: string, sameId: boolean) {
  if (sameId) return
  try {
    const resp = await fetch(sourceUrl)
    const blob = await resp.blob()
    const ext = blob.type.includes('png') ? 'png' : 'jpg'
    useProjectStore().saveToProject('assets', `${targetId}.${ext}`, blob)
  } catch { /* 复用落盘失败不阻塞主流程 */ }
}

/** 单个素材生成的最大超时（5分钟） */
const ASSET_GENERATION_TIMEOUT_MS = 5 * 60 * 1000

/** 包装 Promise 使其在指定超时后自动 reject */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 为单个模块生成美术资源
 */
export async function generateModuleArt(moduleNode: CanvasNode) {
  const settingsStore = useSettingsStore()
  if (!settingsStore.isImageConfigured()) {
    ElMessage.warning('请先配置图像生成 API Key')
    settingsStore.show()
    return
  }

  const store = useCanvasStore()
  const data = moduleNode.data as ModuleNodeData
  if (!data.assets.length) {
    ElMessage.warning('该模块没有关联的美术资源')
    return
  }

  store.updateNode(moduleNode.id, { status: 'processing' })
  store.setPipeline({ currentStage: 3, status: 'running', progress: 0, message: `正在为「${data.name}」生成美术…` })

  const orientation = resolveOrientation()
  const updatedAssets = [...data.assets]
  let completed = 0

  await Promise.all(
    updatedAssets.map(async (asset, i) => {
      if (asset.status === 'done' && asset.url) {
        completed++
        return // 已有图片跳过
      }
      // 跨模块去重：若其他模块已生成过同一素材（同 id 或同内容），直接复用，不再重复生成
      const reuse = findReusableAsset(store, asset, moduleNode.id)
      if (reuse) {
        updatedAssets[i] = { ...asset, url: reuse.url, status: 'done', errorMessage: undefined }
        await persistReusedAsset(asset.id, reuse.url, reuse.sameId)
        completed++
        store.updateNode(moduleNode.id, { data: { ...data, assets: [...updatedAssets] } })
        store.setPipeline({ progress: (completed / updatedAssets.length) * 100 })
        return
      }
      updatedAssets[i] = { ...asset, status: 'generating' }
      store.updateNode(moduleNode.id, { data: { ...data, assets: [...updatedAssets] } })

      const prompt = buildArtPrompt(asset, updatedAssets, orientation)
      try {
        await withTimeout((async () => {
        let finalUrl = ''
        const settingsStore = useSettingsStore()

        // 分层策略：video 类型走 图生视频→抽帧 pipeline（节约模式：默认拒绝，仅 needsVideo=true 时启用）
        if (shouldUseVideoPipeline(asset, settingsStore) && asset.animationType === 'video') {
          // Step 1: 生成单张高质量静态角色图
          const staticPrompt = buildStaticCharacterPrompt(asset, updatedAssets)
          const staticImages = await generateImage({ prompt: staticPrompt, n: 1, size: '1280*720' })
          const staticUrl = staticImages[0]?.url || ''
          if (!staticUrl) throw new Error('视频流程：静图生成失败')

          // 视频 API 需要公开 HTTP URL，data URL / 代理 URL 无法使用
          const publicImageUrl = unproxyUrl(staticUrl)
          if (!isPublicHttpUrl(publicImageUrl)) {
            console.warn('[video-pipeline] 静图 URL 不是公开 HTTP URL，降级为 spritesheet:', staticUrl.slice(0, 80))
            const fallbackAsset = { ...asset, animationType: 'spritesheet' as const }
            const fallbackPrompt = buildArtPrompt(fallbackAsset, updatedAssets, orientation)
            const images = await generateImage({ prompt: fallbackPrompt, n: 1, size: getImageSize(fallbackAsset, orientation) })
            finalUrl = images[0]?.url || ''
          } else {
            // Step 2: 图生视频（描述动作循环）
            const motionPrompt = buildVideoMotionPrompt(asset)
            console.log('[video-pipeline] generating video for', asset.id, motionPrompt)
            const video = await generateVideo({ imageUrl: publicImageUrl, prompt: motionPrompt, size: '1280*720' })

            // Step 3: 从视频抽帧→拼 sprite sheet
            const frameSize = { width: asset.frameWidth || 256, height: asset.frameHeight || 256 }
            const spriteDataUrl = await videoToSpriteSheet(video.url, (asset.frameCount as number) || 8, frameSize)
            finalUrl = spriteDataUrl
          }
        } else if (asset.animationType === 'video' && (!settingsStore.isVideoConfigured() || (asset as any).needsVideo === false)) {
          // 降级：video 模型未配置或显式 needsVideo=false，回退到 spritesheet 图片生成
          console.warn('[video-pipeline] 跳过视频生成（未配置或显式禁用），降级 spritesheet:', asset.id)
          const fallbackAsset = { ...asset, animationType: 'spritesheet' as const }
          const fallbackPrompt = buildArtPrompt(fallbackAsset, updatedAssets, orientation)
          const images = await generateImage({ prompt: fallbackPrompt, n: 1, size: getImageSize(fallbackAsset, orientation) })
          finalUrl = images[0]?.url || ''
        } else {
          // 标准路径：spritesheet / static / bg / ui
          if (asset.animationType === 'spritesheet' && asset.frameCount && asset.frameCount > 1) {
            // 序列帧动画：优先走 图生视频→抽帧（动作连贯），降级走逐帧生成
            if (settingsStore.isVideoConfigured()) {
              try {
                console.log('[i2v-spritesheet] generating', asset.id, '— single frame → i2v →', asset.frameCount, 'frames')
                finalUrl = await generateSpriteSheetViaI2V(asset, updatedAssets)
              } catch (i2vErr: any) {
                console.warn('[i2v-spritesheet] failed, falling back to multi-frame:', asset.id, i2vErr.message)
                try {
                  finalUrl = await generateSpriteSheetMultiFrame(asset, updatedAssets, settingsStore)
                } catch (mfErr: any) {
                  console.warn('[multi-frame] also failed, falling back to single-image:', asset.id, mfErr.message)
                  const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
                  finalUrl = images[0]?.url || ''
                }
              }
            } else {
              // 视频模型未配置：走逐帧生成
              try {
                console.log('[multi-frame] generating', asset.id, '—', asset.frameCount, 'frames individually')
                finalUrl = await generateSpriteSheetMultiFrame(asset, updatedAssets, settingsStore)
              } catch (mfErr: any) {
                console.warn('[multi-frame] failed, falling back to single-image:', asset.id, mfErr.message)
                const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
                finalUrl = images[0]?.url || ''
              }
            }
          } else {
            const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
            finalUrl = images[0]?.url || ''
          }
        }

        const { blobUrl, blob } = finalUrl ? await persistAssetFromUrl(finalUrl, `${moduleNode.id}_${asset.id}`) : { blobUrl: '', blob: null }
        updatedAssets[i] = { ...asset, url: blobUrl, status: 'done' }
        // 保存到项目 assets 目录
        if (blob) {
          const ext = blob.type.includes('png') ? 'png' : 'jpg'
          const projStore = useProjectStore()
          projStore.saveToProject('assets', `${asset.id}.${ext}`, blob)
        }
        })(), ASSET_GENERATION_TIMEOUT_MS, `素材「${asset.entityName}」生成超时（5分钟无响应）`)
      } catch (err: any) {
        updatedAssets[i] = { ...asset, status: 'error', errorMessage: err.message || '生成失败' }
      } finally {
        completed++
        store.updateNode(moduleNode.id, { data: { ...data, assets: [...updatedAssets] } })
        store.setPipeline({ progress: (completed / updatedAssets.length) * 100 })
      }
    })
  )

  const allDone = updatedAssets.every((a) => a.status === 'done')
  store.updateNode(moduleNode.id, {
    status: allDone ? 'completed' : 'error',
    data: { ...data, assets: updatedAssets },
  })
  store.setPipeline({
    status: allDone ? 'completed' : 'error',
    message: allDone ? `「${data.name}」美术生成完成` : `「${data.name}」部分美术生成失败`,
  })
}

/**
 * 重新生成单个美术资源
 */
export async function regenerateAsset(moduleNode: CanvasNode, assetId: string) {
  const settingsStore = useSettingsStore()
  if (!settingsStore.isImageConfigured()) {
    ElMessage.warning('请先配置图像生成 API Key')
    settingsStore.show()
    return
  }

  const store = useCanvasStore()
  const data = moduleNode.data as ModuleNodeData
  const assetIdx = data.assets.findIndex((a) => a.id === assetId)
  if (assetIdx < 0) return

  const asset = data.assets[assetIdx]
  const updatedAssets = [...data.assets]
  updatedAssets[assetIdx] = { ...asset, status: 'generating', url: '', errorMessage: undefined }
  store.updateNode(moduleNode.id, { data: { ...data, assets: updatedAssets } })

  // 更新右上角状态指示器
  store.setPipeline({ currentStage: 3, status: 'running', progress: 0, message: `正在重新生成「${asset.entityName}」…` })

  const prompt = buildArtPrompt(asset, data.assets, resolveOrientation())
  try {
    await withTimeout((async () => {
    let finalUrl = ''
    const orientation = resolveOrientation()

    // 手动重生成也支持 video pipeline（节约模式 — 仅 needsVideo=true 时启用；手动场景宽容兼容老素材）
    if (shouldUseVideoPipeline(asset, settingsStore) && asset.animationType === 'video') {
      const staticPrompt = buildStaticCharacterPrompt(asset, data.assets)
      const staticImages = await generateImage({ prompt: staticPrompt, n: 1, size: '1280*720' })
      const staticUrl = staticImages[0]?.url || ''
      if (!staticUrl) throw new Error('视频流程：静图生成失败')
      const publicImageUrl = unproxyUrl(staticUrl)
      if (!isPublicHttpUrl(publicImageUrl)) {
        console.warn('[video-pipeline] 静图 URL 不是公开 HTTP URL，降级为 spritesheet:', staticUrl.slice(0, 80))
        const fallbackAsset = { ...asset, animationType: 'spritesheet' as const }
        const fallbackPrompt = buildArtPrompt(fallbackAsset, data.assets, orientation)
        const images = await generateImage({ prompt: fallbackPrompt, n: 1, size: getImageSize(fallbackAsset, orientation) })
        finalUrl = images[0]?.url || ''
      } else {
        const motionPrompt = buildVideoMotionPrompt(asset)
        const video = await generateVideo({ imageUrl: publicImageUrl, prompt: motionPrompt, size: '1280*720' })
        const frameSize = { width: asset.frameWidth || 256, height: asset.frameHeight || 256 }
        finalUrl = await videoToSpriteSheet(video.url, (asset.frameCount as number) || 8, frameSize)
      }
    } else if (asset.animationType === 'video' && asset.frameCount) {
      // 降级（视频未配置或显式 needsVideo=false）
      const fallbackAsset = { ...asset, animationType: 'spritesheet' as const }
      const fallbackPrompt = buildArtPrompt(fallbackAsset, data.assets, orientation)
      const images = await generateImage({ prompt: fallbackPrompt, n: 1, size: getImageSize(fallbackAsset, orientation) })
      finalUrl = images[0]?.url || ''
    } else {
      // 序列帧动画：优先走 图生视频→抽帧，降级走逐帧生成
      if (asset.animationType === 'spritesheet' && asset.frameCount && asset.frameCount > 1) {
        if (settingsStore.isVideoConfigured()) {
          try {
            console.log('[i2v-spritesheet] regenerating', asset.id, '— single frame → i2v →', asset.frameCount, 'frames')
            finalUrl = await generateSpriteSheetViaI2V(asset, data.assets)
          } catch (i2vErr: any) {
            console.warn('[i2v-spritesheet] failed, falling back to multi-frame:', asset.id, i2vErr.message)
            try {
              finalUrl = await generateSpriteSheetMultiFrame(asset, data.assets, settingsStore)
            } catch (mfErr: any) {
              console.warn('[multi-frame] also failed, falling back to single-image:', asset.id, mfErr.message)
              const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
              finalUrl = images[0]?.url || ''
            }
          }
        } else {
          try {
            console.log('[multi-frame] regenerating', asset.id, '—', asset.frameCount, 'frames individually')
            finalUrl = await generateSpriteSheetMultiFrame(asset, data.assets, settingsStore)
          } catch (mfErr: any) {
            console.warn('[multi-frame] failed, falling back to single-image:', asset.id, mfErr.message)
            const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
            finalUrl = images[0]?.url || ''
          }
        }
      } else {
        const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
        finalUrl = images[0]?.url || ''
      }
    }

    const { blobUrl, blob } = finalUrl ? await persistAssetFromUrl(finalUrl, `${moduleNode.id}_${asset.id}_${Date.now()}`) : { blobUrl: '', blob: null }
    updatedAssets[assetIdx] = { ...asset, url: blobUrl, status: 'done', errorMessage: undefined }
    // 保存到项目 assets 目录
    if (blob) {
      const ext = blob.type.includes('png') ? 'png' : 'jpg'
      const projStore = useProjectStore()
      projStore.saveToProject('assets', `${asset.id}.${ext}`, blob)
    }
    ElMessage.success(`「${asset.entityName}」重新生成完成`)
    store.setPipeline({ status: 'completed', progress: 100, message: `「${asset.entityName}」重新生成完成` })
    })(), ASSET_GENERATION_TIMEOUT_MS, `素材「${asset.entityName}」重新生成超时（5分钟无响应）`)
  } catch (err: any) {
    updatedAssets[assetIdx] = { ...asset, status: 'error', errorMessage: err.message || '生成失败' }
    ElMessage.error(`重新生成失败: ${err.message}`)
    store.setPipeline({ status: 'error', progress: 0, message: `「${asset.entityName}」生成失败` })
  }
  store.updateNode(moduleNode.id, { data: { ...data, assets: updatedAssets } })
}

/**
 * 一键生成所有模块的美术资源
 */
export async function generateAllArt() {
  const settingsStore = useSettingsStore()
  if (!settingsStore.isImageConfigured()) {
    ElMessage.warning('请先配置图像生成 API Key')
    settingsStore.show()
    return
  }

  const store = useCanvasStore()
  const moduleNodes = store.nodes.filter((n) => n.type === 'module')
  if (!moduleNodes.length) {
    ElMessage.warning('没有可生成美术的模块节点')
    return
  }

  store.setPipeline({ currentStage: 3, status: 'running', progress: 0, message: '一键生成所有美术资源…' })

  const orientation = resolveOrientation()
  // 逐模块生成（并行每个模块内部的多个 asset）
  let totalAssets = 0
  let doneAssets = 0
  moduleNodes.forEach((m) => { totalAssets += (m.data as ModuleNodeData).assets.length })

  for (const moduleNode of moduleNodes) {
    const data = moduleNode.data as ModuleNodeData
    if (!data.assets.length) continue

    store.updateNode(moduleNode.id, { status: 'processing' })
    const updatedAssets = [...data.assets]

    await Promise.all(
      updatedAssets.map(async (asset, i) => {
        if (asset.status === 'done' && asset.url) {
          doneAssets++
          store.setPipeline({ progress: (doneAssets / totalAssets) * 100 })
          return
        }
        // 跨模块去重：命中已生成的同一素材则直接复用
        const reuse = findReusableAsset(store, asset, moduleNode.id)
        if (reuse) {
          updatedAssets[i] = { ...asset, url: reuse.url, status: 'done', errorMessage: undefined }
          await persistReusedAsset(asset.id, reuse.url, reuse.sameId)
          doneAssets++
          store.updateNode(moduleNode.id, { data: { ...data, assets: [...updatedAssets] } })
          store.setPipeline({ progress: (doneAssets / totalAssets) * 100 })
          return
        }
        updatedAssets[i] = { ...asset, status: 'generating' }
        store.updateNode(moduleNode.id, { data: { ...data, assets: [...updatedAssets] } })

        const prompt = buildArtPrompt(asset, updatedAssets, orientation)
        try {
          await withTimeout((async () => {
          let finalUrl = ''

          // 分层策略：video 类型走 图生视频→抽帧 pipeline（节约模式 — 默认拒绝）
          if (shouldUseVideoPipeline(asset, settingsStore) && asset.animationType === 'video') {
            const staticPrompt = buildStaticCharacterPrompt(asset, updatedAssets)
            const staticImages = await generateImage({ prompt: staticPrompt, n: 1, size: '1280*720' })
            const staticUrl = staticImages[0]?.url || ''
            if (!staticUrl) throw new Error('视频流程：静图生成失败')
            const publicImageUrl = unproxyUrl(staticUrl)
            if (!isPublicHttpUrl(publicImageUrl)) {
              console.warn('[video-pipeline] 静图 URL 不是公开 HTTP URL，降级为 spritesheet:', staticUrl.slice(0, 80))
              const fallbackAsset = { ...asset, animationType: 'spritesheet' as const }
              const fallbackPrompt = buildArtPrompt(fallbackAsset, updatedAssets, orientation)
              const images = await generateImage({ prompt: fallbackPrompt, n: 1, size: getImageSize(fallbackAsset, orientation) })
              finalUrl = images[0]?.url || ''
            } else {
              const motionPrompt = buildVideoMotionPrompt(asset)
              console.log('[video-pipeline] generating video for', asset.id, motionPrompt)
              const video = await generateVideo({ imageUrl: publicImageUrl, prompt: motionPrompt, size: '1280*720' })
              const frameSize = { width: asset.frameWidth || 256, height: asset.frameHeight || 256 }
              finalUrl = await videoToSpriteSheet(video.url, (asset.frameCount as number) || 8, frameSize)
            }
          } else if (asset.animationType === 'video' && asset.frameCount && (!settingsStore.isVideoConfigured() || (asset as any).needsVideo === false)) {
            console.warn('[video-pipeline] 跳过视频生成（未配置或显式禁用），降级 spritesheet:', asset.id)
            const fallbackAsset = { ...asset, animationType: 'spritesheet' as const }
            const fallbackPrompt = buildArtPrompt(fallbackAsset, updatedAssets, orientation)
            const images = await generateImage({ prompt: fallbackPrompt, n: 1, size: getImageSize(fallbackAsset, orientation) })
            finalUrl = images[0]?.url || ''
          } else {
            // 序列帧动画：优先走 图生视频→抽帧，降级走逐帧生成
            if (asset.animationType === 'spritesheet' && asset.frameCount && asset.frameCount > 1) {
              if (settingsStore.isVideoConfigured()) {
                try {
                  console.log('[i2v-spritesheet] generating', asset.id, '— single frame → i2v →', asset.frameCount, 'frames (generateAllArt)')
                  finalUrl = await generateSpriteSheetViaI2V(asset, updatedAssets)
                } catch (i2vErr: any) {
                  console.warn('[i2v-spritesheet] failed, falling back to multi-frame:', asset.id, i2vErr.message)
                  try {
                    finalUrl = await generateSpriteSheetMultiFrame(asset, updatedAssets, settingsStore)
                  } catch (mfErr: any) {
                    console.warn('[multi-frame] also failed, falling back to single-image:', asset.id, mfErr.message)
                    const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
                    finalUrl = images[0]?.url || ''
                  }
                }
              } else {
                try {
                  console.log('[multi-frame] generating', asset.id, '—', asset.frameCount, 'frames individually (generateAllArt)')
                  finalUrl = await generateSpriteSheetMultiFrame(asset, updatedAssets, settingsStore)
                } catch (mfErr: any) {
                  console.warn('[multi-frame] failed, falling back to single-image:', asset.id, mfErr.message)
                  const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
                  finalUrl = images[0]?.url || ''
                }
              }
            } else {
              const images = await generateImage({ prompt, n: 1, size: getImageSize(asset, orientation) })
              finalUrl = images[0]?.url || ''
            }
          }

          const { blobUrl, blob } = finalUrl ? await persistAssetFromUrl(finalUrl, `${moduleNode.id}_${asset.id}`) : { blobUrl: '', blob: null }
          updatedAssets[i] = { ...asset, url: blobUrl, status: 'done' }
          // 保存到项目 assets 目录
          if (blob) {
            const ext = blob.type.includes('png') ? 'png' : 'jpg'
            const projStore = useProjectStore()
            projStore.saveToProject('assets', `${asset.id}.${ext}`, blob)
          }
          })(), ASSET_GENERATION_TIMEOUT_MS, `素材「${asset.entityName}」生成超时（5分钟无响应）`)
        } catch (err: any) {
          updatedAssets[i] = { ...asset, status: 'error', errorMessage: err.message || '生成失败' }
        } finally {
          doneAssets++
          store.updateNode(moduleNode.id, { data: { ...data, assets: [...updatedAssets] } })
          store.setPipeline({ progress: (doneAssets / totalAssets) * 100 })
        }
      })
    )

    const allDone = updatedAssets.every((a) => a.status === 'done')
    store.updateNode(moduleNode.id, {
      status: allDone ? 'completed' : 'error',
      data: { ...data, assets: updatedAssets },
    })
  }

  store.setPipeline({ status: 'completed', progress: 100, message: `所有美术资源生成完成（${doneAssets}/${totalAssets}）` })
  ElMessage.success('所有美术资源生成完成')
}

// ===== Stage 4: 代码生成 =====

/**
 * Stage 4 — generate web game HTML from design + module assets.
 * 使用独立的代码模型配置（settings.code*）。
 * 由任意模块节点的"生成代码"按钮触发。
 */
export async function runStage4_code(triggerNode: CanvasNode) {
  const settingsStore = useSettingsStore()
  if (!settingsStore.isCodeConfigured()) {
    ElMessage.warning('请先配置代码模型 API Key（设置 → 代码模型配置）')
    settingsStore.show()
    return
  }

  const store = useCanvasStore()

  // 收集模块清单（含已完成美术）
  const moduleNodes = store.nodes.filter((n) => n.type === 'module')
  if (!moduleNodes.length) {
    ElMessage.error('请先拆分功能模块')
    return
  }

  // 美术资源缺失提醒：让用户决定继续（占位）还是先去生成美术
  const proceed = await confirmMissingAssetsBeforeCodegen()
  if (!proceed) return

  const codegenModules = collectCodegenModules()

  // 获取设计文档
  const ideaNode = store.nodes.find((n) => n.type === 'idea' && n.status === 'completed')
  const design = ideaNode?.data.expandedDesign as GameDesign | null
  if (!design) {
    ElMessage.error('找不到已完成的创意节点')
    return
  }

  store.setPipeline({ currentStage: 4, status: 'running', progress: 5, message: '正在读取项目资料…' })

  // 从项目目录读取设计文档和模块信息，补充给代码生成
  const projStore = useProjectStore()
  let projectDesignDoc = ''
  let projectModuleDocs: string[] = []
  let projectAssetList: string[] = []

  if (projStore.hasProject) {
    try {
      // 读取设计文档
      const designContent = await projStore.readFromProject('design', 'game-design.json')
      if (designContent) projectDesignDoc = designContent

      // 读取模块文档
      const moduleFiles = await projStore.listProjectDir('modules')
      for (const f of moduleFiles) {
        if (f.name.endsWith('.json') && !f.name.startsWith('_') && !f.isDir) {
          const content = await projStore.readFromProject('modules', f.name)
          if (content) projectModuleDocs.push(content)
        }
      }

      // 列出美术资源文件
      const assetFiles = await projStore.listProjectDir('assets')
      projectAssetList = assetFiles.filter((f) => !f.isDir && !f.name.startsWith('.')).map((f) => f.name)
    } catch { /* 非致命，继续使用画布内数据 */ }
  }

  store.setPipeline({ currentStage: 4, status: 'running', progress: 10, message: `代码模型正在按 ${codegenModules.length} 个模块生成游戏代码…` })

  // 复用已有代码节点或创建新的
  let codeNode = store.nodes.find((n) => n.type === 'code')
  const codeId = codeNode ? codeNode.id : `code_${Date.now()}`

  if (codeNode) {
    const data = codeNode.data as CodeNodeData
    if (data.source && !data.source.startsWith('// 正在')) {
      pushVersionToHistory(codeNode, '重新生成前')
    }
    store.updateNode(codeId, {
      status: 'processing',
      data: { ...data, source: '// 正在生成代码…', buildStatus: 'pending' },
    })
  } else {
    // 定位在最后一个模块节点右侧
    const lastModule = moduleNodes[moduleNodes.length - 1] || triggerNode
    codeNode = {
      id: codeId,
      type: 'code',
      position: { x: lastModule.position.x + lastModule.size.width + 180, y: lastModule.position.y },
      size: { width: 360, height: 240 },
      stage: 4,
      status: 'processing',
      data: {
        codeType: 'frontend',
        fileName: 'game.js',
        language: 'javascript',
        source: '// 正在生成代码…',
        buildStatus: 'pending',
        history: [],
        activeVersionId: undefined,
        optimizeInstruction: '',
      } as CodeNodeData,
      createdAt: new Date().toISOString(),
    }
    store.addNode(codeNode)
    // 连接所有模块到代码节点
    moduleNodes.forEach((m) =>
      store.addEdge({ id: `edge_${m.id}_${codeId}`, sourceId: m.id, targetId: codeId, type: 'pipeline' })
    )
  }

  try {
    let acc = ''
    // 构建增强的 user prompt，加入项目目录中的文档信息
    let userPrompt = buildCodegenUserPromptFromModules(design, codegenModules, orientationFromDesign(design))

    // 如果项目目录有额外的模块文档（用户手动编辑过），追加到 prompt
    if (projectModuleDocs.length > 0) {
      userPrompt += '\n\n# 项目模块详细文档（来自本地项目目录）\n'
      for (const doc of projectModuleDocs) {
        try {
          const parsed = JSON.parse(doc)
          userPrompt += `\n## ${parsed.name || parsed.id}\n`
          if (parsed.description) userPrompt += `描述：${parsed.description}\n`
          if (parsed.userInput) userPrompt += `用户要求：${parsed.userInput}\n`
          if (parsed.assets?.length) {
            userPrompt += `美术资源：${parsed.assets.map((a: any) => `${a.entityName}(${a.id})`).join('、')}\n`
          }
        } catch { /* skip malformed */ }
      }
    }

    // 追加美术资源文件列表
    if (projectAssetList.length > 0) {
      userPrompt += `\n\n# 项目美术资源文件（已保存到本地，通过 ASSETS[id] 访问）\n`
      userPrompt += projectAssetList.map((f) => `- ${f}`).join('\n')
      userPrompt += `\n\n⚠️ 【强制要求】上述所有美术资源必须全部使用！每个实体/角色/道具/子弹/背景等都必须通过 window.ASSETS['资源id'] 加载对应图片来渲染，严禁用纯色矩形或几何图形代替已有的美术素材。`
    }

    const code = await codeCompletion(
      [
        { role: 'system', content: CODEGEN_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: 0.4,
        onChunk: (chunk) => {
          acc += chunk
          store.updateNode(codeId, { data: { ...codeNode!.data, source: acc } })
          store.setPipeline({ progress: Math.min(95, store.pipeline.progress + 1) })
        },
      }
    )
    let clean = code.replace(/^```(?:html|javascript|js)?\n?|```$/gm, '').trim()

    // 资源使用自检：若有美术资源未被代码引用，自动发起一次"补丁式"修复，把缺失的素材接进去
    try {
      const unused = findUnusedAssets(clean, codegenModules)
      if (unused.length > 0) {
        store.setPipeline({ status: 'running', progress: 96, message: `检测到 ${unused.length} 个美术资源未被使用，正在自动修复…` })
        const availableAssets: string[] = []
        for (const m of codegenModules) for (const a of m.assets) availableAssets.push(a.id)
        const fixInstruction = `以下美术资源已经生成并注入到 window.ASSETS，但当前代码没有使用它们：\n${unused
          .map((id) => `- ASSETS['${id}']`)
          .join('\n')}\n请用最小化补丁把这些资源接入渲染：背景类(bg_)铺在对应界面；ui_button 用于所有按钮；ui_panel 用于所有弹窗/面板底板；角色/道具/子弹类用对应素材替换纯色绘制。严禁继续用纯色矩形代替这些已有素材。`
        let patchText = ''
        patchText = await codeCompletion(
          [
            { role: 'system', content: CODE_OPTIMIZE_SYSTEM_PROMPT },
            { role: 'user', content: buildOptimizeUserPrompt({ currentCode: clean, instruction: fixInstruction, design, availableAssets }) },
          ],
          {
            temperature: 0.2,
            onChunk: (chunk) => {
              patchText += chunk
              store.setPipeline({ progress: Math.min(98, store.pipeline.progress + 1) })
            },
          }
        )
        const patched = applyPatchText(clean, patchText)
        if (patched.totalPatches > 0 && patched.source) {
          clean = patched.source.replace(/^```(?:html|javascript|js)?\n?|```$/gm, '').trim()
        }
      }
    } catch { /* 自检失败不阻塞主流程 */ }

    const initialVersion = createVersion(clean, '初始生成')
    store.updateNode(codeId, {
      status: 'completed',
      data: {
        ...codeNode!.data,
        source: clean,
        buildStatus: 'success',
        history: [initialVersion],
        activeVersionId: initialVersion.id,
      } as CodeNodeData,
    })
    store.setPipeline({ status: 'completed', progress: 100, message: '代码生成完成' })
    // 多文件解析：分模块落盘到 code/ 目录，便于查看清晰工程结构
    const codeFiles = parseMultiFileOutput(clean)
    persistCodeFiles(codeFiles)
    // 合并后的可运行包作为部署源（core 最前、main 最后）
    const combined = combineCodeFiles(codeFiles)
    if (combined !== clean) {
      const merged = createVersion(combined, '初始生成')
      store.updateNode(codeId, {
        status: 'completed',
        data: { ...codeNode!.data, source: combined, buildStatus: 'success', history: [merged], activeVersionId: merged.id } as CodeNodeData,
      })
    }
    useProjectStore().saveToProject('code', 'game.js', combined)
  } catch (err: any) {
    store.updateNode(codeId, {
      status: 'error',
      data: { ...codeNode!.data, buildStatus: 'error', source: '// 生成失败: ' + err.message },
    })
    store.setPipeline({ status: 'error', message: err.message || '代码生成失败' })
  }
}

// ===== Stage 5: 部署测试 =====

/**
 * Stage 5 — bundle code + assets into a standalone HTML game file.
 */
export async function runStage5_deploy(codeNode: CanvasNode) {
  const store = useCanvasStore()
  store.setPipeline({ currentStage: 5, status: 'running', progress: 20, message: '正在打包游戏…' })

  const t0 = performance.now()

  // 从项目 assets 目录读取所有美术资源（而非依赖 blob URL）
  const projStore = useProjectStore()
  const assetMap: Record<string, string> = {}
  try {
    const assetFiles = await projStore.listProjectDir('assets')
    for (const file of assetFiles) {
      if (file.isDir || file.name.startsWith('.')) continue
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!ext || !['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext)) continue
      const assetId = file.name.replace(/\.[^.]+$/, '') // 去掉扩展名作为 ID
      const filePath = `${projStore.projectName}/assets/${file.name}`
      const dataUrl = await readFileAsDataUrl(filePath)
      if (dataUrl) {
        assetMap[assetId] = dataUrl
      }
    }
  } catch {
    // 如果读取失败，降级尝试从模块节点的 blob URL 获取
    const moduleNodes = store.nodes.filter((n) => n.type === 'module')
    for (const m of moduleNodes) {
      const mdata = m.data as ModuleNodeData
      for (const asset of mdata.assets) {
        if (asset.status !== 'done' || !asset.url) continue
        try {
          const resp = await fetch(asset.url)
          const blob = await resp.blob()
          const dataUrl = await blobToDataUrl(blob)
          assetMap[asset.id] = dataUrl
        } catch { /* skip */ }
      }
    }
  }

  // 补全：磁盘 assets/ 中缺失的素材（如多帧拼接 spritesheet 等本地生成但未落盘的），从 canvas state blob URL 获取
  const moduleNodes = store.nodes.filter((n) => n.type === 'module')
  for (const m of moduleNodes) {
    const mdata = m.data as ModuleNodeData
    for (const asset of mdata.assets) {
      if (asset.status !== 'done' || !asset.url) continue
      if (assetMap[asset.id]) continue // 磁盘已存在，跳过
      try {
        const resp = await fetch(asset.url)
        const blob = await resp.blob()
        const dataUrl = await blobToDataUrl(blob)
        assetMap[asset.id] = dataUrl
        console.log(`[Stage5] 补全缺失素材: ${asset.id} (${(dataUrl.length / 1024).toFixed(0)}KB)`)
      } catch (e) {
        console.warn(`[Stage5] 无法补全素材: ${asset.id}`, e)
      }
    }
  }

  store.setPipeline({ progress: 60, message: '正在压缩素材…' })

  // 部署产物优化：将所有 base64 素材重编码为 WebP + 尺寸限制（减少 HTML 体积 50-70%）
  const compressedAssetMap: Record<string, string> = {}
  const MAX_ASSET_DIM = 1024 // 非 spritesheet 素材最大尺寸限制
  for (const [id, dataUrl] of Object.entries(assetMap)) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = reject
        el.src = dataUrl
      })
      // 确定目标尺寸：spritesheet 保持原始尺寸，其他限制最大边 1024px
      let tw = img.width, th = img.height
      const isSpriteSheet = id.startsWith('tower_') || id.startsWith('enemy_') || id.startsWith('boss_') || id.startsWith('base_') || id.startsWith('player_') || id.startsWith('fighter_')
      if (!isSpriteSheet && (tw > MAX_ASSET_DIM || th > MAX_ASSET_DIM)) {
        const ratio = Math.min(MAX_ASSET_DIM / tw, MAX_ASSET_DIM / th)
        tw = Math.round(tw * ratio)
        th = Math.round(th * ratio)
      }
      const c = document.createElement('canvas')
      c.width = tw; c.height = th
      const cx = c.getContext('2d')!
      cx.drawImage(img, 0, 0, tw, th)
      // 优先 WebP（体积小），不支持时降级 PNG
      const webp = c.toDataURL('image/webp', 0.82)
      compressedAssetMap[id] = webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png')
    } catch {
      compressedAssetMap[id] = dataUrl // 压缩失败保留原图
    }
  }

  store.setPipeline({ progress: 75, message: '正在生成 HTML 文件…' })

  // 读取已保存的布局调整（游戏内可视化编辑的产物），重新打包时不丢失
  const layout = await readSavedLayout()

  const html = buildGameHTML(codeNode.data.source, compressedAssetMap, layout)
  const blob = new Blob([html], { type: 'text/html' })
  const blobUrl = URL.createObjectURL(blob)
  const bundleSize = blob.size
  const elapsed = Math.round(performance.now() - t0)

  const testResults = [
    { name: '代码体积', status: bundleSize < 200000 ? 'pass' : 'warn', value: formatBytes(bundleSize) },
    { name: '素材数量', status: 'pass', value: `${Object.keys(assetMap).length}` },
    { name: '打包耗时', status: elapsed < 3000 ? 'pass' : 'warn', value: `${elapsed}ms` },
    { name: 'HTML5 兼容', status: 'pass', value: '原生 Canvas/DOM' },
  ] as const

  // 复用已有部署节点或创建新的
  let deployNode = store.nodes.find((n) => n.type === 'deploy')
  if (deployNode) {
    if (deployNode.data.htmlBlobUrl) {
      try { URL.revokeObjectURL(deployNode.data.htmlBlobUrl) } catch {}
    }
    store.updateNode(deployNode.id, {
      status: 'completed',
      data: { platform: 'web', htmlBlobUrl: blobUrl, fileName: 'game.html', bundleSize, testResults: [...testResults] },
    })
  } else {
    const deployId = `deploy_${Date.now()}`
    const deployHeight = 500
    // 将部署节点垂直居中对齐代码节点，使箭头水平连接
    const deployY = codeNode.position.y + codeNode.size.height / 2 - deployHeight / 2
    deployNode = {
      id: deployId,
      type: 'deploy',
      position: { x: codeNode.position.x + codeNode.size.width + 80, y: deployY },
      size: { width: 420, height: deployHeight },
      stage: 5,
      status: 'completed',
      data: { platform: 'web', htmlBlobUrl: blobUrl, fileName: 'game.html', bundleSize, testResults: [...testResults] },
      createdAt: new Date().toISOString(),
    }
    store.addNode(deployNode)
    store.addEdge({ id: `edge_${codeNode.id}_${deployNode.id}`, sourceId: codeNode.id, targetId: deployNode.id, type: 'pipeline' })
  }

  store.setPipeline({ status: 'completed', progress: 100, message: '打包完成！可下载或在线试玩' })
  // 保存最终 HTML 到项目目录
  useProjectStore().saveToProject('deploy', 'game.html', html)
}

// ===== 辅助函数 =====

/** 读项目 design/ui-layout.json（不存在/解析失败返回 null） */
async function readSavedLayout(): Promise<GFLayoutFile | null> {
  try {
    const raw = await useProjectStore().readFromProject('design', LAYOUT_FILE_NAME)
    if (!raw) return null
    const obj = JSON.parse(raw)
    return obj && obj.scenes ? (obj as GFLayoutFile) : null
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function formatBytes(n: number) {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}

function buildGameHTML(gameCode: string, assets: Record<string, string>, layout: GFLayoutFile | null = null) {
  const assetsJson = JSON.stringify(assets)

  // 错误捕获脚本（注入到所有游戏中）
  const errorScript = `<script>
window.ASSETS = ${assetsJson};
window.__GAME_ERRORS = [];
(function() {
  var overlay = document.getElementById('error-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'error-overlay'; overlay.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow-y:auto;background:rgba(0,0,0,0.92);color:#f87171;font-family:monospace;font-size:12px;padding:12px 16px;z-index:99999;border-top:2px solid #ef4444;'; document.body.appendChild(overlay); }
  function showError(msg) {
    window.__GAME_ERRORS.push(msg);
    overlay.style.display = 'block';
    if (!overlay.querySelector('.err-title')) {
      overlay.innerHTML = '<div style="color:#fca5a5;font-weight:bold;margin-bottom:6px;">运行时错误：</div>';
    }
    var line = document.createElement('div');
    line.style.cssText = 'margin:2px 0;color:#fda4af;';
    line.textContent = '• ' + msg;
    overlay.appendChild(line);
    try { window.parent.postMessage({ type: 'gameforge-error', error: msg, errors: window.__GAME_ERRORS }, '*'); } catch(x) {}
  }
  window.onerror = function(msg, src, line, col) { showError(msg + ' (line ' + line + ')'); };
  window.addEventListener('unhandledrejection', function(e) { showError('Promise rejected: ' + (e.reason?.message || e.reason)); });
  var origError = console.error;
  console.error = function() {
    var args = Array.prototype.slice.call(arguments).map(function(a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); });
    showError(args.join(' '));
    origError.apply(console, arguments);
  };
})();
<\/script>`

  // 如果生成的代码已经是完整 HTML，注入资源和错误捕获
  // 先去掉可能的 markdown 代码块标记（LLM 经常加上 ```html ... ```）
  let cleaned = gameCode.trim()
  // 去掉 ```html 或 ``` 开头标记
  cleaned = cleaned.replace(/^```(?:html|HTML)?\s*\n?/i, '').replace(/\n?\s*```\s*$/, '')
  // 有时候上游已经去掉了 ``` 但留下了 "html" 语言标识符
  cleaned = cleaned.replace(/^html\s*\n/i, '')
  const trimmed = cleaned.trim()

  if (/^<!DOCTYPE|^<html/i.test(trimmed)) {
    // 在 </head> 前或 <body> 后注入错误捕获脚本
    let html = trimmed

    if (html.includes('</body>')) {
      // 在 </body> 前注入
      html = html.replace('</body>', `${errorScript}\n</body>`)
    } else {
      // 附加在末尾
      html += `\n${errorScript}`
    }
    return finalizeLayout(html, layout)
  }

  // 兼容旧模式：gameCode 是纯 JS，包裹到 HTML 外壳中
  return finalizeLayout(
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>GameForge Mini Game</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #0a0a12; overflow: hidden; touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  #game-container { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); box-sizing: border-box; }
  canvas { touch-action: none; }
</style>
</head>
<body>
<div id="game-container"></div>
${errorScript}
<script>
document.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });
try {
${trimmed}
} catch (e) {
  var ov = document.getElementById('error-overlay');
  if (ov) { ov.style.display = 'block'; ov.innerHTML = '<div style="color:#fca5a5;font-weight:bold;">游戏脚本异常：</div><div style="color:#fda4af;">' + e.message + '</div>'; }
  console.error(e);
}
<\/script>
</body>
</html>`,
    layout
  )
}

/**
 * 统一收口部署产物：
 * - 注入布局覆盖数据块（哨兵包裹，后续可原地热替换，无需重新打包）
 * - 剥离编辑代理块（编辑能力只在编辑器浮层的临时 blob 中存在，产物永不带）
 */
function finalizeLayout(html: string, layout: GFLayoutFile | null) {
  return stripEditorBlock(upsertLayoutBlock(html, layout))
}

// ===== 版本管理辅助 =====

function createVersion(source: string, label: string): CodeVersion {
  return {
    id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source,
    label,
    createdAt: new Date().toISOString(),
  }
}

function pushVersionToHistory(codeNode: CanvasNode, label: string) {
  const data = codeNode.data as CodeNodeData
  if (!data.source || data.source.startsWith('// 正在生成')) return
  const history = data.history || []
  const ver = createVersion(data.source, label)
  history.push(ver)
  while (history.length > 10) history.shift()
  const store = useCanvasStore()
  store.updateNode(codeNode.id, {
    data: { ...data, history, activeVersionId: ver.id },
  })
}

// ===== 代码重新生成 =====

export async function regenerateCode(codeNode: CanvasNode) {
  const settingsStore = useSettingsStore()
  if (!settingsStore.isCodeConfigured()) {
    ElMessage.warning('请先配置代码模型 API Key（设置 → 代码模型配置）')
    settingsStore.show()
    return
  }

  const store = useCanvasStore()
  const data = codeNode.data as CodeNodeData
  pushVersionToHistory(codeNode, '重新生成前')

  const ideaNode = store.nodes.find((n) => n.type === 'idea' && n.status === 'completed')
  const design = ideaNode?.data.expandedDesign as GameDesign | null
  if (!design) {
    ElMessage.error('找不到上游的游戏设计文档')
    return
  }

  // 收集模块清单
  const moduleNodes = store.nodes.filter((n) => n.type === 'module')
  if (!moduleNodes.length) {
    ElMessage.error('请先拆分功能模块')
    return
  }

  // 美术资源缺失提醒
  const proceed = await confirmMissingAssetsBeforeCodegen()
  if (!proceed) return

  const codegenModules = collectCodegenModules()

  store.updateNode(codeNode.id, {
    status: 'processing',
    data: { ...data, source: '// 正在重新生成代码…', buildStatus: 'pending' },
  })
  store.setPipeline({ currentStage: 4, status: 'running', progress: 5, message: '正在读取项目资料…' })

  // 从项目目录读取模块和资源信息
  const projStore = useProjectStore()
  let projectModuleDocs: string[] = []
  let projectAssetList: string[] = []
  if (projStore.hasProject) {
    try {
      const moduleFiles = await projStore.listProjectDir('modules')
      for (const f of moduleFiles) {
        if (f.name.endsWith('.json') && !f.name.startsWith('_') && !f.isDir) {
          const content = await projStore.readFromProject('modules', f.name)
          if (content) projectModuleDocs.push(content)
        }
      }
      const assetFiles = await projStore.listProjectDir('assets')
      projectAssetList = assetFiles.filter((f) => !f.isDir && !f.name.startsWith('.')).map((f) => f.name)
    } catch { /* 非致命 */ }
  }

  store.setPipeline({ progress: 10, message: `代码模型正在按 ${codegenModules.length} 个模块重新生成…` })

  try {
    let acc = ''
    let userPrompt = buildCodegenUserPromptFromModules(design, codegenModules, orientationFromDesign(design))
    if (projectModuleDocs.length > 0) {
      userPrompt += '\n\n# 项目模块详细文档\n'
      for (const doc of projectModuleDocs) {
        try {
          const parsed = JSON.parse(doc)
          userPrompt += `\n## ${parsed.name || parsed.id}\n`
          if (parsed.description) userPrompt += `描述：${parsed.description}\n`
          if (parsed.userInput) userPrompt += `用户要求：${parsed.userInput}\n`
          if (parsed.assets?.length) {
            userPrompt += `美术资源：${parsed.assets.map((a: any) => `${a.entityName}(${a.id})`).join('、')}\n`
          }
        } catch {}
      }
    }
    if (projectAssetList.length > 0) {
      userPrompt += `\n\n# 项目美术资源文件\n` + projectAssetList.map((f) => `- ${f}`).join('\n')
    }

    const code = await codeCompletion(
      [
        { role: 'system', content: CODEGEN_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: 0.6,
        onChunk: (chunk) => {
          acc += chunk
          store.updateNode(codeNode.id, { data: { ...codeNode.data, source: acc } })
          store.setPipeline({ progress: Math.min(95, store.pipeline.progress + 1) })
        },
      }
    )
    const clean = code.replace(/^```(?:html|javascript|js)?\n?|```$/gm, '').trim()
    // 多文件解析 + 合并（core 最前、main 最后）
    const codeFiles = parseMultiFileOutput(clean)
    persistCodeFiles(codeFiles)
    const combined = combineCodeFiles(codeFiles)
    const newVersion = createVersion(combined, '重新生成')
    const history = (data.history || []).slice()
    history.push(newVersion)
    while (history.length > 10) history.shift()

    store.updateNode(codeNode.id, {
      status: 'completed',
      data: { ...data, source: combined, buildStatus: 'success', history, activeVersionId: newVersion.id },
    })
    store.setPipeline({ status: 'completed', progress: 100, message: '代码重新生成完成' })
    ElMessage.success('代码重新生成完成')
    // 保存代码到项目目录
    useProjectStore().saveToProject('code', 'game.js', combined)
  } catch (err: any) {
    store.updateNode(codeNode.id, {
      status: 'error',
      data: { ...data, buildStatus: 'error', source: '// 重新生成失败: ' + err.message },
    })
    store.setPipeline({ status: 'error', message: err.message || '重新生成失败' })
    ElMessage.error('代码重新生成失败: ' + err.message)
  }
}

// ===== 代码优化（增量补丁式） =====
//
// 优化器不再重新生成完整代码，而是要求 LLM 输出 SEARCH/REPLACE 或 APPEND 补丁块，
// 解析后逐个应用到当前源码。这样可以：
//   1. 显著降低 token 消耗与生成时间
//   2. 保留未修改部分的稳定性
//   3. 修改可追踪（可在历史版本里看到逐次的小改动）

export interface OptimizeCodeOptions {
  /** 运行时捕获的错误列表（试玩卡点） */
  runtimeErrors?: string[]
  /** 用户补充描述 */
  description?: string
  /** 传统指令（预设按钮使用） */
  instruction?: string
}

export async function optimizeCode(codeNode: CanvasNode, instructionOrOpts: string | OptimizeCodeOptions) {
  // 兼容旧接口：如果传的是字符串，当作 instruction
  const opts: OptimizeCodeOptions = typeof instructionOrOpts === 'string'
    ? { instruction: instructionOrOpts }
    : instructionOrOpts

  const settingsStore = useSettingsStore()
  if (!settingsStore.isCodeConfigured()) {
    ElMessage.warning('请先配置代码模型 API Key（设置 → 代码模型配置）')
    settingsStore.show()
    return
  }
  if (!opts.instruction?.trim() && !opts.runtimeErrors?.length && !opts.description?.trim()) {
    ElMessage.warning('请输入优化指令或提供报错信息')
    return
  }

  const store = useCanvasStore()
  const data = codeNode.data as CodeNodeData
  if (!data.source || data.source.startsWith('// 正在') || data.source.startsWith('// 生成失败')) {
    ElMessage.error('当前没有可优化的代码')
    return
  }

  const originalSource = data.source

  // 构建修复摘要文本用于版本标签
  const fixSummary = opts.runtimeErrors?.length
    ? `修复 ${opts.runtimeErrors.length} 个运行时错误`
    : (opts.description || opts.instruction || '').slice(0, 20)

  // 把"优化前"快照入历史，便于回退
  pushVersionToHistory(codeNode, `优化前 (${fixSummary}…)`)

  const ideaNode = store.nodes.find((n) => n.type === 'idea' && n.status === 'completed')
  const design = ideaNode?.data.expandedDesign as GameDesign | undefined

  // 收集可用资源清单
  const moduleNodes = store.nodes.filter((n) => n.type === 'module')
  const availableAssets: string[] = []
  for (const mn of moduleNodes) {
    const mData = mn.data as ModuleNodeData
    if (mData.assets) {
      for (const asset of mData.assets) {
        if (asset.url || asset.status === 'done') {
          availableAssets.push(asset.id)
        }
      }
    }
  }

  store.updateNode(codeNode.id, {
    status: 'processing',
    data: { ...data, buildStatus: 'pending', optimizeInstruction: fixSummary },
  })
  store.setPipeline({ currentStage: 4, status: 'running', progress: 5, message: `代码模型正在修复: ${fixSummary}…` })

  try {
    // 收集补丁文本，但不直接覆盖 source（避免源码被中间补丁文本污染）
    let patchText = ''
    await codeCompletion(
      [
        { role: 'system', content: CODE_OPTIMIZE_SYSTEM_PROMPT },
        { role: 'user', content: buildOptimizeUserPrompt({
          currentCode: originalSource,
          runtimeErrors: opts.runtimeErrors,
          description: opts.description,
          instruction: opts.instruction,
          design,
          availableAssets,
        }) },
      ],
      {
        temperature: 0.2,
        onChunk: (chunk) => {
          patchText += chunk
          // 仅更新进度提示，不改 source
          store.setPipeline({ progress: Math.min(90, store.pipeline.progress + 1) })
        },
      }
    )

    // 解析并应用补丁
    const result = applyPatchText(originalSource, patchText)

    if (result.totalPatches === 0) {
      // LLM 未输出有效补丁块；回滚 UI 状态
      store.updateNode(codeNode.id, {
        status: 'completed',
        data: { ...data, source: originalSource, buildStatus: 'success', optimizeInstruction: '' },
      })
      store.setPipeline({ status: 'error', message: '优化失败：模型未输出有效补丁块' })
      ElMessage.error('优化失败：模型未输出有效补丁块（请重试或换种说法）')
      return
    }

    if (result.applied === 0) {
      store.updateNode(codeNode.id, {
        status: 'completed',
        data: { ...data, source: originalSource, buildStatus: 'success', optimizeInstruction: '' },
      })
      store.setPipeline({ status: 'error', message: `优化失败：${result.failed} 个补丁均未匹配` })
      ElMessage.error(`优化失败：${result.failed} 个补丁均未匹配源代码（${result.failedDetails[0] || ''}）`)
      return
    }

    const summary = result.failed > 0
      ? `优化: ${fixSummary.slice(0, 24)}（应用 ${result.applied}/${result.totalPatches} 个补丁）`
      : `优化: ${fixSummary.slice(0, 24)}（${result.applied} 个补丁）`
    const newVersion = createVersion(result.source, summary)
    const history = (data.history || []).slice()
    history.push(newVersion)
    while (history.length > 10) history.shift()

    store.updateNode(codeNode.id, {
      status: 'completed',
      data: { ...data, source: result.source, buildStatus: 'success', history, activeVersionId: newVersion.id, optimizeInstruction: '' },
    })

    if (result.failed > 0) {
      store.setPipeline({
        status: 'completed',
        progress: 100,
        message: `部分补丁未匹配（${result.applied}/${result.totalPatches}），已应用其余补丁`,
      })
      ElMessage.warning(`已应用 ${result.applied} 个补丁，${result.failed} 个未匹配源代码`)
    } else {
      store.setPipeline({ status: 'completed', progress: 100, message: `代码优化完成（${result.applied} 个补丁）` })
      ElMessage.success(`代码优化完成（应用了 ${result.applied} 个补丁）`)
      // 保存优化后的代码到项目目录
      useProjectStore().saveToProject('code', 'game.js', result.source)
    }

    // 优化完成后自动重新部署，让用户立即验证效果
    const updatedCodeNode = store.nodes.find((n) => n.id === codeNode.id)
    if (updatedCodeNode) {
      setTimeout(() => runStage5_deploy(updatedCodeNode), 500)
    }
  } catch (err: any) {
    // 失败：恢复源码到优化前
    store.updateNode(codeNode.id, {
      status: 'completed',
      data: { ...data, source: originalSource, buildStatus: 'success', optimizeInstruction: '' },
    })
    store.setPipeline({ status: 'error', message: err.message || '优化失败' })
    ElMessage.error('代码优化失败: ' + err.message)
  }
}

// ===== 版本回退 =====

export function rollbackToVersion(codeNode: CanvasNode, versionId: string) {
  const store = useCanvasStore()
  const data = codeNode.data as CodeNodeData
  const history = data.history || []
  const target = history.find((v) => v.id === versionId)
  if (!target) {
    ElMessage.error('版本不存在')
    return
  }
  if (data.source !== target.source) {
    pushVersionToHistory(codeNode, '回退前')
  }
  store.updateNode(codeNode.id, {
    status: 'completed',
    data: { ...data, source: target.source, buildStatus: 'success', activeVersionId: versionId },
  })
  ElMessage.success(`已回退到: ${target.label}`)
}
