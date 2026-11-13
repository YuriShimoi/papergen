/**
 * Scene composer: palette roles + procedural scene presets built from Shapes layers (back -> front).
 * A scene is a pure function of (preset, palette, seed, t): same inputs give the same frame.
 */
class Scene {
  static PRESETS = ['peaks', 'meadow', 'coast', 'sakura', 'autumn', 'rain', 'night', 'city', 'canopy', 'grove'];

  //#region [ Roles ]
  /**
   * Maps a Mood.generate() result to named color roles (only palette colors), in two hue groups (`Scene.groups`):
   * the scenery roles (sky, land, water, clouds) use the primary hue family plus the grays, the object roles
   * (leaves, blossoms, flowers, accents) use the other hues. Light sources (sun, halo, snow) keep the lightest
   * secondary colors whatever their group.
   */
  static roles(pal) {
    const { scene: P, obj: O, gray } = Scene.groups(pal);
    const S = pal.ramps.secondary.length? pal.ramps.secondary: P, A = pal.ramps.accent;
    const pk = Shapes.pick;
    const all = pal.colors;
    // step inside the color's own ramp first, so shading keeps its hue family
    const rampOf = c => [P, S, A].find(r => r.includes(c)) ?? all;
    const shadeOf = c => { const r = rampOf(c), i = r.indexOf(c); return i > 0? r[i - 1]: all[Math.max(0, all.indexOf(c) - 1)]; };
    const lightOf = c => { const r = rampOf(c), i = r.indexOf(c); return i < r.length - 1? r[i + 1]: all[Math.min(all.length - 1, all.indexOf(c) + 1)]; };
    const uniq = list => list.filter((c, i) => list.indexOf(c) === i);
    const bright = pal.options.brightness;
    const lch = c => Color.hexToLch(c), byL = (a, b) => lch(a)[0] - lch(b)[0];
    const near = (c, hue, tol) => Math.abs(Color.hueDelta(lch(c)[2], hue)) <= tol;
    const SG = uniq([...P, ...gray]).sort(byL), top = SG[SG.length - 1];  // scenery colors; the lightest one is the haze
    // objects: the leading object hue (the strongest secondary color, else the strongest accent) and its family
    const lead = [...O].sort((a, b) => (S.includes(b) - S.includes(a)) || lch(b)[1] - lch(a)[1])[0];
    const leafFam = lead? O.filter(c => near(c, lch(lead)[2], 50)): [];
    const accFam = A.length? O.filter(c => near(c, lch(A[0])[2], 30)): [];
    const leaf = Scene.steps(leafFam, gray, P);
    const bloom = Scene.steps(accFam.length >= 2? accFam: leafFam, gray, P, true);  // blossoms / autumn leaves lean light
    return {
      all, P, S, A, O, gray, SG, shadeOf, lightOf, uniq, bright, mood: pal.options.mood,
      sky   : uniq(bright < 0.35
        ? [P[0], pk(P, 0.2), pk(P, 0.45), pk(P, 0.65)]
        : [pk(P, 0.45), pk(P, 0.65), pk(P, 0.85), P[P.length - 1], top]),
      far   : pk(P, 0.6),
      mid   : pk(P, 0.4),
      near  : pk(P, 0.2),
      ground: P[0],
      glow  : S[S.length - 1],
      halo  : uniq([pk(S, 0.55), pk(S, 0.8)]),
      cloud : SG.slice(-3),  // the 3 lightest scenery colors
      leaf,
      water : uniq([pk(P, 0.15), pk(P, 0.35), pk(P, 0.55), top]),
      sea   : P.slice(0, Math.max(2, Math.ceil(P.length * 0.8))),  // scenery-only ramp for wave bodies
      warm  : uniq([...S, ...A]),
      bloom,
      bloomTones: bloom.length >= 3? bloom: uniq([shadeOf(bloom[0]), ...bloom]).slice(0, 3),
      leafRim: pk(S, 0.75),  // sunlit glints on the top clumps
      snow  : [P[P.length - 1], S[S.length - 1]].sort((a, b) => Color.hexToLch(b)[0] - Color.hexToLch(a)[0])[0],
      night : SG.slice(0, 4),  // no accents in a night sky
      accent: A.length? A: [S[S.length - 1]]
    };
  }

  /**
   * Splits a palette into two hue groups, each dark -> light. scene: the primary ramp plus any secondary or accent
   * color within 25deg of the primary hue (chroma-weighted mean). obj: the other hues. Near-grays (chroma < 0.03) have
   * no hue to split by and go to gray, which both sides may use.
   */
  static groups(pal) {
    const lch = c => Color.hexToLch(c), byL = (a, b) => lch(a)[0] - lch(b)[0], uniq = list => list.filter((c, i) => list.indexOf(c) === i);
    const P = pal.ramps.primary;
    let sx = 0, sy = 0;
    for(const c of P) { const [, C, h] = lch(c); sx += Math.cos(h * Math.PI / 180) * C; sy += Math.sin(h * Math.PI / 180) * C; }
    const hue = Math.atan2(sy, sx) * 180 / Math.PI;
    const scene = [...P], obj = [], gray = [];
    for(const c of [...pal.ramps.secondary, ...pal.ramps.accent]) {
      const [, C, h] = lch(c);
      if(C < 0.03) gray.push(c);
      else (Math.abs(Color.hueDelta(h, hue)) < 25? scene: obj).push(c);
    }
    return { scene: uniq(scene).sort(byL), obj: uniq(obj).sort(byL), gray: uniq(gray).sort(byL) };
  }

  /**
   * Up to 3 tones, dark -> light, from one hue family; grays fill the missing steps (lighter ones first when `light`),
   * then the scenery's darkest color as a shared shadow. With no family and no grays (a one-hue palette) the
   * objects fall back to the scenery ramp, as nothing is left to split.
   */
  static steps(fam, gray, P, light=false) {
    const L = c => Color.hexToLch(c)[0], uniq = list => list.filter((c, i) => list.indexOf(c) === i);
    if(fam.length >= 3) return uniq([fam[0], Shapes.pick(fam, 0.5), fam[fam.length - 1]]);
    const out = fam.length? [...fam]: gray.length >= 2? [Shapes.pick(gray, 0.4), gray[gray.length - 1]]: [...gray];
    if(!out.length) return uniq([P[0], Shapes.pick(P, 0.3), Shapes.pick(P, 0.55)]);
    for(const c of gray) if(out.length < 3 && L(c) > L(out[out.length - 1]) + 0.06 && (light || out.length < 2)) out.push(c);
    const darker = [...gray, P[0]].filter(c => L(c) < L(out[0]) - 0.06).sort((a, b) => L(a) - L(b));
    if(out.length < 3 && darker.length) out.unshift(darker[darker.length - 1]);
    for(const c of gray) if(out.length < 3 && L(c) > L(out[out.length - 1]) + 0.06) out.push(c);
    return uniq(out);
  }
  //#endregion

