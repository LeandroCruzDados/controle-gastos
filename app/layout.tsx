import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PWARegister } from "./pwa-register";

export const metadata: Metadata = {
  title: "Controle de Gastos",
  description: "Dashboard financeiro familiar com lançamentos, cartões, previsões e insights.",
  manifest: "/manifest.json",
  applicationName: "Controle de Gastos",
  appleWebApp: {
    capable: true,
    title: "Controle de Gastos",
    statusBarStyle: "black-translucent"
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  }
};

export const viewport: Viewport = {
  themeColor: "#b8ff00"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
