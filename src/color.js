/** Color math: sRGB <-> linear <-> OKLab <-> OKLCH, gamut clip, mixing, nearest palette color. */
class Color {
  //#region [ Hex / RGB ]
  /** '#rrggbb' -> [r,g,b] 0..255 */
  static hexToRgb(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  static rgbToHex([r, g, b]) {
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return ('#' + c(r) + c(g) + c(b)).toUpperCase();
  }

  static toLinear(v) { v /= 255; return v <= 0.04045? v / 12.92: ((v + 0.055) / 1.055) ** 2.4; }
  static toSrgb(v)   { const s = v <= 0.0031308? v * 12.92: 1.055 * v ** (1 / 2.4) - 0.055; return s * 255; }
  //#endregion

  //#region [ OKLab ]
  /** [r,g,b] 0..255 -> [L,a,b] */
  static rgbToOklab([r, g, b]) {
    r = Color.toLinear(r); g = Color.toLinear(g); b = Color.toLinear(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }

  /** [L,a,b] -> linear [r,g,b] (unclamped, may be out of gamut) */
  static oklabToLinear([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
       4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }

  static oklabToRgb(lab) {
    return Color.oklabToLinear(lab).map(v => Color.toSrgb(Math.max(0, Math.min(1, v))));
  }
  //#endregion

  //#region [ OKLCH ]
  /** hue in degrees */
  static rgbToOklch(rgb) {
    const [L, a, b] = Color.rgbToOklab(rgb);
    const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    return [L, Math.hypot(a, b), h];
  }

  static lchToLab([L, C, h]) {
    const r = h * Math.PI / 180;
    return [L, C * Math.cos(r), C * Math.sin(r)];
  }

  static inGamut(lab) {
    return Color.oklabToLinear(lab).every(v => v >= -0.0005 && v <= 1.0005);
  }

  /** OKLCH -> [r,g,b], reducing chroma until it fits sRGB (keeps lightness and hue). */
  static oklchToRgb([L, C, h]) {
    L = Math.max(0, Math.min(1, L));
    if(!Color.inGamut(Color.lchToLab([L, C, h]))) {
      let lo = 0, hi = C;
      for(let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if(Color.inGamut(Color.lchToLab([L, mid, h]))) lo = mid; else hi = mid;
      }
      C = lo;
    }
    return Color.oklabToRgb(Color.lchToLab([L, C, h]));
  }

  static lch(L, C, h) { return Color.rgbToHex(Color.oklchToRgb([L, C, h])); }
  static hexToLch(hex) { return Color.rgbToOklch(Color.hexToRgb(hex)); }
  //#endregion

  //#region [ Mix / distance ]
  /** Mix two hex colors in OKLab, t in 0..1. */
  static mix(hexA, hexB, t) {
    const a = Color.rgbToOklab(Color.hexToRgb(hexA)), b = Color.rgbToOklab(Color.hexToRgb(hexB));
    return Color.rgbToHex(Color.oklabToRgb(a.map((v, i) => v + (b[i] - v) * t)));
  }

  /** Signed shortest hue difference b - a in degrees. */
  static hueDelta(a, b) { return ((b - a + 540) % 360) - 180; }

  static dist(labA, labB) {
    return Math.hypot(labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]);
  }

  /**
   * Nearest-color mapper for a palette, cached by 15-bit RGB key.
   * @returns {(r:number,g:number,b:number)=>number} palette index
   */
  static nearestFn(hexes) {
    const labs = hexes.map(h => Color.rgbToOklab(Color.hexToRgb(h)));
    const cache = new Int16Array(32768).fill(-1);
    return (r, g, b) => {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      if(cache[key] >= 0) return cache[key];
      const lab = Color.rgbToOklab([r, g, b]);
      let best = 0, bestD = Infinity;
      for(let i = 0; i < labs.length; i++) {
        const d = Color.dist(lab, labs[i]);
        if(d < bestD) { bestD = d; best = i; }
      }
      cache[key] = best;
      return best;
    };
  }
  //#endregion
}
