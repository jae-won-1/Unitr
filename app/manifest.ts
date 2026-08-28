import type { MetadataRoute } from "next";

// Makes the app installable to the home screen. `display: standalone` is what
// drops the browser chrome — the single biggest change in how finished the
// prototype feels on a phone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Unitr",
    short_name: "Unitr",
    description: "The football platform for players, coaches, and clubs.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Splash background is the page colour; theme colour matches the TopBar band.
    background_color: "#F4F6FB",
    theme_color: "#008000",
    icons: [
      // One 512 source (scripts/generate-icons.mjs), declared at both sizes
      // Chrome looks for; it downscales for the smaller one. The mark sits well
      // inside the central 80%, so it survives the maskable crop.
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
