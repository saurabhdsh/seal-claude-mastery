-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'ASSESSMENT_MANAGER', 'REVIEWER', 'TRAINEE');

-- CreateEnum
CREATE TYPE "CurriculumLevel" AS ENUM ('FOUNDATION', 'PRACTITIONER', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_MCQ', 'MULTI_SELECT', 'SCENARIO_DECISION', 'CODE_ANALYSIS', 'FIND_THE_DEFECT', 'ARCHITECTURE_DECISION', 'SEQUENCE', 'MATCH', 'CONFIGURATION_ANALYSIS', 'PROMPT_CRITIQUE', 'CONTEXT_DESIGN', 'MCP_SCHEMA', 'TOOL_CALL_REASONING', 'JSON_STRUCTURED_OUTPUT', 'CLAUDE_CODE_WORKFLOW', 'SECURITY_INCIDENT', 'COST_LATENCY', 'EVALUATION_DESIGN', 'AGENT_WORKFLOW', 'SHORT_RESPONSE');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'AI_VALIDATED', 'HUMAN_REVIEWED', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVISION');

-- CreateEnum
CREATE TYPE "DifficultyBand" AS ENUM ('CONCEPTUAL', 'APPLIED', 'MODERATE', 'HARD', 'VERY_HARD', 'EXPERT', 'ADVERSARIAL');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUBMITTED', 'EVALUATING', 'COMPLETED', 'EXPIRED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AssessmentMode" AS ENUM ('LEVEL_SPECIFIC', 'PROGRESSIVE_MASTERY');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'SCORED', 'REVIEW_REQUIRED', 'HUMAN_OVERRIDDEN');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('ANTHROPIC_DOC', 'ORGANIZATION_CONTENT', 'CURRICULUM', 'ADMIN_REFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "IntegrityEventType" AS ENUM ('TAB_SWITCH', 'WINDOW_BLUR', 'COPY', 'PASTE', 'FULLSCREEN_EXIT', 'DISCONNECT', 'RECONNECT', 'FAST_ANSWER', 'FOCUS_RETURN');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('LOG', 'EMAIL');

-- CreateEnum
CREATE TYPE "ProficiencyBand" AS ENUM ('DEVELOPING', 'FOUNDATION_READY', 'PRACTITIONER', 'ADVANCED_PRACTITIONER', 'CLAUDE_ENGINEER', 'CLAUDE_EXPERT');

-- CreateEnum
CREATE TYPE "AIJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AIUsagePurpose" AS ENUM ('GENERATE', 'CRITIC', 'EVALUATE', 'NARRATIVE', 'CALIBRATE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraineeProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "businessUnit" TEXT,
    "department" TEXT,
    "jobRole" TEXT,
    "location" TEXT,
    "managerName" TEXT,
    "assignedLevel" "CurriculumLevel" NOT NULL DEFAULT 'FOUNDATION',
    "notes" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraineeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "level" "CurriculumLevel" NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "level" "CurriculumLevel" NOT NULL,
    "domainId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "learningObjectives" TEXT[],
    "targetRole" TEXT NOT NULL,
    "estimatedBankSize" INTEGER NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cluster" TEXT NOT NULL,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "level" "CurriculumLevel" NOT NULL,
    "difficulty" "DifficultyBand" NOT NULL,
    "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "discriminationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "questionType" "QuestionType" NOT NULL,
    "questionText" TEXT NOT NULL,
    "scenario" TEXT,
    "codeSnippet" TEXT,
    "codeLanguage" TEXT,
    "architectureArtifact" JSONB,
    "correctAnswer" JSONB NOT NULL,
    "answerExplanation" TEXT NOT NULL,
    "scoringRubric" JSONB NOT NULL,
    "estimatedTimeSeconds" INTEGER NOT NULL,
    "maxPoints" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "difficultyWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "generationModel" TEXT,
    "generationPromptVersion" TEXT,
    "fingerprint" TEXT NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "correctAnswerRate" DOUBLE PRECISION,
    "avgResponseMs" INTEGER,
    "lastUsedAt" TIMESTAMP(3),
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "body" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionCompetency" (
    "questionId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "QuestionCompetency_pkey" PRIMARY KEY ("questionId","competencyId")
);

