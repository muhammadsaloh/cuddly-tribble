import { Prisma, type ExchangeRequest, type ExchangeMethod } from '@prisma/client'

export type MatchWeights = { amount: number; rate: number; method: number; location: number; recency: number }
export const defaultWeights: MatchWeights = { amount: 40, rate: 30, method: 15, location: 10, recency: 5 }

export function compatible(a: ExchangeRequest, b: ExchangeRequest, weights = defaultWeights) {
  if (
    a.userId === b.userId ||
    a.needCurrency === b.needCurrency ||
    a.offerCurrency !== b.needCurrency ||
    b.offerCurrency !== a.needCurrency
  )
    return null
  if (a.status !== 'ACTIVE' || b.status !== 'ACTIVE' || a.expiresAt <= new Date() || b.expiresAt <= new Date())
    return null
  const rateA = new Prisma.Decimal(a.exchangeRate)
  const rateB = new Prisma.Decimal(b.exchangeRate)
  const rateGap = rateA.sub(rateB).abs().div(rateA)
  if (rateGap.gt('0.03')) return null
  const usdAvailableA = a.offerCurrency === 'USD' ? new Prisma.Decimal(a.offerAmount) : new Prisma.Decimal(a.needAmount)
  const usdAvailableB = b.offerCurrency === 'USD' ? new Prisma.Decimal(b.offerAmount) : new Prisma.Decimal(b.needAmount)
  const usdNeededA = a.needCurrency === 'USD' ? new Prisma.Decimal(a.needAmount) : new Prisma.Decimal(a.offerAmount)
  const usdNeededB = b.needCurrency === 'USD' ? new Prisma.Decimal(b.needAmount) : new Prisma.Decimal(b.offerAmount)
  const suggestedUsd = Prisma.Decimal.min(usdAvailableA, usdAvailableB, usdNeededA, usdNeededB)
  if (suggestedUsd.lte(0)) return null
  const methodCompatible =
    a.exchangeMethod === 'EITHER' || b.exchangeMethod === 'EITHER' || a.exchangeMethod === b.exchangeMethod
  if (!methodCompatible) return null
  const locationCompatible = !a.location || !b.location || a.location.toLowerCase() === b.location.toLowerCase()
  if (!locationCompatible && (a.exchangeMethod === 'CASH' || b.exchangeMethod === 'CASH')) return null
  const fulfillment = Prisma.Decimal.min(suggestedUsd.div(usdNeededA), suggestedUsd.div(usdNeededB)).toNumber()
  const recency = Math.max(0, 1 - (Date.now() - Math.max(a.createdAt.getTime(), b.createdAt.getTime())) / 86_400_000)
  const score = Math.round(
    weights.amount * fulfillment +
      weights.rate * Math.max(0, 1 - rateGap.toNumber() / 0.03) +
      weights.method +
      weights.location * (locationCompatible ? 1 : 0) +
      weights.recency * recency,
  )
  const rate = rateA.add(rateB).div(2)
  return {
    score,
    suggestedUsd: suggestedUsd.toDecimalPlaces(2),
    suggestedUzs: suggestedUsd.mul(rate).toDecimalPlaces(2),
  }
}

export function offerAmount(needCurrency: 'USD' | 'UZS', amount: Prisma.Decimal, rate: Prisma.Decimal) {
  return needCurrency === 'USD' ? amount.mul(rate).toDecimalPlaces(2) : amount.div(rate).toDecimalPlaces(2)
}

export function methodLabel(method: ExchangeMethod) {
  return method === 'BANK_TRANSFER' ? 'Bank transfer' : method === 'CASH' ? 'Cash' : 'Either'
}
