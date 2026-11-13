/**
 * Mood palettes: (primary, secondary, brightness, mood level) -> 3..15 colors in OKLCH.
 * Mood axis: 0 = calm (muted, close hues, soft contrast) .. 1 = energetic (saturated, wide hue shift, strong contrast).
 */
class Mood {
  static COOL_HUE = 285;  // deg, shadows drift toward blue-violet
  static WARM_HUE = 75;   // deg, highlights drift toward yellow-orange

  static DEFAULTS = {
    primary   : '#3B3D9A',
    secondary : '#E08A5C',
    brightness: 0.35,   // 0 = night .. 1 = bright day
    mood      : 0.4,    // 0 = calm .. 1 = energetic
    count     : 0,      // 0 = auto, else 3..15
    aerial    : true    // scenery (primary) ramp: saturation peaks in the darks and fades toward the light end, like haze
  };

  static lerp(a, b, t) { return a + (b - a) * t; }
  static clamp(v, lo=0, hi=1) { return Math.max(lo, Math.min(hi, v)); }

  /** Moves hue `h` toward `target` by at most `amount` degrees. */
  static shiftHue(h, target, amount) {
    const d = Color.hueDelta(h, target);
    return (h + Math.sign(d) * Math.min(Math.abs(d), amount) + 360) % 360;
  }

  /** Auto color count: calm palettes are smaller and smoother, energetic ones add accents. */
  static autoCount(mood) { return Math.round(Mood.lerp(6, 12, mood)); }

  //#region [ Generate ]
  /**
   * @returns {{colors: string[], ramps: {primary: string[], secondary: string[], accent: string[]}, options: object}}
   * colors are sorted dark -> light; ramps are dark -> light.
   */
  static generate(options={}) {
    const o = { ...Mood.DEFAULTS, ...options };
    const m = Mood.clamp(o.mood), b = Mood.clamp(o.brightness);
    const n = Mood.clamp(Math.round(o.count || Mood.autoCount(m)), 3, 15);

    // split the count: accents grow with mood, primary takes the larger share
    const accentN = n >= 6? Math.min(3, Math.round(Math.max(0, m - 0.15) * n / 3.4)): 0;
    const rest = n - accentN;
    const secN = Math.max(1, Math.round(rest * 0.38));
    const priN = rest - secN;

    // lightness window: brightness moves it, calm compresses it toward the middle
    let lo = Mood.lerp(0.10, 0.55, b), hi = Mood.lerp(0.55, 0.97, b);
    const mid = (lo + hi) / 2, span = Mood.lerp(0.6, 1.0, m);
    lo = mid - (mid - lo) * span;
    hi = mid + (hi - mid) * span;

    const chromaK = Mood.lerp(0.45, 1.25, m);
    const shift = Mood.lerp(6, 30, m);
    const [, pC, pH] = Color.hexToLch(o.primary);
    const [, sC, sH] = Color.hexToLch(o.secondary);

    const primary = Mood.ramp(priN, lo, hi, pC * chromaK, pH, shift, o.aerial);
    const secondary = Mood.ramp(secN, Mood.lerp(lo, hi, 0.35), Math.min(0.98, hi + 0.04), sC * chromaK, sH, shift);
    const accent = Mood.accents(accentN, pH, sH, m, hi);

    const colors = [...primary, ...secondary, ...accent]
      .map(hex => ({ hex, L: Color.hexToLch(hex)[0] }))
      .sort((p, q) => p.L - q.L)
      .map(c => c.hex);
    return { colors: Mood.dedupe(colors), ramps: { primary, secondary, accent }, options: { ...o, count: n } };
  }

  /**
   * Dark -> light ramp with a chroma bell and hue shifting (cool shadows, warm highlights). `aerial` skews the bell
   * toward the darks (peak at 30% of the ramp, about half the chroma at the light end), so the lighter steps that
   * far planes and the horizon use are the hazy, washed-out ones: aerial perspective inside the palette.
   */
  static ramp(steps, lo, hi, chroma, hue, shift, aerial=false) {
    const out = [];
    for(let i = 0; i < steps; i++) {
      const t = steps === 1? 0.5: i / (steps - 1);
      const L = Mood.lerp(lo, hi, t);
      const C = chroma * (aerial? 0.5 + 0.5 * Math.exp(-(((t - 0.3) / (t < 0.3? 0.35: 0.45)) ** 2)): 0.45 + 0.55 * Math.sin(Math.PI * Mood.lerp(0.15, 0.85, t)));
      const h = t < 0.5
        ? Mood.shiftHue(hue, Mood.COOL_HUE, shift * (0.5 - t) * 2)
        : Mood.shiftHue(hue, Mood.WARM_HUE, shift * (t - 0.5) * 2);
      out.push(Color.lch(L, C, h));
    }
    return out;
  }

