/* core.js —— 确定性时间轴工具：弹簧物理、缓动、DOM/SVG 构造、字幕、花瓣 */
const FPS = 60;
const W = 1920, H = 1080;
const SceneFactories = {};
function registerScene(id, f) { SceneFactories[id] = f; }
window.SceneFactories = SceneFactories;
window.registerScene = registerScene;
const BEAT = 60 / 112;                 // 112 BPM
const SVGNS = "http://www.w3.org/2000/svg";
const PALETTE = { pink: "#EC4899", pink2: "#F472B6", cherry: "#DB2777", ink: "#2D1624", line: "#F3D4E1", hl: "#FCE7F3",
  coral: "#D97757", coralDark: "#B45338", petal: "#F9A8D4", purple: "#A855F7", green: "#10B981", blue: "#60A5FA" };

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const Ease = {
  out: t => 1 - Math.pow(1 - clamp(t), 3),
  in: t => Math.pow(clamp(t), 3),
  inOut: t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  outBack: t => { t = clamp(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  sine: t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t)),
};
/* 欠阻尼弹簧（规格书：mass 0.8, stiffness 190, damping 14），解析解，逐帧确定 */
function spring(t, m = 0.8, k = 190, c = 14) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m));
  const wd = w0 * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
}
const softSpring = t => spring(t, 1, 120, 16);
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ---------- DOM helpers ---------- */
function el(tag, cls, parent, html, style) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (style) Object.assign(e.style, style);
  if (parent) parent.appendChild(e);
  return e;
}
function box(parent, x, y, w, h, cls = "abs", html = "", style = {}) {
  return el("div", cls, parent, html, Object.assign({ left: x + "px", top: y + "px", width: w + "px", height: h + "px" }, style));
}
function sv(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function svgLayer(parent) { return sv("svg", { class: "layer", width: W, height: H, viewBox: `0 0 ${W} ${H}` }, parent); }
const _cache = new WeakMap();
/* 写入样式（带缓存，减少重排） */
function css(e, o) {
  let c = _cache.get(e); if (!c) { c = {}; _cache.set(e, c); }
  for (const k in o) {
    let v = o[k];
    if (k === "o") { v = (+v).toFixed(3); if (c.o !== v) { e.style.opacity = v; c.o = v; } const d = +v <= 0.001 ? "hidden" : "visible"; if (c.vis !== d) { e.style.visibility = d; c.vis = d; } continue; }
    if (k === "tf") { if (c.tf !== v) { e.style.transform = v; c.tf = v; } continue; }
    if (c[k] !== v) { e.style[k] = v; c[k] = v; }
  }
}
function attr(e, o) { for (const k in o) e.setAttribute(k, o[k]); }
/* 弹性弹入：opacity + scale */
function pop(e, lt, t0, opt = {}) {
  const from = opt.from ?? 0.4, dy = opt.dy ?? 0, dx = opt.dx ?? 0, extra = opt.extra || "";
  const s = spring(lt - t0);
  const o = prog(lt, t0, t0 + (opt.fade ?? 0.16)) * (opt.out != null ? 1 - prog(lt, opt.out, opt.out + 0.25) : 1);
  const sc = lerp(from, 1, s);
  css(e, { o, tf: `translate(${dx * (1 - s)}px, ${dy * (1 - s)}px) scale(${sc.toFixed(4)}) ${extra}` });
  return s;
}
function fadeIn(e, lt, t0, dur = 0.3, dy = 16) {
  const p = Ease.out(prog(lt, t0, t0 + dur));
  css(e, { o: p, tf: `translateY(${(1 - p) * dy}px)` });
  return p;
}
/* 打字机：按时间显示字符 */
function typeText(e, text, lt, t0, cps = 22, cursor = false) {
  const n = clamp(Math.floor((lt - t0) * cps), 0, text.length);
  const showCur = cursor && lt >= t0 - 0.3 && (n < text.length || Math.floor(lt * 2.2) % 2 === 0);
  const s = escapeHtml(text.slice(0, n)) + (showCur ? '<span class="tcur">▍</span>' : "");
  if (e._t !== s) { e.innerHTML = s; e._t = s; }
  return n >= text.length;
}
function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* 三次贝塞尔求值 */
function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
}
function bezPath(c) { return `M${c[0][0]},${c[0][1]} C${c[1][0]},${c[1][1]} ${c[2][0]},${c[2][1]} ${c[3][0]},${c[3][1]}`; }
/* 按弧长参数化（粗略） */
function bezAt(c, s) {
  if (!c._lut) { c._lut = [0]; let L = 0, p = c[0]; for (let i = 1; i <= 60; i++) { const q = bez(...c, i / 60); L += Math.hypot(q[0] - p[0], q[1] - p[1]); c._lut.push(L); p = q; } c._len = L; }
  const target = clamp(s) * c._len; let i = 1; while (i < 60 && c._lut[i] < target) i++;
  const t = (i - 1 + (target - c._lut[i - 1]) / Math.max(1e-6, c._lut[i] - c._lut[i - 1])) / 60;
  return bez(...c, clamp(t));
}

