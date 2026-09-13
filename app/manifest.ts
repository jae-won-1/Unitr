import type { MetadataRoute } from "next";

// Makes the app installable to the home screen. `display: standalone` is what
// drops the browser chrome — the single biggest change in how finished the
// prototype feels on a phone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Uniter",
    short_name: "Uniter",
    description: "The football platform for players, coaches, and clubs.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Splash background is the page colour; theme colour matches the TopBar band.
    background_color: "#F4F6FB",
    theme_color: "#008000",
    icons: [
      // Actual-size exports from assets/icons, via scripts/generate-icons.mjs.
      // The separate maskable export keeps the mark inside the safe circle.
      { src: "/icons/uniter-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/uniter-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/uniter-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
