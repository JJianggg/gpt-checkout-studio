import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clipboard,
  ExternalLink,
  ClipboardPaste,
  Download,
  Globe2,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { COUNTRIES, PLANS } from './catalog'
import { maskEmail, parseSessionText, type ParsedSession } from './session'
import './App.css'

type Health = {
  ok: boolean
  subscriptionReady?: boolean
  pythonReady?: boolean
  extractorReady?: boolean
  transport?: string
  message?: string
}

type CheckoutResponse = {
  ok?: boolean
  url?: string
  requestCountry?: string
  transport?: string
  error?: string
}

type ViewStatus = 'idle' | 'ready' | 'loading' | 'success' | 'error'

type SubscriptionSummary = {
  email: string | null
  account_id: string
  plan_type: string | null
  subscription_plan: string | null
  has_active_subscription: boolean | null
  will_renew: boolean | null
  is_delinquent: boolean | null
  expires_at: string | null
  renews_at: string | null
  cancels_at: string | null
  grace_period_end: string | null
  billing_period: string | null
  billing_currency: string | null
  purchase_origin_platform: string | null
}

type Invoice = {
  id: string | null
  number: string | null
  date: string | null
  status: string | null
  invoice_url: string | null
  invoice_downloadable: boolean
  receipt_url: string | null
}

type SubscriptionResponse = {
  ok?: boolean
  summary?: SubscriptionSummary
  invoices?: Invoice[]
  subscription_error?: string | null
  invoice_error?: string | null
  error?: string
}

function formatDate(value: string | null) {
  if (!value) return '未提供'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN', { hour12: false })
}

function planLabel(summary: SubscriptionSummary) {
  if (summary.has_active_subscription === false) return '无有效付费订阅'
  const value = `${summary.plan_type || ''} ${summary.subscription_plan || ''}`.toLowerCase()
  if (value.includes('promax')) return 'Pro Max'
  if (value.includes('prolite')) return 'Pro Lite'
  if (value.includes('plus')) return 'Plus'
  if (value.includes('pro')) return 'Pro'
  if (value.includes('free')) return 'Free'
  if (value.includes('team') || value.includes('business')) return 'Business'
  return summary.plan_type || summary.subscription_plan || '未知套餐'
}

function platformLabel(value: string | null) {
  if (!value) return '未提供'
  if (value.includes('ios') || value.includes('app_store')) return 'Apple App Store'
  if (value.includes('android') || value.includes('play_store')) return 'Google Play'
  if (value.includes('web')) return 'ChatGPT 网页'
  return value
}

function subscriptionVerdict(summary: SubscriptionSummary) {
  if (summary.is_delinquent) return '付款异常'
  if (summary.has_active_subscription === true && summary.will_renew === false) return '本期有效，已停止续费'
  if (summary.has_active_subscription === true) return '订阅有效'
  if (summary.has_active_subscription === false) return '当前无有效订阅'
  return '订阅状态未知'
}

const progressSteps = ['验证会话', '匹配出口地区', '创建结账链接']

