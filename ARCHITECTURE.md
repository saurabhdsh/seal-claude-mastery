# SEAL — Claude Mastery Architecture

Enterprise Claude Capability Assessment Platform.

SEAL answers a single question: **can this person actually use Claude effectively in enterprise work?** It is not an LMS and not a trivia exam. It is a command-center for generating, administering, scoring, and explaining scenario-driven Claude capability assessments.

## 1. System context

```
┌─────────────┐     HTTPS      ┌──────────────────┐      ┌─────────────┐
│  Browser     │◄──────────────►│  Vite SPA        │      │  Anthropic  │
│  Admin /     │                │  React + TS      │      │  Claude API │
│  Trainee     │                └────────┬─────────┘      └──────▲──────┘
└─────────────┘                          │ /api                  │
                                         ▼                       │
                                ┌──────────────────┐             │
                                │  Express API     │─────────────┘
                                │  Node + TS       │  provider abstraction
                                └────┬─────┬───────┘
                                     │     │
                              Prisma │     │ ioredis / BullMQ
                                     ▼     ▼
                              ┌──────────┐ ┌──────────┐
                              │ Postgres │ │  Redis   │
                              └──────────┘ └──────────┘
```

- The browser never holds `ANTHROPIC_API_KEY`.
- Assessment timers, locks, and finalization are server-authoritative.
- Role is always resolved from the authenticated session, never from client state.

## 2. Repository layout

Monorepo with npm workspaces:

```
/
  client/          Vite + React + TypeScript SPA
  server/          Express API, Prisma, workers, CLI
  e2e/             Playwright critical path
```

Shared contracts live in `server/src/types` and are consumed by the client through the HTTP API (OpenAPI-style route modules + Zod). The SPA does not import server internals.

## 3. Runtime topology

| Process | Responsibility |
|---|---|
| `client` (Vite / static) | Admin command center, trainee assessment runtime, results |
| `server` HTTP | Auth, RBAC, CRUD, assessment session, scoring orchestration |
| `server` worker | BullMQ jobs: question generation, critic pipeline, written-answer evaluation, narrative generation |
| PostgreSQL | Source of truth |
| Redis | Refresh-token denylist / rotation helpers, finalize locks, BullMQ, rate-limit backing, generation concurrency |

## 4. Frontend architecture

- **Pure React 18 + Vite + TypeScript**. No Next.js.
- **React Router** for the two product surfaces: Admin and Trainee/Assessment.
- **TanStack Query** for server state. Mutations invalidate precisely.
- **Zustand** for ephemeral client state: auth session (access token in memory), theme, command palette, assessment draft answers (optimistic).
- **Framer Motion** for page, question, score-reveal, and generation-status transitions. All animations honor `prefers-reduced-motion`.
- **Tailwind CSS** with a design-token layer in CSS variables (graphite / ivory / coral).
- **Recharts** for understated analytics. **Lucide** for icons.

Route gates:

- `/admin/*` requires `SUPER_ADMIN | ADMIN | ASSESSMENT_MANAGER | REVIEWER` with per-route permission maps.
- `/assessment/*` requires `TRAINEE` (admins may preview via impersonation-safe review routes, not by sitting the exam as admin).
- `/profile` any authenticated role.

## 5. Backend architecture

Layering:

```
routes → middleware (auth, rbac, validate) → services → prisma / redis / ai
```

Key service modules:

| Module | Role |
|---|---|
| `services/auth` | Login, refresh rotation, lockout, password policy |
| `services/rbac` | Permission catalog, server-side enforcement |
| `services/curriculum` | Levels, domains, modules, competencies |
| `services/questions` | Bank CRUD, status machine, clone/retire |
| `services/ai/anthropicProvider` | Swappable completion provider |
| `services/ai/questionGenerator` | Structured generation + Zod |
| `services/ai/answerEvaluator` | Rubric scoring of untrusted candidate text |
| `services/ai/assessmentAssembler` | Weighted selection under time budget |
| `services/ai/difficultyCalibrator` | Observed difficulty / discrimination |
| `services/ai/feedbackGenerator` | Executive narrative from evidence |
| `services/assessment` | Templates, assignment, attempt lifecycle |
| `services/runtime` | Timer, autosave, reconnect, finalize lock |
| `services/scoring` | Deterministic + AI rubric aggregation |
| `services/integrity` | Signal capture, risk indicators (no auto-fail) |
| `services/analytics` | Live aggregations, never hardcoded |
| `services/audit` | Immutable admin event log |
| `services/notify` | Email abstraction (dev logger) |

