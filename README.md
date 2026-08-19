# SEAL — Claude Mastery

Enterprise Claude capability assessment platform.

SEAL measures whether a person can **apply Claude in real enterprise work** — not whether they can recite product vocabulary. It covers Foundation through Expert, with particular depth in Claude Code, MCP, agentic engineering, context/knowledge fabrics, production evaluation, security, and healthcare/life-sciences architecture.

## Architecture

```
client/   Vite + React + TypeScript SPA
server/   Express API, Prisma, BullMQ workers, CLI
e2e/      Playwright
```

PostgreSQL is the source of truth. Redis backs finalize locks, refresh-adjacent coordination, and generation queues. The Anthropic API is called only from the server through `server/src/services/ai/anthropicProvider.ts`.

See `ARCHITECTURE.md`, `DATA_MODEL.md`, and `IMPLEMENTATION_PLAN.md`.

## Start with Docker (recommended)

Requires Docker Desktop. From the repo root:

```bash
cp .env.example .env   # skip if .env already exists
docker compose up --build
```

Then open **http://localhost:8080**.

That starts Postgres, Redis, the API (migrations + seed on first boot), and the web app. API keys in `.env` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are passed into the API container. Stop with `Ctrl+C` or `docker compose down`.

Postgres and Redis stay on the Docker network (not published to the host), so this does not collide with Homebrew Postgres on port 5432.

## Local Node setup (without Docker for the app)

- Node.js 20+
- PostgreSQL 16 (Docker or Homebrew)
- Redis 7 (optional; generation queue warnings are harmless without it)

```bash
cp .env.example .env
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

- App: http://localhost:5173
- API: http://localhost:4000/api/health

If `db:migrate` is run for the first time it will create the initial Prisma migration.

## Local database notes

**Full Docker stack:** `docker compose up --build` — app at http://localhost:8080.

**Docker Postgres + Redis only, Node on the host:** add host ports to those services in `docker-compose.yml`, then `npm run db:up` and `DATABASE_URL=postgresql://seal:seal@localhost:5432/seal?schema=public`.

**Homebrew Postgres:** create database `seal`, set `DATABASE_URL=postgresql://YOUR_USER@127.0.0.1:5432/seal?schema=public`. Redis is recommended for multi-instance finalize locks and BullMQ; if Redis is down, SEAL falls back to a process-local lock so local development still works.

## First accounts (local seed)

| Role | Email | Password |
|---|---|---|
| Super Admin | superadmin@seal.local | SealAdmin!2026 |
| Admin | admin.one@seal.local | SealAdmin!2026 |
| Reviewer | reviewer@seal.local | SealReview!2026 |
| Trainee (30 seeded) | elena.voss@seal.local | SealTrainee!2026 |

Seed also loads all curriculum modules (F01–E05), **5 approved questions per module**, default 90-minute templates, and assignments for every trainee.

## Environment

See `.env.example`. Critical keys:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
- `ANTHROPIC_API_KEY` (server only — never sent to the browser)
- `ANTHROPIC_MODEL` and optional generation / evaluation / critic model overrides
- `AI_MONTHLY_BUDGET_USD`, `AI_GENERATION_CONCURRENCY`

Do not commit `.env`.

## Question banks

Seed does **not** call an LLM. To populate the full 25-question/module bank with OpenAI (default) or Anthropic:

```bash
# .env
OPENAI_API_KEY=sk-...
AI_PROVIDER=openai
OPENAI_MODEL=gpt-4.1

# or
ANTHROPIC_API_KEY=sk-ant-...
AI_PROVIDER=anthropic
```

Then from **AI control center** choose the provider and Generate, or:

```bash
npm run generate:questions -- --module A01 --count 25
```

Seed does **not** call Claude. To populate the full 25-question/module bank:

```bash
npm run generate:questions -- --module A01 --count 25
npm run generate:level -- --level ADVANCED
npm run validate:question-bank
```

Generation writes `DRAFT` / `AI_VALIDATED` items. Auto-approve is off. Review and approve in **Question bank**.

Requires `ANTHROPIC_API_KEY`. Cost, tokens, and failures appear in **AI control center**.

## Scripts

| Command | Purpose |
|---|---|
| `npm run docker:up` | Postgres, Redis, API, and web in Docker |
| `npm run docker:down` | Stop the Docker stack |
| `npm run dev` | API + SPA on the host |
| `npm run build` | Production build |
| `npm run test` | Vitest (server + client) |
| `npm run test:e2e` | Playwright (services must be seedable) |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Prisma migrate |
| `npm run db:seed` | Curriculum, users, 5 questions/module |
| `npm run generate:questions` | Claude question factory for one module |
| `npm run generate:level` | Fill a level toward 25 approved items |
| `npm run validate:question-bank` | Integrity check |
| `npm run recalculate:analytics` | Observed difficulty / discrimination |

## Assessment runtime

- 90-minute default (`durationSeconds` / `timeBudgetSeconds` = 5400)
- Assembler selects a frozen set under the time budget with weighted coverage (modules, difficulty, type, competencies, freshness, prior exposure)
- Timer is `startedAt` / `expiresAt` on the server; the client derives countdown
- Autosave persists answers; refresh restores progress
- Duplicate finalization is prevented with a Redis lock
- Integrity events are signals — they do not auto-fail

## Scoring

Objective items are scored deterministically. Written/capstone items use a separate evaluator call with untrusted-data delimiters and a Zod rubric schema. Failures mark `REVIEW_REQUIRED` instead of silent zero.

Proficiency bands are configurable. **Claude Expert cannot be awarded from an easy assessment** (mean difficulty weight gate).

## Production notes

- Set `COOKIE_SECURE=true`, strong JWT secrets, and restrict `CORS`/`APP_URL`
- Run API as a Node process behind TLS; run `startWorkers()` (included in `server/src/index.ts`) for generation jobs
- `prisma migrate deploy` on release
- Keep Anthropic keys in a secret manager
- Use the AI control center budget fields; do not regenerate banks at attempt start

## Accessibility

Keyboard navigation on assessment items, visible focus, and `prefers-reduced-motion` are honored. Primary target is desktop/laptop; tablet is supported; mobile is usable but not recommended for architecture artifacts.
