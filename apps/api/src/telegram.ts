import { prisma } from './db.js'

export async function notifyTelegram(userId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const frontend = process.env.FRONTEND_URL
  if (!token || !frontend) return
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true } })
    if (!user) return
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.telegramId.toString(),
        text,
        reply_markup: { inline_keyboard: [[{ text: 'View match', url: `${frontend}/matches` }]] },
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    /* Bot delivery is optional; in-app notification remains authoritative. */
  }
}
