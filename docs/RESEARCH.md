# Mood Paper: research
Procedural building blocks for stylized static and animated wallpapers: flat, solid shapes stacked in layers, plus optional pixelization and dithering. Each section ends with **Use in Mood Paper**, which says what we take from it.

---

## 1. Noise

### 1.1 Value noise
- Put a random value on each lattice point and interpolate between them with a smooth fade, either `3t²-2t³` or quintic.
- Cheap, but it looks blocky and you can see the grid.
- **Use:** fine grain and twinkle timing. It's too blocky for terrain.

### 1.2 Gradient (Perlin) noise
Ken Perlin, 1985, "improved" in 2002.
- Each lattice corner has a pseudo-random gradient vector. Take the dot product with the offset vector, then interpolate.
- The 2002 version uses the quintic fade `6t⁵-15t⁴+10t³`, which gives continuous second derivatives with no creases. It also uses a fixed set of 12 gradient directions with a 256-entry permutation table.
- Output is roughly in [-0.7, 0.7] in 2D. Normalize it before thresholding.
- **Use:**
  - Base field for cloud density, terrain height, water ripples and wind sway.
  - Seed it by shuffling the permutation table with our seeded `Rng`.

### 1.3 Simplex / OpenSimplex2
Perlin 2001; Gustavson, "Simplex noise demystified".
- Works on a simplex (triangle) grid, so it has fewer directional artifacts and costs O(n²) instead of O(2ⁿ) per dimension.
- OpenSimplex2 avoids the old patent concerns and is the modern default.
- **Use:** 3D and 4D noise for looping animation (see 1.8), where Perlin gets expensive.

### 1.4 Fractal Brownian motion (fBm)
- Sum several *octaves*: `Σ amp·noise(p·freq)`, where `freq *= lacunarity` (about 2) and `amp *= gain` (about 0.5).
- More octaves add detail. Fewer octaves give the flat, chunky silhouettes we want.
- Variants:
  - **Turbulence:** `Σ |noise|` gives billowy, cloud-like creases.
  - **Ridged multifractal:** `(1-|noise|)²`, weighted by the previous octave, gives sharp mountain crests.
  - **Hybrid multifractal:** valleys stay smooth while peaks get rough.
- **Use:**
  - Mountain ridgelines: 1D fBm or ridged along x.
  - Cloud masses: 2 to 4 octaves of turbulence.
  - Terrain bands.
  - Keep octaves low (2 to 4) for the stylized look.

### 1.5 Domain warping
Inigo Quilez, "warp".
- Feed the noise into its own coordinates: `f(p + k·fbm(p + fbm(p)))`.
- Produces swirling, marbled, flowing structures from nothing.
- **Use:**
  - Wispy cloud edges, river meanders and aurora bands.
  - Animated "flow" backgrounds where time shifts the warp offset.

### 1.6 Curl noise and flow fields
- Take the curl of a noise potential `(∂n/∂y, -∂n/∂x)`. The result is a divergence-free vector field.
- Particles traced through it follow swirls without clumping.
- **Use:**
  - Drifting leaves, pollen and fireflies.
  - Wind streaks.
  - Water-surface flow lines.

### 1.7 Tileable noise
- Sample noise on a torus: the 2D coordinates map to a 4D circle-product.
- An alternative is periodic Perlin, which wraps the permutation lattice modulo the period.
- **Use:** seamless wallpapers for multi-monitor setups and repeating textures such as grass strips.

### 1.8 Looping animation noise
- Let the time axis walk around a circle in an extra dimension: `noise(x, y, R·cos(2πt/T), R·sin(2πt/T))`.
- Every frame then lies on a closed loop, which makes it perfect for GIFs and live wallpapers.
- A cheaper 2D trick: cross-fade `n(p, t)` with `n(p, t-T)` over the period.
- **Use:** every animated layer must loop exactly over the export period T.

---

## 2. Cellular / Voronoi

### 2.1 Worley (cellular) noise
Steven Worley, 1996.
- Scatter feature points, one jittered point per grid cell. For each pixel, look at the 3×3 neighbor cells.
  - **F1:** distance to the nearest point. Gives cells and bubbles.
  - **F2:** distance to the second nearest.
  - **F2 − F1:** cell borders, i.e. cracks and stained glass.
