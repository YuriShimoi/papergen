/** Post passes: pixelize (render low, scale up), palette snap, ordered / error-diffusion dithering. */
class Raster {
  static BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);
  static BAYER8 = Raster.makeBayer8();
  static MODES = ['none', 'bayer4', 'bayer8', 'floyd', 'atkinson'];

  static makeBayer8() {
    const m = new Array(64);
    for(let y = 0; y < 8; y++)
      for(let x = 0; x < 8; x++) {
        let v = 0, xc = x ^ y, yc = y;
        for(let bit = 0; bit < 3; bit++) {
          v = (v << 2) | (((xc >> bit) & 1) << 1) | ((yc >> bit) & 1);
        }
        m[y * 8 + x] = (v + 0.5) / 64 - 0.5;
      }
    return m;
  }

  /**
   * Snaps every pixel of `src` (canvas) to the palette and writes it, scaled by `px`, into `dst` (canvas).
   * @param {HTMLCanvasElement} src - low-res render (already width/px x height/px)
   * @param {HTMLCanvasElement} dst
   * @param {string[]} palette - hex colors
   * @param {{px?: number, dither?: string, spread?: number, edges?: 'crisp'|'soft'}} opt - soft keeps anti-aliased blends (snapped like any color)
   */
  static apply(src, dst, palette, opt={}) {
    const { px=1, dither='none', spread=0.09, edges='crisp' } = opt;
    const w = src.width, h = src.height;
    const sctx = src.getContext('2d');
    const img = sctx.getImageData(0, 0, w, h);
    const d = img.data;
    if(edges === 'crisp') Raster.crisp(d, w, h, palette);
    const near = Color.nearestFn(palette);
    const rgb = palette.map(Color.hexToRgb);
    const amp = spread * 255;

    if(dither === 'floyd' || dither === 'atkinson') {
      const buf = new Float32Array(w * h * 3);
      for(let i = 0, j = 0; i < d.length; i += 4, j += 3) { buf[j] = d[i]; buf[j + 1] = d[i + 1]; buf[j + 2] = d[i + 2]; }
      const kernel = dither === 'floyd'
        ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
        : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
      for(let y = 0; y < h; y++)
        for(let x = 0; x < w; x++) {
          const j = (y * w + x) * 3;
          const r = Raster.c8(buf[j]), g = Raster.c8(buf[j + 1]), b = Raster.c8(buf[j + 2]);
          const c = rgb[near(r, g, b)];
          const er = buf[j] - c[0], eg = buf[j + 1] - c[1], eb = buf[j + 2] - c[2];
          buf[j] = c[0]; buf[j + 1] = c[1]; buf[j + 2] = c[2];
          for(const [dx, dy, k] of kernel) {
            const nx = x + dx, ny = y + dy;
            if(nx < 0 || nx >= w || ny >= h) continue;
            const n = (ny * w + nx) * 3;
            buf[n] += er * k; buf[n + 1] += eg * k; buf[n + 2] += eb * k;
          }
        }
      for(let i = 0, j = 0; i < d.length; i += 4, j += 3) { d[i] = buf[j]; d[i + 1] = buf[j + 1]; d[i + 2] = buf[j + 2]; }
    } else {
      // ordered: exact palette colors stay flat; in-between colors become a Bayer mix of their 2 nearest colors
      const mat = dither === 'bayer4'? Raster.BAYER4: dither === 'bayer8'? Raster.BAYER8: null;
      const n = dither === 'bayer4'? 4: 8;
      const pair = mat? Raster.pairFn(palette): null;
      for(let y = 0; y < h; y++)
        for(let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let c;
          if(mat) {
            const p = pair(d[i], d[i + 1], d[i + 2]);
            c = rgb[(mat[(y % n) * n + (x % n)] + 0.5) < (p & 255) / 255? (p >> 8) & 255: p >> 16];
          } else c = rgb[near(d[i], d[i + 1], d[i + 2])];
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
    }
    sctx.putImageData(img, 0, 0);

    dst.width = w * px; dst.height = h * px;
    const dctx = dst.getContext('2d');
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(src, 0, 0, w * px, h * px);
  }

  /**
   * Two nearest palette colors and the mix ratio toward the second, packed as (i1 << 16) | (i2 << 8) | t255.
   * t is 0 for exact palette colors, so flat fills never get a pattern. Cached by 15-bit RGB.
   */
  static pairFn(hexes) {
    const labs = hexes.map(hx => Color.rgbToOklab(Color.hexToRgb(hx)));
    const cache = new Int32Array(32768).fill(-1);
    return (r, g, b) => {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      if(cache[key] >= 0) return cache[key];
      const lab = Color.rgbToOklab([r, g, b]);
      let i1 = 0, i2 = 0, d1 = Infinity, d2 = Infinity;
      labs.forEach((l, i) => {
        const dd = Color.dist(lab, l);
        if(dd < d1) { d2 = d1; i2 = i1; d1 = dd; i1 = i; } else if(dd < d2) { d2 = dd; i2 = i; }
      });
      const t = d1 < 0.012? 0: Math.round(255 * d1 / (d1 + d2));
      return cache[key] = (i1 << 16) | (i2 << 8) | t;
    };
  }

  /**
   * Edge pass: removes anti-aliasing, so every edge comes out as sharp pixels in exact colors.
   * A pixel is solid when it is a palette color or a flat in-between fill (same color as a horizontal and a vertical
   * neighbor: sky bands). Any other pixel is a blend m of the solid colors around it: for each solid neighbor B and
   * candidate S (solid colors in the 3x3 window; every palette color when none of those fits), m = B + a (S - B) is
   * fitted and the best fit becomes S when a >= 0.5, else B. That is a coverage threshold, the pixel an aliased fill
   * would give, and thin lines with no solid pixel of their own still survive through the palette fallback.
   * @param {Uint8ClampedArray} d - RGBA pixels, edited in place
   */
  static crisp(d, w, h, palette) {
    const pal = palette.map(hx => { const [r, g, b] = Color.hexToRgb(hx); return (r << 16) | (g << 8) | b; });
    const exact = new Set(pal);
    const n = w * h, col = new Int32Array(n), solid = new Uint8Array(n);
    const px = new Uint32Array(d.buffer, d.byteOffset, n);  // RGBA bytes read as one int (little-endian: A B G R)
    for(let i = 0; i < n; i++) { const v = px[i]; col[i] = ((v & 255) << 16) | (v & 0xFF00) | ((v >> 16) & 255); }
    for(let y = 0, i = 0; y < h; y++)
      for(let x = 0; x < w; x++, i++) {
        const c = col[i];  // flat test first: it settles most pixels without the palette lookup
        const hz = (x > 0 && col[i - 1] === c) || (x < w - 1 && col[i + 1] === c);
        const vt = (y > 0 && col[i - w] === c) || (y < h - 1 && col[i + w] === c);
        solid[i] = (hz && vt) || exact.has(c)? 1: 0;
      }
    const TOL = 3 * 6 * 6;  // fit error allowed before falling back to the whole palette (about 6 levels per channel)
    let res = Infinity, pick = 0;
    const fit = (mr, mg, mb, backs, cands) => {
      for(const B of backs) {
        const br = B >> 16, bg = (B >> 8) & 255, bb = B & 255;
        const dr = mr - br, dg = mg - bg, db = mb - bb;
        const r0 = dr * dr + dg * dg + db * db;
        if(r0 < res) { res = r0; pick = B; }
        for(const S of cands) {
          if(S === B) continue;
          const vr = (S >> 16) - br, vg = ((S >> 8) & 255) - bg, vb = (S & 255) - bb;
          let a = (dr * vr + dg * vg + db * vb) / (vr * vr + vg * vg + vb * vb);
          a = a < 0? 0: a > 1? 1: a;
          const er = dr - a * vr, eg = dg - a * vg, eb = db - a * vb;
          const e = er * er + eg * eg + eb * eb;
          if(e < res) { res = e; pick = a >= 0.5? S: B; }
        }
      }
    };
    const cands = [];
    for(let y = 0, i = 0; y < h; y++)
      for(let x = 0; x < w; x++, i++) {
        if(solid[i]) continue;
        cands.length = 0;
        for(let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if(yy < 0 || yy >= h) continue;
          for(let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, j = yy * w + xx;
            if(xx < 0 || xx >= w || !solid[j]) continue;
            const c = col[j];
            if(!cands.includes(c)) cands.push(c);
          }
        }
        if(!cands.length) continue;  // nothing solid around: left to the plain snap
        const m = col[i], mr = m >> 16, mg = (m >> 8) & 255, mb = m & 255;
        res = Infinity;
        fit(mr, mg, mb, cands, cands);
        if(res > TOL) fit(mr, mg, mb, cands, pal);
        px[i] = 0xFF000000 | ((pick & 255) << 16) | (pick & 0xFF00) | (pick >> 16);
      }
  }

  static c8(v) { return v < 0? 0: v > 255? 255: v | 0; }
}
