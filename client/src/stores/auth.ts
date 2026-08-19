import { create } from "zustand";
import { api, setToken } from "../lib/api";

export type Role = "SUPER_ADMIN" | "ADMIN" | "ASSESSMENT_MANAGER" | "REVIEWER" | "TRAINEE";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  trainee: {
    id: string;
    firstName: string;
    lastName: string;
    assignedLevel: string;
    employeeId: string;
  } | null;
};

type AuthState = {
  user: AuthUser | null;
  assessment: Record<string, unknown> | null;
  booted: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  assessment: null,
  booted: false,
  login: async (email, password) => {
    const data = await api<{ accessToken: string; user: AuthUser; assessment: Record<string, unknown> | null }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    setToken(data.accessToken);
    set({ user: data.user, assessment: data.assessment });
  },
  logout: async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setToken(null);
    set({ user: null, assessment: null });
  },
  hydrate: async () => {
    try {
      const data = await api<{ user: AuthUser; assessment: Record<string, unknown> | null }>("/api/auth/me");
      set({ user: data.user, assessment: data.assessment, booted: true });
    } catch {
      setToken(null);
      set({ user: null, assessment: null, booted: true });
    }
  },
}));
