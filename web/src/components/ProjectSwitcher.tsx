"use client";
import { Check, ChevronsUpDown, Plane, Syringe, Box } from "lucide-react";
import type { State } from "@/lib/api";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/kit/dropdown-menu";

const DEVICE_ICON: Record<string, typeof Box> = { "insulin-pump": Syringe, "flight-controls": Plane };
export const DeviceIcon = ({ device, size = 16 }: { device: string; size?: number }) => {
  const I = DEVICE_ICON[device] || Box;
  return <I size={size} />;
};

/** Switch between projects (e.g. Insulin Pump / Boeing Flight Controls), staying on the same page. */
export function ProjectSwitcher({ state, project, page }: { state: State; project: string; page: string }) {
  const cur = state.projects.find(p => p.id === project);
  if (!cur) return null;
  return (
    <div className="px-3 pb-2">
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Project"
          className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-panel px-2.5 py-2 text-left transition-colors hover:border-line-strong data-[state=open]:border-line-strong">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/[.06] text-ink"><DeviceIcon device={cur.device} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{cur.name}</span>
            <span className="block truncate text-xs text-dim">{state.devices[cur.device] || cur.device}</span>
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-dim" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-60">
          <DropdownMenuLabel className="text-xs text-dim">Projects</DropdownMenuLabel>
          {state.projects.map(p => (
            <DropdownMenuItem key={p.id} onSelect={() => { location.hash = `/p/${p.id}/${page}`; }} className="gap-2.5 py-2">
              <DeviceIcon device={p.device} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-dim">{p.standard.split(" · ")[0]}</span>
              </span>
              {p.id === project && <Check size={14} />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { location.hash = "/"; }} className="text-sm text-mute">All projects</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
