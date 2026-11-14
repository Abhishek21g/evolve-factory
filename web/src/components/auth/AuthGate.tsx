"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readSession, signIn, signOut, stillValid, type Session, type User } from "@/lib/auth";
import { SignIn } from "./SignIn";

const AuthContext = createContext<{ user: User; mode: Session["mode"]; signOut: () => void } | null>(null);
export const useAuth = () => useContext(AuthContext);

/** Route guard for every page: the app renders only with a session, otherwise the sign-in page.
 *  `?demo` in the URL enters the demo workspace directly (judges' links, Playwright and QA flows). */
export function AuthGate({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const cur = readSession();
    if (cur) {
      setS(cur);
      stillValid(cur).then(ok => { if (!ok) setS(null); });
    } else if (new URLSearchParams(location.search).has("demo")) {
      signIn({ demo: true }).then(r => setS("error" in r ? null : r));
    } else setS(null);
  }, []);

  if (s === undefined) return <div className="min-h-screen" />;
  if (!s) return <SignIn onSignedIn={setS} />;
  const out = async () => {
    await signOut(s);
    const q = new URLSearchParams(location.search);
    q.delete("demo");
    history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : ""));
    setS(null);
  };
  return <AuthContext.Provider value={{ user: s.user, mode: s.mode, signOut: out }}>{children}</AuthContext.Provider>;
}
