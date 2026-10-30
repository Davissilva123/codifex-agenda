import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minha Agenda",
  description: "Organize compromissos, tarefas e prazos do seu expediente.",
  applicationName: "Minha Agenda",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Minha Agenda" },
};

export const viewport: Viewport = {
  themeColor: "#f7f7fb",
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
