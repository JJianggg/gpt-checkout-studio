import { spawn } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const appRoot = dirname(fileURLToPath(import.meta.url))
const localHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const countryCurrencies = new Map([
  ['PH', 'PHP'],
  ['US', 'USD'],
  ['JP', 'JPY'],
  ['SG', 'SGD'],
  ['KR', 'KRW'],
  ['IN', 'INR'],
  ['ID', 'IDR'],
  ['BR', 'BRL'],
  ['GB', 'GBP'],
  ['DE', 'EUR'],
  ['TR', 'TRY'],
  ['VN', 'VND'],
])
const planNames = new Set(['chatgptplusplan', 'chatgptprolite', 'chatgptpro', 'chatgptpromax'])

type CheckoutBody = {
  accessToken?: string
  cookieHeader?: string
  sessionToken?: string
  country?: string
  currency?: string
  planName?: string
  proxyUrl?: string
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(payload))
}

function isLocalRequest(request: IncomingMessage) {
  try {
    const host = new URL(`http://${request.headers.host || ''}`).hostname
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .toLowerCase()
    if (!localHosts.has(host)) return false
  } catch {
    return false
  }

  const origin = request.headers.origin
  if (!origin) return true
  try {
    return localHosts.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

async function readBody(request: IncomingMessage): Promise<CheckoutBody> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 3 * 1024 * 1024) throw new Error('请求内容超过 3 MB')
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('请求 JSON 必须是对象')
    }
    return parsed as CheckoutBody
  } catch {
    throw new Error('请求 JSON 格式无效')
  }
}

function validateProxy(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('代理地址格式无效')
  }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
    throw new Error('代理仅支持 http、https、socks5 或 socks5h')
  }
  return value
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function safeMessage(error: unknown, secrets: unknown[]) {
  let message = error instanceof Error ? error.message : '创建支付链接失败'
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret) message = message.split(secret).join('[redacted]')
  }
  if (message.includes('checkout rejected for unusual activity')) {
    return 'OpenAI 支付接口返回 400：Our systems have detected unusual activity. Please try again later. 官网浏览器请求与本地独立请求的校验上下文不同；上游未说明具体触发原因。若官网可用，请直接使用官网结账。'
  }
  return message
}

