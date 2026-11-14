"use client";
import { Check, ChevronsUpDown, LogOut, Plug } from "lucide-react";
import type { Member } from "@/lib/api";
import { Avatar } from "@/components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/kit/dropdown-menu";
import { useAuth } from "./AuthGate";

/** Sidebar footer: Settings link and the signed-in person (name, org, role), who they act as, and sign out. */
export function UserMenu({ humans, me, setMe, integrations, active }:
  { humans: Member[]; me: string; setMe: (id: string) => void; integrations: string; active: boolean }) {
  const auth = useAuth();
  const user = auth?.user;
  const self: Member = { id: user?.actor || me, name: user?.name || "", role: user?.role || "", kind: "human" };
  return (
    <>
      <a href={integrations} aria-current={active ? "page" : undefined}
        className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors ${active ? "bg-white/[.07] text-ink" : "text-mute hover:bg-white/[.04] hover:text-ink"}`}>
        <Plug size={16} className={`shrink-0 ${active ? "text-acc" : ""}`} /> Integrations
      </a>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Account" data-testid="user-menu" className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-white/[.04]">
          <Avatar m={self} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user?.name}</span>
            <span className="block truncate text-xs text-dim">{user?.org} · {user?.role}</span>
          </span>
          <ChevronsUpDown size={14} className="text-dim" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium text-ink">{user?.name}</span>
            <span className="block truncate text-xs text-dim">{user?.email}</span>
            <span className="block truncate text-xs text-dim">{user?.org} · {user?.role}{auth?.mode === "local" ? " · snapshot session" : ""}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-dim">Acting as</DropdownMenuLabel>
          {humans.map(h => (
            <DropdownMenuItem key={h.id} onSelect={() => setMe(h.id)} className="gap-2.5">
              <Avatar m={h} /> <span className="flex-1">{h.name}</span> {h.id === me && <Check size={14} />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { location.hash = integrations.slice(1); }} className="gap-2.5"><Plug size={14} /> Integrations</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => auth?.signOut()} className="gap-2.5" data-testid="sign-out"><LogOut size={14} /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
