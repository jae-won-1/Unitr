// Export the approved artwork at the actual sizes advertised to browsers.
// Run: node scripts/generate-icons.mjs
// Uses the existing Playwright dev dependency; no build-time image generation.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [source, target, size, padding] of [
    ["uniter.png", "app/icon.png", 512, 0],
    ["uniter.png", "app/apple-icon.png", 180, 0],
    ["uniter.png", "public/icons/uniter-192.png", 192, 0],
    ["uniter.png", "public/icons/uniter-512.png", 512, 0],
    ["uniter-maskable.png", "public/icons/uniter-maskable-512.png", 512, 0.05],
  ]) {
    const data = await readFile(new URL(`assets/icons/${source}`, root));
    const png = await page.evaluate(async ({ base64, size, padding }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      // Extend the backdrop when adding mask-safe space around the artwork.
      ctx.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const inset = size * padding;
      ctx.drawImage(image, inset, inset, size - 2 * inset, size - 2 * inset);
      return canvas.toDataURL("image/png").split(",")[1];
    }, { base64: data.toString("base64"), size, padding });
    const output = new URL(target, root);
    await mkdir(new URL(".", output), { recursive: true });
    await writeFile(output, Buffer.from(png, "base64"));
    console.log(`Wrote ${fileURLToPath(output)} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
