import type { Role } from "@prisma/client";

export const permissions = {
  "admin.dashboard": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER", "REVIEWER"],
  "admin.trainees.read": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER"],
  "admin.trainees.write": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER"],
  "admin.modules.read": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER", "REVIEWER"],
  "admin.questions.read": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER", "REVIEWER"],
  "admin.questions.write": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER"],
  "admin.questions.approve": ["SUPER_ADMIN", "ADMIN"],
  "admin.assessments.read": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER", "REVIEWER"],
  "admin.assessments.write": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER"],
  "admin.results.read": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER", "REVIEWER"],
  "admin.results.override": ["SUPER_ADMIN", "ADMIN", "REVIEWER"],
  "admin.analytics": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER"],
  "admin.ai": ["SUPER_ADMIN", "ADMIN"],
  "admin.audit": ["SUPER_ADMIN", "ADMIN"],
  "admin.config": ["SUPER_ADMIN", "ADMIN"],
  "review.queue": ["SUPER_ADMIN", "ADMIN", "REVIEWER"],
  "assessment.take": ["TRAINEE"],
  "profile.read": ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER", "REVIEWER", "TRAINEE"],
} as const;

export type Permission = keyof typeof permissions;

export function can(role: Role, permission: Permission) {
  return (permissions[permission] as readonly string[]).includes(role);
}