  /** Harmony accents: complement first, then split-complements; bright and saturated. */
  static accents(count, pH, sH, m, hi) {
    const offsets = [180, 150, 210, 120, 240, 90, 270];
    const used = [pH, sH];
    const out = [];
    for(let i = 0; i < count; i++) {
      // first harmony offset that stays >= 35deg away from primary, secondary and earlier accents
      const off = offsets.find(o => used.every(u => Math.abs(Color.hueDelta(u, (pH + o) % 360)) >= 35));
      if(off === undefined) break;
      const h = (pH + off) % 360;
      used.push(h);
      const L = Mood.lerp(Mood.cusp(h), Math.max(hi, 0.7), 0.3);  // near the hue's most vivid lightness
      out.push(Color.lch(L, Mood.lerp(0.1, 0.19, m), h));
    }
    return out;
  }

  /** Lightness where a hue reaches its highest in-gamut chroma (yellows high, blues low). */
  static cusp(h) {
    let best = 0.6, bestC = 0;
    for(let L = 0.4; L <= 0.96; L += 0.02) {
      let lo = 0, hi = 0.4;
      for(let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if(Color.inGamut(Color.lchToLab([L, mid, h]))) lo = mid; else hi = mid;
      }
      if(lo > bestC) { bestC = lo; best = L; }
    }
    return best;
  }

  static dedupe(colors) {
    const seen = new Set();
    return colors.filter(c => !seen.has(c) && seen.add(c));
  }

  /**
   * Palette from hand-set colors, shaped like a `generate()` result: sorted dark -> light, then split into ramps by hue
   * around the options' primary and secondary hues (within 40deg; near-grays join the secondary, other hues become
   * accents), so adding one saturated color does not flip the scenery hue. When fewer than 2 colors land near the
   * primary hue (the colors were repainted), the hues `estimate()` reads from the colors are used instead. Mood and
   * brightness are always read from the colors.
   */
  static fromColors(hexes, options={}) {
    const lch = c => Color.hexToLch(c);
    const colors = Mood.dedupe(hexes.map(c => c.toUpperCase())).sort((a, b) => lch(a)[0] - lch(b)[0]);
    const est = Mood.estimate(colors);
    const split = (pH, sH) => {
      const r = { primary: [], secondary: [], accent: [] };
      for(const c of colors) {
        const [, C, h] = lch(c), dp = Math.abs(Color.hueDelta(h, pH)), ds = Math.abs(Color.hueDelta(h, sH));
        if(C < 0.03) r.secondary.push(c);
        else if(dp <= 40 && dp <= ds) r.primary.push(c);
        else if(ds <= 40) r.secondary.push(c);
        else r.accent.push(c);
      }
      return r;
    };
    let ramps = options.primary && options.secondary? split(lch(options.primary)[2], lch(options.secondary)[2]): null;
    if(!ramps || ramps.primary.length < 2) ramps = split(lch(est.primary)[2], lch(est.secondary)[2]);
    if(!ramps.primary.length) ramps.primary.push(...colors);
    return { colors, ramps, options: { ...Mood.DEFAULTS, ...options, mood: est.mood, brightness: est.brightness, count: colors.length, manual: true } };
  }
  //#endregion

  //#region [ Estimate ]
  /**
   * Guesses generator inputs from an existing palette (for comparing against references).
   * @param {string[]} colors
   * @param {number[]} [share] - weights (e.g. % of image), defaults to equal
   */
  static estimate(colors, share) {
    const w = share ?? colors.map(() => 1);
    const total = w.reduce((a, v) => a + v, 0);
    const lch = colors.map(Color.hexToLch);

    const meanL = lch.reduce((a, c, i) => a + c[0] * w[i], 0) / total;
    const stdL = Math.sqrt(lch.reduce((a, c, i) => a + (c[0] - meanL) ** 2 * w[i], 0) / total);
    const meanC = lch.reduce((a, c, i) => a + c[1] * w[i], 0) / total;

    let pi = 0;
    lch.forEach((c, i) => { if(w[i] * (c[1] + 0.02) > w[pi] * (lch[pi][1] + 0.02)) pi = i; });
    let si = -1;
    lch.forEach((c, i) => {
      if(Math.abs(Color.hueDelta(c[2], lch[pi][2])) < 40 || c[1] < 0.03) return;
      if(si < 0 || c[1] * (w[i] + 2) > lch[si][1] * (w[si] + 2)) si = i;
    });
    if(si < 0) si = lch.reduce((best, c, i) => c[0] > lch[best][0]? i: best, 0);

    return {
      primary   : colors[pi],
      secondary : colors[si],
      brightness: Mood.clamp((meanL - 0.2) / 0.55),
      mood      : Mood.clamp(meanC / 0.16 * 0.6 + stdL / 0.25 * 0.4),
      count     : Math.min(15, colors.length)
    };
  }
  //#endregion
}
