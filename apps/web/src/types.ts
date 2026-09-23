export type User = {
  id: string
  displayName: string
  username?: string | null
  avatarUrl?: string | null
  location?: string | null
  preferredMethods?: ('CASH' | 'BANK_TRANSFER' | 'EITHER')[]
  verified: boolean
  role: 'USER' | 'ADMIN'
  joinedAt: string
  rating?: number | null
  ratingCount?: number
  requestCount?: number
  completedCount?: number
}
export type Request = {
  id: string
  userId: string
  needCurrency: 'USD' | 'UZS'
  offerCurrency: 'USD' | 'UZS'
  needAmount: string
  offerAmount: string
  exchangeRate: string
  exchangeMethod: 'CASH' | 'BANK_TRANSFER' | 'EITHER'
  rateType: 'MARKET' | 'CUSTOM'
  location?: string | null
  status: 'ACTIVE' | 'MATCHED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'
  expiresAt: string
  createdAt: string
  user?: {
    id: string
    firstName: string
    lastName?: string | null
    username?: string | null
    avatarUrl?: string | null
    verified: boolean
    location?: string | null
  }
}
export type Match = {
  id: string
  requestA: Request
  requestB: Request
  userAId: string
  userBId: string
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED' | 'CANCELLED'
  score: number
  suggestedUsd: string
  suggestedUzs: string
  acceptedA: boolean
  acceptedB: boolean
  completedA: boolean
  completedB: boolean
  conversation?: { id: string } | null
  createdAt: string
}
export type Conversation = {
  id: string
  participants: {
    userId: string
    user: {
      id: string
      firstName: string
      lastName?: string | null
      avatarUrl?: string | null
      username?: string | null
    }
    lastReadAt?: string | null
  }[]
  messages: Message[]
}
export type Message = { id: string; conversationId: string; senderId: string; body: string; createdAt: string }
export type Notification = {
  id: string
  type: string
  title: string
  body: string
  link?: string | null
  readAt?: string | null
  createdAt: string
}
