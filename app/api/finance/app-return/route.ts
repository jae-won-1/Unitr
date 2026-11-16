import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Where Stripe's hosted bank-linking page sends a leader who started it from
// the phone app. Stripe will only return to an https address, so this page is
// that address: it hands straight back to the app through its own link
// (uniter://…, or exp://… in Expo Go) and offers a button in case the browser
// won't follow that on its own.
//
// Public and static in effect — it reads nothing and writes nothing. The only
// input is the link to hand back to, which is refused unless it is the app's
// own scheme, so this can't be used to bounce someone to another site.

const APP_LINK = /^(uniter|exp):\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const to = params.get("to") ?? "";
  const state = params.get("connect") === "refresh" ? "refresh" : "done";
  if (!APP_LINK.test(to)) {
    return new NextResponse("Close this window and return to Uniter.", { status: 400 });
  }
  const target = `${to}${to.includes("?") ? "&" : "?"}connect=${state}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Back to Uniter</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F6FB;color:#0B1526}
main{max-width:320px;padding:24px;text-align:center}a{display:block;margin-top:20px;padding:14px;border-radius:12px;background:#008000;color:#fff;font-weight:700;text-decoration:none}</style>
</head><body><main>
<h1 style="font-size:20px">Back to Uniter</h1>
<p style="font-size:14px;color:#5A6478">Stripe has what you entered. Return to the app to see whether the account is ready.</p>
<a href="${escapeHtml(target)}">Return to Uniter</a>
</main><script>window.location.replace(${JSON.stringify(target)});</script></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
