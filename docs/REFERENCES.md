# References: limited-palette pixel sceneries vs Mood Paper

Research of 2026-11-12. What pixel-landscape and flat-wallpaper artists do, layer by layer, and how Mood Paper compares.
Sources are listed at the end. Items marked *(memory)* come from general knowledge, not from a page read in this pass.

## 1. The reference layer stack

Slynyrd's landscape backgrounds (Pixelblog 62) are the most explicit breakdown found. Each scene is 192×144 with 15 colors (limit 16):

| # | Layer | Decision |
|---|---|---|
| 1 | Horizon bars | Solid horizontal bars fix the horizon first; everything else hangs on them |
| 2 | Sky + ground bands | Both are split into a few flat bands (the sky gradient *is* bands) |
| 3 | Mountains (2 layers) | Built back from the farthest ground plane. **The farthest range reuses a sky band color** |
| 4 | Ground texture | Near and mid planes get texture **in colors borrowed from the other ground bands** (no new colors) |
| 5 | Mountain detail | A **haze band along the mountain base** blends it into the ground; shading is blue-shifted |
| 6 | Clouds, last | **The farthest clouds are baked into the sky gradient**; the nearest (among the mountains) get the most contrast and detail; cloud layers share colors |

Detail per depth (Slynyrd 62, depth-composition article):
- Near: thick multi-pixel shapes, one extra dark shade, 1 px highlights.
- Mid: single-pixel streaks or clusters of 1–2 px; chunky cel shading; no per-pixel highlights.
- Far: no internal detail, a 2-tone silhouette.
- Keep cluster size and scale consistent inside a layer. Forests are the exception: every layer needs detail, and scale changes less between layers.

## 2. Color decisions

**Atmospheric perspective has three axes, all moving together with each plane back:**
1. Saturation drops.
2. Lightness rises (day and haze; at night the far planes move toward the dark sky instead).
3. Hue moves toward the sky color: warm grass near, blue toward the horizon. With thick haze the shift is stronger; in the desert it runs orange → yellow → light blue, and dark-red shadows → violet → faded blue.

In a backlit forest (viewer in shade, looking at the light) it inverts: near greens are cool, far ones warm yellow.

Other rules:
- Palette size is 4–16 in practice; Slynyrd's 15 colors cover a full scene.
- In bigger palettes, 4–6 cool desaturated colors go to the far layers only, and saturated colors are kept for the foreground. "Consistency kills depth": not every layer should draw from the same ramp.
- Ramps are hue-shifted (shadows cool, highlights warm) rather than value-only.
- Alto's Adventure: a handful of hues per biome carries mood, weather and land. Anything important gets a glow color or a distinct silhouette so it still reads at night.
- Check: blur the frame. If near and far merge, raise the saturation contrast or the silhouette overlap.

## 3. Sky: bands and dither

- Dither only where the palette lacks a mid-tone; don't dither by default.
- A dithered zone needs about 8–16 px to read. Below about 8–10 px, use a solid color or a single-pixel step.
- Straight bands with regular spacing read as speed lines. Arcs, irregular spacing, or loose cloud shapes for band edges read as sky.
- Keep dither tight at the seams and the solid bands wide: that keeps the colors vibrant.
- Dither the whole image or none of it: mixing dithered and clean styles looks odd. This is forum advice; Slynyrd himself textures only the sky.
- Patterns: a 2×2 checkerboard for a quick 50/50 step; Bayer 4×4 or 8×8 for multi-step gradients (it can crosshatch when small); random noise for organic surfaces only.
- Judge at 1:1 or at the real display size. Static means it's over-dithered.

## 4. Motion

- **Color cycling (Mark Ferrari, LucasArts):**
  - The image is a fixed index map; only the palette entries rotate.
  - Water, rain, snow and fog move this way, and time of day comes from swapping the palette on the same map.
  - His scenes also use fairly elaborate scanline parallax, and still leave nearly half of the 256 slots unused.
