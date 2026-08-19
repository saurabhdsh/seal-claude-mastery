# SEAL — Implementation Plan

Execute in the order below. Each phase leaves the system compilable. Do not skip to visual polish before the assessment vertical slice works.

## Phase 1 — Architecture and scaffolding

- Monorepo (`client`, `server`), npm workspaces
- Docker Compose: PostgreSQL 16, Redis 7
- `.env.example`, root scripts, TypeScript configs, ESLint, Vitest, Playwright
- Design tokens and Tailwind layer

**Exit:** `npm run dev` starts API + SPA against local Postgres/Redis.

## Phase 2 — Database schema

- Full Prisma schema (see `DATA_MODEL.md`)
- Indexes for attempt lookup, question bank filters, analytics rollups
- Initial migration

**Exit:** `npm run db:migrate` succeeds on empty database.

## Phase 3 — Authentication and RBAC

- Login / refresh / logout / me
- Argon2id, lockout, password policy
- Permission middleware
- Seed Super Admin

**Exit:** Super Admin can log in and receive a role-correct session.

## Phase 4 — Curriculum / modules

- Seed Foundation F01–F10, Practitioner P01–P10, Advanced A01–A12 + X01–X10, Expert E01–E05
- Competency catalog
- Admin module browser APIs

**Exit:** `/admin/modules` lists the full curriculum from the database.

## Phase 5 — Question bank

- Question + options + competencies + sources
- Status machine: `DRAFT → AI_VALIDATED → HUMAN_REVIEWED → APPROVED | RETIRED`
- CRUD, preview, clone, retire, approve/reject
- Seed **5 approved questions per module** (no Claude calls)

**Exit:** `/admin/question-bank/:moduleId` shows real bank items.

## Phase 6 — Claude AI generation pipeline

- `anthropicProvider` abstraction
- Generator, critic, calibrator, Zod validation, duplicate detection
- BullMQ job + CLI: `generate:questions`, `generate:level`, `validate:question-bank`
- Auto-approve **disabled**

**Exit:** Admin can enqueue a generation for one module; items land as `AI_VALIDATED` / `DRAFT`.

## Phase 7 — Assessment template / assignment

- Templates with level, mode (level-specific vs progressive), difficulty mix, time budget, navigation policy, integrity policy
- Assign to trainee: start, expiry, attempt count
- Assembler persists a frozen question set on attempt start

**Exit:** Admin creates assessment, assigns trainee, assignment appears for trainee.

## Phase 8 — 90-minute runtime

- Instructions + acknowledgement
- Server `startedAt` / `expiresAt`
- Question renderer by type
- Navigator, flag, autosave, integrity signals

**Exit:** Trainee can sit a live attempt with a real countdown.

## Phase 9 — Autosave and reconnect

- Optimistic client + durable `Answer` rows
- Reconnect restores answers, flags, remaining time from `expiresAt`
- Offline indicator with retry

**Exit:** Refresh mid-assessment loses no work; timer matches server.

## Phase 10 — Scoring / evaluation

- Deterministic objective scoring
- Rubric AI evaluation with injection-resistant prompts
- Fail-safe `REVIEW_REQUIRED`
- Capstone extra weight
- Proficiency bands from configuration, difficulty-aware

**Exit:** Submit produces a persisted `AssessmentResult`.

## Phase 11 — Results and competency analytics

- Radar, heatmap, strengths/gaps, narrative
- Competency constellation
- Trainee complete screen (no answer key unless configured)
- Admin result inspector

**Exit:** Both surfaces show computed, not hardcoded, results.

## Phase 12 — Admin analytics

- Live metrics and charts
- Hardest modules, discriminating questions, development candidates

**Exit:** Dashboard numbers match SQL aggregations.

## Phase 13 — Question-quality analytics

- Observed difficulty, discrimination, p-value, timing, skip/flag
- Recalibration candidates
- CLI `recalculate:analytics`

**Exit:** AI Control Center and analytics pages use usage logs.

## Phase 14 — Audit / security

- Audit log for privileged mutations
- Helmet, CORS, rate limit, CSRF considerations for cookie refresh
- Reviewer workspace with mandatory reason on override

**Exit:** Admin `/admin/audit` shows real events.

## Phase 15 — Testing

- Unit: assembler, scoring, ability estimator, Zod AI schemas
- API: auth, RBAC, timer, autosave
- Playwright: admin login → onboard → assign → sit → reconnect → submit → review

**Exit:** `npm run test` and `npm run test:e2e` (with services up).

## Phase 16 — Visual polish and performance

- Motion, skeletons, empty/error/offline states
- Query persistence, list virtualization where needed
- Reduced-motion, WCAG AA focus, keyboard navigator

## Vertical slice (must work before polish)

1. Admin login  
2. Create trainee  
3. Create + assign assessment  
4. Generate or use seeded questions  
5. Trainee login → instructions → session  
6. Answer, refresh, timer restored  
7. Submit → score → admin result view  

## Implementation constraints

- No fake buttons, no mock APIs in the running app, no hardcoded analytics.
- No Claude mass-generation during `db:seed`.
- No secrets in git.
- Core paths must handle loading, empty, error, offline, unauthorized, expired, AI failure.
