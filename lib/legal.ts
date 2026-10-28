// Who Uniter is, for the privacy policy and terms (app/privacy, app/terms) and
// the links to them in both apps. One copy, so the two documents and the store
// listings can't disagree.
//
// TODO before these pages go public: replace every [bracketed] value. The
// pages render whatever is here, brackets included.

export const LEGAL = {
  /** The person or company that runs Uniter and is the data controller. */
  operator: "[Legal name of the person or company running Uniter]",
  /** Registered or postal address. */
  address: "[Postal address]",
  /** Where privacy requests, deletion requests and complaints go. */
  contactEmail: "[contact email address]",
  /** Shown at the top of both pages; change it whenever either changes. */
  updated: "28 October 2026",
  /** Youngest age that may hold an account. */
  minimumAge: 13,
} as const;

/** The public pages, as absolute URLs — the phone opens these in a browser,
 *  and the Play Store listing asks for the privacy one. */
export const LEGAL_BASE_URL = "https://unitr-omega.vercel.app";
export const PRIVACY_URL = `${LEGAL_BASE_URL}/privacy`;
export const TERMS_URL = `${LEGAL_BASE_URL}/terms`;
