"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Building2, FileCheck2, Github, Network, Orbit, Sparkles } from "lucide-react";
import { CertusMark } from "@/components/CertusMark";
import { Button } from "@/components/kit/button";
import { Input } from "@/components/kit/input";
import { Modal } from "@/components/ui";
import { authConfig, signIn, type AuthConfig, type Session } from "@/lib/auth";

const PROOF = [
  [Network, "Every change traced", "Code lines, tests and simulations linked to hazards and requirements (IEC 62304, DO-178C)."],
  [Orbit, "Tested in a world model", "Firmware runs in simulated patients and aircraft before anything can merge."],
  [FileCheck2, "Evidence on every merge", "A deterministic gate and a safety case for each work order, with a full audit trail."],
] as const;

type Admin = "sso" | "github" | null;

export function SignIn({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"demo" | "email" | null>(null);
  const [admin, setAdmin] = useState<Admin>(null);
  useEffect(() => { authConfig().then(setCfg); }, []);

  const go = async (creds: Parameters<typeof signIn>[0]) => {
    setBusy("demo" in creds ? "demo" : "email"); setErr("");
    const r = await signIn(creds);
    setBusy(null);
    if ("error" in r) return setErr(r.error);
    onSignedIn(r);
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); go({ email, password }); };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-[#E86F4C]/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 right-0 size-[420px] rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <CertusMark size={36} />
          <div>
            <div className="text-lg font-semibold tracking-tight">CertusAI</div>
            <div className="text-xs text-dim">Certus Factory</div>
          </div>
        </div>
        <div className="relative max-w-lg">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-ink">
            Agents build it. A world model tests it. Every change ships with its safety case.
          </h2>
          <ul className="mt-10 space-y-6">
            {PROOF.map(([Icon, title, text]) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-panel text-acc"><Icon size={17} /></span>
                <div>
                  <div className="text-base font-medium text-ink">{title}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-mute">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-dim">Projects in this workspace: Insulin Pump Firmware · Boeing Flight Controls</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <CertusMark size={32} />
            <div className="text-lg font-semibold tracking-tight">CertusAI · Certus Factory</div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-base text-mute">The software factory for safety-critical and physical-AI products.</p>

          <button type="button" onClick={() => go({ demo: true })} disabled={!!busy} data-testid="enter-demo"
            className="group mt-8 flex w-full items-center gap-3 rounded-xl border border-acc/40 bg-acc/[.08] px-4 py-3.5 text-left transition-colors hover:border-acc/70 hover:bg-acc/[.13] disabled:opacity-60">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-acc text-bg"><Sparkles size={17} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-ink">{busy === "demo" ? "Opening the workspace…" : "Enter demo workspace"}</span>
              <span className="block text-sm text-mute">No account needed · both projects, {cfg?.live === false ? "runs replay real recorded runs" : "live factory"}</span>
            </span>
            <ArrowRight size={17} className="text-acc transition-transform group-hover:translate-x-0.5" />
          </button>

          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-dim"><span className="h-px flex-1 bg-line" />or sign in<span className="h-px flex-1 bg-line" /></div>

          <div className="grid gap-2">
            <Button variant="outline" size="lg" className="h-10 w-full gap-2 text-base" onClick={() => setAdmin("github")}><Github size={16} /> Continue with GitHub</Button>
            <Button variant="outline" size="lg" className="h-10 w-full gap-2 text-base" onClick={() => setAdmin("sso")}><Building2 size={16} /> Continue with SSO <span className="text-dim">(Okta, Azure AD)</span></Button>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block text-sm font-medium text-mute">
              <span className="mb-1.5 block">Work email</span>
              <Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@certus.ai" className="h-10 text-base" />
            </label>
            <label className="block text-sm font-medium text-mute">
              <span className="mb-1.5 block">Password</span>
              <Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={cfg?.demo_mode ? "Any password in demo mode" : "Password"} required={!cfg?.demo_mode} className="h-10 text-base" />
            </label>
            {err && <p role="alert" className="text-sm text-bad">{err}</p>}
            <Button type="submit" size="lg" className="h-10 w-full text-base" disabled={!!busy}>{busy === "email" ? "Signing in…" : "Sign in"}</Button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-dim">
            {cfg === null ? "\u00a0" : !cfg.live ? "Read-only snapshot: any work email opens the demo workspace, and the session stays in this browser."
              : cfg.demo_mode ? "Demo mode: any work email signs in. Sessions are signed by the factory server, and every sign-in is recorded in the audit trail."
              : "Sign in with the workspace account. Every sign-in is recorded in the audit trail."}
          </p>
        </div>
      </main>

      {admin && (
        <Modal title={admin === "sso" ? "Your admin enables SSO" : "GitHub sign-in is not enabled"} onClose={() => setAdmin(null)}>
          <div className="space-y-3 text-base text-mute">
            {admin === "sso" ? <>
              <p>Single sign-on with Okta or Azure AD (Entra ID) is set up per workspace by your CertusAI admin, using SAML or OIDC.</p>
              <p>It is not configured for this workspace yet, so this button does not sign you in.</p>
            </> : <>
              <p>GitHub sign-in needs a GitHub OAuth app registered by your CertusAI admin.</p>
              <p>It is not configured for this workspace yet. GitHub is still connected for agent work (issues and evidence) through Composio.</p>
            </>}
            <p>Use the demo workspace or your work email instead.</p>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" size="lg" onClick={() => setAdmin(null)}>Close</Button>
            <Button size="lg" onClick={() => { setAdmin(null); go({ demo: true }); }}><Sparkles size={15} /> Enter demo workspace</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