-- CreateTable
CREATE TABLE "SourceReference" (
    "id" TEXT NOT NULL,
    "questionId" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceURL" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "version" TEXT,
    "relevantConcept" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIQuestionGeneration" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "status" "AIJobStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AIQuestionGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIQuestionCritique" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "generationId" TEXT,
    "technicalCorrectness" INTEGER NOT NULL,
    "difficultyConfidence" INTEGER NOT NULL,
    "ambiguityRisk" INTEGER NOT NULL,
    "distractorQuality" INTEGER NOT NULL,
    "scenarioRealism" INTEGER NOT NULL,
    "overall" INTEGER NOT NULL,
    "notes" TEXT,
    "raw" JSONB,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIQuestionCritique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsageLog" (
    "id" TEXT NOT NULL,
    "purpose" "AIUsagePurpose" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL,
    "actorId" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetLevel" "CurriculumLevel" NOT NULL,
    "mode" "AssessmentMode" NOT NULL DEFAULT 'LEVEL_SPECIFIC',
    "durationSeconds" INTEGER NOT NULL DEFAULT 5400,
    "targetQuestionCount" INTEGER,
    "timeBudgetSeconds" INTEGER NOT NULL DEFAULT 5400,
    "levelMix" JSONB NOT NULL,
    "difficultyMix" JSONB NOT NULL,
    "typeMix" JSONB,
    "adaptiveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowNavigation" BOOLEAN NOT NULL DEFAULT true,
    "showAnswerKeyOnComplete" BOOLEAN NOT NULL DEFAULT false,
    "integrityPolicy" JSONB NOT NULL,
    "prohibitedToolsNote" TEXT,
    "passingScore" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "capstoneWeight" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentTemplateModule" (
    "templateId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "AssessmentTemplateModule_pkey" PRIMARY KEY ("templateId","moduleId")
);

-- CreateTable
CREATE TABLE "AssessmentAssignment" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "assignedLevel" "CurriculumLevel" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "timeBudgetSeconds" INTEGER NOT NULL DEFAULT 5400,
    "abilityEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "acknowledgementAt" TIMESTAMP(3),
    "clientMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptQuestion" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "assignedDifficulty" "DifficultyBand" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "revealed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AttemptQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "attemptQuestionId" TEXT NOT NULL,
    "selectedKeys" TEXT[],
    "matchPairs" JSONB,
    "sequence" JSONB,
    "textResponse" TEXT,
    "timeSpentMs" INTEGER NOT NULL DEFAULT 0,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "lastSavedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCorrect" BOOLEAN,
    "pointsAwarded" DOUBLE PRECISION,
    "maxPoints" DOUBLE PRECISION,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "difficultyWeightedScore" DOUBLE PRECISION NOT NULL,
    "proficiencyBand" "ProficiencyBand" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "percentile" DOUBLE PRECISION,
    "scenarioScore" DOUBLE PRECISION NOT NULL,
    "architectureScore" DOUBLE PRECISION NOT NULL,
    "handsOnScore" DOUBLE PRECISION NOT NULL,
    "securityScore" DOUBLE PRECISION NOT NULL,
    "contextScore" DOUBLE PRECISION NOT NULL,
    "agenticScore" DOUBLE PRECISION NOT NULL,
    "claudeCodeScore" DOUBLE PRECISION NOT NULL,
    "levelMastery" JSONB NOT NULL,
    "narrative" JSONB NOT NULL,
    "scoringVersion" TEXT NOT NULL DEFAULT '1.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleResult" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "items" INTEGER NOT NULL,
    "correct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ModuleResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyResult" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "mastery" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "questionsSeen" INTEGER NOT NULL,
    "difficultyReached" "DifficultyBand",

    CONSTRAINT "CompetencyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAnswerEvaluation" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "criterionScores" JSONB,
    "overall" DOUBLE PRECISION,
    "reason" TEXT,
    "evidence" TEXT,
    "confidence" DOUBLE PRECISION,
    "model" TEXT,
    "error" TEXT,
    "rawResponse" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "reviewerId" TEXT,
    "reviewerReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAnswerEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrityEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" "IntegrityEventType" NOT NULL,
    "payload" JSONB,
    "clientTs" TIMESTAMP(3),
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "IntegrityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfiguration" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfiguration_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TraineeProfile_userId_key" ON "TraineeProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TraineeProfile_employeeId_key" ON "TraineeProfile"("employeeId");

-- CreateIndex
CREATE INDEX "TraineeProfile_assignedLevel_idx" ON "TraineeProfile"("assignedLevel");

