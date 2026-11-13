/** Seeded noise: Perlin 2D/3D (improved, quintic fade), fBm, ridged, turbulence, domain warp, Worley, 1D line noise. */
class Noise {
  /** @param {number|string} seed */
  constructor(seed=1) {
    const rng = new Rng(seed);
    const p = rng.shuffle([...Array(256).keys()]);
    this.perm = new Uint8Array(512);
    for(let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.seedOffset = rng.float(0, 1000);
  }

  static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  static lerp(a, b, t) { return a + (b - a) * t; }

  static grad3(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8? x: y;
    const v = h < 4? y: (h === 12 || h === 14? x: z);
    return ((h & 1)? -u: u) + ((h & 2)? -v: v);
  }

  //#region [ Perlin ]
  /** 3D improved Perlin, about -1..1 */
  perlin3(x, y, z) {
    const P = this.perm;
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = Noise.fade(x), v = Noise.fade(y), w = Noise.fade(z);
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
    const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    const L = Noise.lerp, G = Noise.grad3;
    return L(
      L(L(G(P[AA], x, y, z),         G(P[BA], x - 1, y, z), u),
        L(G(P[AB], x, y - 1, z),     G(P[BB], x - 1, y - 1, z), u), v),
      L(L(G(P[AA + 1], x, y, z - 1), G(P[BA + 1], x - 1, y, z - 1), u),
        L(G(P[AB + 1], x, y - 1, z - 1), G(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }

  /** 2D Perlin (z slice), about -1..1 */
  perlin2(x, y) { return this.perlin3(x, y, this.seedOffset); }

  /** 1D noise for silhouettes, about -1..1 */
  line(x) { return this.perlin3(x, this.seedOffset * 0.37, 0.5) * 1.4; }
  //#endregion

  //#region [ Fractal ]
  /** fBm over any base fn(x, y). Normalized to about -1..1. */
  static fractal(fn, x, y, octaves=4, lacunarity=2, gain=0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for(let i = 0; i < octaves; i++) {
      sum += amp * fn(x * freq, y * freq);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm(x, y, octaves=4, lac=2, gain=0.5) { return Noise.fractal((a, b) => this.perlin2(a, b), x, y, octaves, lac, gain); }

  /** fBm with a looping time axis: t in 0..1 walks a circle of radius r in the 3rd dim. */
  fbmLoop(x, y, t, r=0.6, octaves=3) {
    const a = t * Math.PI * 2;
    return Noise.fractal((p, q) => this.perlin3(p + Math.cos(a) * r, q + Math.sin(a) * r, Math.cos(a) * r + this.seedOffset), x, y, octaves);
  }

  /** 1D fBm for ridgelines */
  fbm1(x, octaves=4, lac=2, gain=0.5) { return Noise.fractal(a => this.line(a), x, 0, octaves, lac, gain); }

  /** Ridged 1D: sharp crests, 0..1 */
  ridged1(x, octaves=4) {
    let sum = 0, amp = 0.5, freq = 1, prev = 1, norm = 0;
    for(let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.line(x * freq));
      n *= n;
      sum += n * amp * prev; norm += amp;
      prev = n; amp *= 0.5; freq *= 2.1;
    }
    return sum / norm;
  }

  /** Turbulence (billowy), 0..1 */
  turbulence(x, y, octaves=4) { return Noise.fractal((a, b) => Math.abs(this.perlin2(a, b)), x, y, octaves); }

  /** Domain warp (IQ): f(p + k*fbm(p)) */
  warp(x, y, k=1.5, octaves=3) {
    const qx = this.fbm(x, y, octaves), qy = this.fbm(x + 5.2, y + 1.3, octaves);
    return this.fbm(x + k * qx, y + k * qy, octaves);
  }
  //#endregion

  //#region [ Worley ]
  /** Hash of an integer cell -> 0..1 pair */
  cellPoint(ix, iy) {
    const P = this.perm;
    const h = P[(P[ix & 255] + iy) & 255];
    return [P[h] / 255, P[(h + 71) & 255] / 255];
  }

  /** Worley: returns [F1, F2] distances in cell units. `move` (0..1) orbits points for looping animation. */
  worley(x, y, move=0) {
    const cx = Math.floor(x), cy = Math.floor(y);
    let f1 = 9, f2 = 9;
    for(let j = -1; j <= 1; j++)
      for(let i = -1; i <= 1; i++) {
        let [px, py] = this.cellPoint(cx + i, cy + j);
        if(move) {
          const a = (move + px) * Math.PI * 2;
          px = 0.5 + 0.35 * Math.cos(a); py = 0.5 + 0.35 * Math.sin(a + py * 6);
        }
        const d = Math.hypot(cx + i + px - x, cy + j + py - y);
        if(d < f1) { f2 = f1; f1 = d; } else if(d < f2) f2 = d;
      }
    return [f1, f2];
  }
  //#endregion
}
