import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowDownUp,
  Bell,
  Bookmark,
  ChevronDown,
  Clock3,
  CreditCard,
  Handshake,
  LayoutGrid,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquare,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Wallet,
} from 'lucide-react'
import { api, socketUrl, trackEvent } from './api'
import type { Conversation, Match, Message, Notification, Request, User } from './types'

const nav = [
  { to: '/', label: 'Market', icon: LayoutGrid },
  { to: '/post', label: 'Post request', icon: Plus },
  { to: '/matches', label: 'Matches', icon: Handshake },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/my-requests', label: 'My requests', icon: Wallet },
  { to: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/settings', label: 'Settings', icon: Settings2 },
] as const
const number = (value: string | number) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
const money = (value: string | number, currency: 'USD' | 'UZS') =>
  currency === 'USD' ? `$${number(value)}` : `${number(value)} UZS`
const ago = (date: string) => {
  const min = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 60000))
  return min < 60 ? `${min} min ago` : min < 1440 ? `${Math.floor(min / 60)} hr ago` : `${Math.floor(min / 1440)} d ago`
}
const displayName = (request: Request) =>
  request.user
    ? `${request.user.firstName} ${request.user.lastName ? request.user.lastName.charAt(0) + '.' : ''}`
    : 'Colleague'
const method = (value: Request['exchangeMethod']) =>
  value === 'BANK_TRANSFER' ? 'Bank transfer' : value === 'CASH' ? 'Cash' : 'Either'
const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<{ user: User }>('/auth/me'), retry: false })
const useInvalidate = () => {
  const client = useQueryClient()
  return useCallback(
    (event: MessageEvent<string>) => {
      const type = (JSON.parse(event.data) as { type: string }).type
      const keys =
        type === 'message'
          ? ['messages', 'conversations', 'notifications']
          : type === 'match_found' || type === 'match_updated'
            ? ['matches', 'mine', 'requests', 'notifications']
            : type === 'notification'
              ? ['notifications']
              : ['requests', 'mine', 'stats', 'notifications']
      for (const key of keys) client.invalidateQueries({ queryKey: [key] })
    },
    [client],
  )
}

function Avatar({ src, name, size = 34 }: { src?: string | null; name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {src ? (
        <img src={src} alt="" />
      ) : (
        name
          .split(' ')
          .map((s) => s[0])
          .slice(0, 2)
          .join('')
      )}
    </span>
  )
}
function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Search
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  )
}
function LoadingCards() {
  return (
    <div className="cards">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="request-card skeleton" key={i}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  )
}
function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="error-box">
      {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
    </div>
  )
}

declare global {
  interface Window {
    onTelegramAuth?: (data: Record<string, unknown>) => void
  }
}
function Login() {
  const client = useQueryClient()
  const [error, setError] = useState('')
  useEffect(() => {
    const username = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined
    if (!username) return
    window.onTelegramAuth = async (data) => {
      try {
        await api('/auth/telegram', { method: 'POST', body: JSON.stringify(data) })
        client.invalidateQueries({ queryKey: ['me'] })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign in failed')
      }
    }
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', username)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    document.getElementById('telegram-login')?.appendChild(script)
    return () => {
      window.onTelegramAuth = undefined
      script.remove()
    }
  }, [client])
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand large">
          <span className="brand-icon">↗</span>
          <strong>Almash</strong>
        </div>
        <span className="eyebrow">COLLEAGUE EXCHANGE</span>
        <h1>Exchange with people you know.</h1>
        <p>Post what you need, find a compatible colleague, and connect directly. Almash never handles your money.</p>
        {import.meta.env.VITE_TELEGRAM_BOT_USERNAME && <div id="telegram-login" className="telegram-login" />}
        {!import.meta.env.VITE_TELEGRAM_BOT_USERNAME && (
          <div className="error-box">
            Telegram sign in is not configured yet. Set VITE_TELEGRAM_BOT_USERNAME and TELEGRAM_BOT_TOKEN.
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        <div className="login-note">
          <ShieldCheck size={17} /> Private community · Direct colleague to colleague exchange
        </div>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useMe()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const invalidate = useInvalidate()
  const client = useQueryClient()
  const [showNotifications, setShowNotifications] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/notifications'),
    enabled: !!data,
  })
  const unread = notifications?.filter((n) => !n.readAt).length ?? 0
  useEffect(() => {
    if (!data) return
    let closed = false
    let ws: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      ws = new WebSocket(socketUrl())
      ws.onmessage = invalidate
      ws.onclose = () => {
        if (!closed) timer = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      ws?.close()
    }
  }, [data, invalidate])
  if (isLoading)
    return (
      <div className="boot">
        <div className="brand">
          <span className="brand-icon">↗</span>
          <strong>Almash</strong>
        </div>
      </div>
    )
  if (!data)
    return error instanceof Error && !error.message.includes('sign in') && !error.message.includes('401') ? (
      <Login />
    ) : (
      <Login />
    )
  const user = data.user
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' })
    client.clear()
  }
  const markAll = async () => {
    await api('/notifications/read-all', { method: 'POST' })
    client.invalidateQueries({ queryKey: ['notifications'] })
  }
  return (
    <div className="app">
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <Link to="/" className="brand" onClick={() => setMobileMenu(false)}>
          <span className="brand-icon">↗</span>
          <span>
            <strong>Almash</strong>
            <small>Colleagues exchange, easier</small>
          </span>
        </Link>
        <nav className="side-nav">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`nav-item ${path === item.to ? 'active' : ''}`}
              onClick={() => setMobileMenu(false)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.to === '/matches' && unread > 0 && <b className="nav-badge">{unread}</b>}
            </Link>
          ))}
          {user.role === 'ADMIN' && (
            <Link to="/admin" className={`nav-item ${path === '/admin' ? 'active' : ''}`}>
              <ShieldCheck size={17} /> Admin
            </Link>
          )}
        </nav>
        <div className="sidebar-tip">
          <span>♧</span>
          <p>A safer and faster way to exchange USD ↔ UZS within our colleagues.</p>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileMenu((v) => !v)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <div className="topbar-spacer" />
          <div className="notification-wrap">
            <button className="icon-button" onClick={() => setShowNotifications((v) => !v)} aria-label="Notifications">
              <Bell size={20} />
              {unread > 0 && <i className="dot" />}
            </button>
            {showNotifications && (
              <div className="notification-panel">
                <div className="panel-heading">
                  <strong>Notifications</strong>
                  <button onClick={markAll}>Mark all read</button>
                </div>
                {notifications?.length ? (
                  notifications.map((n) => (
                    <Link
                      key={n.id}
                      to={(n.link || '/') as '/'}
                      className={`notification ${!n.readAt ? 'unread' : ''}`}
                      onClick={async () => {
                        await api(`/notifications/${n.id}/read`, { method: 'POST' })
                        setShowNotifications(false)
                        client.invalidateQueries({ queryKey: ['notifications'] })
                      }}
                    >
                      <strong>{n.title}</strong>
                      <span>{n.body}</span>
                      <small>{ago(n.createdAt)}</small>
                    </Link>
                  ))
                ) : (
                  <p className="muted panel-empty">No notifications yet.</p>
                )}
              </div>
            )}
          </div>
          <Link to="/profile" className="top-user">
            <Avatar src={user.avatarUrl} name={user.displayName} size={30} />
            <span>{user.displayName}</span>
            <ChevronDown size={14} />
          </Link>
        </header>
        <main>{children}</main>
      </div>
      <nav className="bottom-nav">
        {[nav[0], nav[2], nav[1], nav[3], nav[6]].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`${path === item.to ? 'active' : ''} ${item.to === '/post' ? 'post-tab' : ''}`}
          >
            <item.icon size={20} />
            <span>{item.to === '/post' ? 'Post' : item.label}</span>
          </Link>
        ))}
      </nav>
      <button className="logout-floating" onClick={logout} title="Log out">
        <LogOut size={17} />
      </button>
    </div>
  )
}

