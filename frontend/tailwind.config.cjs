/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#0f172a",
        accent: "#0ea5e9",
        ember: "#f97316",
        mint: "#34d399"
      },
      fontFamily: {
        display: ["Sora", "Space Grotesk", "system-ui", "sans-serif"],
        body: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"]
      },
      boxShadow: {
        glow: "0 10px 30px rgba(14, 165, 233, 0.25)"
      }
    }
  },
  plugins: []
};
