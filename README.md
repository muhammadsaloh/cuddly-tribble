# Almash

Almash is a private USD ↔ UZS request discovery and matching app for colleagues. It connects compatible people; it never holds funds, settles an exchange, or processes payments.

## Stack and structure

- `apps/web`: React 19, TypeScript, Vite, file based TanStack Router, TanStack Query, Tailwind CSS v4, React Hook Form, Zod.
- `apps/api`: Fastify, TypeScript, Prisma, PostgreSQL, WebSockets, Telegram Login verification.
- `apps/api/prisma/migrations`: versioned SQL migration.
- `docs/architecture.md`: main data and security flows.
- `.github/workflows/ci.yml`: PostgreSQL-backed migration, build, test, and two-user Playwright verification.

Node 24, pnpm 11.5.2, PostgreSQL 16, and a Telegram bot are required. Docker Compose can provide PostgreSQL and the application if Docker is installed.

## Local setup

1. Copy `.env.example` to `.env` and set `SESSION_SECRET` to a random value of at least 32 characters. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and URLs.
2. Configure the Telegram bot login domain to match `FRONTEND_URL` and authorize the bot to send messages if bot notifications are desired.
3. Run `pnpm install`, `pnpm --filter @almash/api exec prisma generate`, and `pnpm db:migrate` from the repository root.
4. Run `pnpm dev`. The web app is on port 5173 and the API on port 3000. `GET /health` verifies database connectivity.

For containers, run `docker compose up --build`. The API container applies the checked in migration before starting. The Compose file is for local use; replace its database password and deployment topology for production.

The optional `pnpm db:seed` creates development data only and refuses to run with `NODE_ENV=production`. Seed users have placeholder Telegram IDs and cannot sign in. Production components query the API and contain no hardcoded marketplace listings.

## Commands

```text
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm lint
pnpm db:migrate
pnpm db:seed
```

## Configuration

| Variable                     | Purpose                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`               | PostgreSQL connection string                                             |
| `SESSION_SECRET`             | Required high entropy server secret; sessions use opaque random tokens   |
| `FRONTEND_URL`               | Exact allowed browser origin and Telegram return domain                  |
| `API_URL`                    | Public API URL for deployment metadata                                   |
| `TELEGRAM_BOT_TOKEN`         | Server side Telegram signature verification and optional bot messages    |
| `TELEGRAM_BOT_USERNAME`      | Bot identity for setup                                                   |
| `EXCHANGE_RATE_API_URL`      | Optional HTTPS endpoint returning `{ "rate": "12750", "source": "..." }` |
| `EXCHANGE_RATE_API_KEY`      | Optional bearer token for that endpoint                                  |
| `VITE_API_URL`               | Browser API base URL, set at frontend build time                         |
| `VITE_TELEGRAM_BOT_USERNAME` | Public Telegram Login widget bot username                                |
| `NODE_ENV`, `PORT`           | Runtime mode and API port                                                |

When the reference rate provider is unavailable, users can enter a custom rate. A cached reference rate can remain visible with its source and timestamp. A reference rate is information only; peers agree their own terms.

## Deployment

Deploy both Docker images to a service that supports long lived WebSocket connections, such as one container platform for the API and a static host for the web app. Use managed PostgreSQL and TLS for `app.example.com` and `api.example.com`. Set `FRONTEND_URL=https://app.example.com`, `VITE_API_URL=https://api.example.com`, and configure the Telegram bot for the app domain. Build frontend environment values into the image. Route all frontend paths to `index.html` (the included Nginx config does this). Run `prisma migrate deploy` once per release, before API traffic; the API Dockerfile currently runs it at startup, which is suitable for a single API instance. Never run the development seed in production.

Create an initial admin by authenticating with Telegram, then setting that user's role to `ADMIN` directly through a secured database administration process. No admin password or Telegram ID is embedded in source.

Before opening the service to a public community, obtain local legal/compliance review for a platform facilitating foreign currency transactions. Technical validation does not establish legal compliance.

## Verification status

Local verification completed against an isolated PostgreSQL instance: the checked-in migration applied to an empty database, `GET /health` returned `ok`, and the persisted final match had status `COMPLETED` with one message and one review. Build, lint, formatting, and seven API unit tests also pass.

The Playwright test uses two isolated browser contexts and signs local test Telegram payloads with `TELEGRAM_BOT_TOKEN`; it must run only against a dedicated test database and bot. Set `E2E_WEB_URL` and `E2E_API_URL` if the services are not on their default localhost ports. The complete browser scenario passed locally: both users authenticated, posted opposite requests, found and accepted their match, exchanged a message, marked the exchange complete, and submitted a review.

Docker image builds, real Telegram widget login and bot delivery, and public production smoke tests have not been executed in this environment. A production target, managed database, public domains, TLS, and real Telegram bot credentials are still required before deployment. No production URL is claimed.

The CI workflow starts PostgreSQL 16, applies the checked-in migration to an empty database, builds and checks both apps, installs Chromium, starts the API and web app, and runs the complete two-user exchange scenario. Product events are stored through an analytics provider abstraction without message content, amounts, locations, or other event payloads.

## Troubleshooting

- If Telegram sign in fails, check the bot domain, clock skew, token, and exact frontend URL.
- If browser writes return 403, check the `Origin` header against `FRONTEND_URL`.
- If the market is empty, confirm there are active unexpired requests; expired requests are excluded immediately.
- If the reference rate is unavailable, configure the provider endpoint or select a custom rate.
- On Windows, `spawn EPERM` during Vite or Vitest can be an execution restriction rather than a source error.