- Distance metric changes the look:
  - Euclidean: organic.
  - Manhattan: diamonds.
  - Chebyshev: squares.
- **Smooth Voronoi** (IQ): a soft-min over points gives rounded, blobby cells.
- **Voronoise** (IQ): blends between grid noise and Voronoi with two parameters.
- **Use:**
  - Water caustics: F2-F1 thresholded, animated by moving the points.
  - Pebbles and cobbles.
  - Leaf clusters: F1 under a threshold.
  - Crackle textures and puffy cloud bottoms.

### 2.2 Point distributions
- **Jittered grid:** fast and even.
- **Poisson-disk** (Bridson, 2007, O(n)): natural spacing with a minimum distance, using a background grid and k=30 candidates.
- **Lloyd relaxation:** move points to their cell centroids for evenly sized cells.
- **Use:** scatter trees, bushes, leaves, stars and grass tufts without clumping, using a per-layer minimum distance.

---

## 3. Shape generation (turning fields into solid shapes)

The core of the "solid shapes in layers" look.

### 3.1 Thresholding and banding
- `field > t` gives a binary mask.
- Several thresholds give *contour bands*: posterized noise that reads as flat, stacked shapes. This is the "topographic" look.
- **Marching squares** traces those bands into vector polygons that can be smoothed (Chaikin) and filled crisp at any resolution.
- **Use:**
  - Cloud banks, where each threshold is one palette step.
  - Water reflections.
  - Moss and bush masses.

### 3.2 Height-line silhouettes (1D)
- Build `y = base + amplitude·fbm(x·freq)` and fill everything below the curve. That is one mountain or hill layer.
- Stack N layers:
  - Each farther layer is higher on screen, lower in amplitude and lower in contrast, and closer to the sky color (aerial perspective).
  - Each layer has its own seed.
- **Midpoint displacement** (1D) gives jagged peaks. Ridged fBm gives alpine crests. Smooth fBm with 1 to 2 octaves gives rolling hills.
- **Use:** mountain scenery, hills, far forests (fBm plus a tooth pattern), city skylines (stepped rectangles) and shorelines.

### 3.3 Blobs: circles, metaballs and SDFs
- **Circle packing / union of circles:** the classic cumulus. Use a flat bottom, circles of decreasing radius, and draw the light layer offset up-left.
- **Metaballs:** `Σ r²/d²` thresholded gives gooey merged blobs. Good for bushes and cloud puffs.
- **SDF smooth union** (IQ `smin`): `smin(a, b, k)` merges shapes with a controllable fillet.
- **Use:** clouds, bushes, tree canopies, puddles and droplets.

### 3.4 Branching structures
- **Recursive branching:**
  - Each segment spawns 2 to 3 children with angle ± jitter, length × 0.6 to 0.8, and width tapering by depth.
  - Stop at a minimum length.
  - Leaves or blossom clusters go at the tips.
- **L-systems** (Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants*): string rewriting, e.g. `F → F[+F]F[-F]F`, read by turtle graphics. Deterministic and stylized.
- **Space colonization** (Runions et al., 2007): branches grow toward scattered attraction points inside a crown shape. Gives natural, crown-shaped trees.
- **Use:** trees, bare winter branches, sakura branches with blossom blobs, coral and lightning.

### 3.5 Waves
- **Sum of sines:** `y = Σ Aᵢ sin(kᵢx + ωᵢt + φᵢ)`. Simple and loops when every `ωᵢ·T` is a multiple of 2π.
- **Gerstner (trochoidal) waves** (GPU Gems ch. 1): points move in circles, which gives sharp crests and flat troughs. The cartoon ocean look.
- **Use:**
  - Wave rows that stack like mountains: far rows thinner and paler.
  - Foam lines on crests.
  - Shimmer dashes on the water surface.

### 3.6 Scatter and instancing
- Place a sprite or shape at Poisson points with random scale, rotation and palette index.
- Sort by y for depth.
- Rotate along a flow field for wind-blown leaves.
- **Use:** grass blades (tapered triangles or quadratic curves), scattered leaves (ellipses or almond shapes), petals, droplets (teardrop: circle plus a triangle tip, with a highlight dot) and stars.

