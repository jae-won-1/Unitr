import type { Metadata } from "next";
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
            <main className="min-h-screen pb-20">{children}</main>
            <BottomNav />
          </RoleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
