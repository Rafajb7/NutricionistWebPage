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
        glow: "0 0 0 1px rgba(247,204,47,0.15), 0 16px 40px -20px rgba(247,204,47,0.7)"
      },
      backgroundImage: {
        "brand-gradient":
          "radial-gradient(circle at 10% 15%, rgba(247, 204, 47, 0.18), transparent 35%), radial-gradient(circle at 85% 5%, rgba(162, 137, 50, 0.14), transparent 38%)"
      }
    }
  },
  plugins: []
};

export default config;