  //#region [ Render ]
  /**
   * Renders one frame into `out` (canvas). skyDither: height of the dithered seams between sky bands, as a share of
   * a band (0 = hard seams, default 0.35).
   * @param {{preset, palette, seed, t?, width, height, px?, dither?, skyDither?, snap?, spread?}} o
   */
  static render(out, o) {
    const px = Math.max(1, o.px ?? 1);
    const W = Math.round(o.width / px), H = Math.round(o.height / px);
    const low = Scene.low ??= document.createElement('canvas');
    low.width = W; low.height = H;
    const ctx = low.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const R = Scene.roles(o.palette);
    R.skyBands = (o.dither ?? 'none') === 'none'? 1: 4;  // extra in-between sky bands for the dither to pattern
    R.skyDither = o.skyDither ?? 0.35;
    const fn = Scene[o.preset] ?? Scene.peaks;
    fn(ctx, W, H, R, o.seed, o.t ?? 0);
    if(o.snap !== false || px > 1) Raster.apply(low, out, o.palette.colors, { px, dither: o.dither ?? 'none', spread: o.spread });
    else {
      out.width = W; out.height = H;
      out.getContext('2d').drawImage(low, 0, 0);
    }
  }

  /** Per-layer rng + noise so one layer's draws never shift another's. */
  static kit(seed, layer) {
    const s = `${seed}:${layer}`;
    return { rng: new Rng(s), noise: Scene.noiseFor(s) };
  }

  static noiseFor(s) {
    Scene.noiseCache ??= new Map();
    if(!Scene.noiseCache.has(s)) Scene.noiseCache.set(s, new Noise(s));
    return Scene.noiseCache.get(s);
  }
  //#endregion

  //#region [ Depth ]
  /** Band count of the current sky (its stops times the extra dither bands). */
  static bandCount(R) { return R.sky.length * (R.skyBands ?? 1); }

  /** Sky colors behind the heights y0..y1 (px) of a sky `horizon` (share of H) tall, padded for its wavy, dithered seams. */
  static behind(R, H, horizon, y0, y1) {
    const n = Scene.bandCount(R), sh = H * horizon, pad = 0.6 * sh / n, out = [];
    for(let k = 0; k <= 8; k++) {
      const y = y0 - pad + (y1 - y0 + pad * 2) * k / 8;
      out.push(Shapes.skyColorAt(R.sky, Math.max(0, Math.min(0.999, y / sh)), n));
    }
    return R.uniq(out);
  }

  /**
   * Depth tones for n receding planes, far -> near: aerial perspective in palette colors. The farthest plane takes the
   * scenery color closest to the sky behind it (`behind`, the sky colors across its ridge) that still reads against every
   * one of them (dL >= 0.035): darker when the palette has room between that sky and `near`, else lighter (night skies
   * take the darks). The planes between step evenly toward `near`. Every plane back moves toward the sky, and with the
   * aerial ramp (`Mood.ramp`) the lighter steps are also the less saturated ones.
   */
  static depthTones(R, behind, near, n) {
    const L = c => Color.hexToLch(c)[0], Ln = L(near), SG = Scene.huePool(R);
    const lo = Math.min(...behind.map(L)), hi = Math.max(...behind.map(L)), gap = 0.035;
    const dark = SG.filter(c => L(c) <= lo - gap && L(c) >= Ln + 0.02), light = SG.filter(c => L(c) >= hi + gap);
    const far = dark.length? dark[dark.length - 1]: light.length? light[0]: R.far;
    if(n < 2) return [far];
    const Lf = L(far), pool = SG.filter(c => c !== far && c !== near && (L(c) - Lf) * (L(c) - Ln) < 0), mids = [];
    for(let k = 1; k < n - 1; k++) {  // in between: closest (OKLab) to the even mix of far and near, so hue stays in family
      const goal = Scene.lab(Color.mix(far, near, k / (n - 1)));
      mids.push(pool.filter(c => !mids.includes(c)).sort((a, b) => Color.dist(Scene.lab(a), goal) - Color.dist(Scene.lab(b), goal))[0] ?? (k / (n - 1) < 0.5? far: near));
    }
    mids.sort((a, b) => (L(b) - L(a)) * Math.sign(Lf - Ln));  // keep them in order from far to near
    return [far, ...mids, near];
  }

  /** Scenery colors for depth planes and haze: the scenery group without its neutral grays (when 3+ hued colors are left). */
  static huePool(R) {
    const hued = R.SG.filter(c => !R.gray.includes(c));
    return hued.length >= 3? hued: R.SG;
  }

  static lab(hex) { return Color.rgbToOklab(Color.hexToRgb(hex)); }

  /**
   * Haze tone for a layer of color c: a scenery color between c and the sky behind it (`toward`), the one closest
   * (OKLab) to a third of the way from c to that sky, so the mist keeps the layer's hue; null when there is none.
   */
  static hazeOf(R, c, toward) {
    const L = x => Color.hexToLch(x)[0], d = Math.sign(L(toward) - L(c));
    if(!d) return null;
    const goal = Scene.lab(Color.mix(c, toward, 0.35));
    const near = Scene.huePool(R).filter(x => (L(x) - L(c)) * d >= 0.025 && (L(x) - L(toward)) * d <= 0.01);
    return near.sort((a, b) => Color.dist(Scene.lab(a), goal) - Color.dist(Scene.lab(b), goal))[0] ?? null;
  }

  /**
   * Haze band (`Shapes.mist`) for a layer of color c: its `hazeOf` tone dithered in over the lower three quarters of the
   * gap between the layer's ridge line (`top`) and where the next layer covers it (`ground`), solid below, broken into
   * rolling fog banks (`wave`, keyed by `key`). Null when there is no haze tone or no room.
   */
  static mistBand(R, c, top, ground, toward, t=0, key='mist') {
    const color = Scene.hazeOf(R, c, toward);
    if(!color || ground - top < 3) return null;
    return { color, y0: ground - (ground - top) * 0.75, y1: ground, t, wave: 0.8, seed: key };
  }

  /** Far cloud tones: the sky band behind it (its shaded base melts into the sky), then the nearest distinct color, lighter when there is one. */
  static farCloud(R, back) {
    const L = c => Color.hexToLch(c)[0], up = R.SG.filter(c => L(c) > L(back) + 0.025), down = R.SG.filter(c => L(c) < L(back) - 0.025);
    const other = up[0] ?? down[down.length - 1];
    return other? [back, other]: [back];
  }

  /** Moonlit rim for a dark silhouette at (x, y) whose lightest tone is `tone`: one step lighter, facing the moon. */
  static moonlit(R, x, y, moon, tone) {
    const dx = moon.sx - x, dy = moon.sy - y, d = Math.hypot(dx, dy) || 1, rim = R.lightOf(tone);
    return rim === tone? {}: { rim, light: [dx / d, dy / d] };
  }
  //#endregion