- **Parallax (Slynyrd 23):**
  - Every layer moves at a whole number of px per frame that divides the canvas width (1, 2, 3, 4, 6, 8…), and the loop length equals the width in frames.
  - Under 1 px per frame looks jittery, so it's avoided.
  - "Balanced layers without dominant points of interest help hide the loop."
- **Depth spacing:**
  - Scroll rates spaced logarithmically: sky 0, far 0.1, mid 0.25, near 0.5, action 1.0, foreground 1.2. Values like 0.4 and 0.5 are too close to tell apart.
  - Three layers (distant, action, foreground) are enough.
- **Pace:** pixel animation commonly runs at 8–12 fps, and sub-pixel motion is done by recoloring pixels rather than moving them.

## 5. Comparison with Mood Paper

| Topic | References | Mood Paper before | Same / differs |
|---|---|---|---|
| Palette size | 4–16 (15 typical) | 3–15, auto 6–12 by mood | Same range |
| Ramps | Hue-shifted, shadows cool and highlights warm | `Mood.ramp`: cool→warm hue shift, chroma bell | Same |
| Scenery vs objects | Far layers get their own cool, desaturated subset; saturated colors stay in front | `groups`: scenery = primary hue family, objects = the other hues | Similar intent; the split is by hue, not by depth |
| Depth color | Saturation ↓, lightness ↑, hue → sky, per plane | `far .6 / mid .4 / near .2` steps along the primary ramp: lightness only | **Differs**: the chroma bell peaks mid-ramp, so the far range (0.6) is about as saturated as the near ones, or more |
| Farthest range | Reuses a sky band color | `pk(P, .6)`, close to the lower sky stops but not chosen from them | Close, not tied |
| Mountain base | Haze band blends it into the ground | Range ends in a hard edge; nothing blends the base | **Missing** |
| Ground texture | Borrows colors from neighbouring bands | Grass and hills use `ground / near / mid` from the same ramp | Same |
| Sky | Bands, linear texture between them, curved or irregular edges | Wavy noisy bands with Bayer seams at 0.35 of a band; rings in canopy and grove | Same idea, and the edges are already non-straight |
| Dither scope | Only where a tone is missing; zones ≥ 8 px; all or none | Sky seams, cloud fades, optional global dither in `Raster.apply`; objects stay flat | Mixed by design. At px 4 the seams can drop under 8 px |
| Clouds by depth | Far clouds melt into the sky; near ones have the most contrast | All clouds use `R.cloud` (the 3 lightest scenery colors) at every height and size | **Differs**: no depth tiers |
| Detail falloff | Far is a 2-tone silhouette, mid is chunky, near is fine | LODs: `farTree` / `midTree` / close; hill trees in hill tones | Same |
| Occlusion | Foreground breaks the horizon; overlap of about 30% | Overhang branch, the meadow's main tree, bushes in groups | Same |
| Night legibility | Glow color or silhouette on key shapes | The overhang is skipped when it lacks contrast; stars and moon | Partial: no general check |
| Loop motion | Palette cycling, integer-px parallax, loop length = width | Float positions on t with `wave()`, whole crossings, crossfades | **Differs**: motion is geometric, not palette-based; sub-pixel positions are rounded to the grid, which is exactly the "under 1 px per frame" case |
| Layer parallax | Per-layer scroll rates (log spacing) | Static layers; only clouds, leaves and sway move | Not used (wallpaper, not a scroller) |
| Time of day | Palette swap on a fixed index map | A new palette means new roles, then a re-render | Same architecture: roles are the index map |

### Main differences, in short
1. **Depth is value-only.** The refs lower saturation and pull hue toward the sky as well; Mood Paper's ramp chroma bell does the opposite for the far range.
2. **No mountain-base haze band** and **no cloud depth tiers**, two of the cheapest depth cues in Slynyrd's stack.
3. **Motion model.** The refs animate with color (cycling) or exact pixel rates; Mood Paper moves geometry on floats and lets the grid round it. Slow drifts (heaps at 8–15% of the width per loop) fall well under 1 px per frame at a 30 s loop.
4. **Dither scope** is intentional, not uniform: the sky is dithered, the objects are flat. That goes against the "all or none" forum advice but matches what Slynyrd does.

