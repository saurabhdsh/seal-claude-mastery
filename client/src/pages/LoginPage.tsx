import { useEffect } from "react";
import { useAuth } from "../stores/auth";
import { Field, inputClass, Button } from "../components/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function LoginPage() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("superadmin@seal.local");
  const [password, setPassword] = useState("SealAdmin!2026");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) nav(user.role === "TRAINEE" ? "/assessment" : "/admin/dashboard", { replace: true });
  }, [user, nav]);

  return (
    <div className="grid min-h-screen bg-[#f5f5f7] lg:grid-cols-[38%_62%]">
      {/* Left panel */}
      <section className="relative hidden overflow-hidden bg-[#1d1d1f] lg:flex lg:flex-col lg:justify-between">
        {/* TCS logo — very top left, no padding */}
        <img
          src="/TCS-logo-white.svg"
          alt="TCS"
          className="w-auto object-contain"
          style={{ height: 140, maxWidth: 300, alignSelf: "flex-start", paddingLeft: 24 }}
        />

        {/* SEAL text — bottom left */}
        <div className="px-12 pb-12">
          <div className="text-[15px] font-semibold uppercase tracking-[0.24em] text-white/40">SEAL</div>
          <h1 className="mt-2 text-5xl font-semibold leading-tight text-white" style={{ letterSpacing: "-0.025em" }}>
            Claude<br />Mastery
          </h1>
          <p className="mt-4 text-[15px] text-white/50">Measure capability. Prove mastery.</p>
        </div>
      </section>

      {/* Right panel */}
      <section className="flex items-center justify-center bg-white p-8">
        <form
          className="w-full max-w-[340px] space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await login(email, password);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Sign-in failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="mb-8">
            <h2 className="text-[28px] font-semibold text-[#1d1d1f]" style={{ letterSpacing: "-0.022em" }}>
              Sign in
            </h2>
            <p className="mt-1 text-[14px] text-[#86868b]">Use your SEAL username and password.</p>
          </div>
          <Field label="Username">
            <input
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="e.g. john.doe"
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <Button className="w-full py-3" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-[11px] text-[#aeaeb2]">Seed: superadmin / SealAdmin!2026</p>
        </form>
      </section>
    </div>
  );
}

