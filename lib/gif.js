// Shim: DAE_CORE runs the module against a global DAE object.
var DAE_CORE = DAE_CORE || (fn => fn(window.DAE = window.DAE || {}));
// Animated GIF encoder: RGBA frames -> GIF89a bytes (one global palette, transparency, loop).
// Pixel art usually has few colors, so the palette is exact when it fits in 255 entries;
// otherwise colors are reduced by median cut. Alpha under 128 becomes the transparent index.
DAE_CORE(DAE => {
  class Gif {
    /**
     * @param {{w: number, h: number, frames: Array<{rgba: Uint8ClampedArray|Uint8Array, delay?: number}>, loop?: number}} o
     *   delay in ms (GIF keeps 1/100 s), loop 0 = forever
     * @returns {Uint8Array}
     */
    static encode({ w, h, frames, loop = 0 }) {
      const { palette, index } = Gif.palette(frames.map(f => f.rgba));
      const transparent = palette.length;                 // one slot after the colors
      let bits = 1;
      while((1 << bits) < transparent + 1) bits++;
      const size = 1 << bits;
      const out = [];
      const u16 = v => out.push(v & 255, (v >> 8) & 255);
      out.push(...'GIF89a'.split('').map(c => c.charCodeAt(0)));
      u16(w); u16(h);
      out.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
      for(let i = 0; i < size; i++) {
        const c = palette[i] ?? [0, 0, 0];
        out.push(c[0], c[1], c[2]);
      }
      out.push(0x21, 0xFF, 11, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 3, 1);
      u16(loop); out.push(0);
      for(const f of frames) {
        out.push(0x21, 0xF9, 4, (2 << 2) | 1);            // dispose: restore to background; has transparency
        u16(Math.round((f.delay ?? 100) / 10)); out.push(transparent, 0);
        out.push(0x2C); u16(0); u16(0); u16(w); u16(h); out.push(0);
        const px = new Uint8Array(w * h);
        for(let i = 0, p = 0; i < px.length; i++, p += 4) {
          px[i] = f.rgba[p + 3] < 128 ? transparent : index(f.rgba[p], f.rgba[p + 1], f.rgba[p + 2]);
        }
        const min = Math.max(2, bits);
        out.push(min);
        const data = Gif.lzw(px, min);
        for(let i = 0; i < data.length; i += 255) {
          const block = data.subarray(i, i + 255);
          out.push(block.length, ...block);
        }
        out.push(0);
      }
      out.push(0x3B);
      return Uint8Array.from(out);
    }

    /** Palette (max 255 colors) and a color -> index lookup for every opaque pixel. */
    static palette(list) {
      const count = new Map();
      for(const rgba of list) {
        for(let p = 0; p < rgba.length; p += 4) {
          if(rgba[p + 3] < 128) continue;
          const k = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
          count.set(k, (count.get(k) ?? 0) + 1);
        }
      }
      const keys = [...count.keys()];
      if(keys.length <= 255) {
        const at = new Map(keys.map((k, i) => [k, i]));
        return { palette: keys.map(k => [k >> 16, (k >> 8) & 255, k & 255]), index: (r, g, b) => at.get((r << 16) | (g << 8) | b) ?? 0 };
      }
      const palette = Gif.medianCut(keys.map(k => [k >> 16, (k >> 8) & 255, k & 255, count.get(k)]), 255);
      const cache = new Map();
      const index = (r, g, b) => {
        const k = (r << 16) | (g << 8) | b;
        let i = cache.get(k);
        if(i === undefined) {
          let best = Infinity;
          palette.forEach((c, j) => {
            const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
            if(d < best) { best = d; i = j; }
          });
          cache.set(k, i);
        }
        return i;
      };
      return { palette, index };
    }

    /** Median cut on [r, g, b, weight] entries -> up to n colors (weighted averages). */
    static medianCut(colors, n) {
      let boxes = [colors];
      while(boxes.length < n) {
        let bi = -1, span = 0, axis = 0;
        boxes.forEach((b, i) => {
          if(b.length < 2) return;
          for(let a = 0; a < 3; a++) {
            let lo = 255, hi = 0;
            for(const c of b) { lo = Math.min(lo, c[a]); hi = Math.max(hi, c[a]); }
            if(hi - lo > span) { span = hi - lo; bi = i; axis = a; }
          }
        });
        if(bi < 0) break;
        const b = boxes[bi].sort((p, q) => p[axis] - q[axis]);
        const total = b.reduce((s, c) => s + c[3], 0);
        let acc = 0, cut = 1;
        for(; cut < b.length - 1; cut++) { acc += b[cut - 1][3]; if(acc >= total / 2) break; }
        boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
      }
      return boxes.map(b => {
        const t = b.reduce((s, c) => s + c[3], 0);
        return [0, 1, 2].map(a => Math.round(b.reduce((s, c) => s + c[a] * c[3], 0) / t));
      });
    }

    /** GIF-flavored LZW (variable code size up to 12 bits, LSB first). */
    static lzw(px, min) {
      const clear = 1 << min, eoi = clear + 1;
      const out = [];
      let size = min + 1, next = eoi + 1, buf = 0, nbits = 0;
      const emit = code => {
        buf |= code << nbits;
        nbits += size;
        while(nbits >= 8) { out.push(buf & 255); buf >>>= 8; nbits -= 8; }
      };
      let dict = new Map();
      emit(clear);
      let cur = px[0];
      for(let i = 1; i < px.length; i++) {
        const k = px[i], key = cur * 4096 + k;
        const hit = dict.get(key);
        if(hit !== undefined) { cur = hit; continue; }
        emit(cur);
        if(next < 4096) {
          dict.set(key, next++);
          if(next > (1 << size) && size < 12) size++;
        }
        else {
          emit(clear);
          dict = new Map();
          size = min + 1;
          next = eoi + 1;
        }
        cur = k;
      }
      emit(cur);
      emit(eoi);
      if(nbits > 0) out.push(buf & 255);
      return Uint8Array.from(out);
    }
  }

  DAE.Gif = Gif;
});
