'use client';
import { useEffect, useState } from "react";

export const Navbar = () => {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved === "dark" || (!saved && prefersDark);
    document.documentElement.classList.toggle("dark", isDark);
    setDark(isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-6 py-3 border-b border-line bg-surface/90 backdrop-blur-md shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-2xl">📅</span>
        <span className="text-lg font-bold tracking-tight text-accent">Minha Agenda</span>
      </div>
      <button
        onClick={toggle}
        aria-label="Alternar tema"
        className="rounded-full p-2 text-xl transition-colors hover:bg-accent/10"
        title={dark ? "Modo claro" : "Modo escuro"}
      >
        {dark ? "🌞" : "🌙"}
      </button>
    </header>
  );
};