  //#region [ Shared layers ]
  static skyAndSun(ctx, W, H, R, seed, t, { horizon=0.6, sunX=null, sunY=null, moon=null, stars=null }={}) {
    const k = Scene.kit(seed, 'sky');
    const bands = R.sky.length * (R.skyBands ?? 1);
    Shapes.sky(ctx, { w: W, h: H * horizon + 2, stops: R.sky, bands, wavy: 0.5 / (R.skyBands ?? 1), noise: k.noise, t, dither: R.skyDither ?? 0.35 });
    const night = moon ?? R.bright < 0.35;
    if(stars ?? night) Shapes.stars(ctx, { w: W, h: H * horizon * 0.8, count: Math.round(W * H / 6000), colors: R.uniq([R.lightOf(R.sky[0]), R.glow]), rng: k.rng, t, size: Math.max(1, Math.round(W / 400)) });
    // day: high sun; dusk: low, near the horizon (long glints); night: moon high in the dark bands
    const sx = (sunX ?? k.rng.float(0.2, 0.8)) * W;
    const sy = (sunY ?? (night? k.rng.float(0.12, horizon - 0.25): R.bright > 0.65? k.rng.float(0.15, 0.3): k.rng.float(horizon - 0.24, horizon - 0.1))) * H;
    const r = Math.min(W, H) * (night? 0.06: 0.07);
    const crescent = night && k.rng.chance(0.6);
    Shapes.sun(ctx, { x: sx, y: sy, r, halo: night? R.halo.slice(0, 1): R.halo, disc: R.glow,
      crescent });
    return { sx, sy, r: r * (1 + Shapes.sunHalo(night? R.halo.slice(0, 1): R.halo, R.glow).length * 0.55) };  // r includes the halo
  }

  /** Cloud kind weights by mood level: calm skies favor layers and wisps, energetic ones heaps and towers. */
  static cloudKind(rng, mood) {
    const w = mood < 0.35? { stratus: 3, stratocumulus: 3, cirrus: 2, altocumulus: 2, cumulus: 1, towering: 0 }
            : mood < 0.65? { cumulus: 3, stratocumulus: 2, altocumulus: 2, cirrus: 1, stratus: 1, towering: 1 }
            : { cumulus: 3, towering: 3, stratocumulus: 1, altocumulus: 1, cirrus: 1, stratus: 0 };
    let roll = rng.float(0, Object.values(w).reduce((a, v) => a + v, 0));
    for(const [kind, v] of Object.entries(w)) if((roll -= v) < 0) return kind;
    return 'cumulus';
  }

  /** Box each kind grows into: [min, max] width as a share of W, [min, max] height as a share of that width. */
  static CLOUD_BOX = {
    cumulus      : [0.12, 0.22, 0.45, 0.6],
    towering     : [0.12, 0.2,  0.9,  1.3],
    stratocumulus: [0.3,  0.5,  0.12, 0.18],
    stratus      : [0.35, 0.6,  0.09, 0.14],
    altocumulus  : [0.25, 0.4,  0.25, 0.35],
    cirrus       : [0.25, 0.45, 0.15, 0.25]
  };

  /**
   * Clouds of mood-weighted kinds in three depth tiers (one cloud deck seen in perspective): high ones are near (full
   * size, all three cloud tones, fastest), middle ones two tones, low ones far (60% size, two tones that melt into the
   * sky band behind them, slowest), drift speeds spaced about 2x apart per tier (parallax). Each kind keeps its motion,
   * and every one closes the loop:
   *  - cumulus, towering: big and slow: they billow while drifting only 8-15% of the width per loop (half when far), then
   *    dissolve back to where they started over the last fifth (a dithered crossfade between the two spots)
   *  - far clouds of the other kinds drift the same way, 20-30% of the width per loop
   *  - stratocumulus, altocumulus: drift across and dissolve on the way (dithered: in quickly, then slowly down)
   *  - cirrus: drifts along its wavy line, reshaping as it goes (`Shapes.cirrus`), always mid tier; stratus: drifts
   * x and y snap to whole pixels, so a moving cloud only translates instead of re-rasterizing its edges every frame.
   * `streaks` first lays far streaks into the low sky (`Scene.streaks`). With `sun`, a cloud that would cover it in the
   * still frame starts further along.
   */
  static clouds(ctx, W, H, R, seed, t, { count=4, top=0.08, band=0.3, speed=1, sun=null, horizon=0.6, streaks=true }={}) {
    const k = Scene.kit(seed, 'clouds'), sh = H * horizon, n = Scene.bandCount(R);
    if(streaks) Scene.streaks(ctx, W, H, R, seed, t, horizon);
    for(let i = 0; i < count; i++) {
      const kind = Scene.cloudKind(k.rng, R.mood ?? 0.5);
      const [w0, w1, a0, a1] = Scene.CLOUD_BOX[kind];
      let cw = W * k.rng.float(w0, w1), ch = cw * k.rng.float(a0, a1);
      k.rng.int(1, 2);  // (was the lap count; still drawn so the draws after it stay in step)
      let start = k.rng.float(0, 1);
      const lift = kind === 'cirrus'? 0.5: 1;  // wisps ride higher
      const v = k.rng.float(0, 1), tier = kind === 'cirrus'? 1: v < 0.34? 0: v < 0.67? 1: 2;  // 0 near (high) .. 2 far (low)
      const scale = [1, 0.82, 0.6][tier];
      cw *= scale; ch *= scale;
      const cy = Math.round(H * (top * lift + band * v * lift) - (kind === 'towering'? ch * 0.5: 0));
      const heap = kind === 'cumulus' || kind === 'towering', home = heap || tier === 2;
      const at = home? f => (f % 1) * (W - cw * 0.5) - cw * 0.25: f => (f % 1) * (W + cw * 2) - cw;  // home: a spot in frame
      if(sun && at(start) < sun.sx + sun.r && at(start) + cw > sun.sx - sun.r && cy < sun.sy + sun.r && cy + ch > sun.sy - sun.r) start += 0.45;
      const back = Shapes.skyColorAt(R.sky, Math.max(0, Math.min(0.999, (cy + ch * 0.8) / sh)), n);
      const ramp = kind === 'cirrus' || tier === 0? R.cloud: tier === 1? R.cloud.slice(0, 2): Scene.farCloud(R, back);
      const o = { kind, y: cy, w: cw, h: ch, ramp, rng: new Rng(`${seed}:cloud${i}`) };
      if(home) {
        const g = new Rng(`${seed}:drift${i}`), D = W * (heap? g.float(0.08, 0.15) * (tier === 2? 0.5: 1): g.float(0.2, 0.3));
        const x0 = at(start) - D / 2, a = Math.min(1, (1 - t) / 0.2);
        const draw = (x, fade, inv) => Shapes.cloud(ctx, { ...o, rng: new Rng(`${seed}:cloud${i}`), x: Math.round(x), t, morph: heap, fade, inv });
        draw(x0 + D * t, a, false);
        if(a < 1) draw(x0 + D * (t - 1), 1 - a, true);  // the same cloud back at the start, taking over the other pixels
      } else {
        const lap = (tier === 0? 2: 1) * speed;  // whole crossings per loop; near clouds cross twice as often (parallax)
        const x = at(start + t * lap), g = (x + cw) / (W + cw);  // g: 0 entering at the left .. 1 gone at the right
        const fade = kind === 'stratocumulus' || kind === 'altocumulus'? Math.max(0, Math.min(1, g / 0.15, (1 - g) / 0.85)): 1;
        Shapes.cloud(ctx, { ...o, x: Math.round(x), fade });
      }
    }
  }