export default function App() {
  const [session, setSession] = useState<ParsedSession | null>(null)
  const [sessionInput, setSessionInput] = useState('')
  const [parseError, setParseError] = useState('')
  const [countryCode, setCountryCode] = useState('PH')
  const [planId, setPlanId] = useState('chatgptprolite')
  const [proxyUrl, setProxyUrl] = useState('http://127.0.0.1:7890')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState<ViewStatus>('idle')
  const [activeStep, setActiveStep] = useState(0)
  const [message, setMessage] = useState('')
  const [checkoutUrl, setCheckoutUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [health, setHealth] = useState<Health | null>(null)
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [subscriptionResult, setSubscriptionResult] = useState<SubscriptionResponse | null>(null)
  const [subscriptionError, setSubscriptionError] = useState('')
  const subscriptionRequest = useRef(0)

  const selectedCountry = useMemo(
    () => COUNTRIES.find((country) => country.code === countryCode) ?? COUNTRIES[0],
    [countryCode],
  )
  const selectedPlan = useMemo(
    () => PLANS.find((plan) => plan.id === planId) ?? PLANS[1],
    [planId],
  )

  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as Health
        setHealth(payload)
      })
      .catch(() => {
        setHealth({ ok: false, message: '本地 Chrome 指纹服务未连接' })
      })
  }, [])

  useEffect(() => {
    if (!subscriptionOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSubscriptionOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [subscriptionOpen])

  function acceptSessionText(value: string) {
    subscriptionRequest.current += 1
    setSubscriptionResult(null)
    setSubscriptionStatus('idle')
    setSubscriptionError('')
    setSessionInput(value)
    setMessage('')
    setCheckoutUrl('')
    setCopied(false)

    if (!value.trim()) {
      setSession(null)
      setParseError('')
      setStatus('idle')
      return
    }

    try {
      const parsed = parseSessionText(value)
      setSession(parsed)
      setParseError('')
      setStatus('ready')
    } catch (error) {
      setSession(null)
      setStatus('idle')
      setParseError(error instanceof Error ? error.message : '无法解析 Session 内容')
    }
  }

  function clearSession() {
    subscriptionRequest.current += 1
    setSubscriptionResult(null)
    setSubscriptionStatus('idle')
    setSubscriptionError('')
    setSessionInput('')
    setSession(null)
    setParseError('')
    setCheckoutUrl('')
    setMessage('')
    setStatus('idle')
  }

  async function createCheckout() {
    if (!session || !confirmed || !health?.ok) return

    setStatus('loading')
    setMessage('')
    setCheckoutUrl('')
    setActiveStep(0)

    const timers = [
      window.setTimeout(() => setActiveStep(1), 700),
      window.setTimeout(() => setActiveStep(2), 1500),
    ]

    try {
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: session.accessToken,
          cookieHeader: session.cookieHeader,
          sessionToken: session.sessionToken,
          country: selectedCountry.code,
          currency: selectedCountry.currency,
          planName: selectedPlan.id,
          proxyUrl,
        }),
      })
      const payload = (await response.json()) as CheckoutResponse
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || '未能创建支付链接')
      }

      setActiveStep(3)
      setCheckoutUrl(payload.url)
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : '请求失败，请稍后重试')
    } finally {
      timers.forEach(window.clearTimeout)
    }
  }

  async function copyLink() {
    if (!checkoutUrl) return
    await navigator.clipboard.writeText(checkoutUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  async function checkSubscription() {
    setSubscriptionOpen(true)
    if (!session) {
      setSubscriptionStatus('idle')
      setSubscriptionError('请先在页面中粘贴 Session 或 access token。')
      return
    }
    if (health?.subscriptionReady === false) {
      setSubscriptionStatus('error')
      setSubscriptionError('本地 Python 订阅查询服务未就绪，请检查 Python 环境。')
      return
    }
    const requestId = ++subscriptionRequest.current
    setSubscriptionStatus('loading')
    setSubscriptionError('')
    setSubscriptionResult(null)
    try {
      const response = await fetch('/api/check-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          accessToken: session.accessToken,
          cookieHeader: session.cookieHeader,
          sessionToken: session.sessionToken,
          proxyUrl,
        }),
      })
      const payload = (await response.json()) as SubscriptionResponse
      if (!response.ok || !payload.ok || !payload.summary || !Array.isArray(payload.invoices)) {
        throw new Error(payload.error || '订阅查询失败')
      }
      if (requestId !== subscriptionRequest.current) return
      setSubscriptionResult(payload)
      setSubscriptionStatus('success')
    } catch (error) {
      if (requestId !== subscriptionRequest.current) return
      setSubscriptionStatus('error')
      setSubscriptionError(error instanceof Error ? error.message : '订阅查询失败')
    }
  }

  const canCreate = Boolean(session && confirmed && health?.ok && status !== 'loading')

  return (
    <div className='app-shell'>
      <header className='topbar'>
        <div className='topbar-left'>
          <a className='brand' href='/' aria-label='Checkout Studio 首页'>
            <span className='brand-mark'><Link2 size={19} strokeWidth={2.4} /></span>
            <span>Checkout Studio</span>
          </a>
          <button className='subscription-trigger' type='button' onClick={() => void checkSubscription()}>
            <BadgeCheck size={16} /> 查询 GPT 实际订阅
          </button>
        </div>
        <div className='topbar-right'>
          <span className='privacy-pill'><ShieldCheck size={15} /> Chrome 指纹传输，不保存凭证</span>
          <span className={health?.ok ? 'status-dot online' : 'status-dot'} />
          <span className='service-label'>
            {health === null ? '正在检测' : health.ok ? '提取器就绪' : '服务异常'}
          </span>
        </div>
      </header>

      {subscriptionOpen && (
        <div className='subscription-overlay' onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSubscriptionOpen(false)
        }}>
          <section className='subscription-dialog' role='dialog' aria-modal='true' aria-labelledby='subscription-title'>
            <div className='subscription-dialog-head'>
              <div>
                <span className='subscription-kicker'>OPENAI · 实时查询</span>
                <h2 id='subscription-title'>当前账号订阅详情</h2>
              </div>
              <button type='button' className='icon-button' onClick={() => setSubscriptionOpen(false)} aria-label='关闭订阅详情'><X size={19} /></button>
            </div>

            {subscriptionStatus === 'loading' && (
              <div className='subscription-state'><LoaderCircle className='spin' size={26} /><span>正在向 ChatGPT 查询订阅和账单…</span></div>
            )}
            {subscriptionError && subscriptionStatus !== 'loading' && (
              <div className='subscription-error'><CircleAlert size={18} /> {subscriptionError}</div>
            )}
            {subscriptionResult?.summary && subscriptionStatus === 'success' && (
              <>
                <div className='subscription-verdict'>
                  <span>查询结果</span>
                  <strong>{subscriptionVerdict(subscriptionResult.summary)}</strong>
                </div>
                {subscriptionResult.subscription_error && (
                  <p className='invoice-note subscription-partial'>订阅接口暂不可用（{subscriptionResult.subscription_error}），以下为 ChatGPT 账号接口返回的订阅信息。</p>
                )}
                <div className='subscription-details'>
                  <div><span>账号邮箱</span><strong>{subscriptionResult.summary.email || '未提供'}</strong></div>
                  <div><span>当前套餐</span><strong>{planLabel(subscriptionResult.summary)}</strong></div>
                  <div><span>{subscriptionResult.summary.has_active_subscription === false ? '最近订阅标识' : 'OpenAI 套餐标识'}</span><strong>{subscriptionResult.summary.subscription_plan || '未提供'}</strong></div>
                  <div><span>{subscriptionResult.summary.has_active_subscription === false ? '最近订阅到期时间' : '本期有效至'}</span><strong>{formatDate(subscriptionResult.summary.expires_at)}</strong></div>
                  <div><span>续费状态</span><strong>{subscriptionResult.summary.will_renew === null ? '未提供' : subscriptionResult.summary.will_renew ? '预计续费' : '不会续费'}</strong></div>
                  {subscriptionResult.summary.renews_at && <div><span>预计续费时间</span><strong>{formatDate(subscriptionResult.summary.renews_at)}</strong></div>}
                  {subscriptionResult.summary.cancels_at && <div><span>取消时间</span><strong>{formatDate(subscriptionResult.summary.cancels_at)}</strong></div>}
                  {subscriptionResult.summary.grace_period_end && <div><span>宽限期至</span><strong>{formatDate(subscriptionResult.summary.grace_period_end)}</strong></div>}
                  <div><span>购买渠道</span><strong>{platformLabel(subscriptionResult.summary.purchase_origin_platform)}</strong></div>
                  {subscriptionResult.summary.billing_period && <div><span>账单周期</span><strong>{subscriptionResult.summary.billing_period}</strong></div>}
                  {subscriptionResult.summary.billing_currency && <div><span>账单币种</span><strong>{subscriptionResult.summary.billing_currency}</strong></div>}
                  <div><span>账号 ID</span><strong className='account-id'>{subscriptionResult.summary.account_id}</strong></div>
                </div>

                <div className='invoice-heading'><h3>账单与收据</h3><span>{subscriptionResult.invoices?.length || 0} 条记录</span></div>
                {subscriptionResult.invoice_error ? (
                  <p className='invoice-note'>账单接口暂不可用（{subscriptionResult.invoice_error}）。可到 ChatGPT 账户设置中的付款管理页查看。</p>
                ) : subscriptionResult.invoices?.length ? (
                  <div className='invoice-list'>
                    {subscriptionResult.invoices.map((invoice, index) => (
                      <div className='invoice-row' key={invoice.id || `${invoice.number || 'invoice'}-${index}`}>
                        <div className='invoice-meta'>
                          <strong>{invoice.number || invoice.id || `账单 ${index + 1}`}</strong>
                          <span>{formatDate(invoice.date)}{invoice.status ? ` · ${invoice.status}` : ''}</span>
                        </div>
                        <div className='invoice-actions'>
                          {invoice.invoice_url && <a href={invoice.invoice_url} target='_blank' rel='noopener noreferrer'><Download size={14} /> {invoice.invoice_downloadable ? '下载账单' : '查看账单'}</a>}
                          {invoice.receipt_url && <a href={invoice.receipt_url} target='_blank' rel='noopener noreferrer'><Download size={14} /> 下载收据</a>}
                          {!invoice.invoice_url && !invoice.receipt_url && <span>未提供下载链接</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className='invoice-note'>当前账号没有返回账单或收据记录。App Store 和 Google Play 购买的收据请在对应商店的购买记录中查看。</p>
                )}
              </>
            )}
            <div className='subscription-dialog-foot'>
              <span>数据来自当前 Session 的 ChatGPT 接口</span>
              <button type='button' onClick={() => void checkSubscription()} disabled={!session || subscriptionStatus === 'loading'}><RefreshCw size={15} /> 重新查询</button>
            </div>
          </section>
        </div>
      )}

      <main>
        <section className='hero'>
          <div className='eyebrow'><Sparkles size={14} /> GPT SUBSCRIPTION CHECKOUT</div>
          <h1>三步生成你的<br /><span>GPT 支付链接</span></h1>
          <p>粘贴账号会话，选择账单地区与订阅档位。请求使用参考项目同款 Chrome 136 指纹传输，降低普通 Node 转发触发风控的概率。</p>
          <div className='hero-trust'>
            <span><CheckCircle2 size={16} /> Session 仅在本机使用</span>
            <span><CheckCircle2 size={16} /> 不存储支付信息</span>
          </div>
        </section>

        <section className='workspace'>
          <div className='builder'>
            <article className='step-card'>
              <div className='step-head'>
                <span className='step-number'>01</span>
                <div>
                  <h2>粘贴 GPT Session</h2>
                  <p>支持完整 Session JSON 或单独的 access token</p>
                </div>
                {session && <span className='done-badge'><Check size={14} /> 已就绪</span>}
              </div>

              <div className={session ? 'session-input valid' : parseError ? 'session-input invalid' : 'session-input'}>
                <div className='session-input-head'>
                  <span><ClipboardPaste size={16} /> Session / Access Token</span>
                  <div>
                    {session && <span className='verified'><BadgeCheck size={15} /> 已自动识别</span>}
                    {sessionInput && (
                      <button type='button' onClick={clearSession}>
                        <X size={14} /> 清空
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={sessionInput}
                  onChange={(event) => acceptSessionText(event.target.value)}
                  placeholder={'在此粘贴完整 Session JSON，或直接粘贴 access token\n\n示例：{ accessToken: eyJ... }'}
                  spellCheck={false}
                  autoComplete='off'
                  aria-label='GPT Session 或 Access Token'
                />
                <div className='session-input-foot'>
                  {parseError ? (
                    <span className='parse-error'><CircleAlert size={14} /> {parseError}</span>
                  ) : session ? (
                    <span className='parse-success'><CheckCircle2 size={14} /> {maskEmail(session.email)} · 内容已提取</span>
                  ) : (
                    <span><ShieldCheck size={14} /> 粘贴后自动提取，内容不会存入浏览器持久化存储</span>
                  )}
                  <em>{sessionInput.length.toLocaleString()} 字符</em>
                </div>
              </div>
            </article>

            <article className='step-card'>
              <div className='step-head'>
                <span className='step-number'>02</span>
                <div>
                  <h2>选择账单地区</h2>
                  <p>代理出口、账单国家和币种需要保持一致</p>
                </div>
              </div>

              <div className='field-grid'>
                <label className='field'>
                  <span>国家或地区</span>
                  <div className='select-wrap'>
                    <span className='select-flag'>{selectedCountry.flag}</span>
                    <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                      {COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name} · {country.code}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={17} />
                  </div>
                </label>
                <label className='field'>
                  <span>结算币种</span>
                  <div className='currency-box'>
                    <Globe2 size={17} />
                    <strong>{selectedCountry.currency}</strong>
                    <em>自动匹配</em>
                  </div>
                </label>
              </div>

              <button
                type='button'
                className='advanced-toggle'
                onClick={() => setAdvancedOpen((open) => !open)}
                aria-expanded={advancedOpen}
              >
                <span>代理设置</span>
                <span className={advancedOpen ? 'toggle-arrow open' : 'toggle-arrow'}><ChevronDown size={16} /></span>
              </button>
              {advancedOpen && (
                <div className='advanced-panel'>
                  <label className='field'>
                    <span>Checkout 代理地址</span>
                    <div className='proxy-input'>
                      <Globe2 size={16} />
                      <input
                        value={proxyUrl}
                        onChange={(event) => setProxyUrl(event.target.value)}
                        placeholder='http://127.0.0.1:7890'
                        spellCheck={false}
                      />
                    </div>
                  </label>
                  <p>请先在 Clash 中切换到 {selectedCountry.name} 节点；提取器会在创建 Checkout 前验证真实出口国家。</p>
                </div>
              )}
            </article>

            <article className='step-card'>
              <div className='step-head'>
                <span className='step-number'>03</span>
                <div>
                  <h2>选择订阅档位</h2>
                  <p>套餐是否开放以及最终价格以 ChatGPT 结账页为准</p>
                </div>
              </div>
              <div className='plan-grid'>
                {PLANS.map((plan) => (
                  <button
                    type='button'
                    key={plan.id}
                    className={plan.id === planId ? 'plan-card selected' : 'plan-card'}
                    onClick={() => setPlanId(plan.id)}
                  >
                    <span className='radio-mark'>{plan.id === planId && <span />}</span>
                    <span className='plan-copy'>
                      <strong>{plan.name}</strong>
                      <small>{plan.description}</small>
                    </span>
                    <span className='plan-right'>
                      {plan.badge && <em>{plan.badge}</em>}
                      <b>{plan.priceHint}</b>
                    </span>
                  </button>
                ))}
              </div>
            </article>
          </div>

          <aside className='summary-card'>
            <div className='summary-glow' />
            <div className='summary-kicker'><LockKeyhole size={14} /> CHECKOUT SUMMARY</div>
            <h2>确认生成信息</h2>

            <div className='summary-list'>
              <div>
                <span>账号会话</span>
                <strong>{session ? maskEmail(session.email) : '等待粘贴'}</strong>
              </div>
              <div>
                <span>账单地区</span>
                <strong>{selectedCountry.flag} {selectedCountry.name}</strong>
              </div>
              <div>
                <span>结算币种</span>
                <strong>{selectedCountry.currency}</strong>
              </div>
              <div>
                <span>订阅档位</span>
                <strong>{selectedPlan.name}</strong>
              </div>
            </div>

            <div className='divider' />
            <label className='consent'>
              <input
                type='checkbox'
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span className='checkmark'><Check size={13} /></span>
              <span>我确认该会话属于本人或已获得账号所有者明确授权，并理解账单地区需与代理出口一致。</span>
            </label>

            <button
              className='primary-button'
              type='button'
              disabled={!canCreate}
              onClick={() => void createCheckout()}
            >
              {status === 'loading' ? (
                <><LoaderCircle className='spin' size={19} /> 正在生成</>
              ) : (
                <>生成支付链接 <ArrowRight size={19} /></>
              )}
            </button>

            {!health?.ok && health !== null && (
              <div className='inline-alert'>
                <CircleAlert size={17} />
                <span>{health.message || 'Chrome 指纹提取服务未就绪，请检查参考项目 Python 环境。'}</span>
              </div>
            )}

            {status === 'loading' && (
              <div className='progress-box'>
                {progressSteps.map((step, index) => (
                  <div className='progress-row' key={step}>
                    <span className={index < activeStep ? 'progress-icon done' : index === activeStep ? 'progress-icon active' : 'progress-icon'}>
                      {index < activeStep ? <Check size={13} /> : index + 1}
                    </span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            )}

            {status === 'success' && checkoutUrl && (
              <div className='result-box'>
                <div className='result-title'><CheckCircle2 size={18} /> 支付链接已生成</div>
                <div className='result-url'>{checkoutUrl}</div>
                <div className='result-actions'>
                  <button type='button' onClick={() => void copyLink()}>
                    {copied ? <Check size={16} /> : <Clipboard size={16} />}
                    {copied ? '已复制' : '复制链接'}
                  </button>
                  <a href={checkoutUrl} target='_blank' rel='noreferrer'>
                    打开结账页 <ExternalLink size={15} />
                  </a>
                </div>
              </div>
            )}

            {status === 'error' && message && (
              <div className='error-box'>
                <CircleAlert size={18} />
                <div>
                  <strong>生成失败</strong>
                  <p>{message}</p>
                </div>
                <button type='button' onClick={() => setMessage('')} aria-label='关闭错误'><X size={16} /></button>
              </div>
            )}

            <p className='summary-note'>
              <KeyRound size={14} />
              生成链接不会自动扣款，请在 ChatGPT 托管结账页核对套餐、币种与金额。
            </p>
          </aside>
        </section>

        <section className='notice'>
          <div className='notice-icon'><CircleAlert size={20} /></div>
          <div>
            <strong>使用前请注意</strong>
            <p>此工具调用 ChatGPT Web 内部结账流程，并非稳定的公开 API。接口或套餐标识可能随平台更新而失效，请勿批量滥用，且只处理已获授权的账号。</p>
          </div>
          <button type='button' onClick={() => window.location.reload()} title='重新检查服务'>
            <RefreshCw size={17} />
          </button>
        </section>
      </main>

      <footer>
        <span>Checkout Studio · Local-first utility</span>
        <span>凭证只交给本机 curl_cffi 请求进程，调用后立即清理</span>
      </footer>
    </div>
  )
}
