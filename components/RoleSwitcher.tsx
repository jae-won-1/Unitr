"use client";

import { useState } from "react";
import { useRole, Role } from "@/contexts/RoleContext";

const roles: { key: Role; label: string; description: string }[] = [
  { key: "new_user", label: "New User", description: "No team yet" },
  { key: "player", label: "Player", description: "Part of a team" },
  { key: "captain", label: "Captain", description: "Team admin" },
];

export default function RoleSwitcher() {
  const { role, setRole } = useRole();
  const [open, setOpen] = useState(false);
  const current = roles.find((r) => r.key === role)!;

  return (
    <div className="fixed top-4 right-4 z-50">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2 text-xs font-semibold shadow-lg"
      >
        <span className="w-2 h-2 rounded-full bg-accent" />
        {current.label}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="#9E9E9E" strokeWidth="2.5" strokeLinecap="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-10 right-0 w-52 bg-surface-2 border border-border rounded-2xl overflow-hidden shadow-xl">
          <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider px-4 pt-3 pb-1">
            Preview as
          </p>
          {roles.map((r) => (
            <button
              key={r.key}
              onClick={() => { setRole(r.key); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                role === r.key ? "bg-accent/10" : "hover:bg-background"
              }`}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                role === r.key ? "bg-accent" : "bg-border"
              }`} />
              <div>
                <p className={`text-sm font-semibold ${role === r.key ? "text-accent" : "text-text-primary"}`}>
                  {r.label}
                </p>
                <p className="text-xs text-text-secondary">{r.description}</p>
              </div>
              {role === r.key && (
                <svg className="ml-auto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
