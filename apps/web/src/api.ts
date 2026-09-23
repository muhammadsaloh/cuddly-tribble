const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    const headers = new Headers(init?.headers)
    if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    })
  } catch {
    throw new Error('You appear to be offline. Check your connection and try again.')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || 'Something went wrong. Please try again.')
  }
  return response.json() as Promise<T>
}
export function socketUrl() {
  return BASE.replace(/^http/, 'ws') + '/events'
}

export function trackEvent(event: 'match_opened' | 'telegram_contact_clicked', entityId?: string) {
  void api('/analytics', { method: 'POST', body: JSON.stringify({ event, entityId }) }).catch(() => undefined)
}
