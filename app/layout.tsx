import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import TopBar from "@/components/TopBar";
import ResumePaymentBanner from "@/components/ResumePaymentBanner";
import { RoleProvider } from "@/contexts/RoleContext";
import { AuthProvider } from "@/contexts/AuthContext";

// Poppins carries the rebrand: 700/800 for display (wordmark, section headers,
// team names), 400–600 for UI. Poppins has no variable build on Google Fonts, so
// the weights the design actually uses are listed explicitly.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Unitr",
  description: "The football platform for players, coaches, and clubs.",
  manifest: "/manifest.webmanifest",
  applicationName: "Unitr",
  appleWebApp: {
    capable: true,
    title: "Unitr",
    // "black", not "black-translucent": translucent draws the page *under* the
    // status bar, which would push every page's hardcoded pt-16 TopBar offset
    // out by the notch height. This keeps the web view below the status bar so
    // the existing spacing stays correct.
    statusBarStyle: "black",
  },
  formatDetection: { telephone: false },
};

// Without an explicit viewport, Next emits one that omits `viewport-fit=cover`,
// which makes every env(safe-area-inset-*) resolve to 0 — silently disabling
// `.pb-safe` on the BottomNav and the notch padding on the TopBar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matches the TopBar's green, so on Android the system status bar continues
  // the bar rather than sitting as a dark strip above it.
  themeColor: "#008000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${poppins.className} bg-background text-text-primary`}>
        <AuthProvider>
          <RoleProvider>
            <TopBar />
            <main className="min-h-screen pb-nav">{children}</main>
            {/* Finishes a 3D Secure payment the payer walked away from — see
                lib/pending-payment.ts. Renders nothing when there isn't one. */}
            <ResumePaymentBanner />
            <BottomNav />
          </RoleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