  /**
   * Far streaks baked into the low sky (2-3): long thin lenses (`Shapes.streak`), each one band step lighter than the
   * sky behind it (darker when that band is the lightest), crossing in front of a low sun.
   */
  static streaks(ctx, W, H, R, seed, t, horizon) {
    const r = new Rng(seed + ':streaks'), sh = H * horizon, n = Scene.bandCount(R), L = c => Color.hexToLch(c)[0];
    for(let i = 0, count = r.int(2, 3); i < count; i++) {
      const y = sh * r.float(0.55, 0.9), len = W * r.float(0.25, 0.55), x = W * r.float(-0.2, 1) - len * 0.4;
      const th = Math.max(1, Math.round(H * r.float(0.006, 0.012))), g = new Rng(`${seed}:streak${i}`);
      const back = Shapes.skyColorAt(R.sky, Math.min(0.999, y / sh), n);
      const up = R.SG.filter(c => L(c) > L(back) + 0.025), down = R.SG.filter(c => L(c) < L(back) - 0.025);
      const color = up[0] ?? down[down.length - 1];
      if(color) Shapes.streak(ctx, { x, y, len, th, color, rng: g, t });
    }
  }

  /**
   * Foreground overhang (60% of seeds): a close-up branch reaching in along the top from the corner away from the
   * sun, its leaf sprays in the darkest object tones. Only drawn when the sky top is clearly lighter than the leaves,
   * so it never reads as dark smudges on a dark sky.
   */
  static overhang(ctx, W, H, R, seed, t, sun=null) {
    const f = new Rng(seed + ':canopy');
    if(!f.chance(0.6) || Color.hexToLch(R.sky[0])[0] - Color.hexToLch(R.leaf[0])[0] < 0.1) return;  // silhouette must read
    const fromLeft = sun? sun.sx > W / 2: f.chance(0.5);
    const room = sun? Math.abs(sun.sx - (fromLeft? 0: W)) - sun.r * 1.3: W * 0.5;
    const reach = Math.min(W * f.float(0.3, 0.42), room);
    if(reach < W * 0.16) return;
    const tilt = f.float(0.15, 0.4);
    Shapes.branch(ctx, { x: fromLeft? -W * 0.03: W * 1.03, y: H * f.float(-0.02, 0.06), len: reach, angle: fromLeft? tilt: Math.PI - tilt,
      bark: [R.ground], leaves: R.uniq([R.leaf[0], Shapes.pick(R.leaf, 0.5)]), rng: f, t, size: H * 0.04, wid: H * 0.03, rise: -0.05 });
  }

  /**
   * Mountain ranges back -> front, two at most (more crowd the scenery); far and near keep the first and last style.
   * Tones come from `depthTones` (the far range as close to the sky behind its peaks as still reads), and each range
   * gets a haze band at its base (`mistBand`) down to where the next range, or `floor` (px), covers it. `tones`
   * overrides the colors (a mirrored copy); `haze: false` drops the bands.
   */
  static ranges(ctx, W, H, R, seed, { from=0.3, to=0.62, layers=2, snow=true, styles=['ridged', 'ridged', 'jagged'], horizon=0.6, floor=null, haze=true, tones=null, t=0 }={}) {
    const n = Math.min(2, layers), sh = H * horizon, bands = Scene.bandCount(R);
    const L = Array.from({ length: n }, (_, i) => { const f = i / Math.max(1, n - 1); return { f, y: H * (from + (to - from) * f * 0.8), h: H * (0.28 - f * 0.12) }; });
    const colors = tones ?? Scene.depthTones(R, Scene.behind(R, H, horizon, L[0].y, L[0].y + L[0].h * 0.55), R.near, n);
    for(let i = 0; i < n; i++) {
      const { f, y, h } = L[i], k = Scene.kit(seed, 'range' + i), c = colors[Math.min(colors.length - 1, i)];
      const ground = i < n - 1? L[i + 1].y + L[i + 1].h * 0.6: floor;
      const mist = haze && ground !== null? Scene.mistBand(R, c, y + h * 0.45, ground, Shapes.skyColorAt(R.sky, Math.min(0.999, ground / sh), bands), t, `${seed}:range${i}`): null;
      Shapes.mountains(ctx, {
        y, h, bottom: H, w: W, color: c, shade: R.shadeOf(c), snow: snow && i === 0? R.snow: null, haze: mist,
        noise: k.noise, style: styles[Math.round(f * (styles.length - 1))], freq: 2 + i * 1.3, seedX: k.rng.float(0, 50)
      });
    }
  }
  //#endregion

  //#region [ Presets ]
  /** Mountain lake: sky, sun, clouds, ranges, lake with glint, pine shore, grass */
  static peaks(ctx, W, H, R, seed, t) {
    const sun = Scene.skyAndSun(ctx, W, H, R, seed, t, { horizon: 0.66 }), { sx } = sun;
    Scene.clouds(ctx, W, H, R, seed, t, { count: 3, sun, horizon: 0.66 });
    Scene.ranges(ctx, W, H, R, seed, { from: 0.28, to: 0.55, horizon: 0.66, floor: H * 0.66, t });
    const k = Scene.kit(seed, 'lake');
    Shapes.water(ctx, { x: 0, y: H * 0.66, w: W, h: H * 0.34, ramp: R.water, rng: k.rng, t, dashes: Math.round(W / 12), glint: { x: sx, w: W * 0.08, color: R.glow } });
    const s = Scene.kit(seed, 'shore');
    Shapes.hills(ctx, { y: H * 0.74, h: H * 0.12, bottom: H, w: W, color: R.ground, noise: s.noise, freq: 2.5 });
    for(let i = 0; i < 9; i++) {
      const x = s.rng.chance(0.5)? s.rng.float(0, 0.22) * W: s.rng.float(0.78, 1) * W;
      const py = H * s.rng.float(0.84, 0.9), ph = H * s.rng.float(0.14, 0.26);  // at night the moon rims them
      Shapes.pine(ctx, { x, y: py, h: ph, bark: [R.ground], leaves: [R.ground, R.near], rng: s.rng, t, ...(R.bright < 0.35? Scene.moonlit(R, x, py - ph * 0.6, sun, R.near): {}) });
    }
    Shapes.grass(ctx, { x: 0, y: H * 0.86, w: W, h: H * 0.14, ramp: [R.ground, R.near], rng: s.rng, noise: s.noise, t, rows: 2 });
    Scene.overhang(ctx, W, H, R, seed, t, sun);
  }

