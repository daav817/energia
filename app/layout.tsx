import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Energia Power LLC - CRM & Brokerage",
  description: "Proprietary CRM and Brokerage Management for Energia Power LLC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} flex flex-col h-dvh overflow-hidden`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