function RequestCard({ item, bookmarked }: { item: Request; bookmarked?: boolean }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const toggleBookmark = async () => {
    setBusy(true)
    try {
      await api(`/bookmarks/${item.id}`, { method: bookmarked ? 'DELETE' : 'POST' })
      client.invalidateQueries({ queryKey: ['bookmarks'] })
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="request-card">
      <div className="card-top">
        <span className={`pill ${item.needCurrency === 'USD' ? 'green' : 'blue'}`}>Need {item.needCurrency}</span>
        <small>
          {item.status === 'EXPIRED' || new Date(item.expiresAt) <= new Date() ? 'Expired' : ago(item.createdAt)}
        </small>
      </div>
      <div className="amount-line">{money(item.needAmount, item.needCurrency)}</div>
      <p className="offer-line">
        Offering: <b>{money(item.offerAmount, item.offerCurrency)}</b>
      </p>
      <p className="rate-line">({number(item.exchangeRate)} UZS per $)</p>
      <a className="card-person" href={`/users/${item.userId}`}>
        <Avatar src={item.user?.avatarUrl} name={displayName(item)} size={28} />
        <div>
          <strong>{displayName(item)}</strong>
          <small>
            <MapPin size={11} />
            {item.location || item.user?.location || 'Tashkent'}
          </small>
        </div>
        {item.user?.verified && <ShieldCheck size={15} className="verified" />}
      </a>
      <div className="card-method">
        <CreditCard size={13} />
        {method(item.exchangeMethod)}
      </div>
      <div className="card-actions">
        <button className="outline-button" onClick={() => navigate({ to: '/matches' })}>
          Contact
        </button>
        <button
          className="bookmark-button"
          onClick={toggleBookmark}
          disabled={busy}
          aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
        >
          <Bookmark size={17} fill={bookmarked ? 'currentColor' : 'none'} />
        </button>
      </div>
    </article>
  )
}

export function Market() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])
  const query = new URLSearchParams({ page: String(page), sort })
  if (debounced) query.set('search', debounced)
  if (filter === 'Need USD' || filter === 'Need UZS') query.set('need', filter.slice(-3))
  if (filter === 'Cash') query.set('method', 'CASH')
  if (filter === 'Bank transfer') query.set('method', 'BANK_TRANSFER')
  if (filter === 'Tashkent' || filter === 'Office') query.set('location', filter)
  const { data, isLoading, error } = useQuery({
    queryKey: ['requests', query.toString()],
    queryFn: () => api<{ items: Request[]; total: number; page: number }>(`/requests?${query}`),
  })
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<{ requests: number; colleagues: number }>('/stats'),
  })
  const { data: bookmarks } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: () => api<{ requestId: string }[]>('/bookmarks'),
  })
  const bookmarkIds = new Set(bookmarks?.map((b) => b.requestId))
  const filters = ['All', 'Need USD', 'Need UZS', 'Tashkent', 'Office', 'Cash', 'Bank transfer']
  return (
    <div className="market-layout">
      <div className="market-main">
        <div className="hero-row">
          <div>
            <span className="eyebrow desktop-eyebrow">THE MARKETPLACE</span>
            <h1>Exchange with colleagues</h1>
            <p>Post what you need. Find the right match. Simple and secure.</p>
          </div>
          <div className="stats-card">
            <div>
              <strong>{stats?.requests ?? '—'}</strong>
              <span>Active requests</span>
            </div>
            <div>
              <strong>{stats?.colleagues ?? '—'}</strong>
              <span>Colleagues</span>
              <small>
                <i /> Active community
              </small>
            </div>
          </div>
        </div>
        <div className="need-buttons">
          <Link to="/post" search={{ need: 'USD' }} className="need-primary">
            I need USD <span>💵</span>
          </Link>
          <Link to="/post" search={{ need: 'UZS' }} className="need-secondary">
            I need UZS <span>🇺🇿</span>
          </Link>
        </div>
        <div className="search-field">
          <Search size={18} />
          <input
            placeholder="Search by amount, rate, location, or name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="filter-row">
          <div className="filters">
            {filters.map((f) => (
              <button
                key={f}
                className={`filter-chip ${filter === f ? 'selected' : ''}`}
                onClick={() => {
                  setFilter(f)
                  setPage(1)
                }}
              >
                {f}
              </button>
            ))}
          </div>
          <label className="sort-select">
            Sort:{' '}
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="amount">Amount</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        {error && <ErrorBox error={error} />}{' '}
        {isLoading ? (
          <LoadingCards />
        ) : data?.items.length ? (
          <>
            <div className="cards">
              {data.items.map((item) => (
                <RequestCard key={item.id} item={item} bookmarked={bookmarkIds.has(item.id)} />
              ))}
            </div>
            {data.total > 18 && (
              <div className="pagination">
                <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span>
                  Page {page} of {Math.ceil(data.total / 18)}
                </span>
                <button disabled={page * 18 >= data.total} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            )}
          </>
        ) : (
          <Empty
            icon={Search}
            title="No active requests"
            body="Post what you need and we’ll look for a match."
            action={
              <Link to="/post" className="primary-button">
                Post request
              </Link>
            }
          />
        )}
      </div>
      <aside className="right-rail">
        <RequestForm compact />
        <MatchPreview />
      </aside>
    </div>
  )
}