-- CreateIndex
CREATE INDEX "TraineeProfile_lastName_firstName_idx" ON "TraineeProfile"("lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_code_key" ON "Domain"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Module_code_key" ON "Module"("code");

-- CreateIndex
CREATE INDEX "Module_level_sortOrder_idx" ON "Module"("level", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Competency_code_key" ON "Competency"("code");

-- CreateIndex
CREATE INDEX "Question_moduleId_status_difficulty_idx" ON "Question"("moduleId", "status", "difficulty");

-- CreateIndex
CREATE INDEX "Question_status_lastUsedAt_idx" ON "Question"("status", "lastUsedAt");

-- CreateIndex
CREATE INDEX "Question_fingerprint_idx" ON "Question"("fingerprint");

-- CreateIndex
CREATE INDEX "Question_level_questionType_idx" ON "Question"("level", "questionType");

-- CreateIndex
CREATE INDEX "QuestionOption_questionId_position_idx" ON "QuestionOption"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_questionId_key_key" ON "QuestionOption"("questionId", "key");

-- CreateIndex
CREATE INDEX "SourceReference_questionId_idx" ON "SourceReference"("questionId");

-- CreateIndex
CREATE INDEX "AIQuestionGeneration_createdAt_idx" ON "AIQuestionGeneration"("createdAt");

-- CreateIndex
CREATE INDEX "AIQuestionGeneration_status_idx" ON "AIQuestionGeneration"("status");

-- CreateIndex
CREATE INDEX "AIQuestionCritique_questionId_idx" ON "AIQuestionCritique"("questionId");

-- CreateIndex
CREATE INDEX "AIUsageLog_createdAt_purpose_idx" ON "AIUsageLog"("createdAt", "purpose");

-- CreateIndex
CREATE INDEX "AssessmentTemplate_targetLevel_isActive_idx" ON "AssessmentTemplate"("targetLevel", "isActive");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_traineeId_status_idx" ON "AssessmentAssignment"("traineeId", "status");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_expiresAt_idx" ON "AssessmentAssignment"("expiresAt");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_traineeId_status_idx" ON "AssessmentAttempt"("traineeId", "status");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_expiresAt_status_idx" ON "AssessmentAttempt"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "AttemptQuestion_attemptId_position_idx" ON "AttemptQuestion"("attemptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_attemptId_questionId_key" ON "AttemptQuestion"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_attemptId_position_key" ON "AttemptQuestion"("attemptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_attemptId_questionId_key" ON "Answer"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResult_attemptId_key" ON "AssessmentResult"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleResult_resultId_moduleId_key" ON "ModuleResult"("resultId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyResult_resultId_competencyId_key" ON "CompetencyResult"("resultId", "competencyId");

-- CreateIndex
CREATE INDEX "AIAnswerEvaluation_status_idx" ON "AIAnswerEvaluation"("status");

-- CreateIndex
CREATE INDEX "AIAnswerEvaluation_attemptId_idx" ON "AIAnswerEvaluation"("attemptId");

-- CreateIndex
CREATE INDEX "IntegrityEvent_attemptId_serverTs_idx" ON "IntegrityEvent"("attemptId", "serverTs");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraineeProfile" ADD CONSTRAINT "TraineeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionCompetency" ADD CONSTRAINT "QuestionCompetency_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionCompetency" ADD CONSTRAINT "QuestionCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceReference" ADD CONSTRAINT "SourceReference_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIQuestionGeneration" ADD CONSTRAINT "AIQuestionGeneration_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIQuestionGeneration" ADD CONSTRAINT "AIQuestionGeneration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIQuestionCritique" ADD CONSTRAINT "AIQuestionCritique_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIQuestionCritique" ADD CONSTRAINT "AIQuestionCritique_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "AIQuestionGeneration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsageLog" ADD CONSTRAINT "AIUsageLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplate" ADD CONSTRAINT "AssessmentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplateModule" ADD CONSTRAINT "AssessmentTemplateModule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssessmentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTemplateModule" ADD CONSTRAINT "AssessmentTemplateModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssessmentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "TraineeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssessmentAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "TraineeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AssessmentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_attemptQuestionId_fkey" FOREIGN KEY ("attemptQuestionId") REFERENCES "AttemptQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleResult" ADD CONSTRAINT "ModuleResult_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AssessmentResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleResult" ADD CONSTRAINT "ModuleResult_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyResult" ADD CONSTRAINT "CompetencyResult_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AssessmentResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyResult" ADD CONSTRAINT "CompetencyResult_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnswerEvaluation" ADD CONSTRAINT "AIAnswerEvaluation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnswerEvaluation" ADD CONSTRAINT "AIAnswerEvaluation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnswerEvaluation" ADD CONSTRAINT "AIAnswerEvaluation_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrityEvent" ADD CONSTRAINT "IntegrityEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemConfiguration" ADD CONSTRAINT "SystemConfiguration_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

