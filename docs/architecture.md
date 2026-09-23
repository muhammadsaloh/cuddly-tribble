# Architecture

```text
Telegram Login → verified Fastify auth → opaque session cookie → User
User → ExchangeRequest → server matching → Match → Conversation → Completion → Review
                                     ↘ notifications → WebSocket / optional Telegram bot
```

The browser uses file based TanStack Router and TanStack Query. The API owns authorization, amount calculation, expiration, and matching. Prisma maps domain records to PostgreSQL. Request cards only expose a display name, optional username/avatar, method, location, and offer details. Private Telegram data, session tokens, and IP addresses are never returned in marketplace responses.

Amounts and rates use PostgreSQL `DECIMAL` and Prisma Decimal throughout the server. The browser's immediate estimate is for display only; the server recalculates the saved counter amount. A candidate must have opposite currencies, a positive common USD quantity, a rate gap at most 3%, compatible methods, nonexpired active requests, and a different owner. Scoring weights are isolated in `domain.ts`. A unique request pair prevents duplicate records.

Match acceptance runs in a database transaction. The two request rows are locked in stable order, and competing accepted matches are checked before both participants can commit. Completion requires confirmation from both. Reviews require a completed match and are unique per reviewer per match. Conversation access checks participation on every read/write. Reports are available from colleague profiles; admin endpoints check the database role and write audit records for moderation actions. Bookmarks can reference a request or a colleague, with a database check requiring exactly one target.

Telegram Login is verified with HMAC SHA-256 and a five minute freshness window. Sessions are random opaque tokens hashed in the database and sent in HTTP only, SameSite strict cookies. CORS and write origin checks restrict requests to the configured frontend origin. Rate limits cover API traffic, auth, posting, and messaging. The WebSocket endpoint also checks origin and session.

Real time events only signal affected users. Clients invalidate the relevant cached queries after receiving an event. PostgreSQL is the source of truth. The in process WebSocket registry assumes one API instance; multiple API replicas require a shared pub/sub bridge. The reference rate provider is optional and cached for ten minutes. It does not set a mandatory exchange rate.

The supplied desktop image guided the sidebar, market grid, request panel, emerald match card, card density, and typography. Mobile uses bottom navigation and a direct Post action.

Product analytics goes through an `AnalyticsProvider`. The database implementation records only the event name, authenticated user reference, optional related entity ID, and timestamp. It does not copy request amounts, messages, Telegram details, or locations into analytics records. This provider can be replaced without changing request and match services.
