# UNITER app icon concepts

Created 2026-09-09 using the built-in image generation tool.

## Latest revision: clearer huddle

[uniter-community-huddle-v2.png](uniter-community-huddle-v2.png) develops the
community U into five illustrated football players leaning inward with arms
around neighbouring shoulders. The blue accent is removed, and a small green
and white football sits beside the lower-right curve. The original concept is
preserved. [Edit prompt](huddle-v2-prompt.md).

The offline comparison now shows this revision in the third card. The export is
1254 × 1254 and fully opaque; it was visually inspected for the huddle pose,
U silhouette, ball placement and removal of blue.

## Initial concepts

Open [index.html](index.html) for a side-by-side preview with small home-screen
samples. The PNGs are original generated exports: **1254 × 1254**, fully opaque.
The prompt requested 1024 × 1024; the generator returned 1254 × 1254.
The same comparison is available as [preview.png](preview.png).

| Direction | PNG | Idea |
| --- | --- | --- |
| Football | [uniter-football.png](uniter-football.png) | Recognisable football with a blue panel and a subtle U-shaped lower band. |
| Team | [uniter-team.png](uniter-team.png) | Three teammates in a huddle inside a modern club crest. |
| Community (original) | [uniter-community.png](uniter-community.png) | Five people forming an open U-shaped gathering. |

Palette follows the app's green, white and blue design tokens. These are concept
assets; the existing app icons and manifest have not been replaced. Pixel-perfect
brand colour matching and production-size exports can follow selection.

The first pass was discarded because the generator removed its green backgrounds.
The final pass explicitly preserves an opaque green tile. All three final exports
were visually inspected; every pixel's alpha was checked as 255. The preview
shows the originals at 64 px and 48 px without altering the PNGs.
The offline page was checked with Playwright at 1200 px and 390 px: all 12 image
instances loaded, all three download links were present, and neither viewport
had horizontal overflow. The desktop comparison and small icons were inspected.

## Final prompts

### Football

```text
Use case: logo-brand.
Create ONE finished square UNITER app icon artwork.
CRITICAL OUTPUT REQUIREMENT: This is a complete OPAQUE square tile with an intentional GREEN background, NOT a transparent logo cutout. Preserve the entire solid green square as painted artwork. Every pixel must be opaque including the four corners and all negative spaces. Do not remove or make transparent the green background. No alpha cutout, no chroma key processing, no background removal.
The canvas itself is a uniform rich football green #008000 square, edge to edge. A bold pure white symbol is printed flat on it. This green field is an essential element of the design. Include one small electric blue #335FFF accent. Clean flat graphic design: solid colors, exceptionally crisp smooth contours, no texture, no shading, no gradients, no lighting, no fine outlines, no 3D. 1024x1024 square artwork. The symbol stays within the central 68 percent for home screen masks. Do not draw rounded outer corners or any framing surface beyond the green tile.
Brand: UNITER, a local amateur association-football app for players, teams and community. No written text, no wordmark, no watermark, no presentation labels, no extra icon options.
Subject: a large, beautifully proportioned circular white association football with five or six bold GREEN geometric panel shapes. Conventional pentagon-and-hexagon football recognition is the priority. The main central pentagon is green; one small peripheral panel toward the upper right is electric blue. Make the lower WHITE panels join into a subtly U-shaped white band while keeping the ball simple, circular and recognizably a soccer ball. Absolutely no keyhole shape or interior decorative logo. Treat all green inside the ball as opaque printed green, identical to the background.
```

### Team

```text
Use case: logo-brand.
Create ONE finished square UNITER app icon artwork.
CRITICAL OUTPUT REQUIREMENT: This is a complete OPAQUE square tile with an intentional GREEN background, NOT a transparent logo cutout. Preserve the entire solid green square as painted artwork. Every pixel must be opaque including the four corners and all negative spaces. Do not remove or make transparent the green background. No alpha cutout, no chroma key processing, no background removal.
The canvas itself is a uniform rich football green #008000 square, edge to edge. A bold pure white symbol is printed flat on it. This green field is an essential element of the design. Include one small electric blue #335FFF accent. Clean flat graphic design: solid colors, exceptionally crisp smooth contours, no texture, no shading, no gradients, no lighting, no fine outlines, no 3D. 1024x1024 square artwork. The symbol stays within the central 68 percent for home screen masks. Do not draw rounded outer corners or any framing surface beyond the green tile.
Brand: UNITER, a local amateur association-football app for players, teams and community. No written text, no wordmark, no watermark, no presentation labels, no extra icon options.
Subject: a bold modern white shield outline containing three abstract teammates with arms around each other's shoulders in a close team huddle. Three equal-size circular heads above one joined, simplified shoulder-and-torso silhouette. The joined torso shape gently traces a U. Use generous opaque green gaps between the people and shield so the silhouettes are distinct. The shield has a broad top and a rounded pointed base. One small blue inset at the shield tip. Compact, confident, welcoming club emblem. No stars, crowns, laurels, words, shirt details, or faces.
```

### Community

```text
Use case: logo-brand.
Create ONE finished square UNITER app icon artwork.
CRITICAL OUTPUT REQUIREMENT: This is a complete OPAQUE square tile with an intentional GREEN background, NOT a transparent logo cutout. Preserve the entire solid green square as painted artwork. Every pixel must be opaque including the four corners and all negative spaces. Do not remove or make transparent the green background. No alpha cutout, no chroma key processing, no background removal.
The canvas itself is a uniform rich football green #008000 square, edge to edge. A bold pure white symbol is printed flat on it. This green field is an essential element of the design. Include one small electric blue #335FFF accent. Clean flat graphic design: solid colors, exceptionally crisp smooth contours, no texture, no shading, no gradients, no lighting, no fine outlines, no 3D. 1024x1024 square artwork. The symbol stays within the central 68 percent for home screen masks. Do not draw rounded outer corners or any framing surface beyond the green tile.
Brand: UNITER, a local amateur association-football app for players, teams and community. No written text, no wordmark, no watermark, no presentation labels, no extra icon options.
Subject: five equal-size abstract people forming an open circular gathering, a strong U-shaped community symbol. Five solid white round heads following a U-shaped arc, each attached visually to a short broad curved white body segment; bodies join into a welcoming near-circular embrace with an opening at the top. Every person has the same visual weight: peers joining together, no parent-and-child arrangement. One small blue segment in the lower right connection. The centre stays open green. The unified symbol should feel sociable, inclusive and unmistakably human, while retaining the memory of the UNITER letter U. No shield, no football, no globe, no heart, no thin network lines.
```
