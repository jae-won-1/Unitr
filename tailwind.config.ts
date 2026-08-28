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
        // Rebrand palette — see "Unitr Rebrand.dc.html", artboard 5a.
        // The design ships three distinct brand colours, and which one you reach
        // for depends on whether it is a *surface* or *text*:
        //   accent      — fills: top bar, monogram, primary buttons. Dark enough
        //                 that anything on it is white, never black.
        //   accent-ink  — accent *text*, icons and the active nav item. The same
        //                 green pushed darker so it clears contrast on #F4F6FB.
        //   accent-2    — the blue flash: badges, avatars, the wordmark slash.
        accent: "#008000",
        "accent-2": "#335FFF",
        "accent-ink": "#0E7A3C",
        background: "#F4F6FB",
        surface: "#FFFFFF",
        "surface-2": "#E9EDF6",
        border: "#DCE2EF",
        "text-primary": "#0B1526",
        "text-secondary": "#5A6478",
        // Supporting colours used by badges and status chips in the artboards.
        danger: "#E23D3D",
        // Inset panels inside a sheet — a hair off white so a card nested in a
        // white sheet still reads as a separate surface.
        panel: "#F9FAFD",
        // Overlay scrim. The design tints it navy rather than pure black, so a
        // sheet reads as sitting over the app instead of over a void.
        scrim: "rgba(11,21,38,0.55)",
        "success-bg": "#EAF6EC",
        "success-border": "#BFE3C7",
      },
      borderRadius: {
        // The artboards use three radii and nothing else: 12 for buttons and
        // small tiles, 16 for cards, 99px for pills.
        card: "16px",
        btn: "12px",
      },
      boxShadow: {
        // Every card in the rebrand carries this one shadow. It is deliberately
        // near-invisible — the border does the separating work, not the shadow.
        card: "0 1px 2px rgba(11,21,38,0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
