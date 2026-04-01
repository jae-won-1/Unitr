import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: "#00E676",
        background: "#0A0A0A",
        surface: "#141414",
        "surface-2": "#1E1E1E",
        border: "#2A2A2A",
        "text-primary": "#FFFFFF",
        "text-secondary": "#9E9E9E",
      },
    },
  },
  plugins: [],
};

export default config;
