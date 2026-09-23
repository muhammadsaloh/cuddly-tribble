import { z } from 'zod'
import { prisma } from './db.js'

export interface ExchangeRateProvider {
  getUsdUzsRate(): Promise<{ rate: string; source: string; fetchedAt: Date }>
}
class HttpRateProvider implements ExchangeRateProvider {
  async getUsdUzsRate() {
    const url = process.env.EXCHANGE_RATE_API_URL
    if (!url) throw new Error('Reference rate provider is not configured')
    const response = await fetch(url, {
      headers: process.env.EXCHANGE_RATE_API_KEY
        ? { Authorization: `Bearer ${process.env.EXCHANGE_RATE_API_KEY}` }
        : {},
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error('Reference rate provider failed')
    const parsed = z
      .object({ rate: z.union([z.string(), z.number()]), source: z.string().min(1).default('Configured provider') })
      .parse(await response.json())
    const rate = String(parsed.rate)
    if (!/^\d+(\.\d{1,4})?$/.test(rate) || Number(rate) < 1000 || Number(rate) > 100000)
      throw new Error('Invalid provider rate')
    return { rate, source: parsed.source, fetchedAt: new Date() }
  }
}
const provider: ExchangeRateProvider = new HttpRateProvider()
export async function currentRate() {
  const latest = await prisma.exchangeRate.findFirst({ orderBy: { fetchedAt: 'desc' } })
  if (latest && Date.now() - latest.fetchedAt.getTime() < 10 * 60000) return latest
  if (!process.env.EXCHANGE_RATE_API_URL) return latest
  try {
    const result = await provider.getUsdUzsRate()
    return await prisma.exchangeRate.create({
      data: { usdUzs: result.rate, source: result.source, fetchedAt: result.fetchedAt },
    })
  } catch {
    return latest
  }
}
