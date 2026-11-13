/**
 * Mood / palette controls. `PalettePanel.palette` is the current palette: `Mood.generate()` from the mood inputs, or
 * `Mood.fromColors()` once colors are set by hand (`manual`, edited in the chips under the controls).
 */
class PalettePanel {
  static state = { ...Mood.DEFAULTS, ref: '' };
  static palette = null;
  static manual = null;  // hand-set colors (hex list), or null to follow the mood inputs
  static onchange = [];
  static ctl = {};
  static $preview = null;
  static MIN = 3;
  static MAX = 16;

  static init() {
    const s = PalettePanel.state, upd = () => { PalettePanel.manual = null; PalettePanel.update(); };
    UI.section('Mood');
    PalettePanel.ctl.ref = UI.select(s, 'ref', 'Start from', [['', '(custom)'], ...Object.keys(REFS).map(k => [k, k])], () => PalettePanel.fromRef());
    PalettePanel.ctl.mood = UI.slider(s, 'mood', 'Calm/Energy', 0, 1, 0.01, upd);
    PalettePanel.ctl.brightness = UI.slider(s, 'brightness', 'Brightness', 0, 1, 0.01, upd);
    PalettePanel.ctl.primary = UI.color(s, 'primary', 'Primary', upd);
    PalettePanel.ctl.secondary = UI.color(s, 'secondary', 'Secondary', upd);
    PalettePanel.ctl.count = UI.slider(s, 'count', 'Colors (0=auto)', 0, 15, 1, upd);
    UI.section('Palette');
    PalettePanel.$preview = UI.el('div');
    UI.$panel.appendChild(PalettePanel.$preview);
    PalettePanel.readHash();
    PalettePanel.update(true);
  }

  static fromRef() {
    const r = REFS[PalettePanel.state.ref];
    if(!r) return;
    const e = Mood.estimate(r.colors, r.share);
    for(const k of ['mood', 'brightness', 'primary', 'secondary']) PalettePanel.ctl[k].set(e[k]);
    PalettePanel.manual = null;
    PalettePanel.update();
  }

  static update(silent=false) {
    const s = PalettePanel.state;
    if(s.count > 0 && s.count < 3) s.count = 3;
    PalettePanel.palette = PalettePanel.manual? Mood.fromColors(PalettePanel.manual, s): Mood.generate(s);
    PalettePanel.drawChips();
    PalettePanel.writeHash();
    PalettePanel.onchange.forEach(fn => fn(PalettePanel.palette, silent));
  }

  //#region [ Palette chips ]
  /**
   * One chip per palette color (dark -> light): click to pick a new color, x to remove it, + adds the color halfway
   * across the widest lightness gap. The first edit switches to hand-set colors; Reset goes back to the mood inputs
   * (so does moving any mood control).
   */
  static drawChips() {
    const colors = PalettePanel.chipColors = [...PalettePanel.palette.colors], man = !!PalettePanel.manual;
    const $w = UI.el('div', 'paledit');
    colors.forEach((c, i) => {
      const $chip = UI.el('label', 'pchip');
      $chip.style.background = c;
      $chip.title = c;
      const $in = UI.el('input');
      Object.assign($in, { type: 'color', value: c.toLowerCase() });
      $in.oninput = () => { $chip.style.background = $in.value; PalettePanel.edit(list => { list[i] = $in.value.toUpperCase(); }, true); };
      $in.onchange = () => PalettePanel.edit(list => { list[i] = $in.value.toUpperCase(); });
      $chip.appendChild($in);
      if(colors.length > PalettePanel.MIN) {
        const $x = UI.el('button', 'x', '&times;');
        $x.title = 'Remove';
        $x.onclick = e => { e.preventDefault(); PalettePanel.edit(list => list.splice(i, 1)); };
        $chip.appendChild($x);
      }
      $w.appendChild($chip);
    });
    if(colors.length < PalettePanel.MAX) {
      const $add = UI.el('button', 'padd', '+');
      $add.title = 'Add a color';
      $add.onclick = () => PalettePanel.edit(list => list.push(PalettePanel.gapColor(list)));
      $w.appendChild($add);
    }
    const $note = UI.el('div', 'hint', man? `Hand-set colors (${colors.length}) `: `Generated from the mood (${colors.length}); click a color to edit `);
    if(man) {
      const $reset = UI.el('button', '', 'Reset');
      $reset.onclick = () => { PalettePanel.manual = null; PalettePanel.update(); };
      $note.appendChild($reset);
    }
    PalettePanel.$preview.replaceChildren($w, $note);
  }

  /**
   * Applies fn to a copy of the colors as the chips show them (indexes match the chips, even while a live edit
   * re-sorts the palette) and switches to them. `live` (while a picker is open) only re-renders, without rebuilding
   * the chips, so the picker stays open; one render per animation frame.
   */
  static edit(fn, live=false) {
    const list = [...PalettePanel.chipColors];
    fn(list);
    PalettePanel.manual = list;
    PalettePanel.ctl.ref.set('');
    if(!live) return PalettePanel.update();
    if(PalettePanel.pending) return;
    PalettePanel.pending = requestAnimationFrame(() => {
      PalettePanel.pending = 0;
      PalettePanel.palette = Mood.fromColors(PalettePanel.manual, PalettePanel.state);
      PalettePanel.onchange.forEach(fn => fn(PalettePanel.palette, false));
    });
  }

  /** The color halfway (OKLab) across the widest lightness gap of the list, so a new color fills a missing step. */
  static gapColor(list) {
    const s = [...list].sort((a, b) => Color.hexToLch(a)[0] - Color.hexToLch(b)[0]);
    let best = 0, gap = -1;
    for(let i = 0; i < s.length - 1; i++) {
      const g = Color.hexToLch(s[i + 1])[0] - Color.hexToLch(s[i])[0];
      if(g > gap) { gap = g; best = i; }
    }
    return s.length > 1? Color.mix(s[best], s[best + 1], 0.5).toUpperCase(): '#808080';
  }
  //#endregion

  //#region [ URL hash ]
  /** #mood,brightness,primary,secondary,count[~hand-set colors]|page extra */
  static writeHash() {
    const s = PalettePanel.state;
    const extra = PalettePanel.extraHash?.() ?? '';
    const man = PalettePanel.manual? '~' + PalettePanel.manual.map(c => c.slice(1)).join('.'): '';
    history.replaceState(null, '', '#' + [s.mood, s.brightness, s.primary.slice(1), s.secondary.slice(1), s.count].join(',') + man + extra);
  }

  static readHash() {
    const [main, extra] = location.hash.slice(1).split('|');
    const [params, man] = (main || '').split('~');
    const p = (params || '').split(',');
    if(p.length < 5) return;
    const s = PalettePanel.state;
    s.mood = +p[0]; s.brightness = +p[1]; s.primary = '#' + p[2]; s.secondary = '#' + p[3]; s.count = +p[4];
    for(const k of ['mood', 'brightness', 'primary', 'secondary', 'count']) PalettePanel.ctl[k].set(s[k]);
    const hand = (man || '').split('.').filter(h => /^[0-9a-f]{6}$/i.test(h)).map(h => '#' + h.toUpperCase());
    if(hand.length >= PalettePanel.MIN) PalettePanel.manual = hand;
    PalettePanel.hashExtra = extra;
  }
  //#endregion
}
