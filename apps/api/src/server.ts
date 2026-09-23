import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import crypto from 'node:crypto'
import { z, ZodError } from 'zod'
import { Prisma, type User } from '@prisma/client'
import { prisma } from './db.js'
import { getSession, hashToken, verifyTelegram, type TelegramPayload } from './auth.js'
import { compatible, offerAmount } from './domain.js'
import { currentRate } from './rates.js'
import { notifyTelegram } from './telegram.js'
import { clientAnalyticsEvents, track } from './analytics.js'

const env = z
  .object({
    DATABASE_URL: z.string(),
    SESSION_SECRET: z.string().min(32),
    FRONTEND_URL: z.url(),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .parse(process.env)
const app = Fastify({ logger: true, bodyLimit: 32_768, trustProxy: true })
const sockets = new Map<string, Set<{ send: (data: string) => void; readyState: number }>>()
const emit = (userId: string, type: string, payload: object = {}) => {
  for (const socket of sockets.get(userId) ?? [])
    if (socket.readyState === 1) socket.send(JSON.stringify({ type, ...payload }))
}
const safeUser = (user: User) => ({
  id: user.id,
  displayName: `${user.firstName} ${user.lastName ?? ''}`.trim(),
  username: user.username,
  avatarUrl: user.avatarUrl,
  location: user.location,
  preferredMethods: user.preferredMethods,
  verified: user.verified,
  role: user.role,
  joinedAt: user.createdAt,
})
const requireUser = async (request: Parameters<typeof getSession>[0]) => {
  const session = await getSession(request)
  if (!session) throw Object.assign(new Error('Please sign in'), { statusCode: 401 })
  return session.user
}
const id = z.string().cuid()
const requestInput = z
  .object({
    needCurrency: z.enum(['USD', 'UZS']),
    needAmount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
    exchangeRate: z.string().regex(/^\d{1,7}(\.\d{1,4})?$/),
    rateType: z.enum(['MARKET', 'CUSTOM']),
    exchangeMethod: z.enum(['CASH', 'BANK_TRANSFER', 'EITHER']),
    location: z.string().trim().max(80).optional(),
    expiresInMinutes: z.union([
      z.literal(30),
      z.literal(60),
      z.literal(120),
      z.literal(360),
      z.literal(720),
      z.literal(1440),
    ]),
  })
  .refine(
    (v) =>
      new Prisma.Decimal(v.needAmount).gt(0) &&
      new Prisma.Decimal(v.exchangeRate).gte(1000) &&
      new Prisma.Decimal(v.exchangeRate).lte(100000),
    'Invalid amount or rate',
  )
async function resolveRate(input: z.infer<typeof requestInput>) {
  if (input.rateType === 'CUSTOM') return new Prisma.Decimal(input.exchangeRate)
  const reference = await currentRate()
  if (!reference || Date.now() - reference.fetchedAt.getTime() > 24 * 3600000)
    throw Object.assign(new Error('Reference rate is unavailable. Set a custom rate.'), { statusCode: 409 })
  return reference.usdUzs
}

await app.register(cookie)
await app.register(cors, { origin: env.FRONTEND_URL, credentials: true })
await app.register(helmet, { contentSecurityPolicy: false })
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
await app.register(websocket)
app.addHook('preHandler', async (request) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) && request.url !== '/auth/telegram') {
    if (request.headers.origin !== env.FRONTEND_URL)
      throw Object.assign(new Error('Invalid origin'), { statusCode: 403 })
  }
})
app.setErrorHandler((error, request, reply) => {
  const status =
    error instanceof ZodError
      ? 400
      : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
        ? 404
        : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
          ? 409
          : error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
            ? error.statusCode
            : 500
  if (status >= 500) request.log.error(error)
  reply.status(status).send({
    error:
      status >= 500
        ? 'Something went wrong. Please try again.'
        : error instanceof ZodError
          ? 'Please check the entered fields.'
          : error instanceof Prisma.PrismaClientKnownRequestError
            ? status === 404
              ? 'Item not found.'
              : 'This action was already completed.'
            : error instanceof Error
              ? error.message
              : 'Invalid request.',
  })
})
app.get('/health', async () => {
  await prisma.$queryRaw`SELECT 1`
  return { status: 'ok' }
})