const formSchema = z.object({
  needCurrency: z.enum(['USD', 'UZS']),
  needAmount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter a valid amount'),
  rateType: z.enum(['MARKET', 'CUSTOM']),
  exchangeRate: z.string().regex(/^\d{1,7}(\.\d{1,4})?$/, 'Enter a valid rate'),
  exchangeMethod: z.enum(['CASH', 'BANK_TRANSFER', 'EITHER']),
  location: z.string().max(80),
  expiresInMinutes: z.number(),
})
type FormValues = z.infer<typeof formSchema>
function RequestForm({ compact = false, editRequest }: { compact?: boolean; editRequest?: Request }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [feedback, setFeedback] = useState('')
  const { data: reference } = useQuery({
    queryKey: ['rate'],
    queryFn: () => api<{ rate: string; source: string; fetchedAt: string } | null>('/rates/current'),
  })
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      needCurrency: new URLSearchParams(window.location.search).get('need') === 'UZS' ? 'UZS' : 'USD',
      needAmount: '400',
      rateType: 'CUSTOM',
      exchangeRate: '',
      exchangeMethod: 'CASH',
      location: 'Office / Tashkent',
      expiresInMinutes: 120,
    },
  })
  useEffect(() => {
    if (editRequest)
      reset({
        needCurrency: editRequest.needCurrency,
        needAmount: editRequest.needAmount,
        rateType: editRequest.rateType,
        exchangeRate: editRequest.exchangeRate,
        exchangeMethod: editRequest.exchangeMethod,
        location: editRequest.location || '',
        expiresInMinutes: 120,
      })
  }, [editRequest, reset])
  const rateType = watch('rateType'),
    currency = watch('needCurrency'),
    amount = watch('needAmount'),
    rate = watch('exchangeRate')
  useEffect(() => {
    if (reference?.rate && rateType === 'MARKET') setValue('exchangeRate', reference.rate)
  }, [reference?.rate, rateType, setValue])
  useEffect(() => {
    if (reference?.rate && !editRequest && !dirtyFields.rateType && !dirtyFields.exchangeRate) {
      setValue('rateType', 'MARKET')
      setValue('exchangeRate', reference.rate)
    }
  }, [reference?.rate, editRequest, dirtyFields.rateType, dirtyFields.exchangeRate, setValue])
  const estimate = Number(amount) * Number(rate)
  const submit = async (input: FormValues) => {
    try {
      await api(editRequest ? `/requests/${editRequest.id}` : '/requests', {
        method: editRequest ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...input, location: input.location || undefined }),
      })
      client.invalidateQueries({ queryKey: ['requests'] })
      client.invalidateQueries({ queryKey: ['mine'] })
      client.invalidateQueries({ queryKey: ['matches'] })
      setFeedback(editRequest ? 'Request updated.' : 'Request posted. We’ll notify you when a colleague matches.')
      if (!compact) navigate({ to: '/my-requests' })
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not save request.')
    }
  }
  return (
    <section className={`post-panel ${compact ? 'compact' : ''}`}>
      <div className="panel-title">
        <div>
          <h2>{editRequest ? 'Edit request' : 'Post a request'}</h2>
          <p>Tell your colleagues what you need.</p>
        </div>
        {compact && (
          <Link to="/post" aria-label="Expand form">
            <SlidersHorizontal size={16} />
          </Link>
        )}
      </div>
      <form onSubmit={handleSubmit(submit)}>
        <label className="field-label">What do you need?</label>
        <div className="segment">
          <button
            type="button"
            className={currency === 'USD' ? 'chosen' : ''}
            onClick={() => setValue('needCurrency', 'USD')}
          >
            I need USD <span>💵</span>
          </button>
          <button
            type="button"
            className={currency === 'UZS' ? 'chosen' : ''}
            onClick={() => setValue('needCurrency', 'UZS')}
          >
            I need UZS <span>🇺🇿</span>
          </button>
        </div>
        <label className="field-label" htmlFor={compact ? 'amount-compact' : 'amount-full'}>
          Amount
        </label>
        <div className="input-prefix">
          <span>{currency === 'USD' ? '$' : 'UZS'}</span>
          <input id={compact ? 'amount-compact' : 'amount-full'} inputMode="decimal" {...register('needAmount')} />
        </div>
        {errors.needAmount && <small className="field-error">{errors.needAmount.message}</small>}
        <label className="field-label">Exchange rate</label>
        <div className="radio-stack">
          <label>
            <input type="radio" value="MARKET" disabled={!reference} {...register('rateType')} /> Use reference rate{' '}
            {reference ? `(${number(reference.rate)} · ${reference.source})` : '(unavailable)'}
          </label>
          <label>
            <input type="radio" value="CUSTOM" {...register('rateType')} /> Set my own rate
          </label>
        </div>
        {(rateType === 'CUSTOM' || !reference) && (
          <div className="input-suffix">
            <input inputMode="decimal" placeholder="UZS per 1 USD" {...register('exchangeRate')} />
            <span>UZS / USD</span>
          </div>
        )}
        {errors.exchangeRate && <small className="field-error">{errors.exchangeRate.message}</small>}
        {Number.isFinite(estimate) && estimate > 0 && currency === 'USD' && (
          <p className="estimate">
            You’ll offer approximately <strong>{money(estimate, 'UZS')}</strong>
          </p>
        )}
        {Number(rate) > 0 && currency === 'UZS' && (
          <p className="estimate">
            You’ll offer approximately <strong>{money(Number(amount) / Number(rate), 'USD')}</strong>
          </p>
        )}
        <label className="field-label">How do you want to exchange?</label>
        <div className="radio-row">
          {[
            ['CASH', 'Cash'],
            ['BANK_TRANSFER', 'Bank transfer'],
            ['EITHER', 'Either'],
          ].map(([value, label]) => (
            <label key={value}>
              <input type="radio" value={value} {...register('exchangeMethod')} />
              {label}
            </label>
          ))}
        </div>
        <label className="field-label" htmlFor={compact ? 'location-compact' : 'location-full'}>
          Location
        </label>
        <div className="select-wrap">
          <MapPin size={15} />
          <select id={compact ? 'location-compact' : 'location-full'} {...register('location')}>
            <option>Office / Tashkent</option>
            <option>Tashkent</option>
            <option>Yunusobod</option>
            <option>Mirzo Ulugbek</option>
            <option>Chilonzor</option>
            <option value="">Online / flexible</option>
          </select>
          <ChevronDown size={14} />
        </div>
        <label className="field-label" htmlFor={compact ? 'expires-compact' : 'expires-full'}>
          Request expires
        </label>
        <div className="select-wrap">
          <Clock3 size={15} />
          <select
            id={compact ? 'expires-compact' : 'expires-full'}
            {...register('expiresInMinutes', { valueAsNumber: true })}
          >
            {[
              [30, '30 minutes'],
              [60, '1 hour'],
              [120, '2 hours'],
              [360, '6 hours'],
              [720, '12 hours'],
              [1440, '24 hours'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <button className="primary-button full" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : editRequest ? 'Save changes' : 'Post request'}
        </button>
        {feedback && <p className={feedback.startsWith('Request') ? 'success-text' : 'field-error'}>{feedback}</p>}
      </form>
    </section>
  )
}
export function PostPage() {
  const editId = new URLSearchParams(window.location.search).get('edit')
  const {
    data: mine,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['mine'],
    queryFn: () => api<Request[]>('/requests/mine'),
    enabled: !!editId,
  })
  const editRequest = mine?.find((r) => r.id === editId)
  return (
    <div className="page narrow">
      <div className="page-heading">
        <span className="eyebrow">{editId ? 'YOUR EXCHANGE' : 'NEW EXCHANGE'}</span>
        <h1>{editId ? 'Edit request' : 'Post a request'}</h1>
        <p>Tell your colleagues what you need and we’ll find the right match.</p>
      </div>
      {editId && isLoading ? (
        <LoadingCards />
      ) : error ? (
        <ErrorBox error={error} />
      ) : editId && !editRequest ? (
        <Empty icon={Search} title="Request not found" body="This request is no longer available to edit." />
      ) : (
        <RequestForm editRequest={editRequest} />
      )}
    </div>
  )
}

