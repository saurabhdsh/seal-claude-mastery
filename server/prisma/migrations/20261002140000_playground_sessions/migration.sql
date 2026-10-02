-- CreateTable
CREATE TABLE "PlaygroundSession" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlaygroundSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlaygroundSession_traineeId_startedAt_idx" ON "PlaygroundSession"("traineeId", "startedAt");
CREATE INDEX "PlaygroundSession_endedAt_lastBeatAt_idx" ON "PlaygroundSession"("endedAt", "lastBeatAt");

ALTER TABLE "PlaygroundSession" ADD CONSTRAINT "PlaygroundSession_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "TraineeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