## 6. Authentication and authorization

- Access JWT: 15 minutes, in-memory on the client, sent as `Authorization: Bearer`.
- Refresh JWT: 7 days, `httpOnly`, `Secure` in production, `SameSite=lax`, path `/api/auth`. Rotated on every refresh. Previous token hash revoked.
- Passwords: Argon2id.
- Lockout: 5 consecutive failures → 15-minute lock.
- RBAC: every privileged handler calls `requirePermission(...)`. Browser role badges are display-only.

Roles:

1. `SUPER_ADMIN` — full control including configuration and AI budget.
2. `ADMIN` — trainees, assessments, question bank, analytics, audit read.
3. `ASSESSMENT_MANAGER` — templates, assignments, results, limited question ops.
4. `REVIEWER` — evaluation queue, score modification with reason.
5. `TRAINEE` — own profile, own assignments, own attempts.

## 7. Assessment engine

Hard constraint: `sum(estimatedTimeSeconds) ≤ configured budget` (default 5400s).

Assembler optimizes jointly for:

- module coverage
- difficulty mix by level policy
- question-type diversity
- competency coverage
- freshness / prior exposure
- time budget

Selection is **weighted**, not `Math.random()`. Adaptive mode is optional and uses a transparent ability estimator (difficulty-weighted EWMA of correctness). The interface is shaped so IRT can replace the estimator later without changing persistence.

Timer: `startedAt` / `expiresAt` stored on `AssessmentAttempt`. Client countdown is derived. On `now >= expiresAt`, a Redis lock `lock:attempt:{id}:finalize` guarantees single finalization.

## 8. AI pipeline

```
Generate → Zod schema → duplicate detect → critic (separate call)
        → difficulty calibrate → human approval → APPROVED bank
```

Auto-approve is **off** by default.

Evaluator treats candidate text as **untrusted data**, wrapped in delimiters, with a system instruction that forbids instruction-following on that payload. Output is Zod-validated. Failures mark `REVIEW_REQUIRED` rather than silent zero.

## 9. Scoring philosophy

Not percentage-correct alone.

- Objective items: deterministic.
- Constructed response / capstone: rubric criteria, each with score, reason, evidence, confidence.
- Weights: `maxPoints * difficultyWeight`.
- Proficiency band considers both score and the difficulty mix of the assigned assessment — Expert cannot be awarded from an easy bank.

Competency graph: each question maps 1–N competencies. Results roll up mastery, confidence, items seen, and difficulty reached.

## 10. Integrity

Signals (tab blur, copy/paste, fullscreen exit, disconnect, anomalous speed) are stored. They **never** auto-fail. Admin sees an Integrity Timeline and configurable risk indicators.

## 11. Security controls

Helmet, strict CORS, rate limits, Zod at the boundary, parameterized Prisma access, password policy, account lockout, audit log, refresh rotation, prompt-injection-resistant evaluation, server-side RBAC.

## 12. Design system intent

Anthropic × Linear × Vercel × Stripe × Apple enterprise:

- Dark: warm graphite `#0c0b0a` surfaces, ivory text, coral accent.
- Light: soft ivory `#f7f4ef`, deep graphite text, restrained terracotta.
- Typography: Instrument Sans (UI), Instrument Serif (editorial moments), JetBrains Mono (artifacts).
- Motion: functional — question change, timer, score reveal, generation pulse. No gamification.

## 13. Non-goals

- Learning paths, badges, leaderboards, or course content delivery.
- Invigilation via webcam / keystroke biometrics.
- Calling Claude at assessment start to mint a fresh 25-question set.
- Exposing model names as scattered string literals (configuration only).