function MatchPreview() {
  const { data: me } = useMe()
  const { data: matches } = useQuery({ queryKey: ['matches'], queryFn: () => api<Match[]>('/matches') })
  const match = matches?.find((m) => m.status === 'PENDING' || m.status === 'ACCEPTED')
  const mine = match && (match.userAId === me?.user.id ? match.requestA : match.requestB)
  const theirs = match && (match.userAId === me?.user.id ? match.requestB : match.requestA)
  return (
    <section className="match-preview">
      <div className="match-glow">🤝</div>
      <h2>{match ? 'Match found!' : 'Your next match awaits'}</h2>
      <p>
        {match ? 'We found a matching request for you.' : 'Post a request and we’ll look for a compatible colleague.'}
      </p>
      {match && mine && theirs ? (
        <>
          <div className="match-summary">
            <div>
              <small>You need</small>
              <strong>{money(mine.needAmount, mine.needCurrency)}</strong>
              <span>Offering {money(mine.offerAmount, mine.offerCurrency)}</span>
            </div>
            <span className="exchange-icon">
              <ArrowDownUp size={18} />
            </span>
            <div>
              <small>They have</small>
              <strong>{money(theirs.offerAmount, theirs.offerCurrency)}</strong>
              <span>{displayName(theirs)}</span>
            </div>
          </div>
          <div className="match-colleague">
            <Avatar src={theirs.user?.avatarUrl} name={displayName(theirs)} />
            <div>
              <strong>{displayName(theirs)}</strong>
              <small>
                {method(theirs.exchangeMethod)} · {theirs.location || 'Flexible'}
              </small>
            </div>
          </div>
          <Link to="/matches" className="primary-button full">
            <Send size={16} /> View match
          </Link>
        </>
      ) : (
        <Link to="/post" className="primary-button full">
          <Plus size={16} /> Post a request
        </Link>
      )}
    </section>
  )
}

