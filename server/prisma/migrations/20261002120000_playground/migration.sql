-- CreateTable
CREATE TABLE "PlaygroundWorkspace" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaygroundWorkspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaygroundWorkspace_traineeId_key" ON "PlaygroundWorkspace"("traineeId");

ALTER TABLE "PlaygroundWorkspace" ADD CONSTRAINT "PlaygroundWorkspace_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "TraineeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
