import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { GlobalRemindersBar } from "@/components/global-reminders-bar";

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
      <body className={inter.className}>
        <GlobalRemindersBar />
        {children}
      </body>
    </html>
  );
}