app.post('/auth/telegram', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  const body = z
    .object({
      id: z.number().int(),
      first_name: z.string().min(1).max(100),
      last_name: z.string().max(100).optional(),
      username: z.string().max(50).optional(),
      photo_url: z.url().optional(),
      auth_date: z.number().int(),
      hash: z.string(),
    })
    .parse(request.body) as TelegramPayload
  if (!verifyTelegram(body, env.TELEGRAM_BOT_TOKEN))
    return reply.status(401).send({ error: 'Telegram sign in could not be verified.' })
  const existingUser = await prisma.user.findUnique({ where: { telegramId: BigInt(body.id) }, select: { id: true } })
  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(body.id) },
    create: {
      telegramId: BigInt(body.id),
      firstName: body.first_name,
      lastName: body.last_name,
      username: body.username,
      avatarUrl: body.photo_url,
    },
    update: {
      firstName: body.first_name,
      lastName: body.last_name,
      username: body.username,
      avatarUrl: body.photo_url,
    },
  })
  if (user.suspendedAt) return reply.status(403).send({ error: 'Account is suspended.' })
  const token = crypto.randomBytes(32).toString('base64url')
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 86400000) },
  })
  reply.setCookie('session', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
    maxAge: 30 * 86400,
  })
  if (!existingUser) void track('signed_up', user.id)
  return { user: safeUser(user) }
})
app.post('/auth/logout', async (request, reply) => {
  const token = request.cookies.session
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  reply.clearCookie('session', { path: '/' })
  return { ok: true }
})
app.get('/auth/me', async (request) => {
  const user = await requireUser(request)
  return { user: safeUser(user) }
})
app.patch('/profile', async (request) => {
  const user = await requireUser(request)
  const input = z
    .object({
      location: z.string().trim().max(80).nullable(),
      preferredMethods: z.array(z.enum(['CASH', 'BANK_TRANSFER', 'EITHER'])).max(3),
    })
    .parse(request.body)
  const updated = await prisma.user.update({ where: { id: user.id }, data: input })
  return { user: safeUser(updated) }
})
app.get('/users/:id', async (request) => {
  await requireUser(request)
  const userId = id.parse((request.params as { id: string }).id)
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { reviewsReceived: true, _count: { select: { requests: true } } },
  })
  const completedCount = await prisma.match.count({
    where: { status: 'COMPLETED', OR: [{ userAId: userId }, { userBId: userId }] },
  })
  return {
    ...safeUser(user),
    rating: user.reviewsReceived.length
      ? user.reviewsReceived.reduce((n, r) => n + r.rating, 0) / user.reviewsReceived.length
      : null,
    ratingCount: user.reviewsReceived.length,
    requestCount: user._count.requests,
    completedCount,
  }
})
app.post('/users/:id/report', { config: { rateLimit: { max: 5, timeWindow: '1 day' } } }, async (request) => {
  const reporter = await requireUser(request)
  const reportedUserId = id.parse((request.params as { id: string }).id)
  if (reporter.id === reportedUserId) throw Object.assign(new Error('You cannot report yourself.'), { statusCode: 400 })
  const { reason } = z.object({ reason: z.string().trim().min(10).max(500) }).parse(request.body)
  await prisma.user.findUniqueOrThrow({ where: { id: reportedUserId } })
  await prisma.report.create({ data: { reporterId: reporter.id, reportedUserId, reason } })
  return { ok: true }
})
app.get('/stats', async (request) => {
  await requireUser(request)
  const [requests, colleagues] = await Promise.all([
    prisma.exchangeRequest.count({ where: { status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
    prisma.user.count({ where: { suspendedAt: null } }),
  ])
  return { requests, colleagues }
})
app.get('/rates/current', async (request) => {
  await requireUser(request)
  const rate = await currentRate()
  return rate ? { rate: rate.usdUzs.toString(), source: rate.source, fetchedAt: rate.fetchedAt } : null
})
app.post('/analytics', async (request) => {
  const user = await requireUser(request)
  const input = z
    .object({ event: z.enum(clientAnalyticsEvents), entityId: z.string().max(100).optional() })
    .parse(request.body)
  await track(input.event, user.id, input.entityId)
  return { ok: true }
})

const requestInclude = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      avatarUrl: true,
      verified: true,
      location: true,
    },
  },
} as const
app.get('/requests', async (request) => {
  await requireUser(request)
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      need: z.enum(['USD', 'UZS']).optional(),
      method: z.enum(['CASH', 'BANK_TRANSFER']).optional(),
      location: z.string().max(80).optional(),
      search: z.string().max(80).optional(),
      sort: z.enum(['newest', 'oldest', 'amount']).default('newest'),
    })
    .parse(request.query)
  const numeric = q.search?.replace(/[,$\s]/g, '')
  const where: Prisma.ExchangeRequestWhereInput = {
    status: 'ACTIVE',
    expiresAt: { gt: new Date() },
    user: { suspendedAt: null },
    ...(q.need ? { needCurrency: q.need } : {}),
    ...(q.method ? { exchangeMethod: { in: [q.method, 'EITHER'] } } : {}),
    ...(q.location ? { location: { contains: q.location, mode: 'insensitive' } } : {}),
    ...(q.search
      ? {
          OR: [
            { location: { contains: q.search, mode: 'insensitive' } },
            { user: { firstName: { contains: q.search, mode: 'insensitive' } } },
            { user: { username: { contains: q.search, mode: 'insensitive' } } },
            ...(numeric && /^\d+(\.\d+)?$/.test(numeric)
              ? [{ needAmount: { equals: numeric } }, { exchangeRate: { equals: numeric } }]
              : []),
          ],
        }
      : {}),
  }
  const orderBy: Prisma.ExchangeRequestOrderByWithRelationInput =
    q.sort === 'amount' ? { needAmount: 'asc' } : { createdAt: q.sort === 'oldest' ? 'asc' : 'desc' }
  const [items, total] = await Promise.all([
    prisma.exchangeRequest.findMany({ where, include: requestInclude, orderBy, skip: (q.page - 1) * 18, take: 18 }),
    prisma.exchangeRequest.count({ where }),
  ])
  return { items, total, page: q.page }
})
app.get('/requests/mine', async (request) => {
  const user = await requireUser(request)
  return prisma.exchangeRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: requestInclude,
  })
})
async function makeMatches(created: Awaited<ReturnType<typeof prisma.exchangeRequest.create>>) {
  const candidates = await prisma.exchangeRequest.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      user: { suspendedAt: null },
      needCurrency: created.offerCurrency,
      userId: { not: created.userId },
    },
    take: 100,
    orderBy: { createdAt: 'desc' },
  })
  for (const candidate of candidates) {
    const result = compatible(created, candidate)
    if (!result || result.score < 55) continue
    const first = created.id < candidate.id ? created : candidate
    const second = created.id < candidate.id ? candidate : created
    const match = await prisma.match
      .create({
        data: {
          requestAId: first.id,
          requestBId: second.id,
          userAId: first.userId,
          userBId: second.userId,
          ...result,
        },
        include: { requestA: true, requestB: true },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null
        throw error
      })
    if (!match) continue
    await prisma.notification.createMany({
      data: [created.userId, candidate.userId].map((userId) => ({
        userId,
        type: 'MATCH_FOUND',
        title: 'Match found!',
        body: 'A compatible exchange request is available.',
        link: '/matches',
      })),
    })
    emit(created.userId, 'match_found', { matchId: match.id })
    emit(candidate.userId, 'match_found', { matchId: match.id })
    void track('match_found', created.userId, match.id)
    void track('match_found', candidate.userId, match.id)
    void notifyTelegram(created.userId, '🤝 New Almash match found. Open the app to review the compatible request.')
    void notifyTelegram(candidate.userId, '🤝 New Almash match found. Open the app to review the compatible request.')
  }
}
async function refreshMatches(request: Awaited<ReturnType<typeof prisma.exchangeRequest.create>>) {
  try {
    await makeMatches(request)
  } catch (error) {
    app.log.error(error, 'Matching will be retried')
  }
}
app.post('/requests', { config: { rateLimit: { max: 6, timeWindow: '1 hour' } } }, async (request, reply) => {
  const user = await requireUser(request)
  const input = requestInput.parse(request.body)
  const amount = new Prisma.Decimal(input.needAmount),
    rate = await resolveRate(input)
  const created = await prisma.exchangeRequest.create({
    data: {
      userId: user.id,
      needCurrency: input.needCurrency,
      offerCurrency: input.needCurrency === 'USD' ? 'UZS' : 'USD',
      needAmount: amount,
      offerAmount: offerAmount(input.needCurrency, amount, rate),
      exchangeRate: rate,
      rateType: input.rateType,
      exchangeMethod: input.exchangeMethod,
      location: input.location,
      expiresAt: new Date(Date.now() + input.expiresInMinutes * 60000),
    },
  })
  await refreshMatches(created)
  void track('request_created', user.id, created.id)
  emit(user.id, 'request_created')
  return reply.status(201).send(created)
})
app.patch('/requests/:id', async (request) => {
  const user = await requireUser(request)
  const requestId = id.parse((request.params as { id: string }).id)
  const input = requestInput.parse(request.body)
  const amount = new Prisma.Decimal(input.needAmount),
    rate = await resolveRate(input)
  const result = await prisma.exchangeRequest.updateMany({
    where: { id: requestId, userId: user.id, status: 'ACTIVE' },
    data: {
      needCurrency: input.needCurrency,
      offerCurrency: input.needCurrency === 'USD' ? 'UZS' : 'USD',
      needAmount: amount,
      offerAmount: offerAmount(input.needCurrency, amount, rate),
      exchangeRate: rate,
      rateType: input.rateType,
      exchangeMethod: input.exchangeMethod,
      location: input.location,
      expiresAt: new Date(Date.now() + input.expiresInMinutes * 60000),
    },
  })
  if (!result.count) throw Object.assign(new Error('Request cannot be edited.'), { statusCode: 409 })
  await prisma.match.updateMany({
    where: { OR: [{ requestAId: requestId }, { requestBId: requestId }], status: 'PENDING' },
    data: { status: 'CANCELLED' },
  })
  const updated = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: requestId } })
  await refreshMatches(updated)
  emit(user.id, 'request_updated')
  return { ok: true }
})
app.post('/requests/:id/cancel', async (request) => {
  const user = await requireUser(request)
  const requestId = id.parse((request.params as { id: string }).id)
  const otherUsers = await prisma.$transaction(async (tx) => {
    const result = await tx.exchangeRequest.updateMany({
      where: { id: requestId, userId: user.id, status: { in: ['ACTIVE', 'MATCHED'] } },
      data: { status: 'CANCELLED' },
    })
    if (!result.count) throw Object.assign(new Error('Request cannot be cancelled.'), { statusCode: 409 })
    const matches = await tx.match.findMany({
      where: { OR: [{ requestAId: requestId }, { requestBId: requestId }], status: { in: ['PENDING', 'ACCEPTED'] } },
    })
    await tx.match.updateMany({ where: { id: { in: matches.map((m) => m.id) } }, data: { status: 'CANCELLED' } })
    const others = matches.map((m) => (m.requestAId === requestId ? m.requestBId : m.requestAId))
    await tx.exchangeRequest.updateMany({
      where: { id: { in: others }, status: 'MATCHED', expiresAt: { gt: new Date() } },
      data: { status: 'ACTIVE' },
    })
    return matches.map((m) => (m.userAId === user.id ? m.userBId : m.userAId))
  })
  for (const otherId of otherUsers) emit(otherId, 'match_updated')
  emit(user.id, 'request_cancelled')
  return { ok: true }
})
app.post('/requests/:id/renew', async (request) => {
  const user = await requireUser(request)
  const requestId = id.parse((request.params as { id: string }).id)
  const input = z
    .object({
      expiresInMinutes: z.union([
        z.literal(30),
        z.literal(60),
        z.literal(120),
        z.literal(360),
        z.literal(720),
        z.literal(1440),
      ]),
    })
    .parse(request.body)
  const result = await prisma.exchangeRequest.updateMany({
    where: { id: requestId, userId: user.id, status: 'EXPIRED' },
    data: { status: 'ACTIVE', expiresAt: new Date(Date.now() + input.expiresInMinutes * 60000) },
  })
  if (!result.count) throw Object.assign(new Error('Request cannot be renewed.'), { statusCode: 409 })
  const updated = await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: requestId } })
  await refreshMatches(updated)
  emit(user.id, 'request_updated')
  return updated
})

