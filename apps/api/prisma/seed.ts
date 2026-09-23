import { PrismaClient, Prisma } from '@prisma/client'

if (process.env.NODE_ENV === 'production') throw new Error('Development seed cannot run in production')
const db = new PrismaClient()
const names = [
  'Salohiddin Dilmatov',
  'Aziz Karimov',
  'Diyora Mamatova',
  'Bekzod Abdullayev',
  'Nilufar Saidova',
  'Javohir Tursunov',
  'Munisa Rakhimova',
  'Sardor Ismoilov',
  'Malika Rasulova',
  'Temur Yuldashev',
  'Kamola Yusupova',
  'Rustam Ergashev',
  'Farida Akhmedova',
  'Akmal Kadirov',
  'Zarina Karimova',
  'Dilshod Mirzaev',
  'Nodira Xasanova',
  'Sherzod Sobirov',
  'Sevara Ubaydullaeva',
  'Oybek Nurmatov',
]
const users = []
for (let i = 0; i < names.length; i++) {
  const [firstName, lastName] = names[i]!.split(' ')
  users.push(
    await db.user.upsert({
      where: { telegramId: BigInt(900000000 + i) },
      update: {},
      create: {
        telegramId: BigInt(900000000 + i),
        firstName: firstName!,
        lastName,
        username: `almash_dev_${i + 1}`,
        location: i % 2 ? 'Office / Tashkent' : 'Tashkent',
        verified: i < 8,
      },
    }),
  )
}
const requests = []
for (let i = 0; i < 30; i++) {
  const needCurrency = i % 2 ? 'UZS' : 'USD'
  const needAmount = new Prisma.Decimal(needCurrency === 'USD' ? 100 + i * 25 : (100 + i * 25) * 12750)
  const exchangeRate = new Prisma.Decimal(12750)
  requests.push(
    await db.exchangeRequest.create({
      data: {
        userId: users[i % users.length]!.id,
        needCurrency,
        offerCurrency: needCurrency === 'USD' ? 'UZS' : 'USD',
        needAmount,
        offerAmount: needCurrency === 'USD' ? needAmount.mul(exchangeRate) : needAmount.div(exchangeRate),
        exchangeRate,
        rateType: 'CUSTOM',
        exchangeMethod: i % 3 === 0 ? 'CASH' : 'BANK_TRANSFER',
        location: 'Office / Tashkent',
        status: i < 24 ? 'ACTIVE' : 'EXPIRED',
        expiresAt: new Date(Date.now() + (i < 24 ? 4 : -4) * 3600000),
      },
    }),
  )
}
for (const [a, b, usd, status] of [
  [1, 4, 125, 'PENDING'],
  [3, 6, 175, 'COMPLETED'],
  [5, 8, 225, 'ACCEPTED'],
] as const) {
  const match = await db.match.create({
    data: {
      requestAId: requests[a]!.id,
      requestBId: requests[b]!.id,
      userAId: requests[a]!.userId,
      userBId: requests[b]!.userId,
      score: 88,
      suggestedUsd: usd,
      suggestedUzs: usd * 12750,
      status,
      acceptedA: status !== 'PENDING',
      acceptedB: status !== 'PENDING',
      completedA: status === 'COMPLETED',
      completedB: status === 'COMPLETED',
    },
  })
  if (status !== 'PENDING')
    await db.exchangeRequest.updateMany({
      where: { id: { in: [requests[a]!.id, requests[b]!.id] } },
      data: { status: status === 'COMPLETED' ? 'COMPLETED' : 'MATCHED' },
    })
  const conversation = await db.conversation.create({
    data: { matchId: match.id, participants: { create: [{ userId: match.userAId }, { userId: match.userBId }] } },
  })
  await db.message.createMany({
    data: [
      { conversationId: conversation.id, senderId: match.userAId, body: 'Hi! I saw your request.' },
      { conversationId: conversation.id, senderId: match.userBId, body: 'Thanks. Office works for me.' },
    ],
  })
  await db.notification.createMany({
    data: [match.userAId, match.userBId].map((userId) => ({
      userId,
      type: 'MATCH_FOUND',
      title: 'Match found!',
      body: 'A colleague has a compatible request.',
      link: '/matches',
    })),
  })
  if (status === 'COMPLETED')
    await db.review.createMany({
      data: [
        {
          matchId: match.id,
          reviewerId: match.userAId,
          revieweeId: match.userBId,
          rating: 5,
          comment: 'Smooth exchange.',
        },
        {
          matchId: match.id,
          reviewerId: match.userBId,
          revieweeId: match.userAId,
          rating: 5,
          comment: 'Quick response.',
        },
      ],
    })
}
await db.exchangeRate.create({ data: { usdUzs: 12750, source: 'Development reference rate', fetchedAt: new Date() } })
await db.$disconnect()
console.log('Development data created. These Telegram IDs are placeholders and cannot authenticate.')
