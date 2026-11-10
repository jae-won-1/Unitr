// Links to the terms and privacy policy (app/terms, app/privacy). The stores
// require both to be reachable inside the app; sign-up is where agreeing to
// them happens, and Profile is where someone goes looking later.

const link = "text-accent-ink font-semibold underline underline-offset-2";

/** Under a sign-up button: what pressing it agrees to. */
export function SignUpAgreement() {
  return (
    <p className="text-[11px] text-text-secondary text-center">
      By continuing you confirm you are 18 or over and agree to the{" "}
      <a href="/terms" className={link}>Terms</a> and{" "}
      <a href="/privacy" className={link}>Privacy policy</a>.
    </p>
  );
}

/** A quiet row of links, for the foot of Profile. */
export function LegalFooterLinks() {
  return (
    <p className="text-xs text-text-secondary text-center">
      <a href="/terms" className={link}>Terms</a>
      {" · "}
      <a href="/privacy" className={link}>Privacy policy</a>
    </p>
  );
}
