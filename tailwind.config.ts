import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          accent: "var(--brand-accent)",
          accent2: "var(--brand-accent-2)",
          bg: "var(--brand-bg)",
          surface: "var(--brand-surface)",
          text: "var(--brand-text)",
          muted: "var(--brand-muted)"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px var(--brand-shadow-ring), 0 16px 40px -20px var(--brand-shadow-glow)"
      },
      backgroundImage: {
        "brand-gradient":
          "radial-gradient(circle at 10% 15%, var(--brand-gradient-1), transparent 35%), radial-gradient(circle at 85% 5%, var(--brand-gradient-2), transparent 38%)"
      }
    }
  },
  plugins: []
};

export default config;
