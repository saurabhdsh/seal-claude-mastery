# SEAL — Data Model

Prisma / PostgreSQL. Relational entities are first-class tables. JSON is used only for typed artifacts (code snippets, option payloads, rubric criteria, architecture graphs) that are not independently queried.

## Enums

| Enum | Values |
|---|---|
| `Role` | `SUPER_ADMIN`, `ADMIN`, `ASSESSMENT_MANAGER`, `REVIEWER`, `TRAINEE` |
| `CurriculumLevel` | `FOUNDATION`, `PRACTITIONER`, `ADVANCED`, `EXPERT` |
| `QuestionType` | 20 types (MCQ through `SHORT_RESPONSE`) |
| `QuestionStatus` | `DRAFT`, `AI_VALIDATED`, `HUMAN_REVIEWED`, `APPROVED`, `RETIRED` |
| `ReviewStatus` | `PENDING`, `APPROVED`, `REJECTED`, `NEEDS_REVISION` |
| `DifficultyBand` | `CONCEPTUAL`, `APPLIED`, `MODERATE`, `HARD`, `VERY_HARD`, `EXPERT`, `ADVERSARIAL` |
| `AttemptStatus` | `PENDING`, `IN_PROGRESS`, `SUBMITTED`, `EVALUATING`, `COMPLETED`, `EXPIRED`, `LOCKED` |
| `AssignmentStatus` | `SCHEDULED`, `ACTIVE`, `COMPLETED`, `EXPIRED`, `DISABLED` |
| `AssessmentMode` | `LEVEL_SPECIFIC`, `PROGRESSIVE_MASTERY` |
| `EvaluationStatus` | `PENDING`, `SCORED`, `REVIEW_REQUIRED`, `HUMAN_OVERRIDDEN` |
| `SourceType` | `ANTHROPIC_DOC`, `ORGANIZATION_CONTENT`, `CURRICULUM`, `ADMIN_REFERENCE`, `OTHER` |
| `IntegrityEventType` | `TAB_SWITCH`, `WINDOW_BLUR`, `COPY`, `PASTE`, `FULLSCREEN_EXIT`, `DISCONNECT`, `RECONNECT`, `FAST_ANSWER`, `FOCUS_RETURN` |
| `NotificationChannel` | `LOG`, `EMAIL` |
| `ProficiencyBand` | `DEVELOPING`, `FOUNDATION_READY`, `PRACTITIONER`, `ADVANCED_PRACTITIONER`, `CLAUDE_ENGINEER`, `CLAUDE_EXPERT` |

## Core identity

**User**  
id, email (unique), passwordHash, role, isActive, failedLoginAttempts, lockedUntil, lastLoginAt, passwordChangedAt, createdAt, updatedAt

**RefreshToken**  
id, userId, tokenHash, expiresAt, revokedAt, replacedById, ip, userAgent, createdAt

**TraineeProfile**  
id, userId (unique), employeeId (unique), firstName, lastName, businessUnit, department, jobRole, location, managerName, assignedLevel, notes, disabledAt

## Curriculum

**Domain** — id, code (unique), name, description, level  

**Module** — id, code (unique, e.g. `A09`), name, description, level, domainId, order, learningObjectives[], targetRole, estimatedBankSize  

**Competency** — id, code (unique), name, description, cluster (e.g. `CLAUDE_CODE`)

## Question bank

**Question**  
id, moduleId, level, difficulty, difficultyScore, discriminationScore, questionType, questionText, scenario, codeSnippet, codeLanguage, architectureArtifact (Json), options are related rows, correctAnswer (Json — keys depend on type), answerExplanation, scoringRubric (Json), estimatedTimeSeconds, maxPoints, difficultyWeight, generationModel, generationPromptVersion, status, reviewStatus, usageCount, correctAnswerRate, avgResponseMs, lastUsedAt, createdAt, updatedAt

**QuestionOption** — id, questionId, key (`A`/`B`/…), label, body, isCorrect, position  

**QuestionCompetency** — questionId, competencyId, weight  

**SourceReference** — id, questionId?, sourceType, sourceTitle, sourceURL, retrievedAt, version, relevantConcept  

Never sent to the trainee during an active attempt.

## AI pipeline

**AIQuestionGeneration** — id, moduleId, requestedCount, model, promptVersion, inputTokens, outputTokens, estimatedCostUsd, status, error, createdById, createdAt  

