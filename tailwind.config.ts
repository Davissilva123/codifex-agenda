// Tailwind CSS configuration
// This file enables class‑based dark mode and scans the src files for Tailwind classes.
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class", // preserve existing .dark class handling
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        surface: "var(--surface)",
        page: "var(--page)",
        text: "var(--text)",
        muted: "var(--muted)",
        line: "var(--line)",
      },
    },
  },
  plugins: [],
};

export default config;