## 6. Applied in Mood Paper

| Idea (section) | What Mood Paper does | Where |
|---|---|---|
| Saturation drops with distance (2) | The scenery ramp's chroma peaks at 30% of the ramp and falls to about half at the light end (`aerial` option, default on), so the lighter steps used by far planes and the horizon are the hazy ones | `Mood.ramp` |
| Farthest plane reuses a sky color (1, 2) | `Scene.depthTones`: the far plane is the scenery color closest to the sky behind its ridge that still reads against all of it (dL >= 0.035), darker when there is room, else lighter (dark palettes, whose skies use the darkest colors); planes between follow the OKLab mix toward the near plane; neutral grays are left out. Fixes far ranges that matched a sky band and vanished | ranges, meadow hills, city skylines, rain rows |
| Haze band at the mountain base (1) | `Shapes.mist`: a Bayer-dithered band in one hue-aware step toward the sky, dithered in over the lower 3/4 of the visible gap, clipped to the layer, its edge broken per column by looping noise into fog banks, tongues and clear patches that roll slowly | ranges, hills, skylines (clipped), forest rows in rain (open fog) |
| Far clouds baked into the sky, near ones most contrast (1) | Cloud tiers by height: high = near (full size, 3 tones, 2 crossings per loop), middle = 2 tones, low = far (60% size, the sky band behind + one step, slow drift with crossfade); 2-3 thin streaks baked into the low sky, crossing a low sun | `Scene.clouds`, `Scene.streaks`, `Shapes.streak` |
| Parallax spacing (4) | Near / mid / far cloud speeds about 2.5-4 W / 1.2-1.8 W / 0.2-0.3 W per loop (W = frame width) | `Scene.clouds` |
| Integer-pixel motion (4) | Cloud and leaf positions snap to whole pixels, so a moving shape only translates instead of re-rasterizing its edges (the crisp pass flips edge pixels at fractional offsets) | `Scene.clouds`, `Shapes.scatterLeaves` |
| Color cycling (4) | Rain as fixed slanted lines whose drop pattern steps a whole number of periods per loop, in exact 1 px rects | `Shapes.rain` |
| Night legibility (2) | Shore pines get a moonlit rim one step lighter, on the side facing the moon | night, peaks (dark palettes) |

Not changed: dither scope (sky and mist dithered, objects flat), detail falloff, occlusion, the composition of each preset.

## Sources
- [Slynyrd – Pixelblog 62: Landscape Backgrounds](https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds)
- [Slynyrd – Pixelblog 11: Landscape Pixeling](https://www.slynyrd.com/blog/2018/11/16/pixelblog-11-landscape-pixeling)
- [Slynyrd – Pixelblog 23: Parallax Scrolling](https://www.slynyrd.com/blog/2019/11/12/pixelblog-23-parallax-scrolling)
- [Pixel art scene depth composition tricks](https://freegamesprites.com/ar/news/pixel-art-scene-depth-composition-tricks)
- [Pixel Joint – sky gradient thread](https://pixeljoint.com/forum/printer_friendly_posts.asp?TID=26366)
- [Divoom – Dithering: when to use it and when to stop](https://divoom.com/blogs/setup-ideas/pixel-art-dithering-when-to-use-and-stop)
- [80.lv – Color cycling from the 90s returns with HTML5](https://80.lv/articles/color-cycling-from-the-90s-returns-with-html5)
- [GDC Vault – Mark Ferrari, 8 Bit & '8 Bitish' Graphics](https://gdcvault.com/play/1023586/8-Bit-8-Bitish-Graphics)
- [Wikiwand – Color cycling](https://www.wikiwand.com/en/articles/Color-cycling)
- [Design Milk – Alto's Adventure keeps it simple](https://design-milk.com/altos-adventure-keeps-simple/)
- [MacStories – Alto's Adventure review](https://www.macstories.net/reviews/altos-adventure-review-a-beautiful-descent/)
- [Lospec palette list](https://lospec.com/palettes)