**AIQuestionCritique** — id, questionId, generationId, technicalCorrectness, difficultyConfidence, ambiguityRisk, distractorQuality, scenarioRealism, overall, raw (Json), model, createdAt  

**AIUsageLog** — id, purpose (`GENERATE`/`CRITIC`/`EVALUATE`/`NARRATIVE`/`CALIBRATE`), model, inputTokens, outputTokens, estimatedCostUsd, actorId, resourceType, resourceId, createdAt  

## Assessment

**AssessmentTemplate**  
id, name, description, targetLevel, mode, durationSeconds (default 5400), targetQuestionCount, timeBudgetSeconds, levelMix (Json: { FOUNDATION: 0.15, … }), difficultyMix (Json), typeMix (Json), adaptiveEnabled, allowNavigation, showAnswerKeyOnComplete, integrityPolicy (Json), prohibitedToolsNote, passingScore, capstoneWeight, isActive, createdById, createdAt, updatedAt  

**AssessmentTemplateModule** — templateId, moduleId, weight  

**AssessmentAssignment**  
id, templateId, traineeId, assignedLevel, startsAt, expiresAt, maxAttempts, status, assignedById, createdAt  

**AssessmentAttempt**  
id, assignmentId, traineeId, templateId, status, startedAt, expiresAt, submittedAt, finalizedAt, questionCount, timeBudgetSeconds, abilityEstimate, currentIndex, acknowledgementAt, clientMeta (Json), createdAt  

**AttemptQuestion** — id, attemptId, questionId, position, assignedDifficulty, snapshot (Json — frozen stem/options at start so later bank edits cannot mutate a live exam)

**Answer** — id, attemptId, questionId, attemptQuestionId, selectedKeys (string[]), matchPairs (Json), sequence (Json), textResponse, timeSpentMs, flagged, lastSavedAt, isCorrect, pointsAwarded, maxPoints  

## Results and evaluation

**AssessmentResult**  
id, attemptId (unique), overallScore, difficultyWeightedScore, proficiencyBand, confidence, percentile, scenarioScore, architectureScore, handsOnScore, securityScore, contextScore, agenticScore, claudeCodeScore, levelMastery (Json), narrative (Json: summary, evidence, strengths, gaps, plan), scoringVersion, createdAt  

**ModuleResult** — resultId, moduleId, score, items, correct  

**CompetencyResult** — resultId, competencyId, mastery, confidence, questionsSeen, difficultyReached  

**AIAnswerEvaluation**  
id, attemptId, questionId, status, criterionScores (Json), overall, reason, evidence, confidence, model, error, rawResponse, attemptCount, reviewerId, reviewerReason, createdAt, updatedAt  

## Integrity, audit, config

**IntegrityEvent** — id, attemptId, type, payload (Json), clientTs, serverTs, ip  

**AuditLog** — id, actorId, action, resourceType, resourceId, before (Json), after (Json), ip, userAgent, createdAt  

**SystemConfiguration** — key (unique), value (Json), updatedById, updatedAt  

Default keys: `proficiency_bands`, `difficulty_weights`, `ai_models`, `ai_budget`, `password_policy`, `integrity_defaults`, `generation_concurrency`.

**NotificationLog** — id, userId, channel, template, payload, createdAt  

## Indexes (minimum)

- `User.email`, `TraineeProfile.employeeId`
- `Question(moduleId, status, difficulty)`
- `Question(status, lastUsedAt)`
- `AssessmentAttempt(traineeId, status)`
- `AssessmentAttempt(expiresAt)` where in progress
- `Answer(attemptId, questionId)` unique
- `AuditLog(createdAt, actorId)`
- `AIUsageLog(createdAt, purpose)`
- `IntegrityEvent(attemptId, serverTs)`

## Scoring configuration (defaults)

| Band | Weight |
|---|---|
| Conceptual / Applied (Foundation) | 1.00 |
| Moderate | 1.15 |
| Hard | 1.35 |
| Very Hard | 1.60 |
| Expert | 1.85 |
| Adversarial | 2.00 |

Proficiency (configurable):

| Range | Band |
|---|---|
| 0–39 | Developing |
| 40–54 | Foundation Ready |
| 55–69 | Practitioner |
| 70–82 | Advanced Practitioner |
| 83–91 | Claude Engineer |
| 92–100 | Claude Expert |

Expert band additionally requires the attempt’s mean difficulty weight ≥ Advanced threshold; otherwise the candidate is capped at Advanced Practitioner.