function bodyString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function checkoutApi(mode: string): Plugin {
  const environment = loadEnv(mode, appRoot, '')
  const toolRoot = resolve(
    appRoot,
    environment.GPT_REGISTER_TOOL_ROOT || '../GPT-Register-Tool',
  )
  const extractorPath = join(
    toolRoot,
    'services',
    'protocol-payment',
    'direct_card',
    'direct_card_extract.py',
  )
  const subscriptionPath = join(appRoot, 'subscription_check.py')
  const plusExtractorPath = join(appRoot, 'plus_checkout_extract.py')
  const pythonPath =
    environment.GPT_CHECKOUT_PYTHON ||
    join(toolRoot, '.venv', 'Scripts', 'python.exe')
  const defaultProxy =
    environment.GPT_CHECKOUT_PROXY || 'http://127.0.0.1:7890'

  async function runExtractor(args: string[], proxyUrl: string, scriptPath = extractorPath, timeoutMs = 180_000) {
    return await new Promise<string>((resolveRun, rejectRun) => {
      const child = spawn(pythonPath, [scriptPath, ...args], {
        cwd: toolRoot,
        env: {
          ...process.env,
          DIRECT_CARD_CHECKOUT_PROXY: proxyUrl,
          DIRECT_CARD_UPDATE_PROXY: proxyUrl,
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const outputLimit = 1024 * 1024
      const timer = setTimeout(() => {
        child.kill()
        rejectRun(new Error('请求超时，请检查代理节点后重试'))
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
        if (stdout.length > outputLimit) child.kill()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        if (stderr.length > outputLimit) child.kill()
      })
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rejectRun(error)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (stdout.length > outputLimit || stderr.length > outputLimit) {
          rejectRun(new Error('提取器输出异常'))
          return
        }
        if (code !== 0) {
          let upstreamError = ''
          try {
            const payload = JSON.parse(stdout) as { error?: string }
            upstreamError = payload.error || ''
          } catch {
            // A non-JSON failure is reported from stderr below.
          }
          rejectRun(new Error(upstreamError || stderr.trim().split('\n').at(-1) || '上游服务执行失败'))
          return
        }
        resolveRun(stdout)
      })
    })
  }

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    if (pathname !== '/api/health' && pathname !== '/api/create-checkout' && pathname !== '/api/check-subscription') {
      next()
      return
    }
    if (!isLocalRequest(request)) {
      sendJson(response, 403, { ok: false, error: '仅允许从本机访问此接口' })
      return
    }

    if (pathname === '/api/health') {
      const [pythonReady, extractorReady, subscriptionScriptReady] = await Promise.all([
        exists(pythonPath),
        exists(extractorPath),
        exists(subscriptionPath),
      ])
      const ok = pythonReady && extractorReady
      sendJson(response, ok ? 200 : 503, {
        ok,
        pythonReady,
        extractorReady,
        subscriptionReady: pythonReady && subscriptionScriptReady,
        transport: 'curl_cffi chrome136',
        message: ok
          ? 'Chrome 指纹提取服务已就绪'
          : '未找到参考项目 Python 环境或支付提取器',
      })
      return
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: '仅支持 POST 请求' })
      return
    }

    let body: CheckoutBody = {}
    let temporaryDirectory = ''
    try {
      body = await readBody(request)
      const accessToken = bodyString(body.accessToken)
      const cookieValue = bodyString(body.cookieHeader) || bodyString(body.sessionToken)
      const country = bodyString(body.country).toUpperCase()
      const currency = bodyString(body.currency).toUpperCase()
      const planName = bodyString(body.planName)
      const proxyUrl = validateProxy(bodyString(body.proxyUrl) || defaultProxy)

      if (!accessToken) throw new Error('Session 中缺少 access token')
      if (accessToken.length > 20_000) throw new Error('Access token 长度异常')
      if (cookieValue.length > 20_000) throw new Error('Session Cookie 长度异常')
      if (pathname === '/api/check-subscription') {
        temporaryDirectory = await mkdtemp(join(tmpdir(), 'gpt-subscription-'))
        const credentialPath = join(temporaryDirectory, 'session.json')
        await writeFile(
          credentialPath,
          JSON.stringify({ accessToken, cookie_header: cookieValue || undefined }),
          { encoding: 'utf8', mode: 0o600 },
        )
        const stdout = await runExtractor(
          ['--credential-file', credentialPath],
          proxyUrl,
          subscriptionPath,
          120_000,
        )
        const payload = JSON.parse(stdout) as { ok?: boolean; summary?: unknown; invoices?: unknown }
        if (!payload.ok || !payload.summary || !Array.isArray(payload.invoices)) {
          throw new Error('订阅接口没有返回有效结果')
        }
        sendJson(response, 200, payload)
        return
      }
      if (!countryCurrencies.has(country)) throw new Error('不支持所选账单国家')
      if (countryCurrencies.get(country) !== currency) {
        throw new Error('账单国家与币种不匹配')
      }
      if (!planNames.has(planName)) throw new Error('不支持所选订阅档位')

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'gpt-checkout-'))
      const credentialPath = join(temporaryDirectory, 'session.json')
      await writeFile(
        credentialPath,
        JSON.stringify({
          accessToken,
          cookie_header: cookieValue || undefined,
        }),
        { encoding: 'utf8', mode: 0o600 },
      )

      const stdout = await runExtractor([
        '--credential-file', credentialPath,
        '--billing-country', country,
        '--currency', currency,
        '--checkout-proxy-country', country,
        '--update-proxy-country', country,
        '--plan-name', planName,
        '--checkout-ui-mode', planName === 'chatgptplusplan' ? 'custom' : 'hosted',
        '--checkout-attempts', '3',
        '--update-attempts', '2',
        '--full-attempts', '1',
        '--cf-same-identity-attempts', '2',
        '--cf-retry-delay', '1',
        '--timeout', '45',
      ], proxyUrl, planName === 'chatgptplusplan' ? plusExtractorPath : extractorPath)
      const payload = JSON.parse(stdout) as {
        ok?: boolean
        long_url?: string
        billing_country?: string
      }
      if (!payload.ok || !payload.long_url) {
        throw new Error('提取器没有返回有效支付链接')
      }
      sendJson(response, 200, {
        ok: true,
        url: payload.long_url,
        requestCountry: payload.billing_country || country,
        transport: 'curl_cffi chrome136',
      })
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: safeMessage(error, [
          body.accessToken || '',
          body.cookieHeader || '',
          body.sessionToken || '',
          body.proxyUrl || '',
        ]),
      })
    } finally {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true })
      }
    }
  }

  return {
    name: 'checkout-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void route(request, response, next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        void route(request, response, next)
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), checkoutApi(mode)],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
}))
