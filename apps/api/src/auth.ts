import crypto from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { prisma } from './db.js'

export type TelegramPayload = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export function verifyTelegram(payload: TelegramPayload, token: string, now = Date.now()) {
  const { hash, ...data } = payload
  if (
    !token ||
    !/^[a-f0-9]{64}$/i.test(hash) ||
    !Number.isSafeInteger(data.id) ||
    !Number.isSafeInteger(data.auth_date)
  )
    return false
  if (Math.abs(now / 1000 - data.auth_date) > 300) return false
  const check = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = crypto.createHash('sha256').update(token).digest()
  const expected = crypto.createHmac('sha256', secret).update(check).digest()
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), expected)
}

export function hashToken(token: string) {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is not configured')
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

export async function getSession(request: FastifyRequest) {
  const token = request.cookies.session
  if (!token) return null
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } })
  if (!session || session.expiresAt <= new Date() || session.user.suspendedAt) return null
  return session
}