---

## 4. Gradients

- **Types:**
  - Linear, radial and conic.
  - Diamond, built from a Chebyshev distance.
  - Multi-stop gradients with eased segments.
- **Interpolation space matters:**
  - sRGB lerp goes muddy and gray in the middle, e.g. blue to yellow passes through gray.
  - Linear RGB is physically right for light mixing.
  - **OKLab** (Björn Ottosson, 2020) is perceptually uniform, which makes it the best default.
  - **OKLCH** interpolates hue around the wheel, so it keeps saturation and can take the short or the long way. Good for sunsets.
- **Stepped / banded gradients:**
  - Quantize t into N bands. This is the classic pixel-art sky: horizontal stripes of palette colors.
  - Add noise to t before quantizing to get wavy band edges.
  - Dither between bands for soft transitions (see 6).
- **Use:**
  - The sky is a vertical multi-stop OKLab gradient quantized to palette colors.
  - Sun and moon glow use radial bands.
  - Water reflection is the sky gradient flipped and compressed.

---

## 5. Pixelization

- **Render low, scale up:**
  - Draw at e.g. 1/4 or 1/6 resolution into an offscreen canvas.
  - Upscale with `imageSmoothingEnabled = false` and an integer factor.
  - Add CSS `image-rendering: pixelated` for display.
- **Kill anti-aliasing:** Canvas2D always anti-aliases paths, so pick one of:
  - Render at low res, then snap every pixel to the nearest palette color. This removes the AA blend colors.
  - Threshold alpha at 0.5 per shape.
  - Rasterize polygons yourself with a scanline fill. This is exact but slower.
- **Palette snapping:**
  - Nearest color in OKLab distance.
  - Optionally use a `Uint8` lookup cache keyed by 5-bit RGB (32k entries) for speed.
- **Quantization** (palette from an image): median cut (our extractor uses it), k-means in OKLab, octree.
- **Pixel-art polish:**
  - Pixel-perfect lines: remove the middle pixel of L corners.
  - 1px outlines in a darker palette step.
  - Selective outline (sel-out): outline color = darker neighbor, not black.
  - Avoid orphan pixels.
  - Hue-shift ramps: shadows lean cool, highlights lean warm.
- **Use:**
  - A global "pixel size" option (1 = smooth vector look, 2 to 8 = pixel art) applied as the last pass.
  - The scene renders at W/px × H/px.

---

## 6. Dithering

- **Ordered (Bayer) dithering:**
  - Compare each pixel against a threshold matrix (2×2, 4×4 or 8×8): `out = quantize(c + (M[x%n][y%n] - 0.5)·spread)`.
  - Gives a regular crosshatch: the retro look.
  - **Temporally stable**, so animated pixels don't flicker. Best for animation.
- **Blue-noise dithering:**
  - The threshold texture comes from void-and-cluster (Ulichney).
  - Organic, with no pattern. Also stable over time.
- **Error diffusion:**
  - Push the quantization error to neighbors:
    - Floyd–Steinberg 7/16, 3/16, 5/16, 1/16.
    - Atkinson: spreads only 6/8, so it gives higher contrast and a Mac look.
    - Sierra and Jarvis-Judice-Ninke: wider kernels.
  - Better quality on stills, but **flickers in animation** and "crawls" across frames.
- **Arbitrary-palette pattern dithering** (Joel Yliluoma): for each pixel, choose the pair or mix of palette colors whose blend best matches, then pick between them with the Bayer threshold. Correct for non-gray palettes.
- **Pixel-art band dithering:** only dither inside a narrow transition zone between two bands. Use 50% checker at the border and 25% and 75% Bayer patterns next to it. Inside a band, keep the flat color.
- **Space:** compute error and thresholds in linear or OKLab space for accurate tone, and in sRGB for the "classic" harsher look.
- **Use:**
  - Option `dither: none | bayer4 | bayer8 | blue | floyd | atkinson`. Ordered dithering is the default for animated output, Floyd for stills.
  - Option "band-only dithering" for skies and glows.

---

## 7. Color