/* 樱花花瓣路径 */
const PETAL_D = "M0,-11 L2.6,-8.4 C7,-11 10.5,-5 8.6,1.5 C6.8,7.5 2.4,11 0,12 C-2.4,11 -6.8,7.5 -8.6,1.5 C-10.5,-5 -7,-11 -2.6,-8.4 Z";
function sakuraFlower(parent, r = 14, petal = "#F9A8D4", core = "#EC4899") {
  const g = sv("g", {}, parent);
  for (let i = 0; i < 5; i++) {
    sv("ellipse", { cx: 0, cy: -r * 0.55, rx: r * 0.42, ry: r * 0.6, fill: petal, stroke: "#F472B6", "stroke-width": 0.8, transform: `rotate(${i * 72})` }, g);
  }
  sv("circle", { cx: 0, cy: 0, r: r * 0.28, fill: core }, g);
  return g;
}

/* ---------- 背景花瓣（确定性） ---------- */
const Petals = {
  init() {
    const mk = (svg, n, seed, front) => {
      const r = rng(seed), list = [];
      for (let i = 0; i < n; i++) {
        const g = sv("g", {}, svg);
        sv("path", { d: PETAL_D, fill: r() < .5 ? "#F9A8D4" : "#FBCFE8", stroke: "#F472B6", "stroke-width": .6 }, g);
        list.push({ g, x: r() * W, off: r() * 1200, sp: (front ? 70 : 34) + r() * 38, amp: 20 + r() * 50, ph: r() * 6.28,
          sc: (front ? .8 : .9) + r() * (front ? .9 : 1.1), rs: (r() - .5) * 120, op: front ? .5 + r() * .35 : .26 + r() * .26 });
      }
      return list;
    };
    this.back = mk(document.getElementById("petals"), 16, 7, false);
    this.front = mk(document.getElementById("petalsFront"), 46, 99, true);
  },
  update(t, frontAmt) {
    const run = (list, k) => list.forEach((p, i) => {
      const y = ((t * p.sp + p.off) % 1220) - 70;
      const x = p.x + Math.sin(t * 0.8 + p.ph) * p.amp + t * 8;
      const xx = ((x % (W + 80)) + W + 80) % (W + 80) - 40;
      p.g.setAttribute("transform", `translate(${xx.toFixed(1)},${y.toFixed(1)}) rotate(${(t * p.rs + p.ph * 50).toFixed(1)}) scale(${p.sc.toFixed(2)},${(p.sc * (0.75 + 0.25 * Math.sin(t * 2 + p.ph))).toFixed(2)})`);
      p.g.setAttribute("opacity", (p.op * k).toFixed(3));
    });
    run(this.back, 1);
    run(this.front, frontAmt);
    document.getElementById("petalsFront").style.display = frontAmt > 0.001 ? "block" : "none";
  },
};

