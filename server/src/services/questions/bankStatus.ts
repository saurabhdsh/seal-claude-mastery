import { QuestionStatus, ReviewStatus } from "@prisma/client";

export type BankStatus = "new" | "updated" | "current";

const UPDATED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function isPendingReview(status: QuestionStatus, reviewStatus: ReviewStatus) {
  return (
    reviewStatus === ReviewStatus.PENDING &&
    (status === QuestionStatus.DRAFT || status === QuestionStatus.AI_VALIDATED)
  );
}

export function computeBankStatus(
  pendingReviewCount: number,
  lastApprovedAt: Date | null,
  lastGeneratedAt: Date | null,
): BankStatus {
  if (pendingReviewCount > 0) return "new";
  if (
    lastApprovedAt &&
    lastGeneratedAt &&
    lastApprovedAt >= lastGeneratedAt &&
    Date.now() - lastApprovedAt.getTime() < UPDATED_WINDOW_MS
  ) {
    return "updated";
  }
  return "current";
}
