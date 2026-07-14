import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        mint: "#12b981",
        coral: "#f97363",
        ocean: "#2563eb",
        amber: "#f59e0b"
      },
      boxShadow: {
        glow: "0 24px 80px rgba(17, 24, 39, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
