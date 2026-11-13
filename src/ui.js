/** Tiny control-panel builder for the Mood Paper pages. */
class UI {
  static $panel = document.getElementById('panel');

  static el(tag, cls, html) {
    const $e = document.createElement(tag);
    if(cls) $e.className = cls;
    if(html !== undefined) $e.innerHTML = html;
    return $e;
  }

  static section(title, $parent=UI.$panel) { $parent.appendChild(UI.el('div', 'sec', title)); }

  /** Slider bound to obj[key]; calls onchange(value). */
  static slider(obj, key, label, min, max, step, onchange, $parent=UI.$panel) {
    const $row = UI.el('label', 'row', `<span>${label}</span>`);
    const $in = UI.el('input');
    Object.assign($in, { type: 'range', min, max, step, value: obj[key] });
    const $out = UI.el('output', '', UI.fmt(obj[key], step));
    $in.oninput = () => {
      obj[key] = Number($in.value);
      $out.textContent = UI.fmt(obj[key], step);
      onchange?.(obj[key]);
    };
    $row.append($in, $out);
    $parent.appendChild($row);
    return { $in, set: v => { obj[key] = v; $in.value = v; $out.textContent = UI.fmt(v, step); } };
  }

  static fmt(v, step) { return step < 1? Number(v).toFixed(2): String(v); }

  static color(obj, key, label, onchange, $parent=UI.$panel) {
    const $row = UI.el('label', 'row wide', `<span>${label}</span>`);
    const $in = UI.el('input');
    Object.assign($in, { type: 'color', value: obj[key].toLowerCase() });
    $in.oninput = () => { obj[key] = $in.value.toUpperCase(); onchange?.(obj[key]); };
    $row.appendChild($in);
    $parent.appendChild($row);
    return { $in, set: v => { obj[key] = v; $in.value = v.toLowerCase(); } };
  }

  /** options: array of values or [value, label] pairs */
  static select(obj, key, label, options, onchange, $parent=UI.$panel) {
    const $row = UI.el('label', 'row wide', `<span>${label}</span>`);
    const $sel = UI.el('select');
    for(const op of options) {
      const [v, l] = Array.isArray(op)? op: [op, op];
      $sel.appendChild(new Option(l, v));
    }
    $sel.value = obj[key];
    $sel.onchange = () => { obj[key] = $sel.value; onchange?.(obj[key]); };
    $row.appendChild($sel);
    $parent.appendChild($row);
    return { $sel, set: v => { obj[key] = v; $sel.value = v; } };
  }

  static check(obj, key, label, onchange, $parent=UI.$panel) {
    const $l = UI.el('label', 'check', `<input type="checkbox"> ${label}`);
    const $in = $l.firstChild;
    $in.checked = !!obj[key];
    $in.onchange = () => { obj[key] = $in.checked; onchange?.(obj[key]); };
    $parent.appendChild($l);
    return { $in };
  }

  static button(label, onclick, $parent, cls='') {
    const $b = UI.el('button', cls, label);
    $b.onclick = onclick;
    ($parent ?? document.querySelector('header .tools')).appendChild($b);
    return $b;
  }

  /** Swatch row with hex labels (and optional role labels). */
  static swatches(colors, roles=null) {
    const $w = UI.el('div', 'swatches');
    colors.forEach((c, i) => {
      $w.appendChild(UI.el('div', 'swatch',
        `<div class="chip" style="background:${c}"></div><div class="hex">${c}</div>${roles? `<div class="role">${roles[i] ?? ''}</div>`: ''}`));
    });
    return $w;
  }

  static strip(colors, weights=null) {
    const $s = UI.el('div', 'strip');
    colors.forEach((c, i) => {
      const $d = UI.el('div');
      $d.style.background = c;
      if(weights) $d.style.flex = weights[i];
      $s.appendChild($d);
    });
    return $s;
  }

  static download(canvas, name) {
    canvas.toBlob(blob => {
      const $a = UI.el('a');
      $a.href = URL.createObjectURL(blob);
      $a.download = name;
      $a.click();
      setTimeout(() => URL.revokeObjectURL($a.href), 2000);
    });
  }
}
