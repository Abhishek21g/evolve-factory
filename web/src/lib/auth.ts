"use client";
import { BASES } from "./api";

/** Signed-in person (factory/auth.py). `actor` is the team member the UI acts as in the audit trail. */
export type User = { email: string; name: string; role: string; org: string; actor: string; method: string; exp: number };
/** server: token signed by the factory server. local: static snapshot (Vercel), no server to sign it, kept in this browser. */
export type Session = { user: User; token: string | null; mode: "server" | "local" };
export type AuthConfig = { live: boolean; demo_mode: boolean };

const KEY = "certus.session";
const DEMO_USER = { email: "demo@certus.ai", name: "Abhishek Enaguthi", role: "Safety lead", org: "CertusAI", actor: "abhishek" };

export function readSession(): Session | null {
  try {
    const s: Session = JSON.parse(localStorage.getItem(KEY) || "null");
    return s && s.user.exp * 1000 > Date.now() ? s : null;
  } catch { return null; }
}

function save(s: Session | null) {
  try {
    if (s) { localStorage.setItem(KEY, JSON.stringify(s)); localStorage.setItem("actor", s.user.actor); }
    else localStorage.removeItem(KEY);
  } catch { /* private mode: the session lasts this page */ }
}

let server: Promise<string | null> | null = null;
/** The factory server's base URL, or null on the static snapshot. Probed once per page load. */
export function findServer() {
  server ??= (async () => {
    if (new URLSearchParams(location.search).has("snapshot")) return null;
    for (const b of BASES()) {
      try {
        const r = await fetch(`${b}/api/auth/config`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) return b;
      } catch { /* next */ }
    }
    return null;
  })();
  return server;
}

export async function authConfig(): Promise<AuthConfig> {
  const b = await findServer();
  if (b === null) return { live: false, demo_mode: true };
  const c = await (await fetch(`${b}/api/auth/config`, { cache: "no-store" })).json();
  return { live: true, demo_mode: c.demo_mode };
}

const nameFrom = (email: string) => email.split("@")[0].split(/[._-]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ") || "Guest";

/** Email + password, or the demo workspace. On the static snapshot every sign-in is a demo session in this browser. */
export async function signIn(creds: { email: string; password: string } | { demo: true }): Promise<Session | { error: string }> {
  const b = await findServer();
  if (b === null) {
    const email = "demo" in creds ? DEMO_USER.email : creds.email.trim().toLowerCase();
    if (!email.includes("@")) return { error: "Enter your work email." };
    const known = email.startsWith("murali") ? { name: "Muralikrishna Inti", role: "Firmware engineer", actor: "murali" }
      : "demo" in creds || email.startsWith("abhishek") ? {} : { name: nameFrom(email), role: "Reviewer" };
    const user = { ...DEMO_USER, ...known, email, method: "demo workspace", exp: Math.floor(Date.now() / 1000) + 7 * 86400 };
    const s: Session = { user, token: null, mode: "local" };
    save(s);
    return s;
  }
  try {
    const r = await fetch(`${b}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(creds) });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "Sign-in failed." };
    const s: Session = { user: j.user, token: j.token, mode: "server" };
    save(s);
    return s;
  } catch { return { error: "The factory server did not answer. Try again." }; }
}

export async function signOut(s: Session) {
  save(null);
  const b = s.mode === "server" ? await findServer() : null;
  if (b !== null) await fetch(`${b}/api/auth/logout`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${s.token}` } }).catch(() => null);
}

/** false only when the server says the token is not valid (e.g. a new session secret); a server that is down keeps the session. */
export async function stillValid(s: Session) {
  if (s.mode !== "server") return true;
  const b = await findServer();
  if (b === null) return true;
  const r = await fetch(`${b}/api/auth/session`, { cache: "no-store", headers: { Authorization: `Bearer ${s.token}` } }).catch(() => null);
  return !r || r.status !== 401;
}
