"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { fmtFee } from "@/lib/joining-fee";
import {
  fetchInviteTeam,
  inviteAuthHref,
  joinByInvite,
  rememberPendingInvite,
  type InviteTeam,
  type JoinResult,
} from "@/lib/team-invite";

// ── /join/<code> — the far end of a captain's invite link ───────────────
// Two audiences arrive here from the same WhatsApp message:
//
//   • Signed out — they see whose team this is *before* being asked for an
//     account. That's the same bet TeamsPanel makes about browsing: show the
//     real thing first, gate the action. The code rides to /register on the
//     query string, and the join happens on the way back.
//   • Signed in — nothing to decide, so nothing to confirm. The join fires on
//     mount and the page is the receipt.
//
// Every "no" (wrong account type, already in a squad, dead link) is a normal
// outcome here, not an error state: the visitor did nothing wrong, so each one
// gets a plain sentence and a way onward rather than a red box.

type Phase = "loading" | "guest" | "joining" | "done";

export default function JoinTeamPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const { user, loading: authLoading } = useAuth();

  const [team, setTeam] = useState<InviteTeam | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("loading");
  const [result, setResult] = useState<JoinResult | null>(null);

  // The preview is worth loading either way — signed in, it names the team in
  // the receipt even when the join itself comes back "already_member".
  useEffect(() => {
    if (!code) return;
    fetchInviteTeam(code).then(setTeam);
  }, [code]);

  useEffect(() => {
    if (authLoading || !code || team === undefined) return;

    if (!user) {
      // Stash it before the visitor leaves: if they confirm by email and come
      // back to a bare "/", the query string is gone but this isn't.
      rememberPendingInvite(code);
      setPhase("guest");
      return;
    }

    setPhase("joining");
    joinByInvite(code).then((r) => {
      setResult(r);
      setPhase("done");
    });
  }, [authLoading, user, code, team]);

  return (
    <div className="flex flex-col min-h-screen pb-10">
      {/* Same green hero as Sign in / Create account — for most people opening
          this link, it is the first Unitr screen they have ever seen. */}
      <div className="relative overflow-hidden bg-accent px-6 pt-12 pb-8">
        <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(90deg,rgba(255,255,255,0.05) 0 40px,rgba(0,0,0,0.05) 40px 80px)" }} />
        <span className="relative flex items-center gap-1.5">
          <span className="text-[34px] font-extrabold text-white tracking-[-0.03em] leading-none">UNITR</span>
          <span className="w-[11px] h-6 bg-accent-2 -skew-x-12" />
        </span>
      </div>

      <div className="flex flex-col px-6 pt-8">
        {phase === "loading" || phase === "joining" ? (
          <Loading label={phase === "joining" ? "Joining the team…" : undefined} />
        ) : team === null ? (
          <DeadLink />
        ) : phase === "guest" ? (
          <GuestInvite team={team!} code={code} />
        ) : (
          <Verdict result={result} team={team!} />
        )}
      </div>
    </div>
  );
}

function Loading({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16">
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      {label && <p className="text-sm text-text-secondary">{label}</p>}
    </div>
  );
}

function Crest({ team }: { team: InviteTeam }) {
  const initials = team.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="w-16 h-16 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center overflow-hidden flex-shrink-0">
      {team.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.photo_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-lg font-extrabold text-accent-ink">{initials}</span>
      )}
    </div>
  );
}

