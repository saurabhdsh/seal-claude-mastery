import { AttemptStatus } from "@prisma/client";

/** Statuses that permanently consume an attempt slot. */
export const CONSUMED_ATTEMPT_STATUSES: AttemptStatus[] = [
  AttemptStatus.COMPLETED,
  AttemptStatus.LOCKED,
  AttemptStatus.SUBMITTED,
  AttemptStatus.EVALUATING,
];

/**
 * Timed-out / dropped sittings (EXPIRED) do NOT consume the attempt.
 * Candidates can Begin again after a browser crash, VPN drop, or idle logout.
 */
export function countsTowardAttemptLimit(status: AttemptStatus | string) {
  return CONSUMED_ATTEMPT_STATUSES.includes(status as AttemptStatus);
}
