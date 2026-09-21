/**
 * Vite dev-server plugin: provides a POST /__save-file endpoint
 * that writes files to the local game-output directory.
 * Also provides endpoints to read files, list directories, and list projects.
 * Auth: register/login/session management with server-side users.json.
 */
import type { Plugin, Connect } from 'vite'
import { writeFile, mkdir, readFile, readdir, stat, cp, access, rm, rename } from 'fs/promises'
import { dirname, join, normalize } from 'path'
import { createHash, randomUUID } from 'crypto'

// ─── Auth: in-memory sessions + users.json ─────────────────────────────────────
interface UserRecord { password: string; createdAt: string }
interface UsersDB { users: Record<string, UserRecord> }

const sessions = new Map<string, { username: string; expiresAt: number }>() // token -> user

function hashPassword(pw: string): string {
  return createHash('sha256').update(pw).digest('hex')
}

async function loadUsersDB(filePath: string): Promise<UsersDB> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { users: {} }
  }
}

async function saveUsersDB(filePath: string, db: UsersDB) {
  await writeFile(filePath, JSON.stringify(db, null, 2))
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  })
}

export function saveFilePlugin(outputDir: string): Plugin {
  const usersFile = join(dirname(outputDir), 'users.json')
  const gameShowDir = join(dirname(outputDir), 'game-show')

  return {
    name: 'gameforge-save-file',
    configureServer(server) {

      // ─── Auth endpoints ──────────────────────────────────────────────────
      server.middlewares.use('/__auth', (async (req: Connect.IncomingMessage, res) => {
        const url = req.url || ''
        res.setHeader('Content-Type', 'application/json')

        // POST /__auth/register
        if (req.method === 'POST' && url.includes('/register')) {
          const body = await readBody(req)
          try {
            const { username, password } = JSON.parse(body)
            if (!username || !password || username.length < 6 || username.length > 10 || password.length < 6 || password.length > 10) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: '账号和密码长度需为6~10位' }))
              return
            }
            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: '账号只能包含字母、数字和下划线' }))
              return
            }
            const db = await loadUsersDB(usersFile)
            if (db.users[username]) {
              res.statusCode = 409
              res.end(JSON.stringify({ ok: false, error: '该账号已存在' }))
              return
            }
            db.users[username] = { password: hashPassword(password), createdAt: new Date().toISOString() }
            await saveUsersDB(usersFile, db)
            // Auto login after register
            const token = randomUUID()
            sessions.set(token, { username, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 })
            // Create user directory
            await mkdir(join(outputDir, username), { recursive: true })
            res.statusCode = 200
            res.end(JSON.stringify({ ok: true, token, username }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          return
        }

        // POST /__auth/login
        if (req.method === 'POST' && url.includes('/login')) {
          const body = await readBody(req)
          try {
            const { username, password } = JSON.parse(body)
            if (!username || !password) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: '请输入账号和密码' }))
              return
            }
            const db = await loadUsersDB(usersFile)
            const user = db.users[username]
            if (!user || user.password !== hashPassword(password)) {
              res.statusCode = 401
              res.end(JSON.stringify({ ok: false, error: '账号或密码错误' }))
              return
            }
            const token = randomUUID()
            sessions.set(token, { username, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 })
            // Ensure user directory exists
            await mkdir(join(outputDir, username), { recursive: true })
            res.statusCode = 200
            res.end(JSON.stringify({ ok: true, token, username }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          return
        }

        // POST /__auth/guest — 游客登录，生成随机账号
        if (req.method === 'POST' && url.includes('/guest')) {
          try {
            const db = await loadUsersDB(usersFile)
            // 生成唯一游客账号：guest + 4位随机字符（共10位以内）
            let guestName = ''
            for (let i = 0; i < 20; i++) {
              const rand = Math.random().toString(36).slice(2, 6)
              const candidate = `guest_${rand}`
              if (!db.users[candidate]) { guestName = candidate; break }
            }
            if (!guestName) guestName = `guest_${Date.now().toString(36).slice(-4)}`
            // 记录游客账号（密码随机不可登录，标记 guest）
            db.users[guestName] = { password: hashPassword(randomUUID()), createdAt: new Date().toISOString() }
            await saveUsersDB(usersFile, db)
            const token = randomUUID()
            sessions.set(token, { username: guestName, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 })
            await mkdir(join(outputDir, guestName), { recursive: true })
            res.statusCode = 200
            res.end(JSON.stringify({ ok: true, token, username: guestName }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          return
        }

        // GET /__auth/check-session?token=xxx
        if (req.method === 'GET' && url.includes('/check-session')) {
          const params = new URLSearchParams(url.split('?')[1] || '')
          const token = params.get('token') || ''
          const session = sessions.get(token)
          if (session && session.expiresAt > Date.now()) {
            res.statusCode = 200
            res.end(JSON.stringify({ ok: true, username: session.username }))
          } else {
            if (session) sessions.delete(token)
            res.statusCode = 401
            res.end(JSON.stringify({ ok: false, error: 'Session expired' }))
          }
          return
        }

        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'Not found' }))
      }) as Connect.NextHandleFunction)

      // ─── Game Show endpoints ─────────────────────────────────────────────
      server.middlewares.use('/__game-show', (async (req: Connect.IncomingMessage, res) => {
        const url = req.url || ''
        res.setHeader('Content-Type', 'application/json')

        // GET /__game-show/list — 返回游戏列表，缩略图用 URL 而非 base64
        if (req.method === 'GET' && url.includes('/list')) {
          try {
            await mkdir(gameShowDir, { recursive: true })
            const entries = await readdir(gameShowDir, { withFileTypes: true })
            const games: Array<any> = []
            for (const entry of entries) {
              if (!entry.isDirectory()) continue
              try {
                const metaRaw = await readFile(join(gameShowDir, entry.name, 'meta.json'), 'utf-8')
                const meta = JSON.parse(metaRaw)
                // 优先使用 thumbFile，否则从 assets 目录查找缩略图文件名
                let thumbUrl = ''
                if (meta.thumbFile) {
                  thumbUrl = `/__game-show/thumb/${entry.name}/${meta.thumbFile}`
                } else {
                  // 旧版 meta 没有 thumbFile，从 assets 目录查找实际图片文件
                  try {
                    const assetsDir = join(gameShowDir, entry.name, 'assets')
                    const assetFiles = await readdir(assetsDir)
                    const bgFile = assetFiles.find(f => f.startsWith('bg_title'))
                      || assetFiles.find(f => f.startsWith('bg_'))
                      || assetFiles.find(f => /\.(png|jpe?g|webp)$/i.test(f))
                    if (bgFile) thumbUrl = `/__game-show/thumb/${entry.name}/${bgFile}`
                  } catch { /* no assets */ }
                }
                games.push({ id: entry.name, title: meta.title, author: meta.author, orientation: meta.orientation, publishedAt: meta.publishedAt, thumbUrl })
              } catch { /* skip invalid */ }
            }
            games.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
            res.statusCode = 200
            res.end(JSON.stringify({ ok: true, games }))
          } catch {
            res.statusCode = 200
            res.end(JSON.stringify({ ok: true, games: [] }))
          }
          return
        }

        // GET /__game-show/thumb/:gameId/:file — 静态服务缩略图(带缓存)
        if (req.method === 'GET' && url.includes('/thumb/')) {
          const parts = url.replace(/^.*\/thumb\//, '').split('/')
          const gameId = decodeURIComponent(parts[0] || '')
          const fileName = decodeURIComponent(parts.slice(1).join('/'))
          try {
            const filePath = normalize(join(gameShowDir, gameId, 'assets', fileName))
            if (!filePath.startsWith(normalize(gameShowDir))) {
              res.statusCode = 403
              res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
              return
            }
            const buf = await readFile(filePath)
            const ext = fileName.split('.').pop()?.toLowerCase() || 'png'
            const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
            res.setHeader('Content-Type', mime)
            res.setHeader('Content-Length', buf.length.toString())
            res.setHeader('Cache-Control', 'public, max-age=86400')
            res.statusCode = 200
            res.end(buf)
          } catch {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'Not found' }))
          }
          return
        }

        // GET /__game-show/read?path=xxx
        if (req.method === 'GET' && url.includes('/read')) {
          const params = new URLSearchParams(url.split('?')[1] || '')
          const filePath = params.get('path') || ''
          try {
            const fullPath = normalize(join(gameShowDir, filePath))
            if (!fullPath.startsWith(normalize(gameShowDir))) {
              res.statusCode = 403
              res.end(JSON.stringify({ ok: false, error: 'Path escape' }))
              return
            }
            const mode = params.get('mode') || 'text'
            if (mode === 'base64') {
              const buf = await readFile(fullPath)
              const ext = filePath.split('.').pop()?.toLowerCase() || ''
              const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream'
              res.end(JSON.stringify({ ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }))
            } else {
              const content = await readFile(fullPath, 'utf-8')
              res.end(JSON.stringify({ ok: true, content }))
            }
          } catch (err: any) {
            res.statusCode = 404
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          return
        }

        // POST /__game-show/sync-layout — 布局调整后把最新 deploy/game.html 同步到已发布版本
        if (req.method === 'POST' && url.includes('/sync-layout')) {
          const body = await readBody(req)
          try {
            const { username, projectName } = JSON.parse(body)
            if (!username || !projectName) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'Missing username or projectName' }))
              return
            }
            const destId = `${username}_${projectName}`
            const destDir = normalize(join(gameShowDir, destId))
            if (!destDir.startsWith(normalize(gameShowDir))) {
              res.statusCode = 403
              res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
              return
            }
            // 未发布过则跳过（不算失败）
            try {
              const metaRaw = await readFile(join(destDir, 'meta.json'), 'utf-8')
              const meta = JSON.parse(metaRaw)
              if (meta.author !== username) {
                res.statusCode = 403
                res.end(JSON.stringify({ ok: false, error: '只能同步自己发布的游戏' }))
                return
              }
            } catch {
              res.end(JSON.stringify({ ok: true, synced: false, skipped: 'not-published' }))
              return
            }
            const srcHtml = join(outputDir, username, projectName, 'deploy', 'game.html')
            await access(srcHtml)
            await cp(srcHtml, join(destDir, 'game.html'))
            res.end(JSON.stringify({ ok: true, synced: true, id: destId }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          return
        }

        // POST /__game-show/publish
        if (req.method === 'POST' && url.includes('/publish')) {
          const body = await readBody(req)
          try {
            const { username, projectName, title, orientation } = JSON.parse(body)
            if (!username || !projectName) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'Missing username or projectName' }))
              return
            }
            const srcDir = join(outputDir, username, projectName)
            const destId = `${username}_${projectName}`
            const destDir = join(gameShowDir, destId)
            await mkdir(destDir, { recursive: true })

            // Copy game.html
            const srcHtml = join(srcDir, 'deploy', 'game.html')
            await cp(srcHtml, join(destDir, 'game.html'))

            // Copy assets directory (best effort)
            try {
              const srcAssets = join(srcDir, 'assets')
              await access(srcAssets)
              await cp(srcAssets, join(destDir, 'assets'), { recursive: true })
            } catch { /* no assets, ok */ }

            // Find thumb file name (不再存 base64，改存文件名)
            let thumbFile = ''
            try {
              const assetsDir = join(srcDir, 'assets')
              const assetFiles = await readdir(assetsDir)
              const bgFile = assetFiles.find(f => f.startsWith('bg_title')) || assetFiles.find(f => f.startsWith('bg_')) || assetFiles.find(f => /\.(png|jpg|webp)$/i.test(f))
              if (bgFile) thumbFile = bgFile
            } catch { /* ok */ }

            // Write meta.json
            const meta = {
              author: username,
              title: title || projectName,
              orientation: orientation || 'portrait',
              publishedAt: new Date().toISOString(),
              thumbFile,
            }
            await writeFile(join(destDir, 'meta.json'), JSON.stringify(meta, null, 2))

            res.statusCode = 200
            res.end(JSON.stringify({ ok: true, id: destId }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          return
        }

        // POST /__game-show/delete
        if (req.method === 'POST' && url.includes('/delete')) {
          const body = await readBody(req)
          try {
            const { username, gameId } = JSON.parse(body)
            if (!username || !gameId) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'Missing username or gameId' }))
              return
            }
            // 安全检查：只能删除自己发布的游戏
            const safeId = normalize(gameId).replace(/\.\.\//g, '')
            const gamePath = join(gameShowDir, safeId)
            if (!gamePath.startsWith(normalize(gameShowDir))) {
              res.statusCode = 403
              res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
              return
            }
            // 验证 meta.json 中的 author 是否匹配
            try {
              const metaRaw = await readFile(join(gamePath, 'meta.json'), 'utf-8')
              const meta = JSON.parse(metaRaw)
              if (meta.author !== username) {
                res.statusCode = 403
                res.end(JSON.stringify({ ok: false, error: '只能删除自己发布的游戏' }))
                return
              }
            } catch {
              res.statusCode = 404
              res.end(JSON.stringify({ ok: false, error: '游戏不存在' }))
              return
            }
            await rm(gamePath, { recursive: true, force: true })
            res.statusCode = 200
            res.end(JSON.stringify({ ok: true }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          return
        }

        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'Not found' }))
      }) as Connect.NextHandleFunction)

      // ─── Delete project endpoint ───────────────────────────────────────────
      server.middlewares.use('/__api/delete-project', (async (req: Connect.IncomingMessage, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
          return
        }
        try {
          const body = JSON.parse(await readBody(req))
          const { username, projectName } = body
          if (!username || !projectName) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: 'Missing username or projectName' }))
            return
          }
          // 安全检查：禁止路径穿越
          const safeName = normalize(projectName).replace(/\.\./g, '')
          const projectPath = join(outputDir, username, safeName)
          if (!projectPath.startsWith(join(outputDir, username))) {
            res.statusCode = 403
            res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
            return
          }
          await rm(projectPath, { recursive: true, force: true })
          res.end(JSON.stringify({ ok: true }))
        } catch (e: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      }) as Connect.NextHandleFunction)

      // ─── Rename project endpoint ─────────────────────────────
      server.middlewares.use('/__api/rename-project', (async (req: Connect.IncomingMessage, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
          return
        }
        try {
          const body = JSON.parse(await readBody(req))
          const { username, oldName, newName } = body
          if (!username || !oldName || !newName) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: 'Missing username/oldName/newName' }))
            return
          }
          // 名称合法性检查：仅允许字母/数字/中文/连字符/下划线/点
          if (!/^[\w\u4e00-\u9fa5\-.]+$/.test(newName)) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: '项目名只能包含字母/数字/中文/-/_/.' }))
            return
          }
          const safeOld = normalize(oldName).replace(/\.\./g, '')
          const safeNew = normalize(newName).replace(/\.\./g, '')
          if (safeOld === safeNew) {
            res.end(JSON.stringify({ ok: true, unchanged: true }))
            return
          }
          const userBase = join(outputDir, username)
          const oldPath = join(userBase, safeOld)
          const newPath = join(userBase, safeNew)
          if (!oldPath.startsWith(userBase) || !newPath.startsWith(userBase)) {
            res.statusCode = 403
            res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
            return
          }
          // 检查原目录存在
          try {
            await access(oldPath)
          } catch {
            res.statusCode = 404
            res.end(JSON.stringify({ ok: false, error: '项目不存在' }))
            return
          }
          // 检查新名未被占用
          try {
            await access(newPath)
            res.statusCode = 409
            res.end(JSON.stringify({ ok: false, error: '同名项目已存在' }))
            return
          } catch { /* not exists, ok */ }
          await rename(oldPath, newPath)
          // 同步更新项目元文件中的 name 字段
          try {
            const metaPath = join(newPath, 'project.json')
            const raw = await readFile(metaPath, 'utf-8')
            const meta = JSON.parse(raw)
            meta.name = safeNew
            await writeFile(metaPath, JSON.stringify(meta, null, 2))
          } catch { /* meta 写入失败不作为错误 */ }
          res.end(JSON.stringify({ ok: true }))
        } catch (e: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      }) as Connect.NextHandleFunction)

      // ─── Batch project summaries endpoint (性能优化) ───────────────
      server.middlewares.use('/__api/project-summaries', (async (req: Connect.IncomingMessage, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
          return
        }
        const params = new URLSearchParams((req.url || '').split('?')[1] || '')
        const user = params.get('user') || ''
        if (!user) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: 'Missing user' }))
          return
        }
        try {
          const userDir = join(outputDir, user)
          await mkdir(userDir, { recursive: true })
          const entries = await readdir(userDir, { withFileTypes: true })
          const projects: Array<any> = []

          await Promise.all(entries.map(async (entry) => {
            if (!entry.isDirectory() || entry.name.startsWith('.')) return
            const name = entry.name
            const projDir = join(userDir, name)
            let hasHtml = false
            let orientation: string = 'portrait'
            let displayName = name
            let thumbFile = ''

            // 并行读取元数据
            const [deployFiles, projectJson, designJson, assetFiles] = await Promise.all([
              readdir(join(projDir, 'deploy')).catch(() => [] as string[]),
              readFile(join(projDir, 'project.json'), 'utf-8').catch(() => ''),
              readFile(join(projDir, 'design', 'game-design.json'), 'utf-8').catch(() => ''),
              readdir(join(projDir, 'assets')).catch(() => [] as string[]),
            ])

            hasHtml = deployFiles.includes('game.html')

            if (projectJson) {
              try {
                const meta = JSON.parse(projectJson)
                if (meta?.orientation === 'landscape') orientation = 'landscape'
              } catch {}
            }

            if (designJson) {
              try {
                const design = JSON.parse(designJson)
                const logoText = design?.screens?.title?.logo?.text
                if (logoText && typeof logoText === 'string') {
                  displayName = logoText
                } else {
                  const concept = design?.gameConcept
                  if (concept && typeof concept === 'string') {
                    displayName = concept.length > 12 ? concept.slice(0, 12) + '…' : concept
                  }
                }
              } catch {}
            }

            // 找缩略图文件名
            const imgFiles = assetFiles.filter((f: string) => /\.(png|jpe?g|webp|svg)$/i.test(f) && !f.startsWith('.'))
            const pick = imgFiles.find((f: string) => f.toLowerCase().startsWith('bg_title'))
              || imgFiles.find((f: string) => f.toLowerCase().startsWith('bg_'))
              || imgFiles[0] || ''
            thumbFile = pick

            projects.push({ name, displayName, hasHtml, orientation, thumbFile })
          }))

          res.statusCode = 200
          res.end(JSON.stringify({ ok: true, projects }))
        } catch (err: any) {
          res.statusCode = 200
          res.end(JSON.stringify({ ok: true, projects: [] }))
        }
      }) as Connect.NextHandleFunction)

      // ─── Serve user project assets as static files (thumb) ───────────
      server.middlewares.use('/__asset', (async (req: Connect.IncomingMessage, res) => {
        // /__asset/:user/:project/assets/:file
        const filePath = decodeURIComponent((req.url || '').replace(/\?.*/, ''))
        const fullPath = normalize(join(outputDir, filePath))
        if (!fullPath.startsWith(normalize(outputDir))) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        try {
          const buf = await readFile(fullPath)
          const ext = filePath.split('.').pop()?.toLowerCase() || ''
          const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream'
          res.setHeader('Content-Type', mime)
          res.setHeader('Content-Length', buf.length.toString())
          res.setHeader('Cache-Control', 'public, max-age=3600')
          res.statusCode = 200
          res.end(buf)
        } catch {
          res.statusCode = 404
          res.end('Not found')
        }
      }) as Connect.NextHandleFunction)

      // ─── File system endpoints ───────────────────────────────────────────
      server.middlewares.use('/__save-file', ((req: Connect.IncomingMessage, res, next) => {
        const url = req.url || ''

        // GET /__save-file/status — 检查端点是否可用
        if (req.method === 'GET' && url.includes('/status')) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, outputDir }))
          return
        }

        // GET /__save-file/list-projects?user=xxx — 列出用户的项目目录
        if (req.method === 'GET' && url.includes('/list-projects')) {
          const params = new URLSearchParams(url.split('?')[1] || '')
          const user = params.get('user') || ''
          ;(async () => {
            try {
              const baseDir = user ? join(outputDir, user) : outputDir
              await mkdir(baseDir, { recursive: true })
              const entries = await readdir(baseDir, { withFileTypes: true })
              const projects: Array<{ name: string; createdAt: string }> = []
              for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                  const st = await stat(join(baseDir, entry.name))
                  projects.push({ name: entry.name, createdAt: st.birthtime.toISOString() })
                }
              }
              projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, projects }))
            } catch (err: any) {
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, projects: [] }))
            }
          })()
          return
        }

        // GET /__save-file/list-dir?path=xxx — 列出指定目录内容
        if (req.method === 'GET' && url.includes('/list-dir')) {
          const params = new URLSearchParams(url.split('?')[1] || '')
          const dirPath = params.get('path') || ''
          ;(async () => {
            try {
              const fullPath = normalize(join(outputDir, dirPath))
              if (!fullPath.startsWith(normalize(outputDir))) {
                res.statusCode = 403
                res.end(JSON.stringify({ ok: false, error: 'Path escape' }))
                return
              }
              const entries = await readdir(fullPath, { withFileTypes: true })
              const files = entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, files }))
            } catch {
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, files: [] }))
            }
          })()
          return
        }

        // GET /__save-file/read-file?path=xxx — 读取文件内容
        if (req.method === 'GET' && url.includes('/read-file')) {
          const params = new URLSearchParams(url.split('?')[1] || '')
          const filePath = params.get('path') || ''
          const mode = params.get('mode') || 'text' // 'text' or 'base64'
          ;(async () => {
            try {
              const fullPath = normalize(join(outputDir, filePath))
              if (!fullPath.startsWith(normalize(outputDir))) {
                res.statusCode = 403
                res.end(JSON.stringify({ ok: false, error: 'Path escape' }))
                return
              }
              if (mode === 'base64') {
                const buf = await readFile(fullPath)
                const ext = filePath.split('.').pop()?.toLowerCase() || ''
                const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream'
                const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: true, dataUrl }))
              } else {
                const content = await readFile(fullPath, 'utf-8')
                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: true, content }))
              }
            } catch (err: any) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: err.message }))
            }
          })()
          return
        }

        // GET /__save-file/fetch-image?url=xxx — 服务端代理下载远程图片（避免浏览器 CORS）
        if (req.method === 'GET' && url.includes('/fetch-image')) {
          const params = new URLSearchParams(url.split('?')[1] || '')
          const imageUrl = params.get('url') || ''
          ;(async () => {
            try {
              if (!imageUrl) {
                res.statusCode = 400
                res.end(JSON.stringify({ ok: false, error: 'Missing url param' }))
                return
              }
              const fetchResp = await fetch(imageUrl)
              if (!fetchResp.ok) {
                res.statusCode = 502
                res.end(JSON.stringify({ ok: false, error: `Remote ${fetchResp.status}` }))
                return
              }
              const contentType = fetchResp.headers.get('content-type') || 'application/octet-stream'
              const arrayBuf = await fetchResp.arrayBuffer()
              res.statusCode = 200
              res.setHeader('Content-Type', contentType)
              res.setHeader('Content-Length', arrayBuf.byteLength.toString())
              res.end(Buffer.from(arrayBuf))
            } catch (err: any) {
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: err.message || 'fetch failed' }))
            }
          })()
          return
        }

        // POST /__save-file — 保存文件
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
          return
        }

        const filePath = (req.headers['x-file-path'] as string) || ''
        if (!filePath || filePath.includes('..')) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: 'Invalid x-file-path header' }))
          return
        }

        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', async () => {
          try {
            const body = Buffer.concat(chunks)
            const fullPath = normalize(join(outputDir, filePath))

            // Safety: must be within outputDir
            if (!fullPath.startsWith(normalize(outputDir))) {
              res.statusCode = 403
              res.end(JSON.stringify({ ok: false, error: 'Path escape not allowed' }))
              return
            }

            await mkdir(dirname(fullPath), { recursive: true })
            await writeFile(fullPath, body)

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: fullPath, size: body.length }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
        })
      }) as Connect.NextHandleFunction)
    },
  }
}
