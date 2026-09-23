import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { hashToken, verifyTelegram } from './auth.js'
describe('Telegram verification', () => {
  it('accepts an authentic fresh signature and rejects tampering', () => {
    const token = '123:example'
    const auth_date = Math.floor(Date.now() / 1000)
    const id = 12345
    const first_name = 'Aziz'
    const check = `auth_date=${auth_date}\nfirst_name=${first_name}\nid=${id}`
    const hash = crypto
      .createHmac('sha256', crypto.createHash('sha256').update(token).digest())
      .update(check)
      .digest('hex')
    expect(verifyTelegram({ id, first_name, auth_date, hash }, token)).toBe(true)
    expect(verifyTelegram({ id, first_name: 'Other', auth_date, hash }, token)).toBe(false)
    expect(verifyTelegram({ id, first_name, auth_date: 1, hash }, token)).toBe(false)
  })
  it('rejects malformed signatures and hashes session tokens with the server secret', () => {
    expect(
      verifyTelegram({ id: 1, first_name: 'A', auth_date: Math.floor(Date.now() / 1000), hash: 'bad' }, 'token'),
    ).toBe(false)
    process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters'
    expect(hashToken('session-token')).toHaveLength(64)
    expect(hashToken('session-token')).toBe(hashToken('session-token'))
    expect(hashToken('session-token')).not.toBe(hashToken('another-token'))
  })
})
