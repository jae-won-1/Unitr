import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import TopBar from "@/components/TopBar";
import { RoleProvider } from "@/contexts/RoleContext";
import { AuthProvider } from "@/contexts/AuthContext";

const inter = Inter({ subsets: ["latin"] });

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
  themeColor: "#0A0A0A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-background text-text-primary`}>
        <AuthProvider>
          <RoleProvider>
            <TopBar />
            <main className="min-h-screen pb-nav">{children}</main>
            <BottomNav />
          </RoleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
