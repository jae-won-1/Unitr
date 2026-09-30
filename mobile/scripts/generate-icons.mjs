// Export the approved Uniter artwork (assets/icons/ at the repo root) into the
// slots app.json names — the phone's copy of scripts/generate-icons.mjs.
// Run from the repo root: node mobile/scripts/generate-icons.mjs
// Uses the web app's Playwright dev dependency; not a build step.
//
// Every slot takes the full-bleed maskable artwork, never the rounded one: iOS
// and Android both cut their own corners, and a pre-rounded square shows its
// black corners inside the system's. Android's adaptive icon crops the
// foreground to a circle 66/108 of its width, so the artwork is inset there.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../../", import.meta.url);
const source = await readFile(new URL("assets/icons/uniter-maskable.png", root));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [target, size, padding] of [
    ["mobile/assets/images/icon.png", 1024, 0],
    ["mobile/assets/images/android-icon-foreground.png", 1024, 0.12],
    ["mobile/assets/images/splash-icon.png", 1024, 0],
    ["mobile/assets/images/favicon.png", 48, 0],
  ]) {
    const { png, backdrop } = await page.evaluate(async ({ base64, size, padding }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      // Extend the artwork's own backdrop into the padding.
      ctx.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const inset = size * padding;
      ctx.drawImage(image, inset, inset, size - 2 * inset, size - 2 * inset);
      const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
      return { png: canvas.toDataURL("image/png").split(",")[1], backdrop: hex };
    }, { base64: source.toString("base64"), size, padding });
    const output = new URL(target, root);
    await writeFile(output, Buffer.from(png, "base64"));
    console.log(`Wrote ${fileURLToPath(output)} (${size}x${size}, backdrop ${backdrop})`);
  }
} finally {
  await browser.close();
}