/* ---------- 底部干净整句字幕（无逐字蹦、无花哨配色弹跳；支持 ?nosub=1 渲染纯净无字幕母版） ---------- */
const Subs = {
  init(T) {
    const root = document.getElementById("subs");
    this.disabled = new URLSearchParams(location.search).get("nosub") === "1";
    this.items = [];
    if (this.disabled) { root.style.display = "none"; return; }
    T.scenes.forEach(sc => sc.cues.forEach(cue => {
      const d = el("div", "sub", root, escapeHtml(cue.text));
      this.items.push({ d, start: sc.start + cue.start, hide: sc.start + cue.hide });
    }));
  },
  update(t) {
    if (this.disabled) return;
    for (const it of this.items) {
      const a = it.start - 0.06, b = it.hide;
      if (t < a || t > b + 0.12) {
        if (it.vis !== false) { it.d.style.display = "none"; it.vis = false; }
        continue;
      }
      if (it.vis !== true) { it.d.style.display = "flex"; it.vis = true; }
      const fadeInA = prog(t, a, a + 0.10);
      const fadeOutA = 1 - prog(t, b, b + 0.10);
      css(it.d, { o: fadeInA * fadeOutA, tf: "translateX(-50%)" });
    }
  },
};

/* ---------- 迷你伙伴角色（AGY 粉蓝星 / Codex 绿盾 / DSH 紫鲸） ---------- */
function partner(parent, kind, defsId) {
  const g = sv("g", {}, parent);
  const body = sv("g", {}, g);
  const eyes = [];
  if (kind === "agy") {
    const id = "agyGrad" + defsId;
    const defs = sv("defs", {}, body);
    const lg = sv("linearGradient", { id, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    sv("stop", { offset: "0", "stop-color": "#F472B6" }, lg); sv("stop", { offset: "1", "stop-color": "#60A5FA" }, lg);
    const pts = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 46, a = -Math.PI / 2 + i * Math.PI / 5; pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a) - 46).toFixed(1)}`); }
    sv("polygon", { points: pts.join(" "), fill: `url(#${id})`, stroke: "#DB2777", "stroke-width": 2, "stroke-linejoin": "round" }, body);
    eyes.push([-9, -44], [9, -44]);
  } else if (kind === "codex") {
    sv("path", { d: "M0,-92 L38,-78 C38,-40 26,-14 0,0 C-26,-14 -38,-40 -38,-78 Z", fill: "#10B981", stroke: "#047857", "stroke-width": 2.5 }, body);
    sv("path", { d: "M0,-84 L30,-73 C30,-44 20,-24 0,-12", fill: "none", stroke: "#fff", "stroke-opacity": .35, "stroke-width": 4 }, body);
    eyes.push([-11, -52], [11, -52]);
  } else if (kind === "dsh") {
    sv("path", { d: "M-46,-30 C-46,-62 -14,-74 12,-70 C36,-66 48,-46 46,-30 C44,-12 26,-2 0,-2 C-28,-2 -46,-12 -46,-30 Z", fill: "#8B5CF6", stroke: "#6D28D9", "stroke-width": 2.5 }, body);
    sv("path", { d: "M44,-34 C56,-44 62,-56 60,-64 C68,-56 70,-40 52,-28 Z", fill: "#8B5CF6", stroke: "#6D28D9", "stroke-width": 2 }, body);
    sv("path", { d: "M-34,-18 C-20,-8 10,-8 30,-18", fill: "none", stroke: "#DDD6FE", "stroke-width": 3, "stroke-linecap": "round" }, body);
    sv("path", { d: "M-6,-74 C-10,-88 -18,-90 -22,-86 M-6,-74 C-2,-90 6,-92 10,-88", fill: "none", stroke: "#60A5FA", "stroke-width": 3, "stroke-linecap": "round" }, body);
    eyes.push([-20, -40], [-2, -40]);
  }
  const eyeEls = eyes.map(([x, y]) => {
    const eg = sv("g", { transform: `translate(${x},${y})` }, body);
    const open = sv("ellipse", { cx: 0, cy: 0, rx: 4.2, ry: 7, fill: "#2D1624" }, eg);
    const happy = sv("path", { d: "M-6,3 L0,-4 L6,3", fill: "none", stroke: "#2D1624", "stroke-width": 3.2, "stroke-linecap": "round", "stroke-linejoin": "round" }, eg);
    return { open, happy };
  });
  return {
    g, set(x, y, sx = 1, sy = 1, rot = 0, happy = false, s = 1) {
      attr(g, { transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(2)}) scale(${(s * sx).toFixed(4)},${(s * sy).toFixed(4)})` });
      eyeEls.forEach(e => { e.open.style.display = happy ? "none" : ""; e.happy.style.display = happy ? "" : "none"; });
    },
  };
}
