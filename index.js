// Host half of the classic-mode button: one route that opens the classic
// (DS-Bot-free) Harness UI in the chosen browser.
//
// `dsh web` prints a URL whose token it regenerates on every boot, so the
// button cannot hold a fixed link. The route therefore starts the classic
// server when it is not running, reads the tokenized URL from its output,
// records it in state.json, and hands it to the browser. A later click reuses
// the recorded URL while that server process is still alive.

import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'classic-mode'

/** The route needs the Web server's route registry. */
export const inject = ['webServer']

const STATE_PATH = join(homedir(), '.dsh', 'classic-mode', 'state.json')

/** `dsh web: http://127.0.0.1:3080/?token=<opaque>` as printed on boot. */
const URL_PATTERN = /(https?:\/\/[^\s"'<>]+[?&]token=[^\s"'<>]+)/

const START_TIMEOUT_MS = 90_000
const LOG_TAIL_LINES = 12

/**
 * Read the recorded classic-server state.
 *
 * @returns {Promise<{ url: string, pid: number, startedAt: string } | null>}
 *   The last recorded state, or null when none was written yet.
 */
async function readState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'))
  } catch (error) {
    // A missing or unreadable record only means "no server known": the next
    // click starts one and rewrites the file.
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

/**
 * Record the state of the classic server this plugin started.
 *
 * @param {{ url: string, pid: number, startedAt: string }} state - What to persist.
 * @returns {Promise<void>} Resolves once the file is written.
 */
async function writeState(state) {
  await mkdir(dirname(STATE_PATH), { recursive: true })
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * Tell whether a process id still names a live process.
 *
 * @param {number} pid - Process id to probe.
 * @returns {boolean} True when the process exists and this user may signal it.
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user; that is not
    // this plugin's server either way.
    return error?.code === 'EPERM'
  }
}

/**
 * Tell whether nothing is listening on the loopback port yet.
 *
 * A server started outside this plugin holds a token this plugin never saw, so
 * it cannot be reused: the port is reported busy instead of silently starting
 * a second server that could not bind.
 *
 * @param {number} port - TCP port to probe on 127.0.0.1.
 * @returns {Promise<boolean>} True when the port is free.
 */
function portFree(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (free) => {
      socket.destroy()
      resolve(free)
    }
    socket.setTimeout(1200)
    socket.once('connect', () => done(false))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(true))
  })
}

/**
 * Hand a URL to the configured browser.
 *
 * @param {string} browser - Application name for `open -a`, such as `Safari`.
 * @param {string} url - Absolute URL to open.
 * @returns {Promise<void>} Resolves when the browser accepted the request.
 */
function openInBrowser(browser, url) {
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', browser, url], (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/**
 * Start the classic server and resolve with the URL it printed.
 *
 * @param {{ cliPath: string, profile: string, port: number }} config - Launch settings.
 * @returns {Promise<{ url: string, pid: number }>} The tokenized URL and its process id.
 */
function startServer(config) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.cliPath,
      ['--profile', config.profile, '--no-open', '--port', String(config.port)],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    )

    let buffer = ''
    let settled = false

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }

    const tail = () => buffer.trim().split('\n').slice(-LOG_TAIL_LINES).join('\n')

    const onData = (chunk) => {
      buffer += String(chunk)
      const match = URL_PATTERN.exec(buffer)
      if (match) finish(null, { url: match[1], pid: child.pid })
    }

    const timer = setTimeout(() => {
      finish(new Error(`启动超时：${START_TIMEOUT_MS / 1000} 秒内未打印访问地址`))
    }, START_TIMEOUT_MS)

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (error) => finish(error))
    child.on('exit', (code) => {
      finish(new Error(`经典模式启动失败（退出码 ${code}）：\n${tail()}`))
    })

    // The server outlives this plugin: detaching puts it in its own process
    // group, and the pipes stay attached only to keep reading its log.
    child.unref()
  })
}

/**
 * Answer one `/classic-mode/open` request.
 *
 * @param {object} config - Resolved plugin config.
 * @param {import('node:http').ServerResponse} res - Response to write.
 * @returns {Promise<void>} Resolves once the response is sent.
 */
async function handleOpen(config, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  const state = await readState()
  if (state?.url && pidAlive(state.pid)) {
    try {
      await openInBrowser(config.browser, state.url)
      send(200, { ok: true, started: false, url: state.url })
    } catch (error) {
      send(500, { ok: false, error: `无法调用 ${config.browser}：${error.message}` })
    }
    return
  }

  try {
    if (!(await portFree(config.port))) {
      send(409, {
        ok: false,
        error: `端口 ${config.port} 已被占用：另有一个经典模式实例在运行，而它的访问令牌本插件无法获取。请先关闭那个实例，或修改插件配置里的端口。`,
      })
      return
    }
    const started = await startServer(config)
    await writeState({ ...started, startedAt: new Date().toISOString() })
    try {
      await openInBrowser(config.browser, started.url)
    } catch (error) {
      send(200, {
        ok: true,
        started: true,
        url: started.url,
        warning: `已启动，但无法调用 ${config.browser}：${error.message}`,
      })
      return
    }
    send(200, { ok: true, started: true, url: started.url })
  } catch (error) {
    send(504, { ok: false, error: String(error?.message ?? error) })
  }
}

/**
 * Mount the route that the sidebar button calls.
 *
 * @param {object} ctx - Scoped plugin context holding `webServer`.
 * @param {object} config - Resolved plugin config.
 * @returns {void}
 */
function mountRoute(ctx, config) {
  const route = {
    name: 'classic-mode-open',
    kind: 'exact',
    path: '/classic-mode/open',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405).end()
        return
      }
      // This route answers before dsh Connection authentication, so any page in
      // the browser could reach it. A cross-site request carries an Origin this
      // host does not serve; refuse it. The button's same-origin GET carries none.
      const origin = req.headers.origin
      if (origin !== undefined && origin !== `http://${req.headers.host}`) {
        res.writeHead(403).end()
        return
      }
      try {
        await handleOpen(config, res)
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        }
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
      }
    },
  }
  // Held by an effect: the Plugins page can switch this bundle off without a
  // restart, and a loose registration would keep serving a disabled plugin.
  ctx.effect(() => ctx.webServer.register(route), 'classic-mode: open route')
}

/**
 * Mount the classic-mode button's host half.
 *
 * @param {object} ctx - Plugin context.
 * @param {object} [config] - Bundle config from cordis.patch.yml.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const resolved = {
    cliPath: config.cliPath,
    profile: config.profile ?? 'classic',
    port: config.port ?? 3090,
    browser: config.browser ?? 'Safari',
  }
  if (typeof resolved.cliPath !== 'string' || resolved.cliPath === '') {
    throw new Error('classic-mode: config.cliPath is required')
  }
  ctx.inject(['webServer'], (scope) => {
    mountRoute(scope, resolved)
  })
}
