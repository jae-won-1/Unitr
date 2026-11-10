// Who Uniter is, for the privacy policy and terms (app/privacy, app/terms) and
// the links to them in both apps. One copy, so the two documents and the store
// listings can't disagree. Values confirmed by the user, 10 Nov 2026.

export const LEGAL = {
  /** The person or company that runs Uniter and is the data controller. */
  operator: "Jaewon Choi",
  /** Registered or postal address. */
  address: "London SW17 0HF, United Kingdom",
  /** Where privacy requests, deletion requests and complaints go. */
  contactEmail: "unitrteam@gmail.com",
  /** Shown at the top of both pages; change it whenever either changes. */
  updated: "10 November 2026",
  /** Youngest age that may hold an account. Sign-up offers no age group below it
   *  (lib/profile-options.ts AGE_GROUPS), and the Play target audience is 18+. */
  minimumAge: 18,
} as const;

/** The public pages, as absolute URLs — the phone opens these in a browser,
 *  and the Play Store listing asks for the privacy one. */
export const LEGAL_BASE_URL = "https://unitr-omega.vercel.app";
export const PRIVACY_URL = `${LEGAL_BASE_URL}/privacy`;
export const TERMS_URL = `${LEGAL_BASE_URL}/terms`;
