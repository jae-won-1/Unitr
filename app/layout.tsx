import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import RoleSwitcher from "@/components/RoleSwitcher";
import { RoleProvider } from "@/contexts/RoleContext";
import { TacticsProvider } from "@/contexts/TacticsContext";
import { AuthProvider } from "@/contexts/AuthContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Unitr",
  description: "The football platform for players, coaches, and clubs.",
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
            <TacticsProvider>
              <RoleSwitcher />
              <main className="min-h-screen pb-20">{children}</main>
              <BottomNav />
            </TacticsProvider>
          </RoleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
