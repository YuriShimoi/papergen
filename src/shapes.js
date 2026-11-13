/**
 * Flat layered shape generators. Every shape is drawn with solid fills only, tones stacked by clipping
 * (base -> mid -> light), so it reads as cut-paper layers. `ramp` is always a color list dark -> light.
 * `t` (0..1) is the loop time: every motion completes whole cycles over one loop.
 */
class Shapes {
  static TAU = Math.PI * 2;

  //#region [ Helpers ]
  /** Color from a ramp by fraction 0..1 */
  static pick(ramp, f) { return ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(f * (ramp.length - 1))))]; }

  /** Union path of circles [[x, y, r], ...] */
  static circlesPath(circles, dx=0, dy=0, scale=1) {
    const p = new Path2D();
    for(const [x, y, r] of circles) {
      p.moveTo(x + dx + r * scale, y + dy);
      p.arc(x + dx, y + dy, r * scale, 0, Shapes.TAU);
    }
    return p;
  }

  /**
   * Draws a base path, then lighter copies shifted toward the light, clipped to the base (flat 3-tone volume).
   * @param {(dx:number, dy:number, s:number)=>Path2D} build - path builder for an offset/scale
   * @param {string[]} tones - dark -> light, 1..4 colors
   * @param {number} off - shift per tone (px), light comes from the top-left
   */
  static toned(ctx, build, tones, off) {
    const base = build(0, 0, 1);
    ctx.fillStyle = tones[0];
    ctx.fill(base);
    if(tones.length < 2) return base;
    ctx.save();
    ctx.clip(base);
    for(let i = 1; i < tones.length; i++) {
      ctx.fillStyle = tones[i];
      ctx.fill(build(-off * i * 0.6, -off * i, 1 - i * 0.12));
    }
    ctx.restore();
    return base;
  }

  /** Whole-cycle sine for loops: k cycles over the loop */
  static wave(t, k=1, phase=0) { return Math.sin(Shapes.TAU * (t * k) + phase); }
  //#endregion

  //#region [ Sky ]
  /** 4x4 Bayer thresholds, -0.5..0.5, row-major: the fixed screen pattern of every dithered seam. */
  static BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);

  /** '#rrggbb' -> one opaque ImageData pixel as a 32-bit int (little-endian A B G R). */
  static rgba32(hex) { const [r, g, b] = Color.hexToRgb(hex); return (255 << 24 | b << 16 | g << 8 | r) >>> 0; }

  /**
   * Banded vertical sky: `stops` mixed in OKLab, quantized into `bands` flat stripes with wavy edges (top bands
   * thicker, horizon bands thinner), drawn per pixel. Each seam is an ordered-dither ramp `dither` of a band tall
   * (0 = hard seams): every pixel looks its band up at a height nudged by a 4x4 Bayer threshold fixed to the
   * screen, so the two colors interleave in steps. Band tops are sampled across the whole width, the last sample
   * on the right edge.
   * @param {{x?, y?, w, h, stops: string[], bands?: number, wavy?: number, noise?: Noise, t?: number, dither?: number}} o
   */
  static sky(ctx, o) {
    const { x=0, y=0, w, h, stops, bands=8, wavy=0, noise=null, t=0, dither=0.35 } = o;
    const tones = Array.from({ length: bands }, (_, i) => Shapes.rgba32(Shapes.bandColor(stops, i, bands)));
    const ns = Math.max(1, Math.ceil(w / Math.max(4, w / 80))), tops = new Float64Array((ns + 1) * bands);
    const ox = Math.cos(Shapes.TAU * t) * 0.3, oy = Math.sin(Shapes.TAU * t) * 0.3;
    for(let s = 0; s <= ns; s++)
      for(let i = 1; i < bands; i++)
        tops[s * bands + i] = y + h * (i / bands) ** 0.8 + (noise? noise.perlin3(s / ns * 3 + ox, i * 0.7 + oy, 0.5) * wavy * h / bands: 0);
    const X0 = Math.floor(x), Y0 = Math.floor(y), bw = Math.ceil(x + w) - X0, bh = Math.ceil(y + h) - Y0;
    if(bw <= 0 || bh <= 0) return;
    const z = dither * h / bands, B = Shapes.BAYER4, edge = new Float64Array(bands);
    const cv = Shapes.scratch(bw, bh), cctx = cv.getContext('2d');
    const img = cctx.createImageData(bw, bh), out = new Uint32Array(img.data.buffer);
    for(let i = 0; i < bw; i++) {
      const fs = Math.max(0, Math.min(ns, (X0 + i + 0.5 - x) / w * ns)), s0 = Math.min(ns - 1, Math.floor(fs)), f = fs - s0;
      for(let k = 1; k < bands; k++) edge[k] = tops[s0 * bands + k] + (tops[(s0 + 1) * bands + k] - tops[s0 * bands + k]) * f;
      const col = (X0 + i) & 3;
      for(let j = 0; j < bh; j++) {
        const Y = Y0 + j + 0.5;
        if(Y > y + h) break;
        const yd = Y + B[((Y0 + j) & 3) * 4 + col] * z;
        let band = 0;
        for(let k = 1; k < bands; k++) if(yd >= edge[k]) band = k;
        out[j * bw + i] = tones[band];
      }
    }
    cctx.putImageData(img, 0, 0);
    ctx.drawImage(cv, 0, 0, bw, bh, X0, Y0, bw, bh);
  }

  /**
   * Sky bands as rings around (cx, cy), drawn per pixel like `sky`: ring i (1..n-1) has radius radii[i] with a soft
   * angular wobble, inner rings over outer ones (band 0 fills the rest of the w x h frame), and each seam is an
   * ordered-dither ramp `dither` of its gap to the next ring out.
   * @param {{w, h, cx, cy, radii: number[], colors: string[], noise: Noise, dither?: number}} o - radii shrink with i
   */
  static rings(ctx, { w, h, cx, cy, radii, colors, noise, dither=0.35 }) {
    const n = colors.length, N = 256, tones = colors.map(Shapes.rgba32), B = Shapes.BAYER4;
    const lut = new Float64Array(n * N), z = new Float64Array(n);
    for(let i = 1; i < n; i++) {
      z[i] = dither * Math.max(1, (i > 1? radii[i - 1]: radii[1] * 1.25) - radii[i]);
      for(let q = 0; q < N; q++) {
        const p = (q + 0.5) / N * 4, [dx, dy] = p < 1? [1 - p, p]: p < 2? [1 - p, 2 - p]: p < 3? [p - 3, 2 - p]: [p - 3, p - 4];
        const a = Math.atan2(dy, dx);
        lut[i * N + q] = radii[i] * (1 + 0.05 * noise.perlin3(Math.cos(a) * 1.5, Math.sin(a) * 1.5, i * 0.7));
      }
    }
    const bw = Math.ceil(w), bh = Math.ceil(h);
    const cv = Shapes.scratch(bw, bh), cctx = cv.getContext('2d');
    const img = cctx.createImageData(bw, bh), out = new Uint32Array(img.data.buffer);
    for(let j = 0; j < bh; j++) {
      const dy = j + 0.5 - cy, row = (j & 3) * 4;
      for(let i = 0; i < bw; i++) {
        const dx = i + 0.5 - cx, rho = Math.sqrt(dx * dx + dy * dy), th = B[row + (i & 3)];
        const q = Math.min(N - 1, Shapes.dia(dx, dy) * (N / 4) | 0);
        let band = 0;
        for(let k = 1; k < n; k++) if(rho - th * z[k] < lut[k * N + q]) band = k;
        out[j * bw + i] = tones[band];
      }
    }
    cctx.putImageData(img, 0, 0);
    ctx.drawImage(cv, 0, 0, bw, bh, 0, 0, bw, bh);
  }

  /** Color of band i of n: stops mixed in OKLab (exact stop colors when n == stops.length). */
  static bandColor(stops, i, n) {
    if(stops.length === 1) return stops[0];
    const seg = (n === 1? 0: i / (n - 1)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(seg));
    return Color.mix(stops[k], stops[k + 1], seg - k);
  }

  /** Band color of a `sky()` at height fraction f (0 = top). */
  static skyColorAt(stops, f, n=stops.length) {
    let i = 0;
    while(i < n - 1 && ((i + 1) / n) ** 0.8 <= f) i++;
    return Shapes.bandColor(stops, i, n);
  }

  /**
   * Mist: `color` laid over the band y0 -> y1 through the screen-fixed 4x4 Bayer door, its density rising from none at
   * y0 to solid at y1 (eased by `ease`), then solid on down to `bottom`; clipped to `clip` (Path2D) when given. Exact
   * palette colors, the same pattern as the sky seams. `breathe` (share of the band) lifts and lowers it over the loop.
   * `wave` (share of the band) breaks the straight band into fog banks: per column, looping noise keyed by `seed` raises
   * or sinks the band (big banks plus small wisps) and makes its fade sharper or softer, so it rises in tongues, opens
   * clear patches and rolls slowly sideways and back over the loop.
   * @param {{x?, w, y0, y1, bottom?, color, clip?: Path2D, ease?, t?, breathe?, phase?, wave?, seed?, scale?}} o - scale: banks per width
   */
  static mist(ctx, { x=0, w, y0, y1, bottom=y1, color, clip=null, ease=1.5, t=0, breathe=0, phase=0, wave=0, seed='mist', scale=2.5 }) {
    const lift = breathe * (y1 - y0) * Shapes.wave(t, 1, phase), a0 = y0 - lift, span = Math.max(1, y1 - y0), amp = wave * span;
    const X0 = Math.floor(x), Y0 = Math.floor(Math.min(a0, y0) - amp), bw = Math.ceil(x + w) - X0, bh = Math.ceil(Math.max(bottom, y1 + amp)) - Y0;
    if(bw <= 0 || bh <= 0) return;
    const cv = Shapes.scratch(bw, bh), c = cv.getContext('2d'), B = Shapes.BAYER4, tone = Shapes.rgba32(color);
    const img = c.createImageData(bw, bh), out = new Uint32Array(img.data.buffer);
    const nz = amp > 0? Shapes.noiseFor('mist:' + seed): null, clamp = v => Math.max(-1, Math.min(1, v));
    for(let i = 0; i < bw; i++) {
      let top = a0, sp = span;
      if(nz) {
        const u = (X0 + i + 0.5 - x) / w * scale;
        top += amp * clamp(0.65 * Shapes.loopNoise(nz, u, 1.3, t, 0.35) + 0.35 * Shapes.loopNoise(nz, u * 3.3, 7.7, t, 0.6));  // banks + wisps
        sp *= 0.55 + 0.45 * (0.5 + 0.5 * clamp(Shapes.loopNoise(nz, u * 1.7, 4.1, t, 0.4)));  // sharp fronts here, soft there
      }
      for(let j = 0, col = (X0 + i) & 3; j < bh; j++) {
        const v = (Y0 + j + 0.5 - top) / sp;
        if(v <= 0) continue;
        if(B[((Y0 + j) & 3) * 4 + col] + 0.5 < Math.min(1, v) ** ease) out[j * bw + i] = tone;
      }
    }
    c.putImageData(img, 0, 0);
    ctx.save();
    if(clip) ctx.clip(clip);
    ctx.drawImage(cv, 0, 0, bw, bh, X0, Y0, bw, bh);
    ctx.restore();
  }

  /**
   * Far cloud streak baked into the sky: a long, thin lens of `color` (one step off the sky band behind it) drawn per
   * pixel in whole-pixel rows: a flat-ish base, a rounder top, thickest in the middle, and both ends dithered out through
   * the Bayer door, so it melts into the band instead of sitting on it. It swells and thins a little over the loop.
   * @param {{x, y, len, th, color, rng, t?}} o - x, y: left end of the center line; th: thickest part (px)
   */
  static streak(ctx, { x, y, len, th, color, rng, t=0 }) {
    const bend = rng.float(-0.8, 0.8) * th, ph = rng.float(0, Shapes.TAU), lump = Shapes.wobble(rng, [2.3, 5.1]);
    const swell = 1 + 0.18 * Shapes.wave(t, 1, ph), B = Shapes.BAYER4, tone = Shapes.rgba32(color);
    const X0 = Math.floor(x), bw = Math.ceil(x + len) - X0, Y0 = Math.floor(y - th * 1.6 - Math.abs(bend)), bh = Math.ceil(th * 2.6 + Math.abs(bend) * 2) + 2;
    if(bw <= 0 || bh <= 0) return;
    const cv = Shapes.scratch(bw, bh), c = cv.getContext('2d');
    const img = c.createImageData(bw, bh), out = new Uint32Array(img.data.buffer);
    for(let i = 0; i < bw; i++) {
      const u = (X0 + i + 0.5 - x) / len;
      if(u <= 0 || u >= 1) continue;
      const cy = y + bend * Math.sin(Math.PI * u), body = th * swell * Math.sin(Math.PI * u) ** 0.7 * (0.75 + 0.25 * lump(u));
      const a = Math.min(1, u / 0.2, (1 - u) / 0.2);  // ends dithered out
      for(let j = 0; j < bh; j++) {
        const d = Y0 + j + 0.5 - cy;
        if(d < -body * 0.65 || d > body * 0.35) continue;
        if(B[((Y0 + j) & 3) * 4 + ((X0 + i) & 3)] + 0.5 < a) out[j * bw + i] = tone;
      }
    }
    c.putImageData(img, 0, 0);
    ctx.drawImage(cv, 0, 0, bw, bh, X0, Y0, bw, bh);
  }

  /**
   * Halo colors a sun keeps: only those really close to its disc color (OKLab distance under 0.05), so a sun never
   * reads as two colors; a distinct halo is dropped and the sun stays one solid disc.
   */
  static sunHalo(halo, disc) {
    const lab = c => Color.rgbToOklab(Color.hexToRgb(c)), d = lab(disc);
    return halo.filter(c => Color.dist(lab(c), d) < 0.05);
  }

  /**
   * Sun / moon: a solid disc, with flat halo rings (outer -> inner) only in colors close to the disc (`sunHalo`).
   * crescent: the disc is drawn as one crescent shape (the disc minus an offset circle, through an even-odd clip),
   * so the sky behind the dark side stays untouched, dither and all.
   */
  static sun(ctx, { x, y, r, halo=[], disc, crescent=false }) {
    halo = Shapes.sunHalo(halo, disc);
    halo.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, r * (1 + (halo.length - i) * 0.55), 0, Shapes.TAU);
      ctx.fill();
    });
    ctx.save();
    if(crescent) {
      const cx = x + r * 0.5, cy = y - r * 0.3, cr = r * 0.92;
      ctx.beginPath();
      ctx.rect(x - r * 2, y - r * 2, r * 4, r * 4);
      ctx.moveTo(cx + cr, cy); ctx.arc(cx, cy, cr, 0, Shapes.TAU);
      ctx.clip('evenodd');
    }
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Shapes.TAU); ctx.fill();
    ctx.restore();
  }

  /** Square pixel stars that twinkle in whole cycles. */
  static stars(ctx, { x=0, y=0, w, h, count=60, colors, rng, t=0, size=2 }) {
    for(let i = 0; i < count; i++) {
      const sx = x + rng.float(0, w), sy = y + rng.float(0, h) ** 1.6 / h ** 0.6;
      const tw = Shapes.wave(t, rng.int(1, 3), rng.float(0, 6));
      const s = size * (rng.chance(0.15)? 2: 1);
      const c = rng.pick(colors);  // draw every rng value before any branch so frames stay in sync
      ctx.fillStyle = tw > 0.6? colors[colors.length - 1]: c;
      if(tw < -0.7) continue;
      ctx.fillRect(Math.round(sx), Math.round(sy), s, s);
      if(s > size && tw > 0.3) {
        ctx.fillRect(Math.round(sx) - s, Math.round(sy), s * 3, size * 0.5 | 1);
        ctx.fillRect(Math.round(sx), Math.round(sy) - s, size * 0.5 | 1, s * 3);
      }
    }
  }
  //#endregion

  //#region [ Clouds ]
  static CLOUD_KINDS = ['cumulus', 'towering', 'stratocumulus', 'stratus', 'altocumulus', 'cirrus'];

  /**
   * Procedural cloud. The kind picks the growth rule, so tall heaps, long layers and wisps come out of different
   * structures instead of one shape stretched into another box:
   *  - cumulus: a few big puffs grown into a dome over a flat base
   *  - towering: growth keeps climbing a central column (cauliflower tower)
   *  - stratocumulus: a long row of separate low clumps; gaps where its noise profile drops
   *  - stratus: a thin layer of many small puffs whose size follows a thin noise profile (scalloped top, flat base)
   *  - altocumulus: a patch of small cloudlets in loose wavy rows
   *  - cirrus: tapered curved strands with hooked tails (no puffs)
   * Animation: `morph` makes the puffs billow through the loop at `t` (`billow`), `fade` (0..1) draws the cloud
   * through a dithered screen door (`dithered`), so it fades in exact colors.
   * @param {{x, y, w, h, ramp: string[], rng, kind?: string, t?: number, morph?: boolean, fade?: number}} o - the box the cloud grows into; y + h is the base
   */
  static cloud(ctx, o) {
    const { x, y, w, h, ramp, rng, kind='cumulus', t=0, morph=false, fade=1, inv=false } = o;
    if(fade < 0.999) return Shapes.dithered(ctx, fade, [x - w * 0.1, y - h * 0.6, w * 1.2, h * 1.8], c => Shapes.cloud(c, { ...o, fade: 1 }), inv);
    if(kind === 'cirrus') return Shapes.cirrus(ctx, o);
    if(kind === 'altocumulus') return Shapes.altocumulus(ctx, o);
    const rule = Shapes.CLOUD_RULES[kind] ?? Shapes.CLOUD_RULES.cumulus;
    if(kind === 'stratus') {  // a layer cloud is 2-3 overlapping thin bands, back (higher, shorter) to front
      const layers = rng.int(2, 3);
      for(let l = 0; l < layers; l++) {
        const lw = w * rng.float(0.55, 0.95), lx = x + rng.float(0, w - lw), lh = h * rng.float(0.5, 0.7);
        const ly = y + (h - lh) * (l / Math.max(1, layers - 1));
        Shapes.shadePuffs(ctx, Shapes.growPuffs(lx, ly, lw, lh, rng, Shapes.cloudProfile(kind, rng), rule), ramp, ly + lh, lh * rule.under);
      }
      return;
    }
    const puffs = Shapes.growPuffs(x, y, w, h, rng, Shapes.cloudProfile(kind, rng), rule);
    Shapes.shadePuffs(ctx, morph? Shapes.billow(puffs, x, y, w, h, t): puffs, ramp, y + h, h * rule.under);
  }

  /**
   * Billowing heap over one loop: every puff swells and shrinks on its own phase (a wave rolling across the cloud),
   * drifting a little sideways and up as it swells; the higher a puff sits, the more it moves, so the base stays calm.
   */
  static billow(puffs, x, y, w, h, t) {
    return puffs.map(([px, py, r], i) => {
      const ph = (px - x) / w * Shapes.TAU + i * 0.9, up = Math.max(0, Math.min(1, (y + h - py) / h));
      const s = Shapes.wave(t, 1, ph);
      return [px + r * 0.12 * up * Shapes.wave(t, 1, ph + 1.9), py - r * 0.08 * up * (1 + s), r * (1 + (0.05 + 0.09 * up) * s)];
    });
  }

  /**
   * Runs draw(c) on an offscreen copy of the box [x, y, w, h], then copies it over through a 4x4 Bayer screen door
   * that keeps `alpha` (0..1) of its pixels: a dithered fade in exact colors, the pattern fixed to the screen.
   * `inv` flips the thresholds, so fades at alpha and 1 - alpha (one inverted) split the pixels between them: a
   * crossfade with no pixel drawn twice.
   */
  static dithered(ctx, alpha, [bx, by, bw, bh], draw, inv=false) {
    if(alpha >= 0.999) return draw(ctx);  // all 16 levels kept: draw straight, the same as an unfaded frame (loop seams)
    if(alpha <= 0.001) return;
    const X0 = Math.floor(bx), Y0 = Math.floor(by), w = Math.ceil(bx + bw) - X0, h = Math.ceil(by + bh) - Y0;
    if(w <= 0 || h <= 0) return;
    const cv = Shapes.scratch(w, h), c = cv.getContext('2d'), B = Shapes.BAYER4;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
    c.setTransform(1, 0, 0, 1, -X0, -Y0);
    draw(c);
    c.restore();
    const img = c.getImageData(0, 0, w, h), px = new Uint32Array(img.data.buffer);
    for(let j = 0; j < h; j++)
      for(let i = 0, row = ((Y0 + j) & 3) * 4; i < w; i++) {
        const v = B[row + ((X0 + i) & 3)] + 0.5;
        if((inv? 1 - v: v) >= alpha) px[j * w + i] = 0;
      }
    c.putImageData(img, 0, 0);
    ctx.drawImage(cv, 0, 0, w, h, X0, Y0, w, h);
  }

  /** Per kind: base puff radius as a share of the local profile height, puff cap, underside shadow (share of h). */
  static CLOUD_RULES = {
    cumulus      : { rf: 0.4,  max: 50, under: 0.1,  kids: 0.45, shrink: [0.62, 0.88], spread: 0.6 },
    towering     : { rf: 0.32, max: 90, under: 0.06, kids: 0.65, shrink: [0.55, 0.85], spread: 0.85 },
    stratocumulus: { rf: 0.48, max: 70, under: 0.16, kids: 0.4,  shrink: [0.6, 0.88],  spread: 0.6 },
    stratus      : { rf: 0.5,  max: 60, under: 0.22, kids: 0.3,  shrink: [0.65, 0.9],  spread: 0.5 }
  };

  /** Smooth random wave on 0..1 (sum of a few seeded sines), about -1..1. */
  static wobble(rng, freqs=[1.3, 2.9, 6.1]) {
    const parts = freqs.map((f, i) => [f * rng.float(0.8, 1.25), rng.float(0, Shapes.TAU), 1 / (i + 1)]);
    const norm = parts.reduce((a, p) => a + p[2], 0);
    return u => parts.reduce((a, [f, ph, amp]) => a + amp * Math.sin(Shapes.TAU * f * u + ph), 0) / norm;
  }

  /** Profile from round lobes [center, half-width, height] (u-space): the max of half-disc bumps. */
  static lobes(list) {
    return u => list.reduce((m, [c, rho, a]) => {
      const d = (u - c) / rho;
      return d * d < 1? Math.max(m, a * Math.sqrt(1 - d * d)): m;
    }, 0);
  }

  /** Target top-height profile across the cloud, u 0..1 -> share of the box height (0 = no cloud there). */
  static cloudProfile(kind, rng) {
    const n = Shapes.wobble(rng), gap = Shapes.wobble(rng, [2.1, 4.3]);
    const dome = u => Math.max(0, 1 - (2 * u - 1) ** 2);
    switch(kind) {
      case 'cumulus': {  // main lobe, shoulder lobes stepping down to both sides, small crown bumps, low skirt
        const c = rng.float(0.42, 0.58), rho = rng.float(0.26, 0.32), list = [[c, rho, 1], [0.5, 0.5, 0.22]];
        for(const side of [-1, 1]) {
          let at = c, a = 1, r = rho;
          for(let k = 0, n2 = rng.int(1, 3); k < n2; k++) {
            r *= rng.float(0.6, 0.8); a *= rng.float(0.55, 0.75);
            at += side * r * rng.float(1.1, 1.6);
            list.push([at, r, a]);
          }
        }
        for(let k = 0, n3 = rng.int(1, 3); k < n3; k++) list.push([c + rng.float(-0.6, 0.6) * rho, rho * rng.float(0.25, 0.4), rng.float(0.92, 1.06)]);
        const f = Shapes.lobes(list);
        return u => f(u) * (0.94 + 0.06 * n(u));
      }
      case 'towering': {  // cumulus body + a column of lobes stacking up, narrowing, with side bumps per level
        const c0 = rng.float(0.4, 0.6), list = [[0.5, 0.5, 0.22], [c0, 0.3, 0.45]];
        const levels = rng.int(3, 5);
        for(let j = 0; j < levels; j++) {
          const c = c0 + rng.float(-0.04, 0.04), rho = 0.17 - j * 0.02, a = 0.45 + (j + 1) * 0.55 / levels;
          list.push([c, rho, a]);
          if(rng.chance(0.7)) list.push([c + (rng.chance(0.5)? 1: -1) * rho * rng.float(0.7, 1), rho * 0.6, a - 0.08]);
        }
        for(const side of [-1, 1]) list.push([c0 + side * rng.float(0.25, 0.35), rng.float(0.12, 0.18), rng.float(0.3, 0.45)]);
        return Shapes.lobes(list);
      }
      case 'stratocumulus':
        return u => dome(u) ** 0.25 * (0.6 + 0.4 * n(u * 2.5)) * Math.max(0, Math.min(1, (gap(u * 2) + 0.35) * 3));
      case 'stratus':
        return u => dome(u) ** 0.3 * (0.7 + 0.3 * n(u * 1.5));
      default:
        return u => dome(u) ** 0.6 * (0.8 + 0.2 * n(u));
    }
  }

  /**
   * Grows puffs [x, y, r] into the box under a top profile: a base row sized by the local profile height,
   * then each puff that sits below the profile buds 1-2 smaller puffs upward, leaning toward the higher side,
   * until the silhouette reaches the profile (lumpy, never past it by much).
   */
  static growPuffs(x, y, w, h, rng, profile, { rf=0.42, max=50, kids: pKids=0.4, shrink=[0.68, 0.92], spread=0.5 }={}) {
    const base = y + h, puffs = [];
    if(w <= 0 || h <= 0) return puffs;
    const clamp = u => Math.max(0, Math.min(1, u));
    const top = u => base - profile(clamp(u)) * h;
    const minR = Math.max(1.2, h * 0.04);
    for(let u = 0; u < 1; ) {
      const ht = profile(u) * h;
      if(ht < minR * 1.5) { u += 0.01; continue; }
      const r = Math.max(minR, ht * rf * rng.float(0.85, 1.15));
      puffs.push([x + u * w, base - r * 0.6, r]);
      u += Math.max(0.004, r * rng.float(0.9, 1.3) / w);
    }
    for(let i = 0; i < puffs.length && puffs.length < max; i++) {
      const [px, py, pr] = puffs[i];
      const u = (px - x) / w;
      if(py - pr <= top(u) + pr * 0.25) continue;  // already reaches the profile here
      const kids = rng.chance(pKids)? 2: 1;
      const lean = Math.max(-0.6, Math.min(0.6, (top(u - 0.05) - top(u + 0.05)) / (h * 0.2)));
      for(let k = 0; k < kids; k++) {
        const th = lean * 0.6 + rng.float(-spread, spread) + (kids === 2? (k? 0.35: -0.35): 0);
        const cr = Math.max(minR, pr * rng.float(shrink[0], shrink[1]));
        const cx = px + Math.sin(th) * pr * 0.8, cy = py - Math.cos(th) * pr * 0.8;
        if(cy - cr < top((cx - x) / w) - cr * 0.35) continue;  // would overshoot the profile
        puffs.push([cx, cy, cr]);
      }
    }
    return puffs;
  }

  /**
   * Shades a puff mass: dark union, every puff raised and lit in the mid tone (dark crescents stay under each puff),
   * light caps on the upper puffs, then a flat dark underside band; everything clipped flat at the base.
   */
  static shadePuffs(ctx, puffs, ramp, base, under) {
    if(!puffs.length) return;
    const dark = ramp[0], mid = ramp[Math.min(1, ramp.length - 1)], light = ramp[ramp.length - 1];
    let topY = Infinity, minX = Infinity, maxX = -Infinity;
    for(const [cx, cy, r] of puffs) { topY = Math.min(topY, cy - r); minX = Math.min(minX, cx - r); maxX = Math.max(maxX, cx + r); }
    const span = Math.max(1, base - topY);
    ctx.save();
    ctx.beginPath(); ctx.rect(minX - 2, topY - 2, maxX - minX + 4, base - topY + 2); ctx.clip();  // flat base
    const body = Shapes.circlesPath(puffs);
    ctx.fillStyle = dark;
    ctx.fill(body);
    ctx.clip(body);
    // mid: every puff lifted toward the light (its own crescent) plus a whole-mass shift (volume read)
    // light: lobes on the upper puffs, shifted further, so the top-left of the mass reads sunlit
    const lit = new Path2D(), cap = new Path2D(), gx = span * 0.04, gy = span * 0.08;
    for(const [cx, cy, r] of puffs) {
      const mx = cx - r * 0.08 - gx, my = cy - r * 0.18 - gy;
      lit.moveTo(mx + r * 0.9, my); lit.arc(mx, my, r * 0.9, 0, Shapes.TAU);
      if((cy - topY) / span < 0.6) {
        const lx = cx - r * 0.24 - gx * 1.6, ly = cy - r * 0.34 - gy * 1.6;
        cap.moveTo(lx + r * 0.68, ly); cap.arc(lx, ly, r * 0.68, 0, Shapes.TAU);
      }
    }
    ctx.fillStyle = mid; ctx.fill(lit);
    ctx.fillStyle = light; ctx.fill(cap);
    ctx.fillStyle = dark;
    ctx.fillRect(minX - 2, base - Math.max(1, under), maxX - minX + 4, Math.max(1, under));
    ctx.restore();
  }

  /** Altocumulus: a patch of small cloudlets in loose wavy rows, smaller toward the patch edge. */
  static altocumulus(ctx, { x, y, w, h, ramp, rng }) {
    const rows = rng.int(2, 4), tilt = rng.float(-0.08, 0.08);
    for(let r = 0; r < rows; r++) {
      const v = (r + 0.5) / rows, n = rng.int(3, 6), shift = rng.float(-0.5, 0.5) * w / n;
      for(let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const edge = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        const skip = rng.chance(0.15), jx = rng.float(-0.15, 0.15), sz = rng.float(0.35, 0.5);
        if(edge < 0.25 || skip) continue;
        const cw = w / n * 0.95 * (0.55 + 0.45 * edge), ch = cw * sz;
        const cx = x + u * w + shift + jx * w / n, base = y + v * h + Math.sin(u * Math.PI * 2) * h * 0.06 + (u - 0.5) * w * tilt;
        const puffs = Shapes.growPuffs(cx - cw / 2, base - ch, cw, ch, rng, Shapes.cloudProfile('cumulus', rng), { rf: 0.45, max: 12 });
        Shapes.shadePuffs(ctx, puffs, ramp, base, ch * 0.15);
      }
    }
  }

  /**
   * Cirrus: tapered curved strands with hooked tails, in the cloud ramp's lower tones (never its lightest, the sun's
   * kind of color), so the wisps stay faint. Each strand lies on a fixed wavy line across the sky (screen x), so as
   * the cloud drifts the strand slides along that line and its curve reshapes, like it is following a path.
   */
  static cirrus(ctx, { x, y, w, h, ramp, rng }) {
    const n0 = ramp.length, body = ramp[Math.max(0, n0 - 2)], under = ramp[Math.max(0, n0 - 3)];
    const strands = rng.int(2, 5);
    for(let i = 0; i < strands; i++) {
      const sx = x + rng.float(0, 0.3) * w, sy = y + rng.float(0.15, 0.85) * h, len = w * rng.float(0.5, 0.95);
      const th = Math.max(1.5, h * rng.float(0.1, 0.2)), bend = rng.float(-0.3, 0.3) * h;
      const hook = rng.float(0.2, 0.45) * h * (rng.chance(0.5)? 1: -1), n = 28;
      const lam = len * rng.float(1.2, 2), ph = rng.float(0, Shapes.TAU);  // the strand's line: a wave in screen x
      const pts = [];
      for(let k = 0; k <= n; k++) {
        const u = k / n, X = sx + u * len;
        pts.push([X, sy + Math.sin(Shapes.TAU * X / lam + ph) * bend + u ** 4 * hook, th * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.02)) ** 0.6]);
      }
      const ribbon = (from, to) => {  // from/to: share of the thickness, -0.5 = top edge .. 0.5 = bottom edge
        ctx.beginPath();
        pts.forEach(([px, py, tk], k) => k? ctx.lineTo(px, py + tk * from): ctx.moveTo(px, py + tk * from));
        for(let k = pts.length - 1; k >= 0; k--) ctx.lineTo(pts[k][0], pts[k][1] + pts[k][2] * to);
        ctx.closePath();
        ctx.fill();
      };
      ctx.fillStyle = under; ribbon(-0.5, 0.5);
      ctx.fillStyle = body;  ribbon(-0.5, 0.15);
    }
  }

  /** Cloud bank from a turbulence field: stacked thresholds give flat bands (topographic look), edged per pixel. */
  static cloudBank(ctx, { x, y, w, h, ramp, noise, t=0, scale=3, base=0.25, step=4 }) {
    // the field is sampled on a grid every `step` px and read per pixel through bilinear interpolation, so the band
    // edges come out at the frame's own pixel size whatever the field's grain
    const g = Math.max(1, step), gw = Math.ceil(w / g) + 2, gh = Math.ceil(h / g) + 2, f = new Float32Array(gw * gh);
    const ox = Math.cos(Shapes.TAU * t) * 0.5, oy = Math.sin(Shapes.TAU * t) * 0.5;
    for(let j = 0; j < gh; j++)
      for(let i = 0; i < gw; i++) {
        const px = i * g, py = j * g;  // denser at the top
        f[j * gw + i] = noise.turbulence(px / w * scale + ox, py / h * scale * 0.45 + oy, 3) * (1 - (py / h) * 0.8) + (1 - py / h) * 0.15;
      }
    const X0 = Math.floor(x), Y0 = Math.floor(y), bw = Math.ceil(x + w) - X0, bh = Math.ceil(y + h) - Y0;
    if(bw <= 0 || bh <= 0) return;
    const tones = ramp.map(Shapes.rgba32), levels = tones.length;
    const cv = Shapes.scratch(bw, bh), c = cv.getContext('2d');
    const img = c.createImageData(bw, bh), out = new Uint32Array(img.data.buffer);
    for(let j = 0; j < bh; j++) {
      const gy = (Y0 + j + 0.5 - y) / g, j0 = Math.max(0, Math.min(gh - 2, Math.floor(gy))), fy = gy - j0;
      for(let i = 0; i < bw; i++) {
        const gx = (X0 + i + 0.5 - x) / g, i0 = Math.max(0, Math.min(gw - 2, Math.floor(gx))), fx = gx - i0, k = j0 * gw + i0;
        const n = (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + gw] * (1 - fx) + f[k + gw + 1] * fx) * fy;
        let lv = -1;
        for(let l = 0; l < levels; l++) if(n > base + l * 0.07) lv = l;
        if(lv >= 0) out[j * bw + i] = tones[lv];
      }
    }
    c.putImageData(img, 0, 0);
    ctx.drawImage(cv, 0, 0, bw, bh, X0, Y0, bw, bh);
  }
  //#endregion

  //#region [ Plants ]
  /**
   * Bush: a dark leafy dome; when its leaves are big enough to read (>= 3.5 px), stems fanned from the base carry
   * leaf sprays over it in layers of color (lit side forward) and the outer leaves break the silhouette.
   * Small bushes stay one shaded crown. Flat bottom on the ground (y + h).
   */
  static bush(ctx, { x, y, w, h, ramp, rng, t=0 }) {
    const size = w * 0.11, sprays = size >= 3.5;
    const cx = x + w / 2, base = y + h;
    ctx.save();
    ctx.beginPath(); ctx.rect(x - w, y - h * 2, w * 3, h * 3); ctx.clip();
    Shapes.crown(ctx, { x: cx, y: base + h * 0.15, w: w * (sprays? 0.92: 1), h: h * (sprays? 1.05: 1.2), form: 'spread', edge: 0.3,
      ramp: sprays? [ramp[0]]: ramp, rng });
    if(sprays) {
      const twigs = [], n = rng.int(6, 9);
      for(let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 1.9 + rng.float(-0.12, 0.12);
        const { limbs } = Shapes.grow(cx + Math.cos(a) * w * 0.1, base, a, h * rng.float(0.4, 0.62), 1.5, 2, rng, t,
          { spread: 0.6, from: 0.3, sides: 1.5, fork: 0.3, rise: 0.05, curl: 0.3, sway: 0.03 });
        twigs.push(...limbs);
      }
      Shapes.sprays(ctx, twigs, ramp, rng, { size, t, center: [cx, base - h * 0.55] });
    }
    ctx.restore();
  }

  /** Wildflowers: tiny plus-shaped blooms on short stems, nearer ones bigger, nodding in whole cycles. */
  static flowers(ctx, { x=0, y, w, h, colors, stem, center, rng, t=0, count=40, size=2 }) {
    for(let i = 0; i < count; i++) {
      const fx = x + rng.float(0, w), fy = y + rng.float(0, 1) ** 0.7 * h;
      const c = rng.pick(colors), nod = Shapes.wave(t, 1, rng.float(0, 6));
      const s = Math.max(1, Math.round(size * (0.6 + 0.8 * (fy - y) / h)));
      ctx.fillStyle = stem;
      ctx.fillRect(Math.round(fx), Math.round(fy - s), Math.max(1, s >> 1), s * 2);
      const bx = Math.round(fx + nod * s * 0.6), by = Math.round(fy - s * 2);
      ctx.fillStyle = c;
      ctx.fillRect(bx - s, by, s, s); ctx.fillRect(bx + s, by, s, s);
      ctx.fillRect(bx, by - s, s, s); ctx.fillRect(bx, by + s, s, s);
      ctx.fillStyle = center;
      ctx.fillRect(bx, by, s, s);
    }
  }

  /** Almond leaf with optional vein. */
  static leaf(ctx, x, y, len, angle, color, vein=null) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(0, -len * 0.42, len / 2, 0);
    ctx.quadraticCurveTo(0, len * 0.42, -len / 2, 0);
    ctx.fill();
    if(vein) {
      ctx.strokeStyle = vein; ctx.lineWidth = Math.max(1, len * 0.06);
      ctx.beginPath(); ctx.moveTo(-len * 0.42, 0); ctx.lineTo(len * 0.4, 0); ctx.stroke();
    }
    ctx.restore();
  }

  /** Falling / scattered leaves. With `fall`, each leaf crosses the area a whole number of times per loop. */
  static scatterLeaves(ctx, { x=0, y=0, w, h, colors, rng, count=30, size=10, t=0, fall=false, vein=null, petal=false }) {
    for(let i = 0; i < count; i++) {
      let lx = rng.float(0, w), ly = rng.float(0, h);
      const len = size * rng.float(0.7, 1.3);
      let ang = rng.float(0, Shapes.TAU);
      const spin = rng.int(1, 2) * (rng.chance(0.5)? 1: -1), speed = rng.int(1, 2), ph = rng.float(0, 6);
      if(fall) {
        ly = (ly + t * speed * h) % h;
        lx = ((lx + Shapes.wave(t, speed * 2, ph) * size * 2 + t * w * (spin > 0? 1: -1)) % w + w) % w;  // whole widths per loop
        ang += Shapes.TAU * t * spin;
      }
      const c = rng.pick(colors), px = Math.round(x + lx), py = Math.round(y + ly);  // whole pixels: moving leaves only translate
      if(petal) Shapes.petal(ctx, px, py, len, ang, c);
      else Shapes.leaf(ctx, px, py, len, ang, c, vein);
    }
  }

  /** Heart-notched petal (sakura) */
  static petal(ctx, x, y, len, angle, color) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, len * 0.5);
    ctx.quadraticCurveTo(-len * 0.55, 0, -len * 0.2, -len * 0.5);
    ctx.lineTo(0, -len * 0.32);
    ctx.lineTo(len * 0.2, -len * 0.5);
    ctx.quadraticCurveTo(len * 0.55, 0, 0, len * 0.5);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Grass field: rows spread back -> front (back light and short, front dark and tall),
   * tufts of 3 tapered blades that sway in traveling gusts. `ramp` dark -> light. Each row stands on its own rolling
   * ground line (smooth noise, up to about half the gap between rows), so the bands swell and dip instead of running
   * straight, front rows rolling more often.
   */
  static grass(ctx, { x, y, w, h, ramp, rng, noise, t=0, rows=3, density=1, sway=1 }) {
    const gx = Math.cos(Shapes.TAU * t) * 0.8, gy = Math.sin(Shapes.TAU * t) * 0.8;
    const amp = (rows > 1? h * 0.75 / (rows - 1): h * 0.5) * 0.5, step = Math.max(2, w / 160);
    for(let r = 0; r < rows; r++) {
      const f = rows === 1? 1: r / (rows - 1);
      const rowY = y + h * (0.25 + 0.75 * f);
      const ph = r * 7.31 + 3.7, fq = 2.6 + r * 1.4;
      const ground = px => rowY + amp * (noise? noise.fbm1(ph + (px - x) / w * fq, 2): Math.sin((px - x) / w * fq * Shapes.TAU + ph));
      const bladeH = h * (0.18 + 0.3 * f);
      ctx.fillStyle = Shapes.pick(ramp, 1 - f);
      const tufts = Math.round(w / 7 * density);
      for(let i = 0; i < tufts; i++) {
        const bx = x + rng.float(-0.02, 1.02) * w, base = ground(bx);
        const gust = noise? noise.perlin3(bx / w * 2.5 + gx, r * 0.3 + gy, 0.5): 0;
        const lean0 = gust * 0.4 * sway + Shapes.wave(t, 2, bx * 0.05) * 0.05 * sway;
        const size = rng.float(0.6, 1);
        for(let b = -1; b <= 1; b++) {
          const bh = bladeH * size * (b? rng.float(0.6, 0.85): 1);
          const bw = Math.max(1.5, bh * 0.14);
          const tip = (lean0 + b * 0.28 + rng.float(-0.06, 0.06)) * bh;
          const bxx = bx + b * bw * 0.6;
          ctx.beginPath();
          ctx.moveTo(bxx - bw / 2, base + 2);
          ctx.quadraticCurveTo(bxx - bw / 4 + tip * 0.2, base - bh * 0.55, bxx + tip, base - bh);
          ctx.quadraticCurveTo(bxx + bw / 4 + tip * 0.2, base - bh * 0.5, bxx + bw / 2, base + 2);
          ctx.fill();
        }
      }
      const p = new Path2D();  // the row's ground, down to the field's bottom
      p.moveTo(x, y + h + 1);
      for(let px = x; px < x + w + step; px += step) p.lineTo(Math.min(px, x + w), ground(Math.min(px, x + w)));
      p.lineTo(x + w, y + h + 1);
      p.closePath();
      ctx.fill(p);
    }
  }
  //#endregion

  //#region [ Water ]
  /** Cached Noise per key (water and glint layers build theirs on demand). */
  static noiseFor(key) {
    Shapes.noiseCache ??= new Map();
    if(!Shapes.noiseCache.has(key)) Shapes.noiseCache.set(key, new Noise(key));
    return Shapes.noiseCache.get(key);
  }

  /**
   * Looping 1D noise, about -1..1: `a` walks along the noise, `t` circles in the other two axes so t = 0 and
   * t = 1 give the same value, and `ch` selects an independent channel.
   */
  static loopNoise(nz, a, ch, t, r=0.6) {
    const ang = Shapes.TAU * t;
    return nz.perlin3(a + Math.cos(ang) * r, ch + Math.sin(ang) * r, ch * 0.37 + 0.5) * 1.6;
  }

  /**
   * Water body: depth bands with wavy noise edges (lighter toward the horizon), thin wavy shimmer streaks that
   * grow and fade smoothly, and an optional light path under `glint` {x, w, color, dim?} (see `glint`).
   */
  static water(ctx, { x, y, w, h, ramp, rng, t=0, bands=4, dashes=40, glint=null }) {
    const nz = Shapes.noiseFor('water:' + rng.int(1, 1e6));
    const step = Math.max(2, w / 160);
    const body = ramp.slice(0, Math.max(1, ramp.length - 1));  // the lightest tone is kept for the shimmer
    for(let i = 0; i < bands; i++) {
      ctx.fillStyle = Shapes.pick(body, 1 - i / bands);
      const by = y + h * (i / bands) ** 1.6;
      if(i === 0) { ctx.fillRect(x, by, w, y + h - by); continue; }
      const amp = Math.max(1, h * 0.015 * (1 + i * 0.6));  // nearer band edges wave more
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      for(let px = 0; px <= w + step; px += step)
        ctx.lineTo(x + px, by + amp * Shapes.loopNoise(nz, px / w * (5 + i * 2), i * 3.1, t, 0.45));
      ctx.lineTo(x + w + step, y + h);
      ctx.fill();
    }

    const light = ramp[ramp.length - 1], soft = Shapes.pick(ramp, 0.6);
    ctx.lineCap = 'butt';
    for(let i = 0; i < dashes; i++) {
      // every random value first, so frames stay in sync whatever is skipped
      const f = rng.float(0, 1) ** 1.4;  // more, shorter streaks toward the horizon
      const sy = y + f * h, sx = x + rng.float(0, 1) * w;
      const len = w * rng.float(0.03, 0.08) * (0.4 + f);
      const ch = rng.float(0, 50), bright = rng.chance(0.45);
      const L = len * Math.max(0, Math.min(1, 0.45 + Shapes.loopNoise(nz, ch, 21.7, t, 0.7)));  // grows and fades
      if(L < 1.5) continue;
      const drift = Shapes.loopNoise(nz, ch + 3.3, 9.1, t, 0.5) * len * 0.4;  // slides sideways in place
      const th = Math.max(1, h * 0.012 * (0.5 + f));
      ctx.strokeStyle = bright? light: soft;
      ctx.lineWidth = th;
      ctx.beginPath();
      const n = Math.max(3, Math.round(L / 2));
      for(let k = 0; k <= n; k++) {
        const px = sx + drift + (k / n - 0.5) * L;
        const py = sy + th * 0.9 * nz.perlin3(px / w * 40, ch, 1.5) * 1.6;  // the streak itself is a small wave
        k? ctx.lineTo(px, py): ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    if(glint) Shapes.glint(ctx, { dim: light, ...glint, y, h, t, noise: nz });
  }

  /**
   * Light path on water under a sun, moon or lit window, drawn row by row from continuous looping noise:
   * the column axis wanders, each row's lit width follows a noise wave down the depth (so streaks are
   * lens-shaped and break apart smoothly, more toward the viewer), and a bright core sits inside a dimmer band.
   * @param {{x, w, y, h, color, dim, t?, noise: Noise, ch?: number}} o - w = source width (about the disc); the path widens to 1.5 w
   */
  static glint(ctx, { x, w, y, h, color, dim, t=0, noise, ch=0 }) {
    const rows = Math.max(1, Math.round(h));
    for(let r = 0; r < rows; r++) {
      const f = r / rows;
      const hw = w * 0.5 * (0.7 + 0.8 * f);
      const s = Shapes.loopNoise(noise, f * 16, 4.4 + ch, t, 0.8);  // streak strength along the depth
      const span = hw * Math.max(0, Math.min(1, 0.85 + s * 1.1 - f * 0.5));  // solid near the horizon, opens up toward the viewer
      if(span < 0.5) continue;
      const cx = x + Shapes.loopNoise(noise, f * 3, 11.1 + ch, t, 0.4) * hw * 0.3   // the axis wanders
                   + Shapes.loopNoise(noise, f * 9, 8.8 + ch, t, 0.6) * hw * 0.25;  // each streak slides
      ctx.fillStyle = dim;
      ctx.fillRect(cx - span, y + r, span * 2, 1);
      const core = span * (0.3 + 0.25 * s);
      if(core < 0.5) continue;
      ctx.fillStyle = color;
      ctx.fillRect(cx - core, y + r, core * 2, 1);
    }
  }

  /**
   * Sea swell rows, far -> near: each row is a flat band whose top is a sum of two sines (rolling, not scalloped),
   * with a lighter crest strip and broken foam dashes riding the highest crests. Far rows are thin and pale.
   * Phases advance whole cycles per loop.
   */
  static waves(ctx, { x, y, w, h, ramp, foam, t=0, rows=5, rng }) {
    for(let r = 0; r < rows; r++) {
      const f = r / Math.max(1, rows - 1);
      const baseY = y + h * (0.06 + 0.94 * f ** 1.4);
      const amp = h * (0.02 + 0.07 * f);
      const len = w * (0.05 + 0.13 * f);
      const dir = r % 2? 1: -1;
      const p1 = rng.float(0, 6) + Shapes.TAU * t * dir, p2 = rng.float(0, 6) - Shapes.TAU * t * 2 * dir;
      const swell = px => 0.65 * Math.sin(px / len * Math.PI * 2 + p1) + 0.35 * Math.sin(px / len * Math.PI * 4.6 + p2);
      const crest = px => baseY - amp * swell(px);
      const step = Math.max(2, w / 300);
      const body = Shapes.pick(ramp, (0.85 - f * 0.85) + (r % 2? 0.2: 0));  // alternate tones so rows separate
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      for(let px = 0; px <= w + step; px += step) ctx.lineTo(x + px, crest(px));
      ctx.lineTo(x + w + step, y + h);
      ctx.fill();
      // crest strip: one tone lighter, thicker on the high parts of the swell
      ctx.fillStyle = Shapes.pick(ramp, Math.min(1, 1.05 - f * 0.8));
      const th = Math.max(1, amp * 0.9);
      for(let px = 0; px <= w; px += step) {
        const s = swell(px);
        if(s > 0.15) ctx.fillRect(x + px, crest(px), step + 0.5, th * (0.4 + s));
      }
      if(!foam) continue;
      // foam: short dashes on the highest crests, seeded per row so they hold still between frames
      ctx.fillStyle = foam;
      const dashes = Math.round(w / len * 2);
      for(let i = 0; i < dashes; i++) {
        const px = rng.float(0, w), dl = len * rng.float(0.08, 0.25);
        const s = swell(px);
        if(s < 0.55) continue;
        ctx.fillRect(x + px - dl / 2, crest(px) - Math.max(1, amp * 0.15), dl * (s - 0.4), Math.max(1, amp * 0.22));
      }
    }
  }

  /**
   * Water drop on glass in whole pixels: a small blob, a bit taller than wide, its edge broken by per-pixel noise, the
   * lower rim one tone darker and a noisy 1-2 px glint up-left. `trail`: px of a broken wet streak above it (a sliding
   * drop). ramp dark -> light: rim, body, glint. `seed` keys the noise to the drop, so it keeps its shape as it moves.
   */
  static droplet(ctx, { x, y, r, ramp, seed=1, trail=0 }) {
    const n = ramp.length, tones = [ramp[0], ramp[Math.min(1, n - 1)], ramp[n - 1]];
    const R = Math.max(0.8, r), sy = 1.25, cx = Math.round(x), cy = Math.round(y), ext = Math.ceil(R * sy) + 1;
    const hash = (i, j) => {
      let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed | 0, 1103515245);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const px = [new Path2D(), new Path2D(), new Path2D()];
    for(let j = -ext; j <= ext; j++)
      for(let i = -ext; i <= ext; i++) {
        const ox = (i + 0.5) / R, oy = (j + 0.5) / (R * sy), d = Math.hypot(ox, oy) + (hash(i, j) - 0.5) * 0.55;
        if(d >= 1) continue;
        const k = oy > 0.2 && d > 0.45? 0: ox < -0.1 && oy < -0.1 && d < 0.62 && hash(j, i) > 0.3? 2: 1;
        px[k].rect(cx + i, cy + j, 1, 1);
      }
    for(let j = 1; j <= trail; j++)  // the wet streak: broken, wobbling a pixel now and then
      if(hash(-99, j) > 0.3) px[1].rect(cx - (hash(j, 77) > 0.8? 0: 1), cy - ext - j + 1, 1, 1);
    px.forEach((p, k) => { ctx.fillStyle = tones[k]; ctx.fill(p); });
  }

  /**
   * Rain by color cycling (Mark Ferrari's trick): `count` fixed slanted lines across the area, each a repeating pattern
   * `period` px long holding one drop of about `len` px (its lowest pixel in `head`). Only the pattern's phase moves, a
   * whole number of periods per loop (about `speed` heights), so every frame is the same lines in exact whole pixels
   * with the drops stepping down them: crisp, nothing re-rasterized, seamless at the loop.
   */
  static rain(ctx, { x=0, y=0, w, h, color, head=color, rng, t=0, count=80, len=14, slant=0.2, speed=3 }) {
    const body = new Path2D(), tip = new Path2D();
    for(let i = 0; i < count; i++) {
      const x0 = rng.float(0, w), period = Math.max(len + 6, Math.round(h * rng.float(0.22, 0.45))), off = rng.int(0, period - 1);
      const laps = Math.max(1, Math.round(speed * rng.float(0.8, 1.25) * h / period));  // whole periods per loop
      const dl = Math.max(2, Math.round(len * rng.float(0.6, 1.1)));
      const s = Math.round(t * period * laps) % period;  // rounded, so t -> 1 lands on the t = 0 phase
      for(let k = ((s + off) % period) - period; k < h; k += period)  // k: top row of each drop on this line
        for(let j = Math.max(0, k); j < Math.min(h, k + dl); j++)
          (j === k + dl - 1? tip: body).rect(x + Math.floor(((x0 + j * slant) % w + w) % w), y + j, 1, 1);
    }
    ctx.fillStyle = color; ctx.fill(body);
    ctx.fillStyle = head; ctx.fill(tip);
  }
  //#endregion

  //#region [ Terrain ]
  /**
   * Mountain range from explicit peaks and valleys joined by midpoint-displaced slopes.
   * Each peak gets a flat shadow face on its right (light from the left) and an optional snow cap.
   * @param {{x?, y, w, h, bottom, color, shade?, snow?, snowLine?, noise?: Noise, style?: 'ridged'|'smooth'|'jagged', freq?, seedX?, haze?}} o
   * y = highest possible peak, h = vertical room for peaks. haze: {color, y0, y1, t?, breathe?}, a `mist` band at the base.
   */
  static mountains(ctx, o) {
    const { x=0, y, w, h, bottom, color, shade=null, snow=null, snowLine=0.16, style='ridged', freq=3, seedX=0, haze=null } = o;
    const rng = new Rng(`m${seedX}:${freq}:${style}`);
    const rough = style === 'jagged'? 0.3: style === 'ridged'? 0.18: 0.06;
    const count = Math.max(2, Math.round(freq * 1.4));
    // peaks and valleys alternate across the width (a little past both edges)
    const keys = [];
    for(let i = -1; i <= count; i++) {
      const px = x + w * (i + 0.5 + rng.float(-0.25, 0.25)) / count;
      const ph = y + h * (1 - rng.float(0.45, 1) * (style === 'smooth'? 0.7: 1));
      if(keys.length) {
        const prev = keys[keys.length - 1];
        const low = Math.max(prev[1], ph);
        keys.push([(prev[0] + px) / 2 + rng.float(-0.1, 0.1) * w / count, low + (y + h - low) * rng.float(0.3, 0.8), 'v']);
      }
      keys.push([px, ph, 'p']);
    }
    // midpoint displacement between key points
    const pts = [];
    const subdivide = (a, b, depth) => {
      if(depth === 0) return;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + rng.float(-1, 1) * len * rough];
      subdivide(a, m, depth - 1); pts.push(m); subdivide(m, b, depth - 1);
    };
    const peaks = [];
    keys.forEach((k, i) => {
      if(k[2] === 'p') peaks.push(pts.length);
      pts.push([k[0], k[1]]);
      if(i < keys.length - 1) subdivide(k, keys[i + 1], style === 'smooth'? 3: 4);
    });
    const line = style === 'smooth'? Shapes.chaikin(pts, 2): pts;

    const sil = new Path2D();
    sil.moveTo(line[0][0], bottom);
    for(const [px, py] of line) sil.lineTo(px, py);
    sil.lineTo(line[line.length - 1][0], bottom);
    sil.closePath();
    ctx.fillStyle = color;
    ctx.fill(sil);
    if(!shade && !snow && !haze) return line;

    ctx.save();
    ctx.clip(sil);
    if(snow) {
      ctx.fillStyle = snow;
      for(const pi of peaks) {
        const [px, py] = pts[pi];
        if(py > y + h * 0.5) continue;  // low peaks stay bare
        const capH = (bottom - py) * snowLine * rng.float(0.6, 1), span = capH * 2.6;
        const r = Array.from({ length: 10 }, () => rng.float(0, 1));  // as many draws as the old drip teeth, so the faces below keep their shapes
        // snow line: a soft bow (the path, far gentler than the ridge) with small sharp teeth along it, drips a bit longer
        const sag = 0.1 + 0.1 * r[0], tilt = (r[1] - 0.5) * 0.16, teeth = 14;
        ctx.beginPath();
        ctx.moveTo(px - span, py - capH * 4);  // silhouette clip forms the top
        for(let k = 0; k <= teeth; k++) {
          const u = k / teeth * 2 - 1, a = capH * (0.07 + 0.11 * r[2 + k % 8]);
          ctx.lineTo(px + span * u, py + capH * (0.85 + sag * (1 - u * u) + tilt * u) + (k % 2? a: -a * 0.6));
        }
        ctx.lineTo(px + span, py - capH * 4);
        ctx.closePath();
        ctx.fill();
      }
    }
    if(shade) {
      ctx.fillStyle = shade;
      for(let n = 0; n < peaks.length; n++) {
        const i = peaks[n], j = n < peaks.length - 1? Math.round((peaks[n] + peaks[n + 1]) / 2): pts.length - 1;
        const [px, py] = pts[i];
        const p = new Path2D();
        p.moveTo(px, py);
        for(let k = i; k <= j; k++) p.lineTo(pts[k][0], pts[k][1]);
        // inner edge: from a point under the valley back up to the peak, jagged
        const [vx, vy] = pts[j];
        const footX = px + (vx - px) * rng.float(0.15, 0.45), footY = vy + (vy - py) * rng.float(0.2, 0.6);
        p.lineTo(vx, footY);
        p.lineTo(footX, footY);
        for(let k = 1; k < 5; k++) {
          const f = k / 5;
          p.lineTo(footX + (px - footX) * f + rng.float(-1, 1) * (footY - py) * 0.05, footY + (py - footY) * f);
        }
        p.closePath();
        ctx.fill(p);
      }
    }
    if(haze) Shapes.mist(ctx, { ...haze, x, w, bottom });  // haze band at the base (already clipped to the range)
    ctx.restore();
    return line;
  }

  /** Chaikin corner cutting (smooths a polyline, keeps the ends). */
  static chaikin(pts, iterations=1) {
    let out = pts;
    for(let it = 0; it < iterations; it++) {
      const next = [out[0]];
      for(let i = 0; i < out.length - 1; i++) {
        const [ax, ay] = out[i], [bx, by] = out[i + 1];
        next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
      }
      next.push(out[out.length - 1]);
      out = next;
    }
    return out;
  }

  /**
   * Sea cliff / headland seen from the side: rounded grassy top, a face of 3 receding rock tiers
   * (lit ledges, shadowed risers), rocks at the waterline with a foam ring that pulses over the loop.
   * @param {{left: boolean, w, top, sea, bottom, reach, color, shade, rim?, grass?, foam?, rng, t?}} o
   */
  static cliff(ctx, { left=true, w, top, sea, bottom, reach, color, shade, rim=null, grass=null, foam=null, rng, t=0 }) {
    const X = v => left? v: w - v;  // mirror for a right-side cliff
    const H = sea - top;
    const lip = reach * rng.float(0.55, 0.7);
    // top surface: slight rise toward the lip, rounded over the edge
    const topPts = [];
    for(let i = 0; i <= 8; i++) {
      const f = i / 8;
      topPts.push([lip * f, top + H * (0.06 * Math.sin(f * Math.PI) * -1 + rng.float(-0.015, 0.015) + 0.04 * f * f)]);
    }
    // face: steep under the lip, easing out into a talus slope at the waterline; jagged, with 1-2 lit ledges
    const face = [];
    const n = 12, run = reach - lip, y0 = topPts[8][1];
    const ledgeAt = [rng.int(3, 6), rng.chance(0.6)? rng.int(7, 9): -1];
    let shift = 0;
    for(let i = 1; i <= n; i++) {
      const f = i / n, fy = y0 + (sea - y0) * f;
      const fxi = () => lip + shift + run * 0.55 * f ** 2.2;
      const jag = rng.float(-1, 1) * run * 0.08;
      face.push([fxi() + jag, fy]);
      if(ledgeAt.includes(i)) {
        shift += run * rng.float(0.12, 0.2);
        face.push([fxi() + jag, fy + H * 0.012]);
      }
    }
    const fx = face[face.length - 1][0];
    const all = [[-4, top], ...topPts, ...face, [fx + reach * 0.05, bottom], [-4, bottom]];
    const sil = new Path2D();
    all.forEach(([x, y], i) => i? sil.lineTo(X(x), y): sil.moveTo(X(x), y));
    sil.closePath();
    ctx.fillStyle = color;
    ctx.fill(sil);

    ctx.save();
    ctx.clip(sil);
    // risers in shadow: a band just inside the face line
    ctx.fillStyle = shade;
    const sh = new Path2D();
    const back = reach * 0.07;
    sh.moveTo(X(lip), topPts[8][1]);
    face.forEach(([x, y]) => sh.lineTo(X(x), y));
    sh.lineTo(X(fx + reach * 0.05), bottom);
    sh.lineTo(X(fx - back), bottom);
    for(let i = face.length - 1; i >= 0; i--) sh.lineTo(X(face[i][0] - back * (0.7 + 0.6 * ((i * 7) % 5) / 4)), face[i][1] + H * 0.02);
    sh.lineTo(X(lip - back), topPts[8][1] + H * 0.05);
    sh.closePath();
    ctx.fill(sh);
    // cracks / strata on the lit wall
    for(let i = 0; i < 7; i++) {
      const cy = top + H * rng.float(0.15, 1.2), cx = rng.float(0.05, 0.8) * lip, cw = lip * rng.float(0.08, 0.2);
      ctx.fillRect(Math.min(X(cx), X(cx + cw)), cy, cw, Math.max(1, H * 0.012));
    }
    // lit ledges
    if(rim) {
      ctx.fillStyle = rim;
      for(let i = 0; i < face.length - 1; i++) {
        const [ax, ay] = face[i], [bx, by] = face[i + 1];
        if(Math.abs(by - ay) < H * 0.03 && bx > ax) ctx.fillRect(Math.min(X(ax - back), X(bx)), ay - 1, Math.abs(bx - ax) + back, Math.max(2, H * 0.025));
      }
    }
    ctx.restore();

    // grass cap: thick band over the top plus tufts hanging over the lip
    if(grass) {
      ctx.fillStyle = grass;
      const cap = Math.max(3, H * 0.06);
      ctx.beginPath();
      ctx.moveTo(X(-4), topPts[0][1] - 1);
      topPts.forEach(([x, y]) => ctx.lineTo(X(x), y - 1));
      for(let i = topPts.length - 1; i >= 0; i--) {
        const [x, y] = topPts[i];
        ctx.lineTo(X(x), y + cap * (i === topPts.length - 1? 1.8: rng.float(0.7, 1.3)));
      }
      ctx.lineTo(X(-4), topPts[0][1] + cap);
      ctx.fill();
    }
    // waterline rocks + foam
    for(let i = 0; i < 4; i++) {
      const rx = fx + reach * rng.float(-0.04, 0.12), rr = H * rng.float(0.04, 0.09);
      const pulse = 1 + 0.25 * Math.max(0, Shapes.wave(t, 2, i * 1.3));
      if(foam) {
        ctx.fillStyle = foam;
        ctx.beginPath(); ctx.ellipse(X(rx), sea + rr * 0.3, rr * 1.6 * pulse, rr * 0.45 * pulse, 0, 0, Shapes.TAU); ctx.fill();
      }
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.ellipse(X(rx), sea, rr, rr * 0.75, 0, Math.PI, Shapes.TAU); ctx.fill();
    }
  }

  /**
   * City skyline: stepped rectangular towers with roof details; optional lit windows that blink in whole cycles.
   * @param {{x?, y, w, h, bottom, color, lit?: string[], rng, t?, minW?, maxW?}} o - y = tallest roof line, h = height range
   */
  static skyline(ctx, { x=0, y, w, h, bottom, color, lit=null, rng, t=0, minW=0.03, maxW=0.08 }) {
    ctx.fillStyle = color;
    const towers = [], sil = new Path2D();  // towers.sil: the whole skyline as one path (to clip haze to it)
    for(let bx = x - w * 0.02; bx < x + w; ) {
      const tw = w * rng.float(minW, maxW);
      const top = y + h * rng.float(0, 1) ** 0.7;
      towers.push([bx, top, tw]);
      sil.rect(bx, top, tw + 1, bottom - top);
      const roof = rng.int(0, 4);
      if(roof === 1) sil.rect(bx + tw * 0.2, top - h * 0.08, tw * 0.6, h * 0.08);                 // setback
      if(roof === 2) sil.rect(bx + tw * 0.45, top - h * 0.18, Math.max(1, tw * 0.08), h * 0.18);  // antenna
      if(roof === 3) { sil.moveTo(bx, top); sil.lineTo(bx + tw / 2, top - tw * 0.5); sil.lineTo(bx + tw, top); sil.closePath(); }
      bx += tw * rng.float(0.85, 1.1);
    }
    ctx.fill(sil);
    towers.sil = sil;
    if(!lit) return towers;
    const cell = Math.max(2, w / 160);
    for(const [bx, top, tw] of towers) {
      const cols = Math.floor(tw / (cell * 2));
      for(let wy = top + cell * 2; wy < bottom - cell * 2; wy += cell * 2.2)
        for(let c = 0; c < cols; c++) {
          const on = rng.float(0, 1), blink = Shapes.wave(t, rng.int(1, 3), rng.float(0, 6));
          const tone = rng.pick(lit);
          if(on < 0.72 || (on < 0.8 && blink < 0)) continue;
          ctx.fillStyle = tone;
          ctx.fillRect(Math.round(bx + cell * 0.6 + c * cell * 2), Math.round(wy), Math.ceil(cell), Math.ceil(cell));
        }
    }
    return towers;
  }

  /** Rolling hill band (smooth 1D noise), optional top highlight strip and `haze` ({color, y0, y1, ...}: a `mist` band at its base). */
  static hills(ctx, { x=0, y, w, h, bottom, color, rim=null, noise, freq=1.5, seedX=0, haze=null }) {
    const p = new Path2D();
    p.moveTo(x, bottom);
    const top = [], n = Math.max(1, Math.ceil(w / 4));
    for(let k = 0; k <= n; k++) {  // the last sample sits on the right edge, so the outline never drops early
      const px = w * k / n, py = y + h * (0.5 - 0.5 * noise.fbm1(seedX + px / w * freq, 2));
      top.push([x + px, py]);
      p.lineTo(x + px, py);
    }
    p.lineTo(x + w, bottom);
    p.closePath();
    ctx.fillStyle = color;
    ctx.fill(p);
    if(rim) {
      ctx.save(); ctx.clip(p);
      ctx.strokeStyle = rim; ctx.lineWidth = Math.max(2, h * 0.06);
      ctx.beginPath();
      top.forEach(([px, py], i) => i? ctx.lineTo(px, py + ctx.lineWidth / 2): ctx.moveTo(px, py + ctx.lineWidth / 2));
      ctx.stroke();
      ctx.restore();
    }
    if(haze) Shapes.mist(ctx, { ...haze, x, w, bottom, clip: p });
    return top;
  }
  //#endregion

  //#region [ Trees ]
  /**
   * Tree with a level of detail by distance:
   *  - far: a short forked trunk under one unified crown silhouette (`Shapes.crown`), scalloped to spiky
   *  - mid: a forked trunk with a twig into each of 5-8 large leaf clusters layered by depth (`Shapes.midTree`)
   *  - close: curved limbs + individual leaves in layers of color (`Shapes.sprays`)
   * kind: 'round' | 'sakura' (blossoms) | 'bare' (limbs only) | 'pine' (cone crown with needle teeth)
   * @param {{x, y, h, bark: string[], leaves?: string[], rng, kind?, t?, angle?, depth?, spread?, lod?: 'far'|'mid'|'close', form?, edge?, size?}} o
   */
  static tree(ctx, o) {
    const { kind='round' } = o;
    if(kind === 'pine') return Shapes.pine(ctx, o);
    const { x, y, h, bark, leaves=[], rng, t=0, angle=-Math.PI / 2, spread=0.8 } = o;
    const lod = o.lod ?? (h < 60? 'far': 'mid');
    if(kind !== 'bare' && leaves.length) {
      if(lod === 'far') return Shapes.farTree(ctx, o);
      if(lod === 'mid') return Shapes.midTree(ctx, { ...o, edge: o.edge ?? (kind === 'sakura'? 0.1: 0.3) });
    }
    const depth = o.depth ?? (kind === 'bare'? 6: 5);
    const { limbs, tips } = Shapes.grow(x, y, angle, h * 0.3, Math.max(2, h * 0.055), depth, rng, t, { spread, sides: kind === 'bare'? 1.2: 0.8, fork: 0.75, rise: 0.05 });
    Shapes.drawLimbs(ctx, limbs, bark);
    if(kind !== 'bare' && leaves.length) Shapes.sprays(ctx, limbs.filter(l => l.d <= 2), leaves, rng, { size: o.size ?? h * 0.04, t, shape: kind === 'sakura'? 'blossom': 'leaf' });
    return tips;
  }

  /**
   * Limb growth with soft curves. Every limb is a polyline whose heading drifts on a smooth seeded wave and bends
   * toward the light (`rise`); it ends in a fork or a leader, and sprouts side limbs from `from` along its length
   * onward (close-up branches use a low `from` and more `sides`, so twigs come off anywhere, not only the ends).
   * Sway rotates each limb a little and carries its children, so motion builds up toward the tips.
   * Returns limbs {pts, ws, hs, len, d, ry} (ry: un-swayed mid y, a stable depth key) and
   * tips [x, y, len, restY, angle, restX].
   * @param {{spread?, from?, sides?, fork?, rise?, curl?, taper?, shrink?: number[], sway?}} opt
   */
  static grow(x, y, angle, len, wid, depth, rng, t=0, { spread=0.6, from=0.45, sides=0.8, fork=0.6, rise=0.08, curl=0.3, taper=0.3, shrink=[0.66, 0.8], sway=0.04 }={}) {
    const limbs = [], tips = [], up = -Math.PI / 2;
    const lerp2 = (arr, u, n) => { const fi = u * n, i = Math.min(n - 1, Math.floor(fi)), f = fi - i; return [arr[i][0] + (arr[i + 1][0] - arr[i][0]) * f, arr[i][1] + (arr[i + 1][1] - arr[i][1]) * f]; };
    const lerp1 = (arr, u, n) => { const fi = u * n, i = Math.min(n - 1, Math.floor(fi)), f = fi - i; return arr[i] + (arr[i + 1] - arr[i]) * f; };
    const limb = (bx, by, ux, uy, ang, uang, l, wd, d) => {
      // every random value first, so the structure (and the rng stream) never depends on t
      const p1 = rng.float(0, Shapes.TAU), p2 = rng.float(0, Shapes.TAU), amp = curl * rng.float(0.6, 1.2), bend = rng.float(-0.5, 0.5) * curl;
      const nf = d > 1 && l > 2? (rng.chance(fork) || d === depth? 2: 1): 0;
      const fj = [rng.float(0.6, 1.2), rng.float(0.6, 1.2), rng.float(-0.2, 0.2), rng.float(shrink[0], shrink[1]), rng.float(shrink[0], shrink[1])];
      const ns = d > 1? Math.min(3, Math.floor(sides + rng.float(0, 1))): 0;
      const sd = [0, 1, 2].map(() => [rng.float(from, 0.94), rng.float(0.7, 1.3), rng.float(0.45, 0.75)]);
      const flip = rng.chance(0.5)? 1: -1;
      const n = Math.max(2, Math.min(24, Math.round(l / 4)));
      const sw = Shapes.wave(t, 1, d * 0.8 + ux * 0.013) * sway * (depth - d + 1) / depth;
      const pull = Math.atan2(Math.sin(up - uang), Math.cos(up - uang)) * rise;
      const head = s => bend * s + amp * (0.7 * (Math.sin(3.1 * s + p1) - Math.sin(p1)) + 0.3 * (Math.sin(7.3 * s + p2) - Math.sin(p2))) + pull * s * s;
      const pts = [[bx, by]], rest = [[ux, uy]], ws = [wd], hs = [ang + sw + head(0)], uhs = [uang + head(0)];
      for(let i = 1; i <= n; i++) {
        const s = i / n, hm = head(s - 0.5 / n);
        const [px, py] = pts[i - 1], [qx, qy] = rest[i - 1];
        pts.push([px + Math.cos(ang + sw + hm) * l / n, py + Math.sin(ang + sw + hm) * l / n]);
        rest.push([qx + Math.cos(uang + hm) * l / n, qy + Math.sin(uang + hm) * l / n]);
        ws.push(wd * (1 - taper * s));
        hs.push(ang + sw + head(s)); uhs.push(uang + head(s));
      }
      limbs.push({ pts, ws, hs, len: l, d, ry: rest[n >> 1][1] });
      const [ex, ey] = pts[n], [rx, ry] = rest[n];
      if(!nf) tips.push([ex, ey, l, ry, hs[n], rx]);
      else if(nf === 1) limb(ex, ey, rx, ry, hs[n] + fj[2], uhs[n] + fj[2], l * fj[3], ws[n], d - 1);
      else for(let k = 0; k < 2; k++) {
        const dl = (k? 1: -1) * spread * fj[k];
        limb(ex, ey, rx, ry, hs[n] + dl, uhs[n] + dl, l * fj[3 + k], ws[n] * 0.8, d - 1);
      }
      for(let k = 0; k < ns; k++) {
        const [u, dj, lf] = sd[k], dl = (k % 2? -1: 1) * flip * spread * dj;
        const [sx, sy] = lerp2(pts, u, n), [qx, qy] = lerp2(rest, u, n);
        limb(sx, sy, qx, qy, lerp1(hs, u, n) + dl, lerp1(uhs, u, n) + dl, l * lf * (1.1 - u * 0.5), wd * (1 - taper * u) * 0.6, d - 1);
      }
    };
    limb(x, y, x, y, angle, angle, len, wid, depth);
    return { limbs, tips };
  }

  /**
   * Limbs as tapered curved bodies with round joints (none for a limb with cap: false, e.g. a trunk foot), plus a lit
   * strip on the light-facing side of the thick ones.
   */
  static drawLimbs(ctx, limbs, bark) {
    ctx.fillStyle = bark[0];
    const caps = new Path2D();
    for(const L of limbs) {
      ctx.fill(Shapes.limbPath(L, -0.5, 0.5));
      if(L.cap === false) continue;
      const [x0, y0] = L.pts[0], r = Math.max(0.6, L.ws[0] / 2);
      caps.moveTo(x0 + r, y0); caps.arc(x0, y0, r, 0, Shapes.TAU);
    }
    ctx.fill(caps);
    if(bark.length < 2) return;
    ctx.fillStyle = bark[bark.length - 1];
    for(const L of limbs) if(L.ws[0] >= 4) ctx.fill(Shapes.limbPath(L, 0.1, 0.5));
  }

  /**
   * Outline of one tapered limb between two offsets across its width (-0.5 = shadow edge .. 0.5 = lit edge).
   * The lit side is picked once per limb (the normal facing up-left), so the strip never swaps sides.
   */
  static limbPath({ pts, ws }, from, to) {
    const n = pts.length, [x0, y0] = pts[0], [x1, y1] = pts[n - 1];
    const s = 0.8 * (x1 - x0) - 0.6 * (y1 - y0) >= 0? 1: -1;
    const a = [], b = [];
    for(let i = 0; i < n; i++) {
      const [px, py] = pts[i], [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(n - 1, i + 1)];
      const dx = bx - ax, dy = by - ay, m = Math.hypot(dx, dy) || 1;
      const nx = s * dy / m, ny = -s * dx / m, w = Math.max(1.2, ws[i]);
      a.push([px + nx * w * from, py + ny * w * from]);
      b.push([px + nx * w * to, py + ny * w * to]);
    }
    const p = new Path2D();
    a.forEach(([x, y], i) => i? p.lineTo(x, y): p.moveTo(x, y));
    for(let i = n - 1; i >= 0; i--) p.lineTo(b[i][0], b[i][1]);
    p.closePath();
    return p;
  }

  /** Crown half-width (0..1) at height v (0 = crown bottom, 1 = top), per base form. */
  static CROWN_FORMS = {
    round : v => Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 2)),
    oval  : v => Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 2)) * (1 - 0.2 * v),
    spread: v => Math.max(0, 1 - Math.abs(2 * v - 1) ** 3) ** 0.45,
    column: v => Math.sin(Math.PI * Math.min(1, v * 1.05)) ** 0.75 * (1 - 0.4 * v),
    cone  : (v, tiers) => (1 - v) ** 1.1 * (tiers? 0.68 + 0.32 * (1 - (v * tiers) % 1): 1)
  };

  /** Far tree proportions per form: [crown width, crown height, trunk length], shares of the tree height. */
  static FAR_FORMS = { round: [0.75, 0.7, 0.32], oval: [0.5, 0.78, 0.25], spread: [0.95, 0.5, 0.45], column: [0.3, 0.9, 0.12], cone: [0.55, 0.88, 0.14] };

  /**
   * Leafy blob outline around (0, 0): radius r, edged with scallops (edge 0) .. drooping needle teeth (edge 1).
   * Points are relative to the center, so a swaying clump moves without its edge crawling.
   */
  static blob(r, edge, rng) {
    const bw = Math.max(2.5, r * (0.75 - 0.35 * edge));
    const nb = Math.max(5, Math.min(9 + 8 * edge, Math.round(Shapes.TAU * r / bw)));
    const n = Math.max(16, nb * 4), ph = rng.float(0, 1), wob = Shapes.wobble(rng, [1, 2.2]);
    const amp = 0.22 + 0.14 * edge, pts = [];
    for(let i = 0; i < n; i++) {
      const u = i / n, a = u * Shapes.TAU, f = (u * nb + ph) % 1;
      const bump = (1 - edge) * Math.sqrt(Math.sin(Math.PI * f)) + edge * (1 - Math.abs(2 * f - 1)) ** 1.8;
      const out = amp * bump * 1.6 * (0.85 + 0.15 * wob(u)), rr = r * (1 - amp + out);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr + edge * out * r * 0.5 * Math.abs(Math.cos(a))]);  // teeth droop on the sides
    }
    return pts;
  }

  /**
   * Unified foliage silhouette for distant trees: a base form outlined by arc length and edged from round scallops
   * (edge 0) to needle teeth (edge 1, drooping like pine boughs), shaded like the clouds: the dark mass, mid lobes
   * lifted toward the light over its upper-left (dark gaps and the lower-right stay in shadow), light caps on the
   * top lobes. Cones get one lobe pair per tier (bough layers).
   * Lobes share the crown's edge style, so the light/shadow border reads as leaf clusters. `sway` shears the top (px).
   * `rim`: a rim light, a band of that color along the edges facing `rimDir` (the silhouette minus itself shifted away
   * from the light), about 5% of the width thick and never under 1 px.
   * @param {{x, y, w, h, form?: string, edge?: number, ramp: string[], rng, sway?: number, tiers?: number, rim?: string, rimDir?: number[]}} o - x: center, y: crown bottom
   */
  static crown(ctx, { x, y, w, h, form='round', edge=0, ramp, rng, sway=0, tiers=0, rim=null, rimDir=[-0.6, -0.8] }) {
    const pts = Shapes.crownOutline(x, y, w, h, form, edge, rng, tiers);
    const prof = Shapes.CROWN_FORMS[form] ?? Shapes.CROWN_FORMS.round;
    const path = (list, ox=0, oy=0, s=1) => {
      const p = new Path2D();
      list.forEach(([px, py], i) => {
        const Y = oy + py * s, X = ox + px * s + sway * (y - Y) / h;
        i? p.lineTo(X, Y): p.moveTo(X, Y);
      });
      p.closePath();
      return p;
    };
    // lobes (t-independent): [x, y, outline]; caps sit up-left on the top row of lobes
    const mids = [], caps = [];
    const lobe = (v, u, r, cap) => {
      const ly = y - v * h, lx = x + u * prof(Math.min(1, Math.max(0, v)), tiers) * w / 2;
      mids.push([lx, ly, Shapes.blob(r, edge, rng)]);
      if(cap) caps.push([lx - r * 0.3, ly - r * 0.32, Shapes.blob(r * 0.48, edge, rng)]);
    };
    if(form === 'cone' && tiers) {
      for(let j = 0; j < tiers; j++) {
        const v = (j + 0.4) / tiers, hw = prof(v, tiers) * w / 2;
        lobe(v, -0.32, Math.max(1.5, hw * 0.72), j >= tiers - 2 || rng.chance(0.5));
      }
    } else {
      const rows = Math.max(1, Math.min(3, Math.round(h / 14))), cols = Math.max(1, Math.min(4, Math.round(w / 14)));
      for(let j = 0; j < rows; j++)
        for(let i = 0; i < cols; i++) {
          const v = 0.42 + 0.46 * (rows > 1? j / (rows - 1): 0.6) + rng.float(-0.06, 0.06);
          const u = -0.72 + 1.02 * (cols > 1? i / (cols - 1): 0.45) + rng.float(-0.1, 0.1);
          const r = Math.max(1.5, Math.min(w / cols, h / rows) * rng.float(0.5, 0.64));
          lobe(v, u, r, j === rows - 1 && (u < 0.15 || cols === 1));
        }
    }
    const dark = ramp[0], mid = ramp[Math.min(1, ramp.length - 1)], light = ramp.length > 2? ramp[ramp.length - 1]: null;
    const base = path(pts);
    ctx.fillStyle = dark;
    ctx.fill(base);
    if(mid === dark && !rim) return;
    ctx.save();
    ctx.clip(base);
    if(mid !== dark) {
      ctx.fillStyle = mid;
      for(const [lx, ly, b] of mids) ctx.fill(path(b, lx, ly));
      if(light) {
        ctx.fillStyle = light;
        for(const [lx, ly, b] of caps) ctx.fill(path(b, lx, ly));
      }
    }
    if(rim) {
      const len = Math.hypot(...rimDir) || 1, rw = Math.max(1, w * 0.05), sx = -rimDir[0] / len * rw, sy = -rimDir[1] / len * rw;
      const cut = new Path2D();  // outside the silhouette shifted away from the light, inside the silhouette (clip above)
      cut.rect(x - w * 2, y - h * 2, w * 4, h * 4);
      cut.addPath(path(pts, sx, sy));
      ctx.clip(cut, 'evenodd');
      ctx.fillStyle = rim;
      ctx.fill(base);
    }
    ctx.restore();
  }

  /** Displaced outline points of a crown (see `crown`); t-independent, so the edge never crawls while swaying. */
  static crownOutline(x, y, w, h, form, edge, rng, tiers=0) {
    const prof = Shapes.CROWN_FORMS[form] ?? Shapes.CROWN_FORMS.round;
    const wobR = Shapes.wobble(rng, [1.4, 3.2]), wobL = Shapes.wobble(rng, [1.4, 3.2]);
    const bumpW = Shapes.wobble(rng, [2.3, 5.1]), bumpA = Shapes.wobble(rng, [1.7, 4.4]);
    let phase = rng.float(0, 1);
    // base form: right side bottom -> top, left side top -> bottom (counter-clockwise on screen)
    const base = [], n = 40;
    for(let i = 0; i <= n; i++) { const v = i / n; base.push([x + prof(v, tiers) * (1 + 0.12 * wobR(v)) * w / 2, y - v * h]); }
    for(let i = n; i >= 0; i--) { const v = i / n; base.push([x - prof(v, tiers) * (1 + 0.12 * wobL(v)) * w / 2, y - v * h]); }
    base.push(base[0]);
    const acc = [0];
    for(let i = 1; i < base.length; i++) acc.push(acc[i - 1] + Math.hypot(base[i][0] - base[i - 1][0], base[i][1] - base[i - 1][1]));
    const total = acc[acc.length - 1], m = Math.max(16, Math.round(total / Math.max(0.5, Math.min(w, h) / 30))), ds = total / m;
    const res = [];
    for(let k = 0, j = 1; k < m; k++) {
      const s = k * ds;
      while(j < acc.length - 1 && acc[j] < s) j++;
      const f = (s - acc[j - 1]) / ((acc[j] - acc[j - 1]) || 1);
      res.push([base[j - 1][0] + (base[j][0] - base[j - 1][0]) * f, base[j - 1][1] + (base[j][1] - base[j - 1][1]) * f]);
    }
    // edge: bumps along the outline, round scallops -> sharp teeth; widths and heights wander so it never repeats
    const bw = Math.max(2.2, (w + h) * 0.06) * (1 - 0.35 * edge), amp = bw * (0.45 + 0.3 * edge);
    return res.map(([px, py], k) => {
      const [ax, ay] = res[(k + m - 1) % m], [bx, by] = res[(k + 1) % m];
      const tx = bx - ax, ty = by - ay, tl = Math.hypot(tx, ty) || 1;
      const u = k / m;
      phase += ds / (bw * (0.75 + 0.25 * bumpW(u)));
      const f = phase % 1;
      const d = amp * (0.75 + 0.25 * bumpA(u)) * ((1 - edge) * Math.sqrt(Math.sin(Math.PI * f)) + edge * (1 - Math.abs(2 * f - 1)) ** 1.8) - amp * 0.45;
      const nx = -ty / tl, ny = tx / tl + 0.5 * edge, nl = Math.hypot(nx, ny) || 1;  // outward, drooping with the edge
      return [px + nx / nl * d, py + ny / nl * d];
    });
  }

  /** Distant tree: a short forked trunk, then one unified crown (random form unless given). */
  static farTree(ctx, { x, y, h, bark, leaves, rng, t=0, form=null, edge=null }) {
    const f = form ?? rng.pick(['round', 'round', 'oval', 'spread', 'column']);
    const [cw, chh, trunk] = Shapes.FAR_FORMS[f] ?? Shapes.FAR_FORMS.round;
    const w = h * cw * rng.float(0.85, 1.15), ch = h * chh;
    const { limbs } = Shapes.grow(x, y, -Math.PI / 2, h * trunk, Math.max(1.5, h * 0.06), 2, rng, t, { spread: 0.5, sides: 0, fork: 1, curl: 0.15, rise: 0.5, sway: 0.02 });
    Shapes.drawLimbs(ctx, limbs, bark);
    Shapes.crown(ctx, { x, y: y - h + ch, w, h: ch, form: f, edge: edge ?? (f === 'column'? 0.5: 0.25), ramp: leaves, rng, sway: Shapes.wave(t, 1, x * 0.013) * h * 0.015 });
  }

  /** Mid tree crown proportions per form: [crown width, crown height], shares of the tree height. */
  static MID_FORMS = { round: [0.95, 0.72], spread: [1.2, 0.6], oval: [0.68, 0.8] };

  /**
   * Mid-distance tree. The crown is laid out first: a few large leaf clusters on a ring around the base form's upper
   * part, plus 1-2 in front over the lower middle, each at its own depth so they overlap. Then the trunk forks inside
   * the lower crown, a main limb per side runs to a hub, and a twig reaches every cluster, so the crown always sits on
   * its limbs. The clusters are drawn per pixel as one crown (`Shapes.clusters`). Sway shears trunk and crown together.
   * @param {{x, y, h, bark: string[], leaves: string[], rng, t?, form?: string, edge?: number}} o - y: ground
   */
  static midTree(ctx, { x, y, h, bark, leaves, rng, t=0, form=null, edge=0.3 }) {
    const f = Shapes.MID_FORMS[form]? form: rng.pick(['round', 'round', 'spread', 'oval']);
    const [kw, kh] = Shapes.MID_FORMS[f];
    const w = h * kw * rng.float(0.9, 1.1), ch = h * kh * rng.float(0.95, 1.05);
    const a = w / 2, b = ch / 2, m = Math.min(a, b);
    const cx = x + rng.float(-0.05, 0.05) * w, ey = y - h + b;
    const C = [];  // [x, y, r, depth] at rest
    const ring = f === 'spread'? rng.int(5, 6): f === 'oval'? 4: rng.int(4, 5);
    const from = rng.float(0.85, 0.95), to = rng.float(2.05, 2.15);
    for(let j = 0; j < ring; j++) {
      const th = Math.PI * (from + (to - from) * j / (ring - 1) + rng.float(-0.06, 0.06)), r = m * rng.float(0.5, 0.66);
      C.push([cx + Math.cos(th) * (a - r * 0.9), ey + Math.sin(th) * (b - r * 0.9), r, rng.float(0, 0.35) * m]);
    }
    const front = f === 'spread' || rng.chance(0.4)? 2: 1;
    for(let i = 0; i < front; i++) {
      const r = m * rng.float(0.55, 0.68), u = front > 1? (i? 0.34: -0.34) + rng.float(-0.06, 0.06): rng.float(-0.12, 0.12);
      C.push([cx + u * a, ey + b * rng.float(0.2, 0.35), r, m * rng.float(0.5, 0.6)]);
    }
    // limbs: trunk to a fork in the lower crown, one main limb per side to a hub, a twig from the hub to each cluster
    const w0 = Math.max(2, h * 0.085), fx = cx + (x - cx) * 0.35, fy = ey + b * 0.55;
    const limbs = [Shapes.reach(x, y, fx, fy, w0, w0 * 0.7, rng.float(-0.04, 0.04), rng, { wob: 0.4, flare: 0.4, cap: false })];
    for(const side of [-1, 1]) {
      const g = C.filter(([qx]) => side < 0? qx < fx: qx >= fx);
      if(!g.length) continue;
      const gx = g.reduce((s, q) => s + q[0], 0) / g.length, gy = g.reduce((s, q) => s + q[1], 0) / g.length;
      const hx = fx + (gx - fx) * 0.5, hy = fy + (gy - fy) * 0.5;
      limbs.push(Shapes.reach(fx, fy, hx, hy, w0 * 0.55, w0 * 0.42, rng.float(-0.1, 0.1), rng));
      for(const [qx, qy] of g) limbs.push(Shapes.reach(hx, hy, qx, qy, w0 * 0.34, w0 * 0.14, rng.float(-0.12, 0.12), rng));
    }
    const seed = rng.int(1, 1 << 30);
    const sway = Shapes.wave(t, 1, x * 0.013) * h * 0.012;
    for(const L of limbs) for(const p of L.pts) p[0] += sway * (y - p[1]) / h;
    Shapes.drawLimbs(ctx, limbs, bark);
    Shapes.clusters(ctx, C, leaves, { sway, base: y, h, edge, seed });
    return C;
  }

  /**
   * One curved, tapered limb from (x0, y0) to (x1, y1) for `drawLimbs`. bend bows it sideways (share of its length),
   * wob scales its small wiggle, flare widens its foot (share of the width, trunks), cap: false drops its round foot.
   */
  static reach(x0, y0, x1, y1, w0, w1, bend, rng, { wob=1, flare=0, cap=true }={}) {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1, n = Math.max(2, Math.min(24, Math.round(len / 4)));
    const nx = (y0 - y1) / len, ny = (x1 - x0) / len, ph = rng.float(0, Shapes.TAU), amp = len * rng.float(0.015, 0.04) * wob;
    const pts = [], ws = [];
    for(let i = 0; i <= n; i++) {
      const s = i / n, off = len * bend * 4 * s * (1 - s) + amp * Math.sin(Math.PI * s) * Math.sin(Shapes.TAU * 1.3 * s + ph);
      pts.push([x0 + (x1 - x0) * s + nx * off, y0 + (y1 - y0) * s + ny * off]);
      ws.push((w0 + (w1 - w0) * s) * (1 + flare * (1 - s) ** 14));
    }
    return { pts, ws, len, d: 1, cap };
  }

  /** Diamond angle of (dx, dy): 0..4 once around, monotonic like atan2 but with no trig (edge lookups per pixel). */
  static dia(dx, dy) {
    return dy >= 0? (dx >= 0? dy / (dx + dy || 1): 1 - dx / (dy - dx)): (dx < 0? 2 - dy / (-dx - dy): 3 + dx / (dx - dy));
  }

  /**
   * Leafy edge of a round shape as a lookup over the diamond angle (`dia`, N + 1 entries): the radius share at each
   * direction. Three layers, so it never looks stamped: a lopsided base (low harmonics), 6-9 broad soft lumps, and
   * leaf bumps about bw px wide (round scallops at edge 0 .. sharp teeth at edge 1 like `blob`; their widths and
   * heights wander). leafK scales the leaf bumps, al the lumps. Periodic, so there is no seam. lut[N + 1] holds the
   * largest share (for bounds).
   */
  static edgeLut(r, bw, edge, rng, N=256, leafK=1, al=0.06) {
    const M = 512, TAU = Shapes.TAU, q = [0, 1, 2, 3, 4, 5].map(() => rng.float(0, TAU)), off = rng.float(0, 1);
    const ph = new Float32Array(M + 1);  // leaf phase, integrated over u with a wandering bump width
    for(let i = 1; i <= M; i++) ph[i] = ph[i - 1] + 1 / (0.75 + 0.25 * Math.sin(TAU * 3 * (i - 0.5) / M + q[0]));
    const nb = Math.max(6, Math.min(48, Math.round(TAU * r / bw))), k = nb / ph[M];
    const amp = Math.min(0.25, bw * 0.45 / r) * leafK, nl = rng.int(6, 9), offL = rng.float(0, 1);
    const lut = new Float32Array(N + 2);
    for(let i = 0; i <= N; i++) {
      const p = i / N * 4, [dx, dy] = p < 1? [1 - p, p]: p < 2? [1 - p, 2 - p]: p < 3? [p - 3, 2 - p]: [p - 3, p - 4];
      const u = (Math.atan2(dy, dx) / TAU + 1) % 1, fi = u * M, i0 = Math.min(M - 1, fi | 0);
      const f = ((ph[i0] + (ph[i0 + 1] - ph[i0]) * (fi - i0)) * k + off) % 1;
      const leaf = (1 - edge) * Math.sqrt(Math.sin(Math.PI * f)) + edge * (1 - Math.abs(2 * f - 1)) ** 1.8;
      const lump = 0.5 - 0.5 * Math.cos(TAU * (u * nl + offL + 0.04 * Math.sin(TAU * u + q[5])));
      const au = amp * (0.75 + 0.25 * Math.sin(TAU * 2 * u + q[1]));
      const base = 1 + 0.07 * Math.sin(TAU * u + q[2]) + 0.04 * Math.sin(TAU * 2 * u + q[3]) + 0.025 * Math.sin(TAU * 3 * u + q[4]);
      lut[i] = base * (1 - au - al + 1.6 * (au * leaf + al * lump));
      lut[N + 1] = Math.max(lut[N + 1], lut[i]);
    }
    return lut;
  }

  /** Shared scratch canvas for per-pixel shapes, grown as needed. */
  static scratch(w, h) {
    const c = Shapes.scratchCanvas ??= typeof document !== 'undefined'? document.createElement('canvas'): new OffscreenCanvas(1, 1);
    if(c.width < w) c.width = w;
    if(c.height < h) c.height = h;
    return c;
  }

  /**
   * Crown from leaf clusters [x, y, r, depth], drawn per pixel. The clusters are leafy discs layered by depth, so a
   * front cluster overlaps the ones behind with its whole leafy edge. Each cluster is toned like a far crown: a mid
   * lobe lifted toward the light (a dark crescent stays on its lower right), 0-3 light caps on its lit side (fewer
   * low in the crown), all leafy-edged. A cluster in front also drops its silhouette as a shadow on the ones behind,
   * shifted away from the light (`light`: screen direction) by `drop` of its radius: one tone darker. Every pixel is
   * an exact ramp color with hard edges. Shapes live in rest coordinates, so their edges ride the sway (a shear of
   * `sway` px at height h above `base`).
   */
  static clusters(ctx, C, ramp, { sway=0, base=0, h=1, edge=0.3, seed=1, light=[-0.55, -0.85], drop=0.22 }={}) {
    const k = C.length, N = 256;
    if(!k || !ramp.length) return;
    const ls = Math.hypot(...light) || 1, ux = light[0] / ls, uy = light[1] / ls, la = Math.atan2(uy, ux);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for(const [cx, cy, r] of C) {
      const re = r * 1.4;
      minX = Math.min(minX, cx - re); maxX = Math.max(maxX, cx + re); minY = Math.min(minY, cy - re); maxY = Math.max(maxY, cy + re);
    }
    const cx0 = (minX + maxX) / 2, hx = (maxX - minX) / 2 || 1, cy0 = (minY + maxY) / 2, hy = (maxY - minY) / 2 || 1;
    // shapes: x, y, r per entry + an edge lookup each; clusters front first, each with its ball and lobes (mid, caps)
    const S = [], luts = [], balls = [], lobes = [];
    // leaf bumps: a share of the cluster, never under 5 px (smaller ones read as noise once pixelized)
    const shape = (x, y, r, rr, lobe=false) => {
      S.push(x, y, r);
      luts.push(lobe? Shapes.edgeLut(r, Math.max(5, r * 0.3), edge, rr, N, 0.6, 0.08): Shapes.edgeLut(r, Math.max(5, r * 0.14), edge, rr, N));
      return luts.length - 1;
    };
    for(const ci of C.map((c, i) => i).sort((p, q) => C[q][3] - C[p][3])) {
      const [cx, cy, r] = C[ci], rr = new Rng(seed + ':' + ci);
      const g = -((cx - cx0) / hx * ux + (cy - cy0) / hy * uy);  // where it sits in the crown: -1 lit side .. 1 shade side
      balls.push(shape(cx, cy, r, rr));
      const L = [shape(cx + ux * r * 0.3, cy + uy * r * 0.3, r * (0.94 - 0.16 * Math.max(0, g)), rr, true)];
      const caps = g < -0.25? rr.int(2, 3): g < 0.3? rr.int(1, 2): rr.chance(0.35)? 1: 0;
      for(let i = 0; i < caps; i++) {
        const an = la + (caps > 1? (i / (caps - 1) - 0.5) * 1.3: 0) + rr.float(-0.2, 0.2), d = r * rr.float(0.4, 0.52);
        L.push(shape(cx + Math.cos(an) * d, cy + Math.sin(an) * d, r * rr.float(0.3, 0.42), rr, true));
      }
      lobes.push(L);
    }
    const P = Float64Array.from(S), lim = Float64Array.from(luts, (L, s) => (P[s * 3 + 2] * L[N + 1]) ** 2);
    const inside = (s, X, Y) => {
      const dx = X - P[s * 3], dy = Y - P[s * 3 + 1], d2 = dx * dx + dy * dy, R = P[s * 3 + 2];
      if(d2 >= lim[s]) return false;
      const p = Shapes.dia(dx, dy) * (N / 4), i0 = p | 0, L = luts[s], Re = R * (L[i0] + (L[i0 + 1] - L[i0]) * (p - i0));
      return d2 < Re * Re;
    };
    const x0 = Math.floor(minX - Math.abs(sway) - 1), x1 = Math.ceil(maxX + Math.abs(sway) + 1);
    const y0 = Math.floor(minY - 1), y1 = Math.ceil(maxY + 1), bw = x1 - x0, bh = y1 - y0;
    if(bw <= 0 || bh <= 0) return;
    const nt = ramp.length, pick = [0, Math.min(1, nt - 1), nt > 2? nt - 1: Math.min(1, nt - 1)];
    const tones = pick.map(i => { const [r, g, b] = Color.hexToRgb(ramp[i]); return (255 << 24 | b << 16 | g << 8 | r) >>> 0; });
    const cv = Shapes.scratch(bw, bh), cctx = cv.getContext('2d');
    const img = cctx.createImageData(bw, bh), out = new Uint32Array(img.data.buffer);
    for(let j = 0; j < bh; j++) {
      const Y = y0 + j + 0.5, sh = sway * (base - Y) / h;
      for(let i = 0; i < bw; i++) {
        const X = x0 + i + 0.5 - sh;
        let c = 0;
        while(c < k && !inside(balls[c], X, Y)) c++;
        if(c === k) continue;
        const L = lobes[c];
        let tone = 0;
        if(inside(L[0], X, Y)) {
          tone = 1;
          for(let l = 1; l < L.length; l++) if(inside(L[l], X, Y)) { tone = 2; break; }
        }
        for(let f = 0; tone > 0 && f < c; f++) {  // drop shadow of a cluster in front
          const d = P[balls[f] * 3 + 2] * drop;
          if(inside(balls[f], X + ux * d, Y + uy * d)) { tone--; break; }
        }
        out[j * bw + i] = tones[tone];
      }
    }
    cctx.putImageData(img, 0, 0);
    ctx.drawImage(cv, 0, 0, bw, bh, x0, y0, bw, bh);
  }

  /**
   * Leaf sprays for close-up foliage: leaves set along the outer part of each twig (`from` .. tip, irregular gaps,
   * random sides, one at the tip), drawn in layers of color back -> front. tone 'light': a leaf's layer follows how
   * much its spot faces the light (the upper-left of the spray comes forward and lighter); 'flat': every leaf takes
   * tones[0] (one depth layer) with a tones[1] lit half. Each leaf is an almond with its lit half one tone lighter,
   * or a bunch of two 5-petal blossoms. Leaves near `glow` (a light behind them) turn translucent.
   * @param {Array<{pts, hs, len, ry}>} twigs - limbs from `grow`
   * @param {string[]} tones - dark -> light
   * @param {{size: number, gap?, from?, shape?: 'leaf'|'blossom', tone?: 'light'|'flat', t?, glow?: {x, y, r, color}, center?: number[]}} o
   */
  static sprays(ctx, twigs, tones, rng, { size, gap=0.5, from=0.3, shape='leaf', tone='light', t=0, glow=null, center=null }) {
    const leaves = [], bloom = shape === 'blossom';
    for(const tw of twigs) {
      const { pts, hs, len } = tw, n = pts.length - 1;
      const count = Math.max(1, Math.floor(len * (1 - from) / (size * gap)));
      const lift = rng.float(-0.2, 0.2);
      for(let k = 0; k <= count; k++) {
        const spread = rng.float(0.35, 1.05), lj = rng.float(0.7, 1.3), jit = rng.float(-0.15, 0.15), ph = rng.float(0, Shapes.TAU);
        const du = rng.float(-0.3, 0.3), side = k === count? 0: rng.chance(0.5)? 1: -1;
        const bx = rng.float(-0.6, 0.6), by = rng.float(-0.6, 0.6);
        const u = k === count? 1: from + (1 - from) * Math.min(0.97, Math.max(0, (k + 0.5 + du) / count));
        const fi = u * n, i = Math.min(n - 1, Math.floor(fi)), f = fi - i;
        const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
        const ang = hs[i] + (hs[i + 1] - hs[i]) * f + side * spread + Shapes.wave(t, 1, ph) * 0.12;
        const l = size * lj;
        leaves.push({ x, y, l, ang, v: lift + jit, ry: tw.ry, k: leaves.length });
        if(bloom) leaves.push({ x: x + bx * l, y: y + by * l, l: l * 0.85, ang: ang + 1.3, v: lift + jit, ry: tw.ry, k: leaves.length });
      }
    }
    if(!leaves.length) return;
    const L = tones.length;
    if(tone === 'flat') leaves.forEach(lf => { lf.layer = 0; });
    else {
      const [cx, cy] = center ?? [leaves.reduce((a, l) => a + l.x, 0) / leaves.length, leaves.reduce((a, l) => a + l.y, 0) / leaves.length];
      const rad = Math.max(1, ...leaves.map(l => Math.hypot(l.x - cx, l.y - cy)));
      for(const lf of leaves) {
        const facing = ((lf.x - cx) * -0.6 + (lf.y - cy) * -0.8) / rad;  // -1 away from the light .. 1 toward it
        lf.layer = Math.max(0, Math.min(L - 1, Math.floor((0.5 + facing * 0.55 + lf.v) * L)));
      }
    }
    leaves.sort((a, b) => a.layer - b.layer || b.ry - a.ry || a.k - b.k);
    // one batch per layer: bodies, then lit halves (each side in its own path, so windings never cancel)
    for(let layer = 0; layer < L; layer++) {
      const set = leaves.filter(lf => lf.layer === layer);
      if(!set.length) continue;
      const body = new Path2D(), bodyGlow = new Path2D(), lit = [new Path2D(), new Path2D()], hot = [new Path2D(), new Path2D()], dots = new Path2D();
      for(const lf of set) {
        const near = glow && Math.hypot(lf.x - glow.x, lf.y - glow.y) < glow.r;
        const ca = Math.cos(lf.ang), sa = Math.sin(lf.ang);
        if(bloom) {  // 5 overlapping petals around a center dot
          const r = lf.l * 0.5, bx = lf.x + ca * r * 0.3, by = lf.y + sa * r * 0.3, path = near? bodyGlow: body;
          for(let p = 0; p < 5; p++) {
            const a = lf.ang + p * Shapes.TAU / 5, px = bx + Math.cos(a) * r * 0.42, py = by + Math.sin(a) * r * 0.42;
            path.moveTo(px + r * 0.48, py); path.arc(px, py, r * 0.48, 0, Shapes.TAU);
          }
          const cr = Math.max(0.6, r * 0.22);
          dots.moveTo(bx + cr, by); dots.arc(bx, by, cr, 0, Shapes.TAU);
          continue;
        }
        const P = (lx, ly) => [lf.x + ca * lx - sa * ly, lf.y + sa * lx + ca * ly];  // leaf space: base at 0, tip at l
        const l = lf.l, wq = l * 0.55;
        const [x0, y0] = P(0, 0), [x1, y1] = P(l, 0), [c1x, c1y] = P(l * 0.5, -wq), [c2x, c2y] = P(l * 0.5, wq);
        const path = near? bodyGlow: body;
        path.moveTo(x0, y0); path.quadraticCurveTo(c1x, c1y, x1, y1); path.quadraticCurveTo(c2x, c2y, x0, y0); path.closePath();
        if(l < 4) continue;
        const s = (sa * 0.6 - ca * 0.8) >= 0? 1: -1;  // the half whose side normal faces the light
        const [hx, hy] = s > 0? [c2x, c2y]: [c1x, c1y];
        const half = (near? hot: lit)[s > 0? 1: 0];
        half.moveTo(x0, y0); half.quadraticCurveTo(hx, hy, x1, y1); half.closePath();
      }
      const main = tones[layer], up = tones[Math.min(L - 1, layer + 1)];
      ctx.fillStyle = main; ctx.fill(body);
      if(glow) { ctx.fillStyle = up; ctx.fill(bodyGlow); }
      if(up !== main || tone === 'flat') { ctx.fillStyle = up; ctx.fill(lit[0]); ctx.fill(lit[1]); }
      if(glow) { ctx.fillStyle = glow.color; ctx.fill(hot[0]); ctx.fill(hot[1]); }
      if(bloom) { ctx.fillStyle = layer? tones[0]: up; ctx.fill(dots); }
    }
  }

  /**
   * Close-up branch: one long curved limb whose twigs come off random points all along every limb (not only the
   * ends), carrying leaf or blossom sprays in layers of color. Sakura branches, overhangs and the look-up canopy.
   * @param {{x, y, len, angle, bark: string[], leaves: string[], rng, t?, blossom?, depth?, size?, wid?, tone?, glow?, rise?, sway?, sides?, from?}} o
   */
  static branch(ctx, { x, y, len, angle, bark, leaves, rng, t=0, blossom=false, depth=4, size=len * 0.04, wid=len * 0.045, tone='light', glow=null, rise=0.08, sway=0.025, sides=1.6, from=0.2 }) {
    const { limbs } = Shapes.grow(x, y, angle, len * 0.55, wid, depth, rng, t, { spread: 0.75, from: 0.12, sides, fork: 0.3, rise, curl: 0.35, taper: 0.45, shrink: [0.55, 0.8], sway });
    Shapes.drawLimbs(ctx, limbs, bark);
    Shapes.sprays(ctx, limbs.filter(l => l.d <= 2), leaves, rng, { size, from, gap: blossom? 0.6: 0.45, shape: blossom? 'blossom': 'leaf', tone, t, glow });
    return limbs;
  }

  /**
   * Tree top seen from below, in four layers: a big leafy back mass, a smaller mass over it (depth), a dense fan of
   * limbs radiating from the trunk at (x, y) out to the crown's rim (many more sticks than `branch`), then leaf
   * sprays on top. Tones dark -> light: back mass, front mass, leaves (lit halves from a 4th tone when given).
   * The masses are unions of leafy blobs (`leafyPath`) set around the trunk inside the fan.
   * @param {{x, y, r, bark: string[], tones: string[], rng, t?, dir?, spread?, size?, glow?}} o - r: crown radius; the
   *   fan covers `spread` rad around `dir` (default: all around, the trunk straight above the viewer)
   */
  static treetop(ctx, { x, y, r, bark, tones, rng, t=0, dir=0, spread=Shapes.TAU, size=r * 0.06, glow=null }) {
    const TAU = Shapes.TAU, full = spread >= TAU - 1e-6, share = full? 1: spread / TAU;
    const along = u => full? dir + u * TAU: dir + (u - 0.5) * spread;  // u 0..1 across the fan
    // faults: a few small ragged slits where the sky shows, stretched along the crown's curve; the outer ones only cut
    // the back mass, an inner one may go through both
    const spots = [];
    const hole = (n, dist) => {
      const out = [];
      for(let i = 0; i < n; i++)
        for(let tries = 0; tries < 6; tries++) {  // the tries depend on the layout only, never on t
          const a = along(rng.float(0.05, 0.95)), d = r * rng.float(dist[0], dist[1]), hr = r * rng.float(0.035, 0.065);
          const st = rng.float(1.6, 2.6), rot = a + Math.PI / 2 + rng.float(-0.6, 0.6), hx = x + Math.cos(a) * d, hy = y + Math.sin(a) * d;
          if(spots.some(([sx, sy, sr]) => Math.hypot(hx - sx, hy - sy) < (hr * st + sr) * 1.1)) continue;  // apart, or even-odd would refill the overlap
          spots.push([hx, hy, hr * st]);
          const p = new Path2D();
          Shapes.leafyPath(p, hx, hy, hr, 0.7, rng, Math.max(3, hr * 0.5), st, rot);
          out.push(p);
          break;
        }
      return out;
    };
    const through = hole(rng.int(0, 1), [0.18, 0.42]), outer = hole(rng.int(1, 2) + (full? 1: 0), [0.55, 0.88]), inner = hole(rng.int(0, 1), [0.1, 0.4]);
    const mass = (n, dist, rad, color, core, holes) => {
      const p = new Path2D();
      if(core) Shapes.leafyPath(p, x, y, r * core, 0.3, rng, Math.max(5, r * core * 0.14));
      for(let i = 0; i < n; i++) {
        const a = along((i + rng.float(0.25, 0.75)) / n), d = r * rng.float(dist[0], dist[1]), br = r * rng.float(rad[0], rad[1]);
        Shapes.leafyPath(p, x + Math.cos(a) * d, y + Math.sin(a) * d, br, 0.3, rng, Math.max(5, br * 0.14));
      }
      ctx.save();
      const keep = new Path2D();  // the frame around the crown minus the holes (even-odd), as a clip
      keep.rect(x - r * 3, y - r * 3, r * 6, r * 6);
      for(const h of holes) keep.addPath(h);
      ctx.clip(keep, 'evenodd');
      ctx.fillStyle = color;
      ctx.fill(p);
      ctx.restore();
    };
    mass(Math.max(3, Math.round(8 * share) + (full? 0: 1)), [0.42, 0.62], [0.3, 0.42], tones[0], 0.45, [...through, ...outer]);   // back: big and wide
    mass(Math.max(2, Math.round(6 * share) + (full? 0: 1)), [0.22, 0.48], [0.22, 0.34], Shapes.pick(tones, 0.5), 0.3, [...through, ...inner]);  // front: smaller, closer in
    // limbs must read over the back mass: when the bark is that same color, they take the bark's lit tone instead
    const lab = c => Color.rgbToOklab(Color.hexToRgb(c));
    if(bark.length > 1 && Color.dist(lab(bark[0]), lab(tones[0])) < 0.05) bark = [bark[bark.length - 1]];
    const limbs = [], m = Math.max(2, Math.round(5 * share) + (full? 0: 1));
    for(let k = 0; k < m; k++) {
      const a = along((k + rng.float(0.3, 0.7)) / m);
      limbs.push(...Shapes.grow(x, y, a, r * rng.float(0.32, 0.4), Math.max(1.5, r * 0.05), 4, rng, t,
        { spread: 0.6, from: 0.2, sides: 1.3, fork: 0.5, rise: 0, curl: 0.3, taper: 0.5, shrink: [0.6, 0.78], sway: 0.025 }).limbs);
    }
    Shapes.drawLimbs(ctx, limbs, bark);
    // leaves: only on the finest twigs, toward their tips and sparse, so both masses and the limbs still read under them
    const twigs = limbs.filter(l => l.d === 1 && rng.chance(0.6));
    Shapes.sprays(ctx, twigs, tones.slice(2).length? tones.slice(2): tones.slice(-1), rng, { size, from: 0.55, gap: 0.95, tone: 'flat', t, glow });
    return limbs;
  }

  /**
   * Adds a closed leafy outline around (cx, cy) to path `p`: an `edgeLut` edge (lopsided base, soft lumps, leaf bumps
   * about bw px), optionally stretched along its x axis and rotated by `rot` (slits, gaps).
   */
  static leafyPath(p, cx, cy, r, edge, rng, bw, stretch=1, rot=0) {
    const N = 256, lut = Shapes.edgeLut(r, bw, edge, rng, N), n = Math.max(24, Math.min(200, Math.round(Shapes.TAU * r * stretch / 1.5)));
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for(let k = 0; k < n; k++) {
      const a = k / n * Shapes.TAU, dx = Math.cos(a), dy = Math.sin(a);
      const q = Shapes.dia(dx, dy) * (N / 4), i0 = Math.min(N - 1, q | 0), e = r * (lut[i0] + (lut[i0 + 1] - lut[i0]) * (q - i0));
      const u = dx * e * stretch, v = dy * e, X = cx + u * cr - v * sr, Y = cy + u * sr + v * cr;
      k? p.lineTo(X, Y): p.moveTo(X, Y);
    }
    p.closePath();
  }

  /**
   * Pine: a short trunk under one cone crown built in tiers, edged with drooping needle teeth. `rim`: a rim light in
   * that color along the needles facing `light` (screen direction toward the light, default up-left).
   */
  static pine(ctx, { x, y, h, bark, leaves, rng, t=0, rim=null, light=[-0.6, -0.8] }) {
    const tw = Math.max(1.5, h * 0.05);
    ctx.fillStyle = bark[0];
    ctx.fillRect(x - tw / 2, y - h * 0.22, tw, h * 0.22);
    Shapes.crown(ctx, { x, y: y - h * 0.1, w: h * rng.float(0.42, 0.56), h: h * 0.9, form: 'cone', edge: 0.9, tiers: rng.int(3, 5),
      ramp: leaves, rng, sway: Shapes.wave(t, 1, x * 0.01) * h * 0.02, rim, rimDir: light });
  }
  //#endregion
}