app.get('/matches', async (request) => {
  const user = await requireUser(request)
  return prisma.match.findMany({
    where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
    include: { requestA: { include: requestInclude }, requestB: { include: requestInclude }, conversation: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
})
app.post('/matches/:id/:action', async (request) => {
  const user = await requireUser(request)
  const params = z.object({ id, action: z.enum(['accept', 'decline', 'complete']) }).parse(request.params)
  const match = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${params.id} FOR UPDATE`
    const current = await tx.match.findUniqueOrThrow({ where: { id: params.id } })
    if (current.userAId !== user.id && current.userBId !== user.id)
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    await tx.$queryRaw`SELECT id FROM "ExchangeRequest" WHERE id IN (${current.requestAId}, ${current.requestBId}) ORDER BY id FOR UPDATE`
    const isA = current.userAId === user.id
    if (params.action === 'decline') {
      if (current.status !== 'PENDING')
        throw Object.assign(new Error('Match is no longer pending.'), { statusCode: 409 })
      return tx.match.update({ where: { id: current.id }, data: { status: 'DECLINED' } })
    }
    if (params.action === 'accept') {
      if (!['PENDING', 'ACCEPTED'].includes(current.status))
        throw Object.assign(new Error('Match cannot be accepted.'), { statusCode: 409 })
      const requests = await tx.exchangeRequest.findMany({
        where: { id: { in: [current.requestAId, current.requestBId] } },
        include: { user: { select: { suspendedAt: true } } },
      })
      if (
        requests.length !== 2 ||
        requests.some(
          (r) => !['ACTIVE', 'MATCHED'].includes(r.status) || r.expiresAt <= new Date() || !!r.user.suspendedAt,
        )
      )
        throw Object.assign(new Error('A request is no longer available.'), { statusCode: 409 })
      const competing = await tx.match.count({
        where: {
          id: { not: current.id },
          OR: [
            { requestAId: { in: [current.requestAId, current.requestBId] } },
            { requestBId: { in: [current.requestAId, current.requestBId] } },
          ],
          status: { in: ['ACCEPTED', 'COMPLETED'] },
        },
      })
      if (competing)
        throw Object.assign(new Error('This request is already committed to another match.'), { statusCode: 409 })
      const acceptedA = current.acceptedA || isA,
        acceptedB = current.acceptedB || !isA
      if (acceptedA && acceptedB)
        await tx.exchangeRequest.updateMany({
          where: { id: { in: [current.requestAId, current.requestBId] } },
          data: { status: 'MATCHED' },
        })
      return tx.match.update({
        where: { id: current.id },
        data: { acceptedA, acceptedB, status: acceptedA && acceptedB ? 'ACCEPTED' : 'PENDING' },
      })
    }
    if (current.status !== 'ACCEPTED')
      throw Object.assign(new Error('Both participants must accept first.'), { statusCode: 409 })
    const completedA = current.completedA || isA,
      completedB = current.completedB || !isA
    if (completedA && completedB)
      await tx.exchangeRequest.updateMany({
        where: { id: { in: [current.requestAId, current.requestBId] } },
        data: { status: 'COMPLETED' },
      })
    return tx.match.update({
      where: { id: current.id },
      data: { completedA, completedB, status: completedA && completedB ? 'COMPLETED' : 'ACCEPTED' },
    })
  })
  const other = match.userAId === user.id ? match.userBId : match.userAId
  if (params.action !== 'complete' || match.status === 'COMPLETED') {
    const notification =
      params.action === 'accept'
        ? { type: 'MATCH_ACCEPTED' as const, title: 'Match accepted', body: 'A colleague accepted your match.' }
        : params.action === 'decline'
          ? { type: 'MATCH_DECLINED' as const, title: 'Match declined', body: 'A colleague declined your match.' }
          : {
              type: 'EXCHANGE_COMPLETED' as const,
              title: 'Exchange completed',
              body: 'Both colleagues confirmed the exchange.',
            }
    await prisma.notification.create({ data: { userId: other, ...notification, link: '/matches' } })
  }
  if (params.action === 'accept' && match.status === 'ACCEPTED') void track('match_accepted', user.id, match.id)
  if (params.action === 'complete' && match.status === 'COMPLETED') void track('exchange_completed', user.id, match.id)
  emit(other, 'match_updated', { matchId: match.id })
  emit(user.id, 'match_updated', { matchId: match.id })
  return match
})

app.post('/matches/:id/conversation', async (request) => {
  const user = await requireUser(request)
  const matchId = id.parse((request.params as { id: string }).id)
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } })
  if (match.userAId !== user.id && match.userBId !== user.id)
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  return prisma.conversation.upsert({
    where: { matchId },
    create: { matchId, participants: { create: [{ userId: match.userAId }, { userId: match.userBId }] } },
    update: {},
  })
})
app.get('/conversations', async (request) => {
  const user = await requireUser(request)
  return prisma.conversation.findMany({
    where: { participants: { some: { userId: user.id } } },
    include: {
      participants: {
        include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, username: true } } },
      },
      messages: { take: 1, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  })
})
app.get('/conversations/:id/messages', async (request) => {
  const user = await requireUser(request)
  const conversationId = id.parse((request.params as { id: string }).id)
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  })
  if (!participant) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    data: { lastReadAt: new Date() },
  })
  return prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' }, take: 100 })
})
app.post(
  '/conversations/:id/messages',
  { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
  async (request) => {
    const user = await requireUser(request)
    const conversationId = id.parse((request.params as { id: string }).id)
    const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(request.body)
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { participants: true },
    })
    if (!conversation.participants.some((p) => p.userId === user.id))
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    const message = await prisma.message.create({ data: { conversationId, senderId: user.id, body } })
    for (const participant of conversation.participants)
      if (participant.userId !== user.id) {
        await prisma.notification.create({
          data: {
            userId: participant.userId,
            type: 'NEW_MESSAGE',
            title: 'New message',
            body: `${user.firstName} sent you a message.`,
            link: '/messages',
          },
        })
        emit(participant.userId, 'message', { conversationId })
      }
    emit(user.id, 'message', { conversationId })
    void track('message_sent', user.id, conversationId)
    return message
  },
)
app.get('/notifications', async (request) => {
  const user = await requireUser(request)
  return prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 })
})
app.post('/notifications/read-all', async (request) => {
  const user = await requireUser(request)
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } })
  return { ok: true }
})
app.post('/notifications/:id/read', async (request) => {
  const user = await requireUser(request)
  await prisma.notification.updateMany({
    where: { id: id.parse((request.params as { id: string }).id), userId: user.id },
    data: { readAt: new Date() },
  })
  return { ok: true }
})
app.get('/bookmarks', async (request) => {
  const user = await requireUser(request)
  return prisma.bookmark.findMany({
    where: { userId: user.id },
    include: {
      request: { include: requestInclude },
      targetUser: {
        select: { id: true, firstName: true, lastName: true, username: true, avatarUrl: true, verified: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
})
app.post('/bookmarks/:id', async (request) => {
  const user = await requireUser(request)
  const requestId = id.parse((request.params as { id: string }).id)
  await prisma.exchangeRequest.findUniqueOrThrow({ where: { id: requestId } })
  return prisma.bookmark.upsert({
    where: { userId_requestId: { userId: user.id, requestId } },
    create: { userId: user.id, requestId },
    update: {},
  })
})
app.delete('/bookmarks/:id', async (request) => {
  const user = await requireUser(request)
  const requestId = id.parse((request.params as { id: string }).id)
  await prisma.bookmark.deleteMany({ where: { userId: user.id, requestId } })
  return { ok: true }
})
app.post('/bookmarks/users/:id', async (request) => {
  const user = await requireUser(request)
  const targetUserId = id.parse((request.params as { id: string }).id)
  if (targetUserId === user.id) throw Object.assign(new Error('Cannot bookmark yourself.'), { statusCode: 400 })
  await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } })
  return prisma.bookmark.upsert({
    where: { userId_targetUserId: { userId: user.id, targetUserId } },
    create: { userId: user.id, targetUserId },
    update: {},
  })
})
app.delete('/bookmarks/users/:id', async (request) => {
  const user = await requireUser(request)
  const targetUserId = id.parse((request.params as { id: string }).id)
  await prisma.bookmark.deleteMany({ where: { userId: user.id, targetUserId } })
  return { ok: true }
})
app.post('/matches/:id/reviews', async (request) => {
  const user = await requireUser(request)
  const matchId = id.parse((request.params as { id: string }).id)
  const input = z
    .object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() })
    .parse(request.body)
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } })
  if (match.status !== 'COMPLETED' || (match.userAId !== user.id && match.userBId !== user.id))
    throw Object.assign(new Error('Review is available after a completed exchange.'), { statusCode: 403 })
  const revieweeId = match.userAId === user.id ? match.userBId : match.userAId
  const review = await prisma.review.create({ data: { matchId, reviewerId: user.id, revieweeId, ...input } })
  await prisma.notification.create({
    data: {
      userId: revieweeId,
      type: 'REVIEW_RECEIVED',
      title: 'New review',
      body: 'A colleague reviewed your exchange.',
      link: '/profile',
    },
  })
  emit(revieweeId, 'notification')
  void track('review_created', user.id, review.id)
  return review
})
app.get('/admin/stats', async (request) => {
  const user = await requireUser(request)
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const [users, activeToday, activeRequests, matchesToday, completed, usdDemand, uzsDemand] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { sessions: { some: { createdAt: { gte: today } } } } }),
    prisma.exchangeRequest.count({ where: { status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
    prisma.match.count({ where: { createdAt: { gte: today } } }),
    prisma.match.count({ where: { status: 'COMPLETED' } }),
    prisma.exchangeRequest.count({ where: { status: 'ACTIVE', needCurrency: 'USD', expiresAt: { gt: new Date() } } }),
    prisma.exchangeRequest.count({ where: { status: 'ACTIVE', needCurrency: 'UZS', expiresAt: { gt: new Date() } } }),
  ])
  return { users, activeToday, activeRequests, matchesToday, completed, usdDemand, uzsDemand }
})
app.get('/admin/users', async (request) => {
  const user = await requireUser(request)
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  return prisma.user.findMany({
    select: { id: true, firstName: true, lastName: true, username: true, suspendedAt: true, createdAt: true },
    take: 100,
    orderBy: { createdAt: 'desc' },
  })
})
app.post('/admin/users/:id/suspend', async (request) => {
  const user = await requireUser(request)
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  const targetId = id.parse((request.params as { id: string }).id)
  if (targetId === user.id) throw Object.assign(new Error('Cannot suspend yourself'), { statusCode: 400 })
  await prisma.$transaction([
    prisma.user.update({ where: { id: targetId }, data: { suspendedAt: new Date() } }),
    prisma.auditLog.create({ data: { actorId: user.id, action: 'SUSPEND', entityType: 'User', entityId: targetId } }),
  ])
  return { ok: true }
})
app.get('/admin/requests', async (request) => {
  const user = await requireUser(request)
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  return prisma.exchangeRequest.findMany({ include: requestInclude, orderBy: { createdAt: 'desc' }, take: 100 })
})
app.get('/admin/reports', async (request) => {
  const user = await requireUser(request)
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  return prisma.report.findMany({
    where: { status: 'OPEN' },
    include: { reportedUser: { select: { id: true, firstName: true, lastName: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
})
app.post('/admin/reports/:id/resolve', async (request) => {
  const user = await requireUser(request)
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  const reportId = id.parse((request.params as { id: string }).id)
  await prisma.$transaction([
    prisma.report.update({ where: { id: reportId }, data: { status: 'RESOLVED', resolvedAt: new Date() } }),
    prisma.auditLog.create({
      data: { actorId: user.id, action: 'RESOLVE_REPORT', entityType: 'Report', entityId: reportId },
    }),
  ])
  return { ok: true }
})
app.get('/admin/audit', async (request) => {
  const user = await requireUser(request)
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  return prisma.auditLog.findMany({
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
})
app.post('/admin/requests/:id/deactivate', async (request) => {
  const user = await requireUser(request)
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  const requestId = id.parse((request.params as { id: string }).id)
  const affected = await prisma.$transaction(async (tx) => {
    const target = await tx.exchangeRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } })
    const matches = await tx.match.findMany({
      where: { OR: [{ requestAId: requestId }, { requestBId: requestId }], status: { in: ['PENDING', 'ACCEPTED'] } },
    })
    await tx.match.updateMany({ where: { id: { in: matches.map((m) => m.id) } }, data: { status: 'CANCELLED' } })
    await tx.exchangeRequest.updateMany({
      where: {
        id: { in: matches.map((m) => (m.requestAId === requestId ? m.requestBId : m.requestAId)) },
        status: 'MATCHED',
        expiresAt: { gt: new Date() },
      },
      data: { status: 'ACTIVE' },
    })
    await tx.auditLog.create({
      data: { actorId: user.id, action: 'DEACTIVATE', entityType: 'ExchangeRequest', entityId: requestId },
    })
    return [target.userId, ...matches.map((m) => (m.userAId === target.userId ? m.userBId : m.userAId))]
  })
  for (const userId of affected) emit(userId, 'match_updated')
  return { ok: true }
})
app.get('/events', { websocket: true }, async (socket, request) => {
  if (request.headers.origin !== env.FRONTEND_URL) {
    socket.close(1008)
    return
  }
  const session = await getSession(request)
  if (!session) {
    socket.close(1008)
    return
  }
  const userId = session.userId
  if (!sockets.has(userId)) sockets.set(userId, new Set())
  sockets.get(userId)!.add(socket)
  socket.on('close', () => {
    sockets.get(userId)?.delete(socket)
    if (!sockets.get(userId)?.size) sockets.delete(userId)
  })
})

setInterval(async () => {
  try {
    await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } })
    const now = new Date()
    const warningCutoff = new Date(now.getTime() + 10 * 60_000)
    const expiring = await prisma.exchangeRequest.findMany({
      where: { status: 'ACTIVE', expiresAt: { gt: now, lte: warningCutoff } },
      select: { id: true, userId: true, expiresAt: true },
      take: 100,
    })
    if (expiring.length) {
      const links = expiring.map((item) => `/my-requests?request=${item.id}`)
      const existingWarnings = await prisma.notification.findMany({
        where: { type: 'REQUEST_EXPIRING', link: { in: links } },
        select: { link: true },
      })
      const warned = new Set(existingWarnings.map((item) => item.link))
      const pendingWarnings = expiring.filter((item) => !warned.has(`/my-requests?request=${item.id}`))
      if (pendingWarnings.length)
        await prisma.notification.createMany({
          data: pendingWarnings.map((item) => ({
            userId: item.userId,
            type: 'REQUEST_EXPIRING',
            title: 'Request expiring soon',
            body: `Your request expires at ${item.expiresAt.toISOString()}.`,
            link: `/my-requests?request=${item.id}`,
          })),
        })
      for (const item of pendingWarnings) emit(item.userId, 'notification')
    }
    const expired = await prisma.exchangeRequest.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      select: { id: true, userId: true },
      take: 100,
    })
    if (expired.length) {
      await prisma.exchangeRequest.updateMany({
        where: { id: { in: expired.map((r) => r.id) } },
        data: { status: 'EXPIRED' },
      })
      await prisma.match.updateMany({
        where: {
          OR: [{ requestAId: { in: expired.map((r) => r.id) } }, { requestBId: { in: expired.map((r) => r.id) } }],
          status: 'PENDING',
        },
        data: { status: 'CANCELLED' },
      })
      await prisma.notification.createMany({
        data: expired.map((r) => ({
          userId: r.userId,
          type: 'REQUEST_EXPIRED',
          title: 'Request expired',
          body: 'Your exchange request has expired.',
          link: '/my-requests',
        })),
      })
      for (const item of expired) emit(item.userId, 'request_expired', { requestId: item.id })
    }
  } catch (error) {
    app.log.error(error, 'Request expiration failed')
  }
}, 60_000).unref()
setInterval(async () => {
  try {
    const recent = await prisma.exchangeRequest.findMany({
      where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    for (const item of recent) await makeMatches(item)
  } catch (error) {
    app.log.error(error, 'Matching retry failed')
  }
}, 5 * 60_000).unref()

await app.listen({ port: env.PORT, host: '0.0.0.0' })
