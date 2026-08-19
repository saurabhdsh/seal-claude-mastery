import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./stores/auth";
import { useTheme } from "./stores/theme";
import { LoginPage } from "./pages/LoginPage";
import { AdminShell } from "./layouts/AdminShell";
import {
  AIControlPage,
  AnalyticsPage,
  AssessmentDetailPage,
  AssessmentsPage,
  AuditPage,
  CreateAssessmentPage,
  DashboardPage,
  ModuleQuestionsPage,
  ModulesPage,
  ProfilePage,
  QuestionBankPage,
  ResultDetailPage,
  ResultsPage,
  TraineeDetailPage,
  TraineesPage,
  UsersPage,
} from "./pages/admin";
import { AssessmentHome, CompletePage, InstructionsPage, SessionPage } from "./pages/assessment";
import type { Role } from "./stores/auth";

const STAFF: Role[] = ["SUPER_ADMIN", "ADMIN", "ASSESSMENT_MANAGER", "REVIEWER"];

function Gate({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, booted } = useAuth();
  if (!booted) return <div className="grid min-h-screen place-items-center text-sm text-[var(--ink-muted)]">Restoring session…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={user.role === "TRAINEE" ? "/assessment" : "/admin/dashboard"} replace />;
  return <>{children}</>;
}

export default function App() {
  const hydrateAuth = useAuth((s) => s.hydrate);
  const hydrateTheme = useTheme((s) => s.hydrate);
  useEffect(() => {
    hydrateTheme();
    hydrateAuth();
  }, [hydrateAuth, hydrateTheme]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/admin"
        element={
          <Gate roles={STAFF}>
            <AdminShell />
          </Gate>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="trainees" element={<TraineesPage />} />
        <Route path="trainees/:id" element={<TraineeDetailPage />} />
        <Route path="modules" element={<ModulesPage />} />
        <Route path="question-bank" element={<QuestionBankPage />} />
        <Route path="question-bank/:moduleId" element={<ModuleQuestionsPage />} />
        <Route path="assessments" element={<AssessmentsPage />} />
        <Route path="assessments/create" element={<CreateAssessmentPage />} />
        <Route path="assessments/:id" element={<AssessmentDetailPage />} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="results/:attemptId" element={<ResultDetailPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="ai-control-center" element={<AIControlPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
      <Route
        path="/assessment"
        element={
          <Gate roles={["TRAINEE", ...STAFF]}>
            <AssessmentHome />
          </Gate>
        }
      />
      <Route
        path="/assessment/instructions"
        element={
          <Gate roles={["TRAINEE"]}>
            <InstructionsPage />
          </Gate>
        }
      />
      <Route
        path="/assessment/session/:attemptId"
        element={
          <Gate roles={["TRAINEE"]}>
            <SessionPage />
          </Gate>
        }
      />
      <Route
        path="/assessment/review/:attemptId"
        element={
          <Gate roles={["TRAINEE", ...STAFF]}>
            <CompletePage />
          </Gate>
        }
      />
      <Route
        path="/assessment/complete/:attemptId"
        element={
          <Gate roles={["TRAINEE", ...STAFF]}>
            <CompletePage />
          </Gate>
        }
      />
      <Route
        path="/profile"
        element={
          <Gate roles={[...STAFF, "TRAINEE"]}>
            <ProfilePage />
          </Gate>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
