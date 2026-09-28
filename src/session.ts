export type ParsedSession = {
  accessToken: string
  cookieHeader?: string
  sessionToken?: string
  email?: string
}

const ACCESS_TOKEN_KEYS = ['accessToken', 'access_token', 'token']
const COOKIE_KEYS = [
  'cookie_header',
  'cookieHeader',
  'chatgpt_session_cookie',
  'session_cookie',
]
const SESSION_TOKEN_KEYS = ['sessionToken', 'session_token']

function findString(
  value: unknown,
  keys: string[],
  visited = new WeakSet<object>(),
): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (visited.has(value)) return undefined
  visited.add(value)

  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      return record[key].trim()
    }
  }

  for (const nested of Object.values(record)) {
    const match = findString(nested, keys, visited)
    if (match) return match
  }

  return undefined
}

export function parseSessionText(input: string): ParsedSession {
  if (input.length > 2 * 1024 * 1024) {
    throw new Error('内容超过 2 MB，请粘贴原始 session JSON 或 access token。')
  }

  const raw = input.trim()
  if (!raw) throw new Error('请输入 Session JSON 或 access token。')

  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    if (raw.split('.').length >= 3 || raw.startsWith('eyJ')) {
      return { accessToken: raw }
    }
    throw new Error('未识别到有效的 access token 或 session JSON。')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('JSON 格式无效，请检查 session 文件。')
  }

  const accessToken = findString(parsed, ACCESS_TOKEN_KEYS)
  if (!accessToken) {
    throw new Error('文件中没有找到 accessToken。')
  }

  return {
    accessToken,
    cookieHeader: findString(parsed, COOKIE_KEYS),
    sessionToken: findString(parsed, SESSION_TOKEN_KEYS),
    email: findString(parsed, ['email']),
  }
}

export function maskEmail(email?: string) {
  if (!email || !email.includes('@')) return '已识别会话'
  const [name, domain] = email.split('@')
  const visible = name.slice(0, Math.min(2, name.length))
  return `${visible}${'•'.repeat(Math.max(3, name.length - visible.length))}@${domain}`
}
