import { describe, expect, it } from 'vitest'
import { Prisma, type ExchangeRequest } from '@prisma/client'
import { compatible, offerAmount } from './domain.js'

const base = (
  id: string,
  userId: string,
  needCurrency: 'USD' | 'UZS',
  needAmount: string,
  offerAmountValue: string,
): ExchangeRequest => ({
  id,
  userId,
  needCurrency,
  offerCurrency: needCurrency === 'USD' ? 'UZS' : 'USD',
  needAmount: new Prisma.Decimal(needAmount),
  offerAmount: new Prisma.Decimal(offerAmountValue),
  exchangeRate: new Prisma.Decimal(12750),
  exchangeMethod: 'BANK_TRANSFER',
  rateType: 'CUSTOM',
  location: 'Office / Tashkent',
  status: 'ACTIVE',
  expiresAt: new Date(Date.now() + 3600000),
  createdAt: new Date(),
  updatedAt: new Date(),
})
describe('matching', () => {
  it('supports partial matching without exceeding either party’s amount', () => {
    const result = compatible(base('a', 'a', 'USD', '400', '5100000'), base('b', 'b', 'UZS', '6375000', '500'))
    expect(result?.suggestedUsd.toString()).toBe('400')
    expect(result?.suggestedUzs.toString()).toBe('5100000')
  })
  it('rejects self, expired, incompatible method, and distant rates', () => {
    const a = base('a', 'a', 'USD', '400', '5100000')
    const b = base('b', 'a', 'UZS', '6375000', '500')
    expect(compatible(a, b)).toBeNull()
    b.userId = 'b'
    b.expiresAt = new Date(0)
    expect(compatible(a, b)).toBeNull()
    b.expiresAt = new Date(Date.now() + 3600000)
    b.exchangeMethod = 'CASH'
    expect(compatible(a, b)).toBeNull()
    b.exchangeMethod = 'BANK_TRANSFER'
    b.exchangeRate = new Prisma.Decimal(14000)
    expect(compatible(a, b)).toBeNull()
  })
  it('calculates counter amounts with decimals', () => {
    expect(offerAmount('USD', new Prisma.Decimal('400'), new Prisma.Decimal('12750')).toString()).toBe('5100000')
    expect(offerAmount('UZS', new Prisma.Decimal('5100000'), new Prisma.Decimal('12750')).toString()).toBe('400')
  })
  it('allows location differences for remote methods but rejects them for cash', () => {
    const a = base('a', 'a', 'USD', '400', '5100000')
    const b = base('b', 'b', 'UZS', '6375000', '500')
    b.location = 'Yunusobod'
    expect(compatible(a, b)).not.toBeNull()
    a.exchangeMethod = 'CASH'
    b.exchangeMethod = 'EITHER'
    expect(compatible(a, b)).toBeNull()
  })
  it('uses configurable score weights', () => {
    const result = compatible(base('a', 'a', 'USD', '400', '5100000'), base('b', 'b', 'UZS', '6375000', '500'), {
      amount: 100,
      rate: 0,
      method: 0,
      location: 0,
      recency: 0,
    })
    expect(result?.score).toBe(80)
  })
})
