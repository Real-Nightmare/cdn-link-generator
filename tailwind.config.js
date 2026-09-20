/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090d",
          900: "#0b0e14",
          850: "#10141d",
          800: "#161b26",
          700: "#1f2634",
          600: "#2b3446",
          500: "#3d485e",
        },
        accent: {
          DEFAULT: "#34d399",
          strong: "#10b981",
          soft: "#a7f3d0",
        },
        warn: "#fbbf24",
        danger: "#f87171",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 24px rgba(52, 211, 153, 0.18)",
        card: "0 8px 32px rgba(0, 0, 0, 0.45)",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "fade-up": "fade-up 0.45s ease-out both",
      },
    },
  },
  plugins: [],
};
