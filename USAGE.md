# Usage
Plain scripts, loaded in this order: `src/rng.js`, `color.js`, `noise.js`, `mood.js`, `raster.js`, `shapes.js`, `scene.js` (+ `refs.js`, `ui.js`, `panel.js` for the pages, `lib/gif.js` for GIF export).

```js
const pal = Mood.generate({ primary: '#3B3D9A', secondary: '#E08A5C', brightness: 0.35, mood: 0.4, count: 0 });
// pal.colors (dark -> light), pal.ramps.primary / secondary / accent

Scene.render(canvas, { preset: 'peaks', palette: pal, seed: 7, t: 0, width: 1920, height: 1080, px: 4, dither: 'bayer4' });
```

| Option | Values | Meaning |
|---|---|---|
| `mood` | 0..1 | calm (muted, close hues, soft contrast) -> energetic (saturated, wide hue shift, accents) |
| `brightness` | 0..1 | night -> day (moves the lightness window) |
| `count` | 0, 3..15 | 0 = auto (6 + 6 x mood) |
| `preset` | `Scene.PRESETS` | peaks, meadow, coast, sakura, autumn, rain, night, city, canopy (looking up through branches), grove (looking up through tree tops) |
| `t` | 0..1 | loop time; t = 0 and t = 1 give the same frame |
| `px` | 1..8 | pixel size (renders at width/px, upscales crisp) |
| `dither` | none, bayer4, bayer8, floyd, atkinson | ordered modes only pattern in-between colors; use them for animation |

- `Mood.estimate(colors, share?)` guesses the four inputs from any palette.
- `Shapes.*` draw single elements on a 2D context with a `ramp` (dark -> light): `cloud` (6 kinds), `cloudBank`, `bush`, `leaf`, `scatterLeaves`, `petal`, `grass`, `water`, `waves`, `droplet`, `rain`, `mountains`, `hills`, `cliff`, `skyline`, `sky`, `sun`, `stars`.
- Trees: `tree({ kind: round | sakura | bare | pine, lod: far | mid | close })`, `farTree({ form })`, `midTree({ form: round | spread | oval })` (leaf clusters layered by depth, drawn per pixel by `clusters`), `pine`, `crown({ form: round | oval | spread | column | cone, edge: 0 scallops .. 1 needles })`, `branch` (close-up, twigs from anywhere, leaf or blossom sprays), `sprays`, `grow` (curved limbs).
- `Raster.apply(lowCanvas, outCanvas, paletteHexes, { px, dither, edges })` is the edge / palette snap / dither / upscale pass. `edges: 'crisp'` (default) removes anti-aliasing before the snap; `'soft'` snaps blended edge pixels like any color.
