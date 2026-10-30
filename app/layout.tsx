import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CODIFEX AGENDAS",
  description: "Organize compromissos, tarefas e prazos do seu expediente.",
  applicationName: "CODIFEX AGENDAS",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "CODIFEX AGENDAS" },
};

export const viewport: Viewport = {
  themeColor: "#f4f6fb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
