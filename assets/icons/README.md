# Home-screen artwork

The user-selected U and football icon, recoloured to the previous icon's `#00E676`
using the built-in image generation tool. `uniter.png` preserves the supplied
composition; `uniter-maskable.png` has extra room and a full teal backdrop for
Android launcher masks.

The hex value is the edit's colour target; generated rasters retain small
per-pixel colour variations rather than an exact indexed palette.

Run `node scripts/generate-icons.mjs` to resize these sources into the committed
180 px Apple touch icon, 512 px browser icon, and the manifest's actual 192/512 px
PNGs. This uses the existing Playwright dependency and its Chromium installation
(`npx.cmd playwright install chromium` if needed). Generation is not part of the
production build.

The maskable export adds 5% padding on each edge so the complete mark fits within
the [manifest safe circle](https://www.w3.org/TR/appmanifest/#icon-masks).
Next.js serves `app/icon.png` and `app/apple-icon.png` through its
[metadata file conventions](https://nextjs.org/docs/14/app/api-reference/file-conventions/metadata/app-icons).

## Final colour revision prompts (built-in tool)

Colour source: the prior committed `scripts/generate-icons.mjs` used
`const FG = [0x00, 0xe6, 0x76]`. The user requested this brighter green after the
initial UI-green edit. Both source images and all five exports were replaced.

### Standard icon

Use case: precise-object-edit. Edit target: the supplied Uniter U and football app icon. Replace only the dark green foreground with the previous home-screen icon's bright green: #00E676, RGB (0,230,118). This is a flat colour replacement only. Preserve exactly the existing U and football outlines, white panels, teal background, black outer border, rounded tile corners, scale, margins, and placement. No redesign, texture, gradients or new elements. Crisp opaque PNG.

### Maskable icon

Use case: precise-object-edit. Edit target: the supplied padded Uniter U and football maskable app icon. Replace only the dark green foreground with the previous home-screen icon's bright green: #00E676, RGB (0,230,118). This is a flat colour replacement only. Preserve exactly the existing U and football outlines, white panels, full teal square background, scale, generous margins, and placement. No redesign, texture, gradients, borders, rounded tile corners or new elements. Crisp opaque PNG.

## Initial prompts (superseded colour; built-in tool)

### Colour edit

Use case: precise-object-edit
Asset type: Uniter home-screen app icon.
Input image 1 is the edit target. Change only the bright mint green in this supplied U and football logo to the app UI's solid green, exactly #008000 (RGB 0, 128, 0). Preserve the exact U letter shape, football geometry, white panels, dark teal background, rounded-square silhouette, margins, proportions and composition. Flat crisp solid colours, no gradients, no shadows, no extra elements, no redesign. The only visual change should be the green colour replacement. Output a square high-resolution PNG.

### Maskable export

Use case: precise-object-edit
Asset type: Android maskable home-screen app icon export.
Input image is the colour-corrected Uniter icon edit target. Preserve its exact U and football geometry, arrangement, white panels and solid #008000 green. Prepare a maskable export by scaling the complete U/football mark down to fit within the central 65% of the canvas width, centred horizontally and vertically. Fill the entire square edge-to-edge with the same solid dark teal background #002D36. Remove the black outer margin and rounded outer tile corners: the output must be a fully opaque dark teal square with no frame. Preserve the logo itself exactly. Flat solid colours, crisp edges, no gradients, texture, shadows or new elements.