  /** Rolling meadow: hills, big round tree, bushes, grass, drifting leaves */
  static meadow(ctx, W, H, R, seed, t) {
    const sun = Scene.skyAndSun(ctx, W, H, R, seed, t, { horizon: 0.62, stars: false });
    Scene.clouds(ctx, W, H, R, seed, t, { count: 5, band: 0.25, sun, horizon: 0.62 });
    const hy = i => H * (0.48 + i * 0.1), hh = H * 0.16, low = Shapes.skyColorAt(R.sky, 0.999, Scene.bandCount(R));
    const hills = Scene.depthTones(R, Scene.behind(R, H, 0.62, hy(0), hy(0) + hh * 0.6), R.near, 3);  // far -> near, toward the sky
    hills.forEach((c, i) => {
      const k = Scene.kit(seed, 'hill' + i);
      const haze = Scene.mistBand(R, c, hy(i) + hh * 0.5, i < 2? hy(i + 1) + hh * 0.5: H * 0.84, low, t, `${seed}:hill${i}`);  // down to the next hill's crest
      const top = Shapes.hills(ctx, { y: hy(i), h: hh, bottom: H, w: W, color: c, rim: R.lightOf(c), noise: k.noise, freq: 1.2 + i * 0.6, seedX: k.rng.float(0, 40), haze });
      if(i > 1) return;
      // distant trees planted on this hill's crest, in the hill's own tones (aerial perspective)
      const tr = new Rng(`${seed}:hilltrees${i}`), tones = R.uniq([R.shadeOf(c), c, R.lightOf(c)]);
      const crest = x => top[Math.max(0, Math.min(top.length - 1, Math.round(x / W * (top.length - 1))))][1] + H * 0.012;
      for(let j = tr.int(1, 3), first = true; j > 0; j--, first = false) {
        const [px, py] = top[Math.floor(tr.float(0.05, 0.95) * (top.length - 1))], th = H * (0.07 + i * 0.05);
        const b = new Rng(`${seed}:hillbush${i}`);  // far bushes: one group behind the first tree, in the hill's tones so they melt into it
        if(first && b.chance(0.7)) Scene.bushes(ctx, { cx: px + (b.chance(0.5)? 1: -1) * th * 0.3, base: crest, n: b.int(3, 4), size: th * 0.4, spread: th * 0.45, ramp: tones, rng: b, t, behind: py + H * 0.012 });
        Shapes.tree(ctx, { x: px, y: py + H * 0.012, h: th, bark: [R.shadeOf(c)], leaves: tones, rng: tr, kind: 'round', lod: 'far', t });
      }
    });
    const k = Scene.kit(seed, 'tree'), bk = new Rng(seed + ':bushes');
    const tx = W * (k.rng.chance(0.5)? k.rng.float(0.18, 0.34): k.rng.float(0.66, 0.82)), th = H * 0.55;  // rule of thirds
    // bushes grow in overlapping groups of 3+, only around the tree's foot or in the foreground (far ones sit behind the
    // hill trees above). The tree's group grows behind the trunk, with at most one bush in front, beside the trunk.
    const fn = bk.int(3, 4), fs = W * bk.float(0.075, 0.1), side = bk.chance(0.5)? 1: -1, one = bk.chance(0.5);
    Scene.bushes(ctx, { cx: tx + bk.float(-0.03, 0.03) * W, base: H * 0.84, n: fn, size: fs, spread: fs * 0.45 * (fn - 1), ramp: R.leaf, rng: bk, t, behind: H * 0.84 });
    Shapes.tree(ctx, { x: tx, y: H * 0.84, h: th, bark: [R.ground, R.near], leaves: R.leaf, rng: k.rng, kind: 'round', lod: 'mid', t });
    if(one) {
      const bw = fs * bk.float(0.6, 0.8);
      Shapes.bush(ctx, { x: tx + side * (th * 0.06 + bw * 0.55) - bw / 2, y: H * 0.852 - bw * 0.6, w: bw, h: bw * 0.6, ramp: R.leaf, rng: bk, t });
    }
    Shapes.grass(ctx, { x: 0, y: H * 0.84, w: W, h: H * 0.16, ramp: [R.ground, R.near, R.mid], rng: k.rng, noise: k.noise, t, rows: 3, density: 1.2 });
    Shapes.flowers(ctx, { y: H * 0.88, w: W, h: H * 0.11, colors: R.uniq([...R.accent, R.bloom[R.bloom.length - 1]]), stem: R.near, center: R.glow,
      rng: new Rng(seed + ':flowers'), t, count: Math.round(W / 12), size: Math.max(1, W / 320) });
    if(bk.chance(0.6)) {  // foreground group, on the side away from the tree, cut by the frame bottom
      const size = W * bk.float(0.13, 0.18);
      Scene.bushes(ctx, { cx: W * (tx < W / 2? bk.float(0.72, 0.92): bk.float(0.08, 0.28)), base: H * bk.float(1, 1.04), n: bk.int(3, 4), size, spread: size * 0.5 * 2.5, ramp: R.leaf, rng: bk, t });
    }
    Shapes.scatterLeaves(ctx, { w: W, h: H * 0.85, colors: R.bloom, rng: new Rng(seed + ':fall'), count: 18, size: W / 90, t, fall: true });
  }

  /**
   * A bush group (3 or more), drawn back to front around x = cx: widths vary around `size` (the middle ones bigger),
   * spread over `spread` px so they overlap, bases on `base` (a y, or x -> y to follow a crest), staggered a little in
   * depth (every other one set forward) so they layer instead of lining up. `behind`: the ground y of a tree drawn
   * over the group; every base then stays above it (the stagger sets bushes back instead), so the trunk foot shows
   * in front of the bushes instead of floating over one.
   */
  static bushes(ctx, { cx, base, n=3, size, spread, ramp, rng, t=0, behind=null }) {
    const at = typeof base === 'function'? base: () => base, list = [];
    for(let i = 0; i < n; i++) {
      const u = n > 1? i / (n - 1) - 0.5: 0, bw = size * rng.float(0.75, 1.1) * (1 - Math.abs(u) * 0.4);
      const x = cx + u * spread + rng.float(-0.1, 0.1) * size, d = i % 2? rng.float(0.06, 0.14): rng.float(-0.04, 0.03);
      list.push([x, behind === null? at(x) + d * size: Math.min(at(x), behind - Math.max(1, size * 0.06)) - (d + 0.04) * size, bw]);
    }
    list.sort((a, b) => a[1] - b[1]);
    for(const [x, b, bw] of list) Shapes.bush(ctx, { x: x - bw / 2, y: b - bw * 0.6, w: bw, h: bw * 0.6, ramp, rng, t });
  }

  /** Coast: low sun over wave rows, cliff on one side, birds-free foam */
  static coast(ctx, W, H, R, seed, t) {
    const c = Scene.kit(seed, 'cliff');
    const left = c.rng.chance(0.5);  // decide the cliff side first so the sun sets over open sea
    const sunX = left? new Rng(seed + ':sun').float(0.55, 0.85): new Rng(seed + ':sun').float(0.15, 0.45);
    const sun = Scene.skyAndSun(ctx, W, H, R, seed, t, { horizon: 0.58, sunY: 0.48, sunX }), { sx } = sun;
    Scene.clouds(ctx, W, H, R, seed, t, { count: 4, band: 0.2, sun, horizon: 0.58 });
    const k = Scene.kit(seed, 'sea');
    Shapes.water(ctx, { x: 0, y: H * 0.58, w: W, h: H * 0.42, ramp: R.water, rng: k.rng, t, dashes: 0 });
    Shapes.waves(ctx, { x: 0, y: H * 0.6, w: W, h: H * 0.4, ramp: R.sea, foam: R.snow, t, rows: 6, rng: k.rng });
    Shapes.water(ctx, { x: 0, y: H * 0.6, w: W, h: H * 0.4, ramp: R.water, rng: k.rng, t, bands: 0, dashes: 0, glint: { x: sx, w: W * 0.08, color: R.glow } });
    Shapes.cliff(ctx, { left, w: W, top: H * c.rng.float(0.28, 0.4), sea: H * 0.62, bottom: H, reach: W * c.rng.float(0.3, 0.42),
      color: R.near, shade: R.ground, rim: R.lightOf(R.lightOf(R.near)), grass: R.lightOf(R.near), foam: R.lightOf(R.water[R.water.length - 2]), rng: c.rng, t });
    Shapes.grass(ctx, { x: 0, y: H * 0.9, w: W, h: H * 0.1, ramp: [R.ground, R.near], rng: c.rng, noise: c.noise, t, rows: 1, density: 0.6 });
  }

