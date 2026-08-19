import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { useAuth } from "../stores/auth";
import { LogOut } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN:        "Super Admin",
  ADMIN:              "Admin",
  ASSESSMENT_MANAGER: "Assessment Manager",
  REVIEWER:           "Reviewer",
  TRAINEE:            "Trainee",
};

function UserCard({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useAuth();
  if (!user) return null;

  const username = user.email?.replace("@seal.local", "") ?? user.email ?? "";
  // Derive display name: trainee profile name, or capitalised username
  const displayName =
    user.trainee
      ? `${user.trainee.firstName} ${user.trainee.lastName}`.trim()
      : username
          .split(/[._-]/)
          .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(" ");

  // Initials for avatar
  const parts = displayName.split(" ").filter(Boolean);
  const initials = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : displayName.slice(0, 2);

  const roleLabel = ROLE_LABELS[user.role] ?? user.role;

  return (
    <div className="border-t border-[var(--line)] px-4 py-4">
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1d1d1f] text-[11px] font-semibold uppercase tracking-wide text-white"
        >
          {initials.toUpperCase()}
        </div>
        {/* Name + role */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-[var(--ink)]">{displayName}</div>
          <div className="truncate text-[11px] text-[var(--ink-muted)]">{roleLabel} · @{username}</div>
        </div>
        {/* Sign out */}
        <button
          type="button"
          onClick={onSignOut}
          className="shrink-0 rounded-md p-1.5 text-[var(--ink-muted)] transition-colors hover:bg-white hover:text-[var(--ink)]"
          title="Sign out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}

const links = [
  { to: "/admin/dashboard", label: "Command center" },
  { to: "/admin/trainees", label: "Trainees" },
  { to: "/admin/modules", label: "Modules" },
  { to: "/admin/question-bank", label: "Question bank" },
  { to: "/admin/assessments", label: "Assessments" },
  { to: "/admin/results", label: "Results" },
  { to: "/admin/analytics", label: "Analytics" },
  { to: "/admin/ai-control-center", label: "AI control" },
  { to: "/admin/audit", label: "Audit" },
  { to: "/admin/users", label: "Users" },
];

export function AdminShell() {
  const { logout } = useAuth();
  const nav = useNavigate();

  const handleSignOut = async () => {
    await logout();
    nav("/login");
  };

  return (
    <div className="app-bg min-h-screen">
      <CommandPalette />
      <div className="grid min-h-screen lg:grid-cols-[220px_1fr]">
        {/* Sidebar */}
        <aside className="hidden border-r border-[var(--line)] bg-[var(--bg-muted)] lg:flex lg:flex-col" style={{ height: "100vh", position: "sticky", top: 0 }}>
          {/* Logo */}
          <div className="shrink-0 px-6 py-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">SEAL</div>
            <div className="mt-0.5 text-[17px] font-semibold text-[var(--ink)]" style={{ letterSpacing: "-0.022em" }}>
              Claude Mastery
            </div>
          </div>

          {/* Nav — scrolls if many items, but never pushes user card off screen */}
          <nav className="flex flex-col gap-0.5 overflow-y-auto px-2" style={{ flex: "1 1 0", minHeight: 0 }}>
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-white text-[var(--ink)] shadow-[var(--shadow-sm)]"
                      : "text-[var(--ink-muted)] hover:bg-white/60 hover:text-[var(--ink)]"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          {/* User card — always visible at bottom, never scrolls away */}
          <div className="shrink-0">
            <UserCard onSignOut={handleSignOut} />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex flex-col">
          <header className="flex items-center border-b border-[var(--line)] bg-white/80 px-8 py-3 backdrop-blur-xl">
            <div className="text-[13px] font-medium text-[var(--ink-muted)]">Enterprise assessment operations</div>
          </header>
          <main className="flex-1 px-8 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