- **OKLab / OKLCH conversions** (Ottosson):
  - sRGB → linear → LMS (matrix) → cube root → Lab (matrix).
  - LCH: `C = √(a²+b²)`, `h = atan2(b, a)`.
  - Gamut-clip by reducing C until the color is in sRGB.
- **Ramps:**
  - Build a color ramp by stepping L, peaking C in the mid-tones and shifting h a few degrees per step: shadows toward blue or purple, highlights toward yellow or orange (hue shifting).
- **Harmony offsets** in h: analogous ±30°, complementary 180°, split 150 or 210°, triadic 120°.
- **Mood axis** (calm → energetic):

| Parameter | Calm (low) | Energetic (high) |
|---|---|---|
| Chroma | low | high |
| Hue spread inside a ramp | small | wide |
| Contrast (L range) | compressed | full |
| Accent count | few | many |
| Ramp steps | smooth (more steps, smaller gaps) | punchy (bigger gaps) |
| Animation speed | slow | faster |

- The reference palettes in `src/refs.js` are the comparison set.

---

## 8. Animation and output

- **Parallax:** each layer gets a depth value; horizontal drift = speed × (1/depth). The loop period T must divide evenly so the loop closes.
- **Palette cycling** (Mark Ferrari; demo "Canvas Cycle" by Joseph Huckaby):
  - Rotate a range of palette indices over time.
  - Water, waterfalls, shimmer and rain all animate with zero redraw cost on an indexed buffer.
  - Fits a palette-first renderer well.
- **Sway:** grass and branch tips rotate by `A·sin(ωt + φ(x))`, where φ comes from low-frequency noise so gusts travel across the field.
- **Particles:** leaves and droplets on curl-noise paths, wrapped at the screen edges so they loop.
- **Export:**
  - PNG: `canvas.toBlob`.
  - GIF: a small GIF89a encoder (`lib/gif.js`). Exact palette ≤ 255 colors is a perfect fit, since our palettes are ≤ 15 colors.
  - WebM: `canvas.captureStream()` + `MediaRecorder`.
  - Live wallpaper: an HTML page (e.g. for Lively Wallpaper).

---

## 9. Engine shape
- `src/noise.js` holds Perlin 2D/3D, fBm, ridged, turbulence, domain warp, Worley F1/F2 and the 1D line noise.
- `src/color.js` holds sRGB ↔ OKLab/OKLCH, gamut clip and nearest-color lookup.
- `src/mood.js` turns (primary hue, secondary hue, brightness, mood level) into a palette of 3 to 15 colors, with roles.
- `src/raster.js` does pixelize, palette snap and dither.
- `src/shapes.js` has one generator per element (clouds, bushes, leaves, grass, water, droplets, waves, mountains, trees).
- `src/scene.js` composes scenes: layer stack, depth, palette roles and animation time `t`.
- Everything is seeded: the same seed + palette + options always gives the same wallpaper.

## References
- Perlin, "Improving Noise" (SIGGRAPH 2002), mrl.cs.nyu.edu/~perlin/paper445.pdf
- Gustavson, "Simplex noise demystified" (2005)
- Inigo Quilez articles: iquilezles.org/articles (fbm, warp, smoothvoronoi, voronoise, smin, distfunctions2d)
- Worley, "A Cellular Texture Basis Function" (SIGGRAPH 1996)
- Bridson, "Fast Poisson Disk Sampling in Arbitrary Dimensions" (2007)
- Red Blob Games, "Making maps with noise functions", redblobgames.com/maps/terrain-from-noise
- Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants* (1990), algorithmicbotany.org
- Runions, Lane, Prusinkiewicz, "Modeling Trees with a Space Colonization Algorithm" (2007)
- Tessendorf / GPU Gems ch. 1, "Effective Water Simulation from Physical Models" (Gerstner waves)
- Ottosson, "A perceptual color space for image processing" (OKLab), bottosson.github.io/posts/oklab
- Yliluoma, "Arbitrary-palette positional dithering algorithm", bisqwit.iki.fi/story/howto/dither/jy
- Ulichney, void-and-cluster blue noise (1993)
- Huckaby, "Canvas Cycle" (Mark Ferrari palette art), effectgames.com/demos/canvascycle