  /** Sakura: distant mountains, moon, a blossom branch from the side, falling petals */
  static sakura(ctx, W, H, R, seed, t) {
    Scene.skyAndSun(ctx, W, H, R, seed, t, { horizon: 0.7 });
    Scene.ranges(ctx, W, H, R, seed, { from: 0.42, to: 0.6, layers: 2, snow: false, styles: ['smooth', 'ridged'], horizon: 0.7, floor: H * 0.79, t });
    const k = Scene.kit(seed, 'sakura');
    Shapes.hills(ctx, { y: H * 0.74, h: H * 0.1, bottom: H, w: W, color: R.ground, noise: k.noise, freq: 1 });
    const blossom = R.bloom;
    const fromLeft = k.rng.chance(0.5);
    Shapes.branch(ctx, { x: fromLeft? -W * 0.02: W * 1.02, y: H * k.rng.float(0.15, 0.4), len: W * 0.75, angle: fromLeft? 0.15: Math.PI - 0.15, bark: [R.ground, R.near], leaves: R.bloomTones, rng: k.rng, t, blossom: true, size: W * 0.03, depth: 5, sides: 1.3 });
    Shapes.scatterLeaves(ctx, { w: W, h: H, colors: blossom, rng: new Rng(seed + ':petals'), count: 40, size: W / 110, t, fall: true, petal: true });
  }

  /** Autumn river: hills of round trees in warm tones, a winding river, falling leaves */
  static autumn(ctx, W, H, R, seed, t) {
    const sun = Scene.skyAndSun(ctx, W, H, R, seed, t, { horizon: 0.5, stars: false });
    Scene.clouds(ctx, W, H, R, seed, t, { count: 3, band: 0.15, sun, horizon: 0.5 });
    Scene.ranges(ctx, W, H, R, seed, { from: 0.3, to: 0.45, layers: 2, snow: false, styles: ['smooth', 'smooth'], horizon: 0.5, floor: H * 0.5, t });
    const k = Scene.kit(seed, 'river');
    ctx.fillStyle = R.near; ctx.fillRect(0, H * 0.5, W, H * 0.5);
    // river: a widening band that wanders with 1D noise
    const river = new Path2D();
    const left = [], right = [];
    for(let y = H * 0.5; y <= H + 4; y += 4) {
      const f = (y - H * 0.5) / (H * 0.5);
      const cx = W * (0.5 + 0.25 * k.noise.fbm1(f * 2 + 3, 2));
      const hw = W * (0.015 + 0.2 * f * f);
      left.push([cx - hw, y]); right.push([cx + hw, y]);
    }
    river.moveTo(...left[0]);
    left.forEach(p => river.lineTo(...p));
    right.reverse().forEach(p => river.lineTo(...p));
    river.closePath();
    ctx.save(); ctx.clip(river);
    Shapes.water(ctx, { x: 0, y: H * 0.5, w: W, h: H * 0.5, ramp: R.water, rng: k.rng, t, dashes: Math.round(W / 8) });
    ctx.restore();
    const warm = R.bloom.length >= 2? R.bloom: R.leaf;
    const trees = [];
    for(let i = 0; i < 22; i++) trees.push([k.rng.float(-0.05, 1.05) * W, H * k.rng.float(0.5, 1.05)]);
    trees.sort((a, b) => a[1] - b[1]);
    for(const [x, y] of trees) {
      const f = (y / H - 0.5) / 0.5;
      const cx = W * (0.5 + 0.25 * k.noise.fbm1(f * 2 + 3, 2)), hw = W * (0.015 + 0.2 * f * f);
      if(Math.abs(x - cx) < hw + W * 0.03) continue;
      Shapes.tree(ctx, { x, y, h: H * (0.12 + f * 0.3), bark: [R.ground], leaves: R.bloomTones, rng: k.rng, kind: 'round', lod: f > 0.7? 'mid': 'far', depth: 4, t });
    }
    Shapes.scatterLeaves(ctx, { w: W, h: H, colors: warm, rng: new Rng(seed + ':leaves'), count: 30, size: W / 100, t, fall: true });
  }

  /** Rain: night pines in mist layers, puddle, rain streaks, droplets on the glass */
  static rain(ctx, W, H, R, seed, t) {
    const k = Scene.kit(seed, 'rain');
    Shapes.sky(ctx, { w: W, h: H, stops: R.sky, bands: R.sky.length * (R.skyBands ?? 1), wavy: 0.3, noise: k.noise, t });
    Shapes.cloudBank(ctx, { x: 0, y: 0, w: W, h: H * 0.35, ramp: R.uniq([R.lightOf(R.sky[0]), R.lightOf(R.lightOf(R.sky[0]))]), noise: k.noise, t, step: Math.max(2, Math.round(W / 160)) });
    const rows = Scene.depthTones(R, Scene.behind(R, H, 1, H * 0.33, H * 0.55), R.ground, 4), low = R.sky[R.sky.length - 1];
    rows.forEach((c, i) => {
      const n = 14 - i * 2, base = H * (0.55 + i * 0.1);
      for(let j = 0; j < n; j++) {
        const x = (j + k.rng.float(0, 0.8)) / n * W;
        Shapes.pine(ctx, { x, y: base, h: H * (0.18 + i * 0.07) * k.rng.float(0.7, 1.2), bark: [c], leaves: [c, c], rng: k.rng, t });
      }
      ctx.fillStyle = c; ctx.fillRect(0, base - 1, W, H);
      const haze = i < rows.length - 1? Scene.hazeOf(R, c, low): null;  // mist rising off each row; the next row stands in front of it
      if(haze) Shapes.mist(ctx, { w: W, y0: base - H * 0.12, y1: base + H * 0.02, bottom: base + H * 0.1, color: haze, t, wave: 0.9, seed: `${seed}:rows${i}`, scale: 3.5 });
    });
    Shapes.water(ctx, { x: 0, y: H * 0.86, w: W, h: H * 0.14, ramp: R.water, rng: k.rng, t, dashes: Math.round(W / 14) });
    Shapes.rain(ctx, { w: W, h: H, color: R.lightOf(R.far), head: R.lightOf(R.lightOf(R.far)), rng: new Rng(seed + ':drops'), t, count: Math.round(W / 6), len: Math.max(3, Math.round(H / 30)), speed: 3 });
    const d = new Rng(seed + ':glass'), wet = R.uniq([R.mid, R.far, R.glow]);
    for(let i = 0; i < 36; i++) {  // small noisy drops on the glass; a few slide down, leaving a broken streak
      const x = d.float(0.03, 0.97) * W, y0 = d.float(0.05, 0.9) * H, r = Math.max(1, W / d.int(160, 360));
      const sliding = d.chance(0.25), ph = d.float(0, 1), sp = d.int(1, 2), run = sliding? ((ph + t * sp) % 1) * H * 0.3: 0;
      Shapes.droplet(ctx, { x, y: y0 + run, r, ramp: wet, seed: i * 7919 + 13, trail: sliding? Math.round(Math.min(run, r * 6)): 0 });
    }
  }