function TeamCard({ team }: { team: InviteTeam }) {
  const meta = [
    team.location,
    team.level,
    team.format,
    `${team.member_count} member${team.member_count === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="bg-surface border border-border shadow-card rounded-card p-4 flex items-center gap-4">
      <Crest team={team} />
      <div className="min-w-0">
        <p className="text-base font-extrabold truncate">{team.name}</p>
        <p className="text-xs text-text-secondary mt-0.5">{meta}</p>
      </div>
    </div>
  );
}

// The fee is stated up front rather than sprung after signup. It isn't
// collected here — paying it is an ordinary top-up into team credit, which
// the welcome DM and the Home top-up button handle (supabase_joining_fees.sql).
function FeeNote({ pence }: { pence: number }) {
  if (pence <= 0) return null;
  return (
    <div className="bg-surface-2 border border-border rounded-btn px-4 py-3">
      <p className="text-sm font-semibold">{fmtFee(pence)} joining fee</p>
      <p className="text-xs text-text-secondary mt-1 leading-relaxed">
        It goes into the team&apos;s credit balance, which pays for pitch bookings and
        tournament entry. Top up from your Home screen — until it&apos;s paid you can&apos;t
        vote available for games.
      </p>
    </div>
  );
}

function GuestInvite({ team, code }: { team: InviteTeam; code: string }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.01em]">
          You&apos;ve been invited to join {team.name}
        </h1>
        <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">
          Create a free account and you&apos;re straight into the squad — no request to
          approve. Takes a minute, no card needed to sign up.
        </p>
      </div>

      <TeamCard team={team} />
      <FeeNote pence={team.joining_fee_pence} />

      <div className="flex gap-3">
        <a
          href={inviteAuthHref("/login", code)}
          className="flex-1 py-3 rounded-xl border border-border text-text-primary font-semibold text-sm text-center"
        >
          Sign In
        </a>
        <a
          href={inviteAuthHref("/register", code)}
          className="flex-[2] py-3 rounded-btn bg-accent text-white font-bold text-sm text-center"
        >
          Create Account
        </a>
      </div>
    </div>
  );
}

function DeadLink() {
  return (
    <Outcome
      tone="neutral"
      title="This invite link doesn't work"
      body="It may have been reset by the captain, or copied incompletely. Ask them to send you a fresh one — or browse teams and ask to join."
      actions={[{ href: "/", label: "Browse teams", primary: true }]}
    />
  );
}

function Verdict({ result, team }: { result: JoinResult | null; team: InviteTeam }) {
  const name = result?.team_name ?? team.name;

  switch (result?.status) {
    case "joined":
      return (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-[22px] font-extrabold tracking-[-0.01em]">
              You&apos;ve joined {name}
            </h1>
            <p className="text-sm text-text-secondary leading-relaxed">
              You&apos;re in the squad. Fixtures, availability polls and announcements
              will show up on your Home screen and Calendar.
            </p>
          </div>
          <TeamCard team={team} />
          <FeeNote pence={team.joining_fee_pence} />
          <Actions actions={[
            { href: "/my-team", label: "Go to My Team", primary: true },
            { href: "/", label: "Home" },
          ]} />
        </div>
      );

    case "already_member":
      return (
        <Outcome
          tone="good"
          title={`You're already in ${name}`}
          body="Nothing to do — this link has already been used on this account."
          actions={[{ href: "/my-team", label: "Go to My Team", primary: true }]}
        />
      );

    case "is_captain":
      return (
        <Outcome
          tone="good"
          title={`You captain ${name}`}
          body="This is your own invite link. Send it to your players instead — you can copy it again from Team Settings."
          actions={[
            { href: "/my-team/settings", label: "Team Settings", primary: true },
            { href: "/my-team", label: "My Team" },
          ]}
        />
      );

    case "captain_elsewhere":
      return (
        <Outcome
          tone="neutral"
          title="You already captain a team"
          body={`This account captains ${result.other_team ?? "another team"}, so it can't also play for ${name}. Sign up with a different account to join, or ask the captain to invite that one.`}
          actions={[{ href: "/my-team", label: "Go to My Team", primary: true }]}
        />
      );

    case "in_other_team":
      return (
        <Outcome
          tone="neutral"
          title="You're already in a squad"
          body={`This account plays for ${result.other_team ?? "another team"}. Leave that team before joining ${name} — a player can only be in one squad at a time.`}
          actions={[{ href: "/my-team", label: "Go to My Team", primary: true }]}
        />
      );

    case "venue_manager":
      return (
        <Outcome
          tone="neutral"
          title="Venue accounts can't join squads"
          body="You're signed in as a venue manager. Sign up with a player account to join a team."
          actions={[{ href: "/venue/calendar", label: "Back to your venue", primary: true }]}
        />
      );

    case "not_found":
      return <DeadLink />;

    default:
      return (
        <Outcome
          tone="neutral"
          title="Couldn't join right now"
          body="Something went wrong redeeming this link. Try opening it again, or ask the captain for a fresh one."
          actions={[{ href: "/", label: "Home", primary: true }]}
        />
      );
  }
}

type Action = { href: string; label: string; primary?: boolean };

function Actions({ actions }: { actions: Action[] }) {
  return (
    <div className="flex gap-3">
      {actions.map((a) => (
        <a
          key={a.href}
          href={a.href}
          className={
            a.primary
              ? "flex-[2] py-3 rounded-btn bg-accent text-white font-bold text-sm text-center"
              : "flex-1 py-3 rounded-xl border border-border text-text-primary font-semibold text-sm text-center"
          }
        >
          {a.label}
        </a>
      ))}
    </div>
  );
}

function Outcome({ tone, title, body, actions }: {
  tone: "good" | "neutral";
  title: string;
  body: string;
  actions: Action[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center text-center gap-3">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
          tone === "good" ? "bg-accent/10 border border-accent/30" : "bg-surface-2 border border-border"
        }`}>
          {tone === "good" ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0E7A3C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5A6478" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16.5v.01" />
            </svg>
          )}
        </div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.01em]">{title}</h1>
        <p className="text-sm text-text-secondary leading-relaxed">{body}</p>
      </div>
      <Actions actions={actions} />
    </div>
  );
}