export function Matches() {
  const client = useQueryClient()
  const { data: me } = useMe()
  const { data, isLoading, error } = useQuery({ queryKey: ['matches'], queryFn: () => api<Match[]>('/matches') })
  const [busy, setBusy] = useState<string | null>(null)
  const [errorText, setErrorText] = useState('')
  const [rating, setRating] = useState(5)
  useEffect(() => {
    if (data?.[0]) trackEvent('match_opened', data[0].id)
  }, [data?.[0]?.id])
  const action = async (matchId: string, actionName: string) => {
    setBusy(matchId)
    setErrorText('')
    try {
      await api(`/matches/${matchId}/${actionName}`, { method: 'POST' })
      client.invalidateQueries({ queryKey: ['matches'] })
      client.invalidateQueries({ queryKey: ['mine'] })
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Could not update match.')
    } finally {
      setBusy(null)
    }
  }
  const message = async (matchId: string) => {
    try {
      const conversation = await api<{ id: string }>(`/matches/${matchId}/conversation`, { method: 'POST' })
      window.location.href = `/messages?conversation=${conversation.id}`
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Could not open conversation.')
    }
  }
  const review = async (matchId: string) => {
    try {
      await api(`/matches/${matchId}/reviews`, { method: 'POST', body: JSON.stringify({ rating }) })
      setErrorText('Review submitted. Thank you.')
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Could not submit review.')
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow">CONNECTIONS</span>
        <h1>Your matches</h1>
        <p>Compatible requests from colleagues, ranked by fit.</p>
      </div>
      {error && <ErrorBox error={error} />}{' '}
      {errorText && (
        <div className={errorText.startsWith('Review submitted') ? 'success-banner' : 'error-box'}>{errorText}</div>
      )}
      {isLoading ? (
        <LoadingCards />
      ) : data?.length ? (
        <div className="match-list">
          {data.map((match) => {
            const mine = match.userAId === me?.user.id ? match.requestA : match.requestB
            const theirs = match.userAId === me?.user.id ? match.requestB : match.requestA
            const ownAccepted = match.userAId === me?.user.id ? match.acceptedA : match.acceptedB
            const ownCompleted = match.userAId === me?.user.id ? match.completedA : match.completedB
            return (
              <article className="match-item" key={match.id}>
                <div className="match-item-head">
                  <span className="pill green">
                    <Sparkles size={13} /> {match.score}% compatible
                  </span>
                  <span className="status-text">{match.status.toLowerCase()}</span>
                </div>
                <div className="match-item-body">
                  <div>
                    <small>You need</small>
                    <strong>{money(mine.needAmount, mine.needCurrency)}</strong>
                    <span>You offer {money(mine.offerAmount, mine.offerCurrency)}</span>
                  </div>
                  <span className="exchange-icon">
                    <ArrowDownUp size={19} />
                  </span>
                  <div>
                    <small>{displayName(theirs)} offers</small>
                    <strong>{money(theirs.offerAmount, theirs.offerCurrency)}</strong>
                    <span>Suggested exchange: {money(match.suggestedUsd, 'USD')}</span>
                  </div>
                </div>
                <div className="match-item-foot">
                  <div className="card-person">
                    <Avatar src={theirs.user?.avatarUrl} name={displayName(theirs)} />
                    <div>
                      <strong>{displayName(theirs)}</strong>
                      <small>
                        {theirs.location || 'Flexible'} · {method(theirs.exchangeMethod)}
                      </small>
                    </div>
                  </div>
                  <div className="action-group">
                    <a className="outline-button" href={`/users/${theirs.userId}`}>
                      <UserRound size={14} /> Profile
                    </a>
                    {theirs.user?.username && (
                      <a
                        className="outline-button"
                        href={`https://t.me/${encodeURIComponent(theirs.user.username)}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => trackEvent('telegram_contact_clicked', match.id)}
                      >
                        <Send size={14} /> Telegram
                      </a>
                    )}
                    <button className="outline-button" onClick={() => message(match.id)}>
                      <MessageCircle size={15} /> Message
                    </button>
                    {match.status === 'PENDING' && (
                      <>
                        <button
                          className="primary-button"
                          disabled={busy === match.id || ownAccepted}
                          onClick={() => action(match.id, 'accept')}
                        >
                          {ownAccepted ? 'Waiting for colleague' : 'Accept match'}
                        </button>
                        <button
                          className="text-button"
                          disabled={busy === match.id}
                          onClick={() => action(match.id, 'decline')}
                        >
                          Decline
                        </button>
                      </>
                    )}
                    {match.status === 'ACCEPTED' && (
                      <button
                        className="primary-button"
                        disabled={busy === match.id || ownCompleted}
                        onClick={() => action(match.id, 'complete')}
                      >
                        {ownCompleted ? 'Waiting for colleague' : 'Mark completed'}
                      </button>
                    )}
                    {match.status === 'COMPLETED' && (
                      <div className="rating-control">
                        <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                          {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                              {n} stars
                            </option>
                          ))}
                        </select>
                        <button onClick={() => review(match.id)}>Review</button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <Empty
          icon={Handshake}
          title="No matches yet"
          body="We’ll notify you when someone posts a compatible request."
          action={
            <Link to="/post" className="primary-button">
              Post request
            </Link>
          }
        />
      )}
    </div>
  )
}

export function Messages() {
  const { data: me } = useMe()
  const client = useQueryClient()
  const {
    data: conversations,
    isLoading,
    error,
  } = useQuery({ queryKey: ['conversations'], queryFn: () => api<Conversation[]>('/conversations') })
  const initialId = new URLSearchParams(window.location.search).get('conversation')
  const [selected, setSelected] = useState<string | null>(initialId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => {
    if (!selected && conversations?.[0]) setSelected(conversations[0].id)
  }, [conversations, selected])
  const { data: messages } = useQuery({
    queryKey: ['messages', selected],
    queryFn: () => api<Message[]>(`/conversations/${selected}/messages`),
    enabled: !!selected,
  })
  const current = conversations?.find((c) => c.id === selected)
  const other = current?.participants.find((p) => p.userId !== me?.user.id)?.user
  const send = async () => {
    const body = draft.trim()
    if (!body || !selected) return
    setSending(true)
    try {
      await api(`/conversations/${selected}/messages`, { method: 'POST', body: JSON.stringify({ body }) })
      setDraft('')
      client.invalidateQueries({ queryKey: ['messages', selected] })
      client.invalidateQueries({ queryKey: ['conversations'] })
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="page messages-page">
      <div className="page-heading">
        <span className="eyebrow">CONVERSATIONS</span>
        <h1>Messages</h1>
        <p>Coordinate directly with your matched colleagues.</p>
      </div>
      {error && <ErrorBox error={error} />}{' '}
      {isLoading ? (
        <LoadingCards />
      ) : conversations?.length ? (
        <div className="messages-layout">
          <div className="conversation-list">
            {conversations.map((c) => {
              const colleague = c.participants.find((p) => p.userId !== me?.user.id)?.user
              return (
                <button
                  className={`conversation-item ${selected === c.id ? 'selected' : ''}`}
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                >
                  <Avatar src={colleague?.avatarUrl} name={colleague?.firstName || 'Colleague'} />
                  <span>
                    <strong>
                      {colleague?.firstName} {colleague?.lastName || ''}
                    </strong>
                    <small>{c.messages[0]?.body || 'Start a conversation'}</small>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="chat">
            <div className="chat-header">
              <Avatar src={other?.avatarUrl} name={other?.firstName || 'Colleague'} />
              <div>
                <strong>
                  {other?.firstName} {other?.lastName || ''}
                </strong>
                <small>Matched colleague</small>
              </div>
            </div>
            <div className="chat-messages">
              {messages?.map((m) => (
                <div className={`bubble ${m.senderId === me?.user.id ? 'mine' : ''}`} key={m.id}>
                  <span>{m.body}</span>
                  <small>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
              ))}
            </div>
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message..."
                maxLength={2000}
              />
              <button disabled={sending || !draft.trim()} aria-label="Send message">
                <Send size={17} />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <Empty
          icon={MessageSquare}
          title="No messages yet"
          body="Your conversations will appear here after you contact a match."
          action={
            <Link to="/matches" className="primary-button">
              View matches
            </Link>
          }
        />
      )}
    </div>
  )
}

export function MyRequests() {
  const client = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['mine'], queryFn: () => api<Request[]>('/requests/mine') })
  const [tab, setTab] = useState('ACTIVE')
  const [feedback, setFeedback] = useState('')
  const visible = data?.filter((r) =>
    tab === 'ACTIVE' ? r.status === 'ACTIVE' && new Date(r.expiresAt) > new Date() : r.status === tab,
  )
  const cancel = async (requestId: string) => {
    try {
      await api(`/requests/${requestId}/cancel`, { method: 'POST' })
      client.invalidateQueries({ queryKey: ['mine'] })
      client.invalidateQueries({ queryKey: ['requests'] })
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Could not cancel request.')
    }
  }
  const renew = async (requestId: string) => {
    try {
      await api(`/requests/${requestId}/renew`, { method: 'POST', body: JSON.stringify({ expiresInMinutes: 120 }) })
      client.invalidateQueries({ queryKey: ['mine'] })
      client.invalidateQueries({ queryKey: ['requests'] })
      setTab('ACTIVE')
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Could not renew request.')
    }
  }
  return (
    <div className="page">
      <div className="page-heading with-action">
        <div>
          <span className="eyebrow">YOUR ACTIVITY</span>
          <h1>My requests</h1>
          <p>Keep track of the exchanges you’ve posted.</p>
        </div>
        <Link to="/post" className="primary-button">
          <Plus size={17} /> Post request
        </Link>
      </div>
      <div className="tabs">
        {['ACTIVE', 'MATCHED', 'COMPLETED', 'EXPIRED', 'CANCELLED'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {feedback && <div className="error-box">{feedback}</div>}
      {error && <ErrorBox error={error} />}{' '}
      {isLoading ? (
        <LoadingCards />
      ) : visible?.length ? (
        <div className="my-list">
          {visible.map((r) => (
            <div className="my-row" key={r.id}>
              <span className={`pill ${r.needCurrency === 'USD' ? 'green' : 'blue'}`}>Need {r.needCurrency}</span>
              <div>
                <strong>{money(r.needAmount, r.needCurrency)}</strong>
                <small>Offering {money(r.offerAmount, r.offerCurrency)}</small>
              </div>
              <div className="row-meta">
                <span>{method(r.exchangeMethod)}</span>
                <small>
                  {r.location || 'Flexible'} · {ago(r.createdAt)}
                </small>
              </div>
              <span className="status-text">{r.status.toLowerCase()}</span>
              {r.status === 'ACTIVE' && (
                <>
                  <Link to="/post" search={{ edit: r.id }} className="text-button">
                    Edit
                  </Link>
                  <button className="text-button danger" onClick={() => cancel(r.id)}>
                    Cancel
                  </button>
                </>
              )}
              {r.status === 'EXPIRED' && (
                <button className="outline-button" onClick={() => renew(r.id)}>
                  Renew
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={Wallet}
          title={`No ${tab.toLowerCase()} requests`}
          body="Post what you need and we’ll look for a match."
          action={
            <Link to="/post" className="primary-button">
              Post request
            </Link>
          }
        />
      )}
    </div>
  )
}
export function Bookmarks() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: () =>
      api<
        {
          requestId: string | null
          request: Request | null
          targetUserId: string | null
          targetUser: {
            id: string
            firstName: string
            lastName?: string | null
            avatarUrl?: string | null
            verified: boolean
          } | null
        }[]
      >('/bookmarks'),
  })
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow">SAVED FOR LATER</span>
        <h1>Bookmarks</h1>
        <p>Requests and colleagues you’ve saved for a closer look.</p>
      </div>
      {error && <ErrorBox error={error} />}{' '}
      {isLoading ? (
        <LoadingCards />
      ) : data?.length ? (
        <>
          <div className="cards">
            {data
              .filter((b) => b.request)
              .map((b) => (
                <RequestCard key={b.requestId} item={b.request!} bookmarked />
              ))}
          </div>
          {data.some((b) => b.targetUser) && (
            <>
              <h2 className="section-title">Saved colleagues</h2>
              <div className="saved-users">
                {data
                  .filter((b) => b.targetUser)
                  .map((b) => (
                    <a href={`/users/${b.targetUserId}`} className="saved-user" key={b.targetUserId}>
                      <Avatar src={b.targetUser?.avatarUrl} name={b.targetUser?.firstName || 'Colleague'} />
                      <strong>
                        {b.targetUser?.firstName} {b.targetUser?.lastName}
                      </strong>
                      {b.targetUser?.verified && <ShieldCheck size={15} />}
                    </a>
                  ))}
              </div>
            </>
          )}
        </>
      ) : (
        <Empty
          icon={Bookmark}
          title="No bookmarks yet"
          body="Save interesting requests from the market to find them here."
          action={
            <Link to="/" className="primary-button">
              Browse market
            </Link>
          }
        />
      )}
    </div>
  )
}
export function Profile() {
  const { data: me } = useMe()
  const { data } = useQuery({
    queryKey: ['profile', me?.user.id],
    queryFn: () => api<User>(`/users/${me!.user.id}`),
    enabled: !!me,
  })
  const user = data || me?.user
  return (
    <div className="page narrow">
      <div className="page-heading">
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h1>Profile</h1>
        <p>Your colleague profile and exchange history.</p>
      </div>
      {user && (
        <div className="profile-card">
          <div className="profile-top">
            <Avatar src={user.avatarUrl} name={user.displayName} size={76} />
            <div>
              <h2>{user.displayName}</h2>
              <p>{user.username ? `@${user.username}` : 'Telegram colleague'}</p>
              <span className="pill green">
                <ShieldCheck size={13} /> {user.verified ? 'Verified colleague' : 'Community member'}
              </span>
            </div>
          </div>
          <div className="profile-stats">
            <div>
              <strong>{user.rating ? `${user.rating.toFixed(1)} ★` : '—'}</strong>
              <span>Rating</span>
            </div>
            <div>
              <strong>{user.ratingCount ?? 0}</strong>
              <span>Reviews</span>
            </div>
            <div>
              <strong>{user.completedCount ?? 0}</strong>
              <span>Completed exchanges</span>
            </div>
          </div>
          <div className="profile-detail">
            <MapPin size={17} /> {user.location || 'Location not set'}
          </div>
          <div className="profile-detail">
            <CreditCard size={17} />
            {user.preferredMethods?.length ? user.preferredMethods.map(method).join(', ') : 'No preferred method set'}
          </div>
          <div className="profile-detail">
            <Clock3 size={17} /> Joined {new Date(user.joinedAt).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  )
}
export function ColleagueProfile() {
  const userId = window.location.pathname.split('/').at(-1)
  const { data: me } = useMe()
  const client = useQueryClient()
  const { data: bookmarks } = useQuery({
    queryKey: ['bookmarks'],
    queryFn: () => api<{ targetUserId: string | null }[]>('/bookmarks'),
  })
  const bookmarked = bookmarks?.some((bookmark) => bookmark.targetUserId === userId) ?? false
  const [reportReason, setReportReason] = useState('')
  const [reportFeedback, setReportFeedback] = useState('')
  const {
    data: user,
    isLoading,
    error,
  } = useQuery({ queryKey: ['profile', userId], queryFn: () => api<User>(`/users/${userId}`), enabled: !!userId })
  return (
    <div className="page narrow">
      <div className="page-heading">
        <span className="eyebrow">COLLEAGUE PROFILE</span>
        <h1>Colleague</h1>
        <p>Meet the person behind an exchange request.</p>
      </div>
      {error && <ErrorBox error={error} />}{' '}
      {isLoading ? (
        <LoadingCards />
      ) : (
        user && (
          <div className="profile-card">
            <div className="profile-top">
              <Avatar src={user.avatarUrl} name={user.displayName} size={76} />
              <div>
                <h2>{user.displayName}</h2>
                <p>{user.username ? `@${user.username}` : 'Telegram colleague'}</p>
                <span className="pill green">
                  <ShieldCheck size={13} />
                  {user.verified ? 'Verified colleague' : 'Community member'}
                </span>
              </div>
            </div>
            <div className="profile-stats">
              <div>
                <strong>{user.rating ? `${user.rating.toFixed(1)} ★` : '—'}</strong>
                <span>Rating</span>
              </div>
              <div>
                <strong>{user.ratingCount ?? 0}</strong>
                <span>Reviews</span>
              </div>
              <div>
                <strong>{user.completedCount ?? 0}</strong>
                <span>Completed exchanges</span>
              </div>
            </div>
            {user.username && (
              <a
                className="primary-button"
                href={`https://t.me/${encodeURIComponent(user.username)}`}
                target="_blank"
                rel="noreferrer"
              >
                <Send size={15} /> Contact on Telegram
              </a>
            )}
            {me?.user.id !== userId && (
              <button
                className="outline-button"
                onClick={async () => {
                  await api(`/bookmarks/users/${userId}`, { method: bookmarked ? 'DELETE' : 'POST' })
                  client.invalidateQueries({ queryKey: ['bookmarks'] })
                }}
              >
                <Bookmark size={15} fill={bookmarked ? 'currentColor' : 'none'} />
                {bookmarked ? 'Saved' : 'Save colleague'}
              </button>
            )}
            <div className="profile-detail">
              <MapPin size={17} />
              {user.location || 'Location not set'}
            </div>
            <div className="profile-detail">
              <CreditCard size={17} />
              {user.preferredMethods?.length
                ? user.preferredMethods.map(method).join(', ')
                : 'Exchange method not specified'}
            </div>
            <form
              className="report-form"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  await api(`/users/${userId}/report`, {
                    method: 'POST',
                    body: JSON.stringify({ reason: reportReason }),
                  })
                  setReportReason('')
                  setReportFeedback('Report sent to the moderation team.')
                } catch (error) {
                  setReportFeedback(error instanceof Error ? error.message : 'Could not send report.')
                }
              }}
            >
              <label htmlFor="report-reason">Report a concern</label>
              <textarea
                id="report-reason"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                minLength={10}
                maxLength={500}
                placeholder="Describe the concern for our moderators..."
              />
              <button type="submit" className="outline-button" disabled={reportReason.trim().length < 10}>
                Send report
              </button>
              {reportFeedback && <small>{reportFeedback}</small>}
            </form>
          </div>
        )
      )}
    </div>
  )
}
export function Settings() {
  const { data: me } = useMe()
  const client = useQueryClient()
  const [location, setLocation] = useState('')
  const [methods, setMethods] = useState<('CASH' | 'BANK_TRANSFER' | 'EITHER')[]>([])
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    if (me?.user) {
      setLocation(me.user.location || '')
      setMethods(me.user.preferredMethods || [])
    }
  }, [me?.user])
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' })
    client.clear()
  }
  return (
    <div className="page narrow">
      <div className="page-heading">
        <span className="eyebrow">PREFERENCES</span>
        <h1>Settings</h1>
        <p>Manage your Almash session and privacy.</p>
      </div>
      <div className="settings-card">
        <div>
          <ShieldCheck size={22} />
          <span>
            <strong>Direct exchange only</strong>
            <small>Almash does not hold funds or process payments.</small>
          </span>
        </div>
        <button className="outline-button" onClick={logout}>
          <LogOut size={17} /> Log out
        </button>
      </div>
      <form
        className="profile-card preferences-form"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await api('/profile', {
              method: 'PATCH',
              body: JSON.stringify({ location: location || null, preferredMethods: methods }),
            })
            client.invalidateQueries({ queryKey: ['me'] })
            client.invalidateQueries({ queryKey: ['profile'] })
            setFeedback('Preferences saved.')
          } catch (error) {
            setFeedback(error instanceof Error ? error.message : 'Could not save preferences.')
          }
        }}
      >
        <h2>Exchange preferences</h2>
        <label htmlFor="profile-location">Location</label>
        <input
          id="profile-location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={80}
          placeholder="Office / Tashkent"
        />
        <span>Preferred methods</span>
        <div className="preference-options">
          {[
            ['CASH', 'Cash'],
            ['BANK_TRANSFER', 'Bank transfer'],
            ['EITHER', 'Either'],
          ].map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={methods.includes(value as 'CASH' | 'BANK_TRANSFER' | 'EITHER')}
                onChange={(e) =>
                  setMethods((current) =>
                    e.target.checked
                      ? [...current, value as 'CASH' | 'BANK_TRANSFER' | 'EITHER']
                      : current.filter((item) => item !== value),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        <button className="primary-button" type="submit">
          Save preferences
        </button>
        {feedback && <small>{feedback}</small>}
      </form>
    </div>
  )
}
export function Admin() {
  const { data: me } = useMe()
  const client = useQueryClient()
  const enabled = me?.user.role === 'ADMIN'
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () =>
      api<{
        users: number
        activeToday: number
        activeRequests: number
        matchesToday: number
        completed: number
        usdDemand: number
        uzsDemand: number
      }>('/admin/stats'),
    enabled,
  })
  const { data: users } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () =>
      api<{ id: string; firstName: string; lastName?: string; username?: string; suspendedAt?: string }[]>(
        '/admin/users',
      ),
    enabled,
  })
  const { data: requests } = useQuery({
    queryKey: ['admin-requests'],
    queryFn: () => api<Request[]>('/admin/requests'),
    enabled,
  })
  const { data: reports } = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () =>
      api<
        {
          id: string
          reason: string
          createdAt: string
          reportedUser: { firstName: string; lastName?: string | null }
        }[]
      >('/admin/reports'),
    enabled,
  })
  const { data: audit } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api<{ id: string; action: string; entityType: string; createdAt: string }[]>('/admin/audit'),
    enabled,
  })
  if (!enabled)
    return (
      <div className="page">
        <Empty icon={ShieldCheck} title="Access denied" body="This area is for administrators." />
      </div>
    )
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow">ADMINISTRATION</span>
        <h1>Overview</h1>
        <p>Community activity and account moderation.</p>
      </div>
      <div className="admin-stats">
        {Object.entries(stats || {}).map(([key, value]) => (
          <div key={key}>
            <strong>{value}</strong>
            <span>{key.replace(/([A-Z])/g, ' $1')}</span>
          </div>
        ))}
      </div>
      <h2 className="section-title">Recent colleagues</h2>
      <div className="my-list">
        {users?.map((user) => (
          <div className="my-row" key={user.id}>
            <Avatar name={user.firstName} />
            <div>
              <strong>
                {user.firstName} {user.lastName}
              </strong>
              <small>{user.username ? `@${user.username}` : 'No username'}</small>
            </div>
            <span className="status-text">{user.suspendedAt ? 'Suspended' : 'Active'}</span>
            {!user.suspendedAt && user.id !== me.user.id && (
              <button
                className="text-button danger"
                onClick={async () => {
                  await api(`/admin/users/${user.id}/suspend`, { method: 'POST' })
                  client.invalidateQueries({ queryKey: ['admin-users'] })
                }}
              >
                Suspend
              </button>
            )}
          </div>
        ))}
      </div>
      <h2 className="section-title">Recent requests</h2>
      <div className="my-list">
        {requests?.map((request) => (
          <div className="my-row" key={request.id}>
            <span className={`pill ${request.needCurrency === 'USD' ? 'green' : 'blue'}`}>
              Need {request.needCurrency}
            </span>
            <div>
              <strong>{money(request.needAmount, request.needCurrency)}</strong>
              <small>
                {displayName(request)} · {request.location || 'Flexible'}
              </small>
            </div>
            <span className="status-text">{request.status.toLowerCase()}</span>
            {request.status === 'ACTIVE' && (
              <button
                className="text-button danger"
                onClick={async () => {
                  await api(`/admin/requests/${request.id}/deactivate`, { method: 'POST' })
                  client.invalidateQueries({ queryKey: ['admin-requests'] })
                  client.invalidateQueries({ queryKey: ['admin-stats'] })
                }}
              >
                Deactivate
              </button>
            )}
          </div>
        ))}
      </div>
      <h2 className="section-title">Open reports</h2>
      <div className="my-list">
        {reports?.length ? (
          reports.map((report) => (
            <div className="my-row" key={report.id}>
              <div>
                <strong>
                  {report.reportedUser.firstName} {report.reportedUser.lastName}
                </strong>
                <small>{report.reason}</small>
              </div>
              <button
                className="outline-button"
                onClick={async () => {
                  await api(`/admin/reports/${report.id}/resolve`, { method: 'POST' })
                  client.invalidateQueries({ queryKey: ['admin-reports'] })
                  client.invalidateQueries({ queryKey: ['admin-audit'] })
                }}
              >
                Resolve
              </button>
            </div>
          ))
        ) : (
          <div className="my-row">No open reports.</div>
        )}
      </div>
      <h2 className="section-title">Audit history</h2>
      <div className="my-list">
        {audit?.length ? (
          audit.map((entry) => (
            <div className="my-row" key={entry.id}>
              <div>
                <strong>{entry.action}</strong>
                <small>
                  {entry.entityType} · {new Date(entry.createdAt).toLocaleString()}
                </small>
              </div>
            </div>
          ))
        ) : (
          <div className="my-row">No moderation actions yet.</div>
        )}
      </div>
    </div>
  )
}