  /** Night lake: stars, moon, mist over the ranges, the ranges mirrored in still water with the moon's glint, pine shore, fireflies */
  static night(ctx, W, H, R, seed, t) {
    R = { ...R, sky: R.night, halo: [R.P[Math.min(2, R.P.length - 1)]] };
    const shore = H * 0.62;
    const sun = Scene.skyAndSun(ctx, W, H, R, seed, t, { horizon: 0.62, moon: true, stars: true }), { sx } = sun;
    const ranges = { from: 0.34, to: 0.46, layers: 2, snow: false, styles: ['smooth', 'jagged'], horizon: 0.62, floor: shore, t };
    Scene.ranges(ctx, W, H, R, seed, ranges);
    const k = Scene.kit(seed, 'night');
    Shapes.cloud(ctx, { kind: 'stratus', x: W * k.rng.float(-0.1, 0.3), y: H * 0.5, w: W * 0.8, h: H * 0.035, ramp: R.uniq([R.mid, R.far]), rng: k.rng });  // mist layer
    // lake: bands, then the ranges mirrored and squashed in darker tones, then shimmer + moon glint on top
    const lake = R.uniq([R.ground, R.near, R.mid]);
    Shapes.water(ctx, { x: 0, y: shore, w: W, h: H - shore, ramp: lake, rng: k.rng, t, dashes: 0 });
    ctx.save();
    ctx.beginPath(); ctx.rect(0, shore, W, H - shore); ctx.clip();
    ctx.translate(0, shore * 1.6); ctx.scale(1, -0.6);
    Scene.ranges(ctx, W, H, { ...R, shadeOf: () => R.ground }, seed, { ...ranges, tones: [R.near, R.ground], haze: false });
    ctx.restore();
    Shapes.water(ctx, { x: 0, y: shore, w: W, h: H - shore, ramp: lake, rng: k.rng, t, bands: 0, dashes: Math.round(W / 14), glint: { x: sx, w: W * 0.07, color: R.glow } });
    Shapes.hills(ctx, { y: H * 0.8, h: H * 0.1, bottom: H, w: W, color: R.ground, noise: k.noise, freq: 1.4 });
    for(let i = 0; i < 9; i++) {
      const x = k.rng.chance(0.5)? k.rng.float(0, 0.3) * W: k.rng.float(0.7, 1) * W;
      const py = H * k.rng.float(0.88, 1), ph = H * k.rng.float(0.2, 0.34);
      Shapes.pine(ctx, { x, y: py, h: ph, bark: [R.ground], leaves: [R.ground, R.near], rng: k.rng, t, ...Scene.moonlit(R, x, py - ph * 0.6, sun, R.near) });
    }
    const f = new Rng(seed + ':flies');
    for(let i = 0; i < 24; i++) {
      const a = Shapes.TAU * (t * f.int(1, 2) + f.float(0, 1));
      const x = f.float(0, 1) * W + Math.cos(a) * W * 0.02, y = H * f.float(0.7, 0.97) + Math.sin(a * 2) * H * 0.015;
      const on = Shapes.wave(t, f.int(1, 3), f.float(0, 6)) > 0;
      ctx.fillStyle = on? R.accent[0]: R.near;
      const s = Math.max(1, Math.round(W / 300));
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
  }

  /** City at dusk across water: skyline layers (far plain, near with lit windows), reflections, low sun */
  static city(ctx, W, H, R, seed, t) {
    const sun = Scene.skyAndSun(ctx, W, H, R, seed, t, { horizon: 0.72, sunY: 0.5 }), { sx } = sun;
    Scene.clouds(ctx, W, H, R, seed, t, { count: 3, band: 0.2, sun, horizon: 0.72 });
    const k = Scene.kit(seed, 'city');
    const lit = R.uniq([R.glow, ...R.accent.slice(0, 2)]), low = Shapes.skyColorAt(R.sky, 0.999, Scene.bandCount(R));
    const [cf, cm, cn] = Scene.depthTones(R, Scene.behind(R, H, 0.72, H * 0.38, H * 0.6), R.near, 3);
    const far = Shapes.skyline(ctx, { y: H * 0.38, h: H * 0.25, bottom: H * 0.73, w: W, color: cf, rng: k.rng, minW: 0.02, maxW: 0.05 });
    const fh = Scene.hazeOf(R, cf, low);  // haze over the lower blocks of each skyline, clipped to its towers
    if(fh) Shapes.mist(ctx, { w: W, y0: H * 0.56, y1: H * 0.7, bottom: H * 0.73, color: fh, clip: far.sil, t, wave: 0.6, seed: `${seed}:cityfar` });
    const mid = Shapes.skyline(ctx, { y: H * 0.45, h: H * 0.22, bottom: H * 0.73, w: W, color: cm, rng: k.rng, minW: 0.03, maxW: 0.06 });
    const mh = Scene.hazeOf(R, cm, low);
    if(mh) Shapes.mist(ctx, { w: W, y0: H * 0.62, y1: H * 0.72, bottom: H * 0.73, color: mh, clip: mid.sil, t, wave: 0.6, seed: `${seed}:citymid` });
    const towers = Shapes.skyline(ctx, { y: H * 0.5, h: H * 0.2, bottom: H * 0.73, w: W, color: cn, lit, rng: k.rng, t, minW: 0.05, maxW: 0.1 });
    Shapes.water(ctx, { x: 0, y: H * 0.73, w: W, h: H * 0.27, ramp: R.water, rng: k.rng, t, dashes: Math.round(W / 10), glint: { x: sx, w: W * 0.07, color: R.glow } });
    // window reflections: broken vertical dashes under the near towers
    const r = new Rng(seed + ':refl'), nz = Shapes.noiseFor(seed + ':refl');
    for(const [bx, , tw] of towers) {
      if(r.chance(0.5)) continue;
      const color = r.pick(lit), ch = r.float(0, 40);
      Shapes.glint(ctx, { x: bx + tw / 2, w: tw * 0.35, y: H * 0.735, h: H * 0.2, color, dim: R.water[R.water.length - 2], t, noise: nz, ch });
    }
    ctx.fillStyle = R.ground;
    ctx.fillRect(0, H * 0.72, W, Math.max(2, H * 0.012));
  }

  /**
   * Looking up through tree crowns: sky bands ringing the sun (no clouds: side-view clouds read wrong from below), then branches reaching in from the
   * frame edges toward the zenith in depth layers: far ones long and thin with small light leaves, near ones thick
   * with big dark leaves. Leaves around the sun turn translucent.
   */
  static canopy(ctx, W, H, R, seed, t) {
    const k = Scene.kit(seed, 'canopy');
    const zx = W * k.rng.float(0.4, 0.6), zy = H * k.rng.float(0.38, 0.6);  // zenith: where the branches point
    const sx = zx + W * k.rng.float(-0.12, 0.12), sy = zy + H * k.rng.float(-0.2, 0.05), sr = Math.min(W, H) * 0.07;
    const bands = R.sky.length * (R.skyBands ?? 1), far = Math.hypot(Math.max(sx, W - sx), Math.max(sy, H - sy));
    Shapes.rings(ctx, { w: W, h: H, cx: sx, cy: sy, noise: k.noise, dither: R.skyDither ?? 0.35,  // rings around the sun, a little uneven
      radii: Array.from({ length: bands }, (_, i) => sr * 2 + (far - sr * 2) * ((bands - i) / bands) ** 1.35),
      colors: Array.from({ length: bands }, (_, i) => Shapes.bandColor(R.sky, i, bands)) });
    if(R.bright < 0.35) Shapes.stars(ctx, { w: W, h: H, count: Math.round(W * H / 5000), colors: R.uniq([R.lightOf(R.sky[0]), R.glow]), rng: k.rng, t, size: Math.max(1, Math.round(W / 400)) });
    Shapes.sun(ctx, { x: sx, y: sy, r: sr, halo: R.halo, disc: R.glow });
    const P = R.P, pk = Shapes.pick, F = R.leaf;  // bark in scenery darks, leaves in the object tones (lighter when far)
    const layers = [  // far -> near: branches, reach toward the zenith, leaf size and limb width (shares of H), tones
      { n: 9, reach: [0.45, 0.7], size: 0.032, wid: 0.012, depth: 3, leaves: R.uniq([pk(F, 0.5), pk(F, 1)]), bark: pk(P, 0.2) },
      { n: 7, reach: [0.35, 0.6], size: 0.046, wid: 0.022, depth: 3, leaves: R.uniq([F[0], pk(F, 0.5)]), bark: P[0] },
      { n: 4, reach: [0.25, 0.45], size: 0.07, wid: 0.045, depth: 4, leaves: R.uniq([P[0], F[0]]), bark: P[0] }
    ];
    layers.forEach((L, li) => {
      const r = new Rng(`${seed}:canopy${li}`), off = r.float(0, 1);
      for(let i = 0; i < L.n; i++) {
        const phi = (i + off + r.float(-0.3, 0.3)) / L.n * Shapes.TAU, c = Math.cos(phi), s = Math.sin(phi);
        const d = Math.min(c > 0? (W - zx) / c: c < 0? -zx / c: Infinity, s > 0? (H - zy) / s: s < 0? -zy / s: Infinity);
        Shapes.branch(ctx, { x: zx + c * d * 1.06, y: zy + s * d * 1.06, len: d * r.float(L.reach[0], L.reach[1]), angle: phi + Math.PI + r.float(-0.25, 0.25),
          bark: [L.bark], leaves: L.leaves, rng: r, t, size: H * L.size, wid: H * L.wid, tone: 'flat', rise: 0, depth: L.depth, sides: 2, from: 0.1,
          glow: { x: sx, y: sy, r: sr * 3.2, color: R.leafRim } });
      }
    });
  }

  /**
   * Grove, looking straight up through tree tops (`Shapes.treetop`): sky rings around the sun, a far ring of 5-6
   * crowns reaching in from every side (lighter tones, small sky hole around the zenith), then 2-4 big near crowns over
   * the corners (full object tones, a wider hole), leaves around the sun glowing, a few leaves drifting down.
   * Each crown sits so it spans from the hole's edge to past the frame, so no sky shows between crown and frame.
   */
  static grove(ctx, W, H, R, seed, t) {
    const k = Scene.kit(seed, 'grove');
    const zx = W * k.rng.float(0.42, 0.58), zy = H * k.rng.float(0.42, 0.58);  // zenith: where every crown points
    const sx = zx + W * k.rng.float(-0.08, 0.08), sy = zy + H * k.rng.float(-0.1, 0.06), sr = Math.min(W, H) * 0.06;
    const bands = R.sky.length * (R.skyBands ?? 1), far = Math.hypot(Math.max(sx, W - sx), Math.max(sy, H - sy));
    Shapes.rings(ctx, { w: W, h: H, cx: sx, cy: sy, noise: k.noise, dither: R.skyDither ?? 0.35,
      radii: Array.from({ length: bands }, (_, i) => sr * 2 + (far - sr * 2) * ((bands - i) / bands) ** 1.35),
      colors: Array.from({ length: bands }, (_, i) => Shapes.bandColor(R.sky, i, bands)) });
    if(R.bright < 0.35) Shapes.stars(ctx, { w: W, h: H, count: Math.round(W * H / 6000), colors: R.uniq([R.lightOf(R.sky[0]), R.glow]), rng: k.rng, t, size: Math.max(1, Math.round(W / 400)) });
    Shapes.sun(ctx, { x: sx, y: sy, r: sr, halo: R.halo, disc: R.glow });
    const F = R.leaf, pk = Shapes.pick, glow = { x: sx, y: sy, r: sr * 3, color: R.leafRim };
    const crown = (a, r0, hole, tones, bark, g, spread) => {
      const c = Math.cos(a), s = Math.sin(a);
      const d = Math.min(c > 0? (W - zx) / c: c < 0? -zx / c: Infinity, s > 0? (H - zy) / s: s < 0? -zy / s: Infinity);  // zenith -> frame edge
      const r = Math.max(r0, (d - hole) * 0.6) * g.float(0.9, 1.1), D = hole + r * 0.95;
      Shapes.treetop(ctx, { x: zx + c * D, y: zy + s * D, r, bark, tones, rng: g, t, dir: a + Math.PI, spread, size: r * 0.05, glow });
    };
    const fr = new Rng(seed + ':grovefar'), n = fr.int(5, 6), off = fr.float(0, 1);
    for(let i = 0; i < n; i++)
      crown((i + off + fr.float(-0.15, 0.15)) / n * Shapes.TAU, H * 0.42, H * fr.float(0.16, 0.26), R.uniq([pk(F, 0.5), pk(F, 1)]), [R.near], fr, fr.float(1.4, 1.9));
    const nr = new Rng(seed + ':grovenear');
    for(const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      const a = Math.atan2(cy - zy, cx - zx) + nr.float(-0.2, 0.2), keep = nr.chance(0.7);
      if(keep) crown(a, H * 0.75, H * nr.float(0.34, 0.44), F, [R.ground, R.near], nr, nr.float(1.3, 1.7));
    }
    Shapes.scatterLeaves(ctx, { w: W, h: H, colors: R.bloom, rng: new Rng(seed + ':grovefall'), count: 12, size: W / 100, t, fall: true });
  }
  //#endregion
}
