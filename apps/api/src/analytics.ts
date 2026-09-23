import { prisma } from './db.js'

export const analyticsEvents = [
  'signed_up',
  'request_created',
  'match_found',
  'match_opened',
  'telegram_contact_clicked',
  'message_sent',
  'match_accepted',
  'exchange_completed',
  'review_created',
] as const
export const clientAnalyticsEvents = ['match_opened', 'telegram_contact_clicked'] as const

export type AnalyticsEvent = (typeof analyticsEvents)[number]

export interface AnalyticsProvider {
  track(event: AnalyticsEvent, userId?: string, entityId?: string): Promise<void>
}

class DatabaseAnalyticsProvider implements AnalyticsProvider {
  async track(name: AnalyticsEvent, userId?: string, entityId?: string) {
    await prisma.productEvent.create({ data: { name, userId, entityId } })
  }
}

export const analytics: AnalyticsProvider = new DatabaseAnalyticsProvider()

export function track(event: AnalyticsEvent, userId?: string, entityId?: string) {
  return analytics.track(event, userId, entityId).catch(() => undefined)
}
