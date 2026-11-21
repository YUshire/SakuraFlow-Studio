/* scenes1.js —— Scene 1 ~ 4 */

/* 小图标：各智能体徽章（内联 SVG） */
function agentIcon(parent, kind, size = 56, uid = 0) {
  const s = sv("svg", { width: size, height: size, viewBox: "-60 -110 120 120" }, parent);
  s.style.overflow = "visible";
  if (kind === "claude") {
    sv("rect", { x: -46, y: -96, width: 92, height: 76, rx: 18, fill: "#D97757", stroke: "#B45338", "stroke-width": 3 }, s);
    sv("ellipse", { cx: -17, cy: -60, rx: 7, ry: 12, fill: "#2D1624" }, s);
    sv("ellipse", { cx: 17, cy: -60, rx: 7, ry: 12, fill: "#2D1624" }, s);
    [-34, -14, 6, 26].forEach(x => sv("rect", { x, y: -22, width: 9, height: 14, rx: 2, fill: "#C4633F" }, s));
  } else if (kind === "gray") {
    sv("rect", { x: -46, y: -96, width: 92, height: 80, rx: 18, fill: "#C9C3C6" }, s);
  } else {
    const p = partner(s, kind, "ic" + uid + kind); p.set(0, -6, 1, 1, 0, false, 1.0);
  }
  return s;
}

/* =========================== Scene 1 · 强钩子开场 =========================== */
registerScene("s1", (root, T, X) => {
  const { c, e, w } = X;
  const gray = document.getElementById("gray");
  const lay = el("div", "layer", root);
  // ---- 各聊各的：4 个灰色孤岛智能体 ----
  const names = [["Claude", "claude"], ["Codex", "codex"], ["Antigravity", "agy"], ["DeepSeek", "dsh"]];
  const appear = [w(0, "Claude"), w(0, "Codex"), w(1, "Antigravity"), w(1, "DeepSeek")];
  const isl = names.map(([n, k], i) => {
    const cx = 360 + i * 400;
    const g = box(lay, cx - 150, 400, 300, 150, "abs card nobar", "", { background: "#F7F5F6", borderColor: "#D9D2D6", boxShadow: "0 10px 26px rgba(60,40,50,.10)" });
    const ic = box(g, 24, 40, 70, 70, "abs center");
    agentIcon(ic, k, 66, i);
    ic.style.filter = "grayscale(.85) opacity(.85)";
    box(g, 106, 44, 190, 40, "abs nowrap", n, { fontSize: "28px", fontWeight: 800, color: "#5E5359" });
    box(g, 106, 86, 190, 30, "abs nowrap mono", "isolated session", { fontSize: "17px", color: "#9A8F95" });
    const b = box(lay, cx - 70, 300, 140, 74, "abs center", "", { background: "#fff", border: "2px solid #D9D2D6", borderRadius: "22px", fontSize: "34px", color: "#9A8F95", fontWeight: 900 });
    const dots = el("span", "", b, "···");
    return { g, b, dots, cx };
  });
  const walls = [0, 1, 2].map(i => box(lay, 560 + i * 400 - 2, 300, 4, 260, "abs", "", { background: "repeating-linear-gradient(#C9C1C5 0 12px, transparent 12px 22px)" }));
  // ---- 灰暗死板流程 Step1 → Step2 → Step3 ----
  const flowY = 430, steps = [];
  const flowL = el("div", "layer", root);
  const flowSvg = svgLayer(flowL);
  const arrows = [0, 1].map(i => sv("path", { d: `M${720 + i * 400 - 120},${flowY + 60} L${720 + i * 400 + 30},${flowY + 60}`, stroke: "#A49AA0", "stroke-width": 6, "marker-end": "", fill: "none" }, flowSvg));
  const heads = [0, 1].map(i => sv("path", { d: `M${720 + i * 400 + 26},${flowY + 46} L${720 + i * 400 + 50},${flowY + 60} L${720 + i * 400 + 26},${flowY + 74} Z`, fill: "#A49AA0" }, flowSvg));
  for (let i = 0; i < 3; i++) {
    const x = 400 + i * 400, el2 = box(flowL, x, flowY, 260, 120, "abs card nobar center", `<span class="mono" style="font-size:34px;font-weight:800;color:#6E6469">Step ${i + 1}</span>`, { background: "#EFEDEE", borderColor: "#BDB4B9", borderWidth: "3px", boxShadow: "none" });
    steps.push({ el: el2, x, y: flowY, w: 260, h: 120 });
  }
  // 红色大锁（挂在 Step 2 上）
  const lockSvg = svgLayer(flowL);
  const lock = sv("g", {}, lockSvg);
  sv("path", { d: "M-26,-6 L-26,-30 C-26,-62 26,-62 26,-30 L26,-6", fill: "none", stroke: "#B91C1C", "stroke-width": 11, "stroke-linecap": "round" }, lock);
  sv("rect", { x: -42, y: -10, width: 84, height: 66, rx: 12, fill: "#EF4444", stroke: "#991B1B", "stroke-width": 4 }, lock);
  sv("circle", { cx: 0, cy: 16, r: 8, fill: "#7F1D1D" }, lock); sv("rect", { x: -3.5, y: 18, width: 7, height: 20, rx: 3, fill: "#7F1D1D" }, lock);
  // 报错弹窗
  const err = box(root, 960 - 330, 220, 660, 150, "abs card nobar", `
    <div style="height:44px;background:#EF4444;display:flex;align-items:center;padding:0 18px;color:#fff;font-weight:800;font-size:22px;gap:10px">⚠ Error <span style="margin-left:auto;letter-spacing:6px">● ● ●</span></div>
    <div class="mono" style="padding:18px 24px;font-size:36px;font-weight:800;color:#B91C1C;white-space:nowrap">API_KEY_MISSING / DEADLOCK</div>`,
    { borderColor: "#FCA5A5", borderWidth: "3px", boxShadow: "0 18px 50px rgba(220,38,38,.30)" });
  // 像素碎块
  const shards = [];
  const R = rng(42);
  const shardL = svgLayer(root);
  for (let i = 0; i < 84; i++) {
    const s = steps[i % 3], sz = 12 + R() * 20;
    const x = s.x + R() * (s.w - sz), y = s.y + R() * (s.h - sz);
    const r = sv("rect", { width: sz, height: sz, rx: 3, fill: ["#BDB4B9", "#D6CFD3", "#A49AA0", "#EFEDEE", "#F9A8D4"][Math.floor(R() * 5)] }, shardL);
    shards.push({ r, x, y, sz, vx: 0, vy: -500 - R() * 700, rv: (R() - .5) * 900, dx: R() });
  }
  // 樱花波纹
  const ripple = svgLayer(root);
  const rings = [0, 1, 2].map(() => sv("circle", { cx: 0, cy: 0, r: 0, fill: "none", stroke: "#F472B6", "stroke-width": 6 }, ripple));
  // ---- 标题 ----
  const titleWrap = box(root, 0, 330, 1920, 150, "abs center");
  const title = el("div", "", titleWrap, "", { position: "relative", fontSize: "108px", fontWeight: 900, letterSpacing: "1px", color: "#2D1624", whiteSpace: "nowrap", transformOrigin: "50% 60%" });
  title.innerHTML = `<span style="font-size:96px">🌸</span> Sakura<span style="color:#EC4899">Fl<span id="s1o">o</span>w</span> Studio <span style="color:#EC4899">v4.0</span><span id="s1bl" style="display:inline-block;width:0;height:0"></span>`;
  const sub = box(root, 0, 500, 1920, 70, "abs center nowrap", "", { fontSize: "46px", fontWeight: 700, color: "#6B4A5C" });
  const tags = [["🫧 黑板圆桌", "#FDF2F8"], ["🔑 免 API Key", "#ECFDF5"], ["🖥️+☁️ 双轨混排", "#F5F3FF"], ["🌸 自组织画布", "#FDF2F8"]];
  const tagWrap = box(root, 0, 620, 1920, 70, "abs center", "", { gap: "22px" });
  const tagEls = tags.map(([t, bg]) => el("div", "pill", tagWrap, t, { fontSize: "28px", background: bg, border: "1.5px solid #F3D4E1", padding: "10px 24px", boxShadow: "0 8px 20px rgba(236,72,153,.10)" }));
  // ---- 角色 ----
  const ms = svgLayer(root);
  const M = new Mascot(ms, 1);
  const tJump = c(5) + 0.15, stompT = tJump + 0.95;
  const tTitle = w(6, "Sakura") - 0.05;
  let oPos = null;
  const sfx = [
    { t: 0, type: "drone", dur: stompT },
    ...appear.map((t, i) => ({ t, type: "softpop", gain: .5, p: i })),
    { t: c(3) + 0.1, type: "thud", gain: .7 },
    { t: w(4, "死板") - 0.05, type: "error" },
    { t: tJump - 0.1, type: "whoosh" },
    { t: stompT, type: "pop" }, { t: stompT, type: "glass" }, { t: stompT, type: "music" },
    { t: stompT + 0.95, type: "pop", gain: .5 },
    { t: tTitle, type: "chime" },
    { t: tTitle + 0.45, type: "whoosh", gain: .4 },
    ...[0, 1, 2, 3].map(i => ({ t: c(7) + 0.1 + i * 0.22, type: "tick", p: i })),
  ];
  const stompX = 960, stompY = flowY;
  return {
    sfx, enter: "none",
    update(lt, gt) {
      // 灰暗旧世界 → 樱花晕染
      const rr = lt < stompT ? 0 : Ease.out(prog(lt, stompT, stompT + 1.2)) * 2400;
      if (rr >= 2390) gray.style.display = "none";
      else {
        gray.style.display = "block";
        const m = `radial-gradient(circle at ${stompX}px ${stompY}px, transparent ${rr}px, black ${rr + 70}px)`;
        if (gray._m !== m) { gray.style.webkitMaskImage = m; gray.style.maskImage = m; gray._m = m; }
      }
      rings.forEach((r, i) => {
        const a = prog(lt, stompT + i * 0.12, stompT + 1.1 + i * 0.12);
        attr(r, { cx: stompX, cy: stompY, r: (Ease.out(a) * (900 + i * 260)).toFixed(1), opacity: a > 0 && a < 1 ? ((1 - a) * 0.6).toFixed(3) : 0 });
      });
      // 孤岛
      const islOut = prog(lt, c(3) - 0.1, c(3) + 0.35);
      isl.forEach((s, i) => {
        pop(s.g, lt, appear[i], { from: .6, dy: 30 });
        const bp = pop(s.b, lt, appear[i] + 0.15, { from: .3, dy: 16 });
        const talk = lt > c(2) ? Math.sin((lt - c(2)) * 14 + i) * 4 : 0;
        s.dots.textContent = lt > c(2) ? ["···", "？", "··", "！？"][(Math.floor(lt * 3) + i) % 4] : "···";
        css(s.g, { o: (lt > appear[i] ? 1 : 0) * (1 - islOut), tf: `translateY(${-islOut * 60}px) scale(${lerp(.6, 1, spring(lt - appear[i]))})` });
        css(s.b, { o: (lt > appear[i] + 0.15 ? 1 : 0) * (1 - islOut), tf: `translateY(${talk - islOut * 60}px) scale(${lerp(.3, 1, spring(lt - appear[i] - 0.15))})` });
      });
      walls.forEach((wl, i) => css(wl, { o: prog(lt, appear[i + 1], appear[i + 1] + 0.3) * (1 - islOut) * 0.9 }));
      // 死板流程
      const fIn = c(3) + 0.15, broken = lt >= stompT;
      steps.forEach((s, i) => { pop(s.el, lt, fIn + i * 0.18, { from: .7 }); if (broken) css(s.el, { o: 0 }); });
      arrows.forEach((a, i) => { const p = prog(lt, fIn + 0.25 + i * 0.18, fIn + 0.55 + i * 0.18); a.setAttribute("opacity", broken ? 0 : p); heads[i].setAttribute("opacity", broken ? 0 : p); });
      const lockIn = spring(lt - (fIn + 0.7));
      const swing = Math.sin((lt - fIn) * 3) * 6 * Math.exp(-(lt - fIn - 0.7) * 0.4);
      attr(lock, { transform: `translate(960,${flowY + 8 - (1 - lockIn) * 120}) rotate(${swing.toFixed(2)}) scale(1.05)`, opacity: broken ? 0 : prog(lt, fIn + 0.7, fIn + 0.85) });
      // 报错弹窗
      const tErr = w(4, "死板") - 0.05;
      const es = spring(lt - tErr);
      const shakeX = lt > tErr && lt < tErr + 0.5 ? Math.sin((lt - tErr) * 70) * 14 * (1 - (lt - tErr) / 0.5) : 0;
      const errOut = prog(lt, tJump + 0.4, tJump + 0.7);
      css(err, { o: prog(lt, tErr, tErr + 0.08) * (1 - errOut), tf: `translateX(${shakeX}px) scale(${lerp(0.2, 1, es) * (1 - errOut * .3)}) rotate(${(-2 * es).toFixed(2)}deg)` });
      // 碎块
      shards.forEach(s => {
        if (!broken) { s.r.setAttribute("opacity", 0); return; }
        const a = lt - stompT;
        const dirx = (s.x + s.sz / 2 - stompX) * 2.2 + (s.dx - .5) * 400;
        const x = s.x + dirx * a, y = s.y + s.vy * a + 1300 * a * a;
        attr(s.r, { x: x.toFixed(1), y: y.toFixed(1), opacity: Math.max(0, 1 - a / 1.3).toFixed(3), transform: `rotate(${(s.rv * a).toFixed(1)} ${(x + s.sz / 2).toFixed(1)} ${(y + s.sz / 2).toFixed(1)})` });
      });
      // 标题
      const ts = spring(lt - tTitle);
      css(title, { o: prog(lt, tTitle, tTitle + 0.12), tf: `scale(${lerp(0.3, 1, ts)})` });
      const subT = tTitle + 0.55;
      typeText(sub, "本地多智能体 · 共享黑板自组织画布", lt, subT, 16, true);
      css(sub, { o: lt > subT - 0.3 ? 1 : 0 });
      tagEls.forEach((tg, i) => pop(tg, lt, c(7) + 0.1 + i * 0.22, { from: .4, dy: 24 }));
      // ---- 小 Claude ----
      if (!oPos) {
        const o = document.getElementById("s1o"), bl = document.getElementById("s1bl");
        if (o && o.offsetWidth) {
          const base = titleWrap.offsetTop + title.offsetTop + bl.offsetTop;
          oPos = [titleWrap.offsetLeft + title.offsetLeft + o.offsetLeft + o.offsetWidth / 2, base - 0.54 * 108];
        }
      }
      const op = oPos || [1100, 370];
      const jumps = [
        { t: tJump, to: [stompX, flowY], d: 0.95, h: 520 },
        { t: stompT + 0.55, to: [560, 840], d: 0.6, h: 140 },
        { t: tTitle + 0.55, to: op, d: 0.7, h: 300 },
      ];
      const m = motion(lt, gt, [-200, 820], jumps);
      const onTitle = lt > tTitle + 0.55 + 0.7;
      const sc = lt < stompT + 0.55 ? 1.0 : (onTitle ? 0.52 : lerp(1.0, 0.52, prog(lt, tTitle + 0.55, tTitle + 1.25)));
      const happy = lt > stompT;
      M.set({
        ...m, s: sc, gt, x: m.x, y: m.y,
        eyes: lt < stompT ? (m.air ? "open" : "open") : (happy && !m.air ? "happy" : "open"),
        look: lt < stompT ? 0.6 : 0,
        armL: m.air ? 60 : (onTitle ? -10 : -14), armR: m.air ? 60 : (onTitle ? wave(gt) : (lt > stompT ? 40 : -14)),
        o: lt < tJump - 0.2 ? 0 : 1, flowerRot: m.air ? -18 * Math.sin(gt * 10) : undefined,
      });
    },
  };
});

/* =========================== Scene 2 · 免 API Key =========================== */
registerScene("s2", (root, T, X) => {
  const { c, e, w } = X;
  const lay = el("div", "layer", root);
  const head = box(lay, 110, 108, 1700, 60, "abs nowrap", `🔑 第一大杀手锏：<span style="color:#DB2777">免 API Key</span> · 复用本机登录态`, { fontSize: "40px", fontWeight: 900 });
  const svgBack = svgLayer(lay);
  // 笔记本电脑
  const lap = sv("g", { transform: "translate(205,300)" }, svgBack);
  sv("rect", { x: -88, y: -110, width: 176, height: 112, rx: 12, fill: "#fff", stroke: "#2D1624", "stroke-width": 5 }, lap);
  sv("rect", { x: -74, y: -96, width: 148, height: 84, rx: 6, fill: "#FDF2F8" }, lap);
  sakuraFlower(lap, 18).setAttribute("transform", "translate(0,-56)");
  sv("path", { d: "M-112,8 L112,8 L98,24 L-98,24 Z", fill: "#F3D4E1", stroke: "#2D1624", "stroke-width": 5, "stroke-linejoin": "round" }, lap);
  // 雷达波
  const radar = [0, 1, 2, 3].map(() => sv("circle", { cx: 205, cy: 250, r: 0, fill: "none", stroke: "#EC4899", "stroke-width": 5 }, svgBack));
  // 智能体卡片 2x2
  const cardsDef = [
    ["Antigravity", "agy", "~/.gemini/antigravity", 100, 390], ["Claude Code", "claude", "~/.claude", 510, 390],
    ["OpenAI Codex", "codex", "~/.codex", 100, 650], ["DeepSeek Harness", "dsh", "~/.deepseek", 510, 650],
  ];
  const cAppear = [0, 1, 2, 3].map(i => c(4) + 0.05 + i * 0.32);
  const cards = cardsDef.map(([n, k, p, x, y], i) => {
    const cd = box(lay, x, y, 370, 130, "abs card");
    const ic = box(cd, 18, 30, 72, 72, "abs center"); agentIcon(ic, k, 70, 20 + i);
    box(cd, 102, 28, 260, 38, "abs nowrap", n, { fontSize: "27px", fontWeight: 800 });
    box(cd, 102, 70, 260, 28, "abs nowrap mono muted", p, { fontSize: "18px" });
    const badge = box(cd, 236, 92, 124, 30, "abs pill", `<span style="color:#10B981">●</span> 已探测`, { fontSize: "17px", background: "#ECFDF5", color: "#047857", padding: "3px 12px", justifyContent: "center" });
    return { cd, badge, x, y };
  });
  const chipWrap = box(lay, 100, 818, 800, 50, "abs", "", { display: "flex", gap: "14px" });
  const chips = ["✨ Gemini CLI", "🦙 Ollama", "🧩 OpenCode", "🛠️ Aider"].map(t => el("div", "pill", chipWrap, t, { fontSize: "21px", background: "#fff", border: "1.5px solid #F3D4E1", boxShadow: "0 6px 14px rgba(236,72,153,.08)" }));
  // 右侧：底层原理
  const panel = box(lay, 980, 190, 840, 690, "abs card");
  box(panel, 36, 26, 600, 44, "abs nowrap h-title", "⚙️ 底层原理：怎么做到零密钥？", { fontSize: "30px" });
  const rowDef = [["❌", "RPA 模拟点鼠标"], ["❌", "到处复制粘贴 API Key"]];
  const rows = rowDef.map(([ic, t], i) => {
    const r = box(panel, 36, 96 + i * 76, 760, 60, "abs", "", { display: "flex", alignItems: "center", gap: "14px", fontSize: "30px", fontWeight: 700, color: "#6B4A5C", background: "#FFF1F2", borderRadius: "14px", padding: "0 18px" });
    el("span", "", r, ic); const tx = el("span", "", r, t, { position: "relative" });
    const strike = el("span", "", tx, "", { position: "absolute", left: "-6px", right: "-6px", top: "52%", height: "4px", background: "#E11D48", borderRadius: "2px", transformOrigin: "0 50%", transform: "scaleX(0)" });
    return { r, strike };
  });
  const ok = box(panel, 36, 266, 768, 70, "abs", `<span style="font-size:34px">✅</span> 按需拉起<span style="color:#DB2777">原生无头 CLI 子进程</span>`, { display: "flex", alignItems: "center", gap: "12px", fontSize: "32px", fontWeight: 900, background: "linear-gradient(90deg,#FDF2F8,#ECFDF5)", border: "2px solid #F9A8D4", borderRadius: "16px", padding: "0 20px", transformOrigin: "10% 50%" });
  const engine = box(panel, 40, 410, 280, 110, "abs card center", `<div style="text-align:center"><div style="font-size:30px;font-weight:900">🌸 SakuraFlow</div><div class="muted" style="font-size:20px;font-weight:700">本地引擎 · spawn()</div></div>`, { borderColor: "#F9A8D4", borderWidth: "2px" });
  const locks = [["~/.codex", 368], ["~/.claude", 496]].map(([p, y]) => box(panel, 500, y, 300, 86, "abs card nobar", `<div style="display:flex;align-items:center;gap:14px;height:100%;padding:0 18px"><span style="font-size:36px">🔒</span><div><div class="mono" style="font-size:24px;font-weight:800">${p}</div><div class="muted" style="font-size:17px;font-weight:700">本机登录态 · 只读复用</div></div></div>`, { borderColor: "#C4B5FD", borderWidth: "2px" }));
  const pSvg = svgLayer(panel);
  pSvg.setAttribute("style", "position:absolute;left:0;top:0");
  const beams = [[[320, 465], [400, 465], [420, 411], [500, 411]], [[320, 465], [400, 465], [420, 539], [500, 539]]];
  const beamEls = beams.map(b => ({ base: sv("path", { d: bezPath(b), fill: "none", stroke: "#F9A8D4", "stroke-width": 8, "stroke-linecap": "round" }, pSvg), flow: sv("path", { d: bezPath(b), fill: "none", stroke: "#EC4899", "stroke-width": 4, "stroke-dasharray": "14 16", "stroke-linecap": "round" }, pSvg) }));
  const shields = [411, 539].map(y => { const g = sv("g", { transform: `translate(772,${y - 30})` }, pSvg); sv("path", { d: "M0,-16 L13,-11 C13,2 8,10 0,15 C-8,10 -13,2 -13,-11 Z", fill: "#10B981", stroke: "#fff", "stroke-width": 2 }, g); return g; });
  const label = box(panel, 36, 600, 768, 62, "abs center nowrap", "🛡️ 零密钥读取 · 干完即退不占内存", { fontSize: "30px", fontWeight: 900, color: "#047857", background: "#ECFDF5", borderRadius: "16px", border: "2px solid #A7F3D0" });
  const exitChip = box(panel, 56, 530, 250, 40, "abs pill mono center", "exit 0 · 内存已释放", { fontSize: "18px", background: "#F5F3FF", color: "#6D28D9", border: "1.5px solid #DDD6FE" });
  const stamp = box(lay, 1580, 150, 230, 84, "abs center nowrap", "0 Key Leak", { fontSize: "34px", fontWeight: 900, color: "#DB2777", border: "5px solid #EC4899", borderRadius: "16px", background: "rgba(255,255,255,.9)", fontFamily: "Consolas, monospace" });
  // 角色
  const ms = svgLayer(root); const M = new Mascot(ms, 2);
  const jT = [0, 1, 2, 3].map(i => cAppear[0] + 0.55 + i * 0.75);
  const spots = cards.map(cd => [cd.x + 270, cd.y]);
  const jumps = [{ t: 0.05, to: [205, 190], d: 0.5, h: 120 }, ...jT.map((t, i) => ({ t, to: spots[i], d: 0.55, h: i === 0 ? 120 : 150 }))];
  const sfx = [
    { t: 0.55, type: "whoosh", gain: .4 },
    { t: 0.7, type: "tick" }, { t: 1.6, type: "scratch" }, { t: 1.9, type: "tick" }, { t: w(1, "Key") + 0.3, type: "scratch" },
    { t: c(3) + 0.1, type: "radar" },
    ...cAppear.map((t, i) => ({ t, type: "blip", p: [523.25, 659.25, 783.99, 1046.5][i] })),
    ...jT.map(t => ({ t: t + 0.55, type: "softpop", gain: .7 })),
    { t: c(5) + 0.1, type: "tick", p: 2 },
    { t: c(6), type: "pop" }, { t: c(6) + 0.6, type: "whoosh", gain: .5 },
    { t: c(7) + 0.1, type: "chime" }, { t: c(8) + 0.05, type: "stamp" },
  ];
  return {
    sfx,
    update(lt, gt) {
      pop(head, lt, 0.15, { from: .8, dy: 20 });
      // 雷达
      radar.forEach((r, i) => {
        const t0 = c(3) + 0.1 + i * 0.55, a = prog(lt, t0, t0 + 1.6);
        attr(r, { r: (Ease.out(a) * 900).toFixed(1), opacity: a > 0 && a < 1 ? ((1 - a) * 0.5).toFixed(3) : 0 });
      });
      cards.forEach((cd, i) => {
        pop(cd.cd, lt, cAppear[i], { from: .5, dy: 30 });
        const lit = lt >= jT[i] + 0.55;
        pop(cd.badge, lt, jT[i] + 0.55, { from: .2 });
        css(cd.cd, { borderColor: lit ? "#6EE7B7" : "#F3D4E1" });
      });
      chips.forEach((ch, i) => pop(ch, lt, c(5) + 0.1 + i * 0.12, { from: .4, dy: 14 }));
      pop(panel, lt, 0.35, { from: .9, dx: 60 });
      rows.forEach((r, i) => {
        const t0 = i ? 1.9 : 0.7, ts = i ? w(1, "Key") + 0.3 : 1.6;
        fadeIn(r.r, lt, t0, 0.3, 14);
        css(r.strike, { tf: `scaleX(${Ease.out(prog(lt, ts, ts + 0.35))})` });
        if (lt > ts + 0.4) css(r.r, { o: 1 - 0.45 * prog(lt, ts + 0.4, ts + 0.8) });
      });
      pop(ok, lt, c(6), { from: .5 });
      pop(engine, lt, c(6) + 0.3, { from: .6 });
      locks.forEach((l, i) => pop(l, lt, c(6) + 0.45 + i * 0.15, { from: .6 }));
      beamEls.forEach((b, i) => {
        const p = prog(lt, c(6) + 0.6 + i * 0.12, c(6) + 1.1 + i * 0.12);
        attr(b.base, { "stroke-dasharray": "400", "stroke-dashoffset": (400 * (1 - p)).toFixed(1) });
        attr(b.flow, { opacity: p >= 1 ? 1 : 0, "stroke-dashoffset": (-lt * 90).toFixed(1) });
      });
      shields.forEach((s, i) => { const sp = spring(lt - (c(7) + 0.05 + i * .1)); s.setAttribute("transform", `translate(772,${[411, 539][i] - 30}) scale(${(sp * (1 + 0.15 * Math.sin(lt * 6))).toFixed(3)})`); });
      pop(label, lt, c(7) + 0.1, { from: .6, dy: 20 });
      pop(exitChip, lt, c(7) + 0.4, { from: .5 });
      const ss = spring(lt - (c(8) + 0.05));
      css(stamp, { o: prog(lt, c(8), c(8) + 0.08), tf: `rotate(${lerp(-30, -8, ss)}deg) scale(${lerp(2.4, 1, ss)})` });
      // 角色
      const m = motion(lt, gt, [205, 190], jumps);
      const panic = lt > c(1) + 0.2 && lt < c(3) - 0.1;
      const explaining = lt > c(6) + 0.2;
      M.set({ ...m, s: 0.68, gt, prop: "magnifier", sweat: panic,
        rot: m.rot + (panic ? shake(gt) * 0.6 : 0), look: panic ? Math.sin(gt * 26) : (explaining ? 1 : 0.3),
        eyes: panic ? "squint" : (lt > c(8) ? "happy" : (m.air ? "open" : "open")),
        armR: explaining ? 35 + 6 * Math.sin(gt * 5) : (m.air ? 50 : 10), armL: m.air ? 50 : -14,
        o: lt < 0.02 ? 0 : 1 });
    },
  };
});

/* =========================== Scene 3 · 双轨兼容 + 授权画像 =========================== */
registerScene("s3", (root, T, X) => {
  const { c, e, w } = X;
  const lay = el("div", "layer", root);
  const win = box(lay, 80, 104, 1760, 800, "abs card", "", { borderRadius: "26px" });
  const bar = box(win, 0, 4, 1760, 64, "abs", `<div style="display:flex;align-items:center;height:100%;padding:0 28px;gap:16px"><span style="font-size:28px;font-weight:900">🧠 智能体中心与授权画像</span><span class="pill" style="font-size:18px;background:#FDF2F8;color:#DB2777">Agent Hub</span><span style="margin-left:auto;display:flex;gap:10px"><span style="width:16px;height:16px;border-radius:8px;background:#F9A8D4"></span><span style="width:16px;height:16px;border-radius:8px;background:#FBCFE8"></span><span style="width:16px;height:16px;border-radius:8px;background:#FCE7F3"></span></span></div>`, { borderBottom: "1.5px solid #F3D4E1" });
  // 表单卡
  const F = box(lay, 130, 200, 620, 320, "abs card", "", { transformOrigin: "0 0", zIndex: 3 });
  box(F, 28, 22, 560, 40, "abs nowrap h-title", "☁️ 接入远程 API 模型");
  const proto = box(F, 360, 24, 236, 36, "abs", "", { display: "flex", background: "#FDF2F8", borderRadius: "18px", padding: "3px", gap: "3px" });
  const pOA = el("div", "pill center", proto, "OpenAI", { flex: 1, fontSize: "17px", padding: "2px 0", justifyContent: "center" });
  const pAN = el("div", "pill center", proto, "Anthropic", { flex: 1, fontSize: "17px", padding: "2px 0", justifyContent: "center" });
  const fields = [["Base URL", "https://api.your-provider.com/v1"], ["API Key", "sk-proj-9f3c7e21d0abcd"], ["Model ID", "claude-sonnet-4-5"]].map(([k, v], i) => {
    box(F, 28, 80 + i * 76, 140, 56, "abs center nowrap muted", k, { fontSize: "20px", fontWeight: 800, justifyContent: "flex-start" });
    const inp = box(F, 160, 80 + i * 76, 432, 56, "abs mono nowrap", "", { border: "2px solid #F3D4E1", borderRadius: "12px", fontSize: "21px", display: "flex", alignItems: "center", padding: "0 14px", overflow: "hidden", background: "#FFFBFD" });
    const glow = el("div", "", inp, "", { position: "absolute", left: 0, top: 0, bottom: 0, width: "120px", background: "linear-gradient(90deg,transparent,rgba(236,72,153,.18),transparent)" });
    const txt = el("span", "", inp, "");
    return { inp, txt, glow, v };
  });
  const tType = [c(3) + 0.15, c(5) + 0.05, c(5) + 0.75];
  // 本地 / 远程 卡
  const mkAgent = (x, icon, name, tag, tagBg, tagColor) => {
    const d = box(lay, x, 214, 400, 150, "abs card");
    const ic = box(d, 20, 40, 76, 76, "abs center"); agentIcon(ic, icon, 72, x);
    box(d, 110, 34, 280, 40, "abs nowrap", name, { fontSize: "27px", fontWeight: 800 });
    box(d, 110, 82, 200, 36, "abs pill nowrap", tag, { fontSize: "19px", background: tagBg, color: tagColor });
    return d;
  };
  const L = mkAgent(870, "claude", "Claude Code", "🖥️ 本地 CLI", "#FDF2F8", "#DB2777");
  const slot = box(lay, 1320, 214, 400, 150, "abs center nowrap", "＋ 远程 API 槽位", { border: "3px dashed #E9D5FF", borderRadius: "20px", fontSize: "26px", color: "#A78BFA", fontWeight: 800 });
  const Rm = mkAgent(1320, "dsh", "DeepSeek API", "☁️ 远程 API", "#F5F3FF", "#7C3AED");
  Rm.style.borderColor = "#DDD6FE";
  const big = box(lay, 870, 396, 850, 80, "abs center nowrap", `<span style="color:#DB2777">本地 + 远程</span>，同一画布自由混排`, { fontSize: "44px", fontWeight: 900 });
  // 下半区
  const btn = box(lay, 140, 640, 440, 84, "abs center nowrap", "🔐 授权自检并生成画像", { fontSize: "30px", fontWeight: 900, color: "#fff", background: "linear-gradient(90deg,#F472B6,#EC4899)", borderRadius: "20px", boxShadow: "0 12px 28px rgba(236,72,153,.35)" });
  const ripple = el("div", "", btn, "", { position: "absolute", left: "50%", top: "50%", width: "40px", height: "40px", marginLeft: "-20px", marginTop: "-20px", borderRadius: "50%", background: "rgba(255,255,255,.6)" });
  btn.style.overflow = "hidden";
  const note = box(lay, 140, 740, 440, 120, "abs", "点击后才向你的智能体发起轻量探测<br>实测延迟 → 动态生成画像", { fontSize: "21px", fontWeight: 700, color: "#8A6B7C", lineHeight: "36px" });
  const P = box(lay, 640, 572, 1150, 300, "abs card");
  box(P, 30, 20, 700, 40, "abs nowrap h-title", "📊 动态能力画像 · Claude Code");
  const lock = box(P, 760, 20, 360, 40, "abs pill nowrap", "🔒 未授权 · 不预置任何数据", { fontSize: "19px", background: "#F4F4F5", color: "#71717A", justifyContent: "center" });
  const lat = box(P, 900, 18, 220, 44, "abs pill nowrap mono", "⏱ 延迟 3.0s", { fontSize: "22px", background: "#ECFDF5", color: "#047857", justifyContent: "center", border: "1.5px solid #A7F3D0" });
  const dims = [["架构规划", 92], ["代码工程", 95], ["科研推理", 88], ["批判审查", 84], ["响应速度", 76], ["工具生态", 90]];
  const bars = dims.map(([n, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 30 + col * 560, y = 86 + row * 70;
    box(P, x, y, 130, 44, "abs center nowrap", n, { fontSize: "22px", fontWeight: 800, justifyContent: "flex-start" });
    const track = box(P, x + 130, y + 12, 330, 20, "abs", "", { background: "#FCE7F3", borderRadius: "10px", overflow: "hidden" });
    const fill = el("div", "", track, "", { height: "100%", width: "100%", background: "linear-gradient(90deg,#F9A8D4,#EC4899)", borderRadius: "10px", transformOrigin: "0 50%", transform: "scaleX(0)" });
    const pct = box(P, x + 470, y, 80, 44, "abs center mono nowrap", "0%", { fontSize: "22px", fontWeight: 800, color: "#DB2777", justifyContent: "flex-start" });
    return { fill, pct, v };
  });
  // 光标
  const curSvg = svgLayer(root);
  const cursor = sv("path", { d: "M0,0 L0,36 L10,27 L17,43 L24,40 L17,25 L30,25 Z", fill: "#fff", stroke: "#2D1624", "stroke-width": 2.5, "stroke-linejoin": "round" }, curSvg);
  // 角色
  const ms = svgLayer(root); const M = new Mascot(ms, 3);
  const tFly = c(6) - 0.05, tClick = w(8, "点击") - 0.05, tBars = tClick + 0.45;
  const jumps = [
    { t: 0.1, to: [640, 200], d: 0.55, h: 140 },
    { t: tFly - 0.35, to: [760, 572], d: 0.65, h: 180 },
  ];
  const sfx = [
    { t: 0.15, type: "whoosh", gain: .4 }, { t: 0.65, type: "softpop" },
    { t: c(1) + 0.05, type: "pop", gain: .6 },
    { t: c(2) + 0.1, type: "pop" }, { t: c(2) + 0.35, type: "softpop" },
    ...Array.from({ length: 12 }, (_, i) => ({ t: tType[0] + i * 0.12, type: "tick", gain: .6, p: i })),
    { t: w(4, "Anthropic"), type: "tick", p: 3 },
    ...Array.from({ length: 6 }, (_, i) => ({ t: tType[1] + i * 0.1, type: "tick", gain: .6, p: i })),
    ...Array.from({ length: 3 }, (_, i) => ({ t: tType[2] + i * 0.1, type: "tick", gain: .6, p: i })),
    { t: tFly, type: "whoosh" }, { t: tFly + 0.6, type: "pop" },
    { t: w(6, "同台"), type: "chime" },
    { t: c(7) + 0.1, type: "softpop" },
    { t: tClick, type: "click" }, { t: tBars, type: "rise" }, { t: tBars + 1.2, type: "ding" },
  ];
  return {
    sfx, enter: "slide",
    update(lt, gt) {
      pop(win, lt, 0.0, { from: .97 });
      // 表单
      const flyP = Ease.inOut(prog(lt, tFly, tFly + 0.6));
      pop(F, lt, 0.25, { from: .7, dy: 30 });
      if (lt > tFly) {
        const sx = lerp(1, 400 / 620, flyP), sy = lerp(1, 150 / 320, flyP);
        css(F, { o: 1 - prog(lt, tFly + 0.42, tFly + 0.6), tf: `translate(${lerp(0, 1320 - 130, flyP)}px, ${lerp(0, 214 - 200, flyP) - Math.sin(Math.PI * flyP) * 120}px) scale(${sx}, ${sy})` });
      }
      const anth = lt > w(4, "Anthropic");
      css(pOA, { background: !anth && lt > c(3) ? "#EC4899" : "transparent", color: !anth && lt > c(3) ? "#fff" : "#8A6B7C" });
      css(pAN, { background: anth ? "#A855F7" : "transparent", color: anth ? "#fff" : "#8A6B7C" });
      fields.forEach((f, i) => {
        const t0 = tType[i];
        let v = f.v; const n = clamp(Math.floor((lt - t0) * (i === 0 ? 20 : 26)), 0, v.length);
        let s = v.slice(0, n);
        if (i === 1 && n >= v.length && lt > t0 + v.length / 26 + 0.25) s = "sk-****abcd";
        const showCur = lt > t0 - 0.2 && lt < t0 + v.length / 22 + 0.4 && Math.floor(lt * 3) % 2 === 0;
        const html = escapeHtml(s) + (showCur ? '<span style="color:#EC4899">|</span>' : "");
        if (f.txt._h !== html) { f.txt.innerHTML = html; f.txt._h = html; }
        const active = lt > t0 - 0.2 && lt < t0 + v.length / 22 + 0.3;
        css(f.inp, { borderColor: active ? "#EC4899" : "#F3D4E1" });
        css(f.glow, { o: active ? 1 : 0, tf: `translateX(${((lt - t0) * 500) % 560 - 120}px)` });
      });
      pop(L, lt, c(2) + 0.1, { from: .5, dy: 20 });
      css(slot, { o: prog(lt, c(2) + 0.35, c(2) + 0.6) * (1 - prog(lt, tFly + 0.45, tFly + 0.6)) });
      pop(Rm, lt, tFly + 0.5, { from: .85 });
      pop(big, lt, w(6, "同台") - 0.05, { from: .5, dy: 20 });
      // 画像
      pop(P, lt, c(7) + 0.1, { from: .8, dy: 40 });
      pop(btn, lt, c(7) + 0.3, { from: .6 });
      fadeIn(note, lt, c(7) + 0.5);
      const pressed = lt > tClick && lt < tClick + 0.18;
      css(btn, { tf: `scale(${(lt < c(7) + 1.2 ? lerp(.6, 1, spring(lt - c(7) - 0.3)) : 1) * (pressed ? 0.95 : 1)})` });
      const rp = prog(lt, tClick, tClick + 0.6);
      css(ripple, { o: rp > 0 && rp < 1 ? 1 - rp : 0, tf: `scale(${rp * 14})` });
      css(lock, { o: prog(lt, c(7) + 0.4, c(7) + 0.6) * (1 - prog(lt, tClick + 0.1, tClick + 0.3)) });
      pop(lat, lt, tBars + 1.1, { from: .3 });
      bars.forEach((b, i) => {
        const t0 = tBars + i * 0.12, s = spring(t0 > lt ? 0 : (lt - t0) * 0.8);
        css(b.fill, { tf: `scaleX(${(s * b.v / 100).toFixed(4)})` });
        const pct = Math.round(clamp(s, 0, 1.2) * b.v); const txt = Math.min(pct, b.v + 6) + "%";
        if (b.pct._t !== txt) { b.pct.textContent = lt < t0 ? "--" : txt; b.pct._t = txt; }
      });
      // 光标
      const cx0 = [1500, 900], cx1 = [360, 690];
      const cp = Ease.inOut(prog(lt, tClick - 0.9, tClick - 0.05));
      const curO = prog(lt, tClick - 1.1, tClick - 0.9) * (1 - prog(lt, tClick + 0.9, tClick + 1.2));
      attr(cursor, { transform: `translate(${lerp(cx0[0], cx1[0], cp)},${lerp(cx0[1], cx1[1], cp) - Math.sin(Math.PI * cp) * 80}) scale(${pressed ? 0.85 : 1})`, opacity: curO.toFixed(3) });
      // 角色
      const m = motion(lt, gt, [-120, 200], jumps);
      const worried = lt > 0.6 && lt < c(1);
      const exam = lt > tClick - 0.2;
      M.set({ ...m, s: 0.78, gt, prop: exam || lt > c(7) ? "steth" : "none", sweat: worried,
        eyes: worried ? "squint" : (lt > c(1) && lt < c(2) ? "happy" : (exam && lt < tBars + 1.1 ? "think" : (lt > tBars + 1.1 ? "happy" : "open"))),
        look: lt > c(2) && lt < tFly ? 0.8 : (exam ? 1 : 0), lookY: lt > c(3) && lt < tFly ? 1 : 0,
        armR: exam ? 20 + 10 * Math.sin(gt * 6) : (lt > c(1) && lt < c(2) ? wave(gt) : (m.air ? 60 : -14)), armL: m.air ? 60 : -14,
        rot: m.rot + (worried ? shake(gt) * 0.4 : 0), o: lt < 0.1 ? 0 : 1 });
    },
  };
});

/* =========================== Scene 4 · 黑板圆桌自组织 =========================== */
registerScene("s4", (root, T, X) => {
  const { c, e, w } = X;
  const lay = el("div", "layer", root);
  const BX = 380, BY = 170, BW = 1160, BH = 630;
  const badges = box(lay, 0, 112, 1920, 46, "abs center", "", { gap: "14px" });
  const bdg = ["🎓 LbMAS 2025", "AutoAgents", "DyLAN"].map(t => el("div", "pill", badges, t, { fontSize: "21px", background: "#fff", border: "1.5px solid #F9A8D4", color: "#DB2777", boxShadow: "0 6px 14px rgba(236,72,153,.12)" }));
  const board = box(lay, BX, BY, BW, BH, "abs", "", { background: "linear-gradient(160deg,#2F2A36,#24202B)", borderRadius: "26px", border: "6px solid #F9A8D4", boxShadow: "0 0 0 6px rgba(244,114,182,.18), 0 0 46px rgba(236,72,153,.45), 0 20px 40px rgba(45,22,36,.25)" });
  const chalkTex = el("div", "", board, "", { position: "absolute", inset: 0, borderRadius: "20px", backgroundImage: "radial-gradient(rgba(255,255,255,.035) 1px, transparent 1.5px)", backgroundSize: "7px 7px" });
  box(board, 28, 18, 700, 44, "abs nowrap", "🫧 共享黑板 · Blackboard", { fontSize: "30px", fontWeight: 900, color: "#FDF2F8" });
  const roundNo = box(board, BW - 290, 20, 260, 40, "abs pill nowrap mono", "ROUND 1 / 1", { fontSize: "20px", background: "rgba(244,114,182,.2)", color: "#FBCFE8", justifyContent: "center" });
  // 被划掉的旧流程涂鸦
  const doodle = box(board, 310, 260, 540, 140, "abs center nowrap", `<span style="font-family:Consolas;font-size:40px;color:#E5E7EB;letter-spacing:4px">□ → □ → □</span>`, {});
  const xMark = box(doodle, 150, -10, 240, 160, "abs center", `<span style="font-size:150px;color:#F87171;font-weight:900;line-height:1">✕</span>`);
  const doodleLabel = box(board, 330, 410, 500, 40, "abs center nowrap", "人工画死的流程图", { fontSize: "24px", color: "#FCA5A5", fontWeight: 800 });
  // 立项
  const chair = box(board, 28, 74, 1104, 50, "abs", "", { display: "flex", alignItems: "center", gap: "16px" });
  const chairPill = el("div", "pill", chair, "👑 总意图解析官", { fontSize: "23px", background: "linear-gradient(90deg,#F472B6,#EC4899)", color: "#fff" });
  const chairTxt = el("div", "nowrap", chair, "", { fontSize: "24px", color: "#FDF2F8", fontWeight: 700 });
  const notesDef = ["① 理论框架与可检验假设", "② 实验设计与功效模拟", "③ 独立同行评审 · 去幻觉"];
  const notes = notesDef.map((t, i) => box(board, 28 + i * 372, 136, 352, 80, "abs center nowrap", t, { background: ["#FEF3C7", "#FCE7F3", "#E0E7FF"][i], borderRadius: "10px", fontSize: "24px", fontWeight: 800, color: "#2D1624", boxShadow: "0 6px 0 rgba(0,0,0,.15)", transformOrigin: "50% 0" }));
  // 发言气泡
  const bubDef = [
    ["#1 Antigravity", "我长上下文强，我来领理论框架与假设！", 28, 244, "L", "#F472B6"],
    ["#2 Codex", "我擅长沙箱写代码，我并行写实验与功效模拟！", 28, 372, "L", "#10B981"],
    ["#3 DeepSeek Harness", "我独立做红队同行评审，防你们俩一起幻觉！", 598, 244, "R", "#8B5CF6"],
  ];
  const bubbles = bubDef.map(([who, text, x, y, side, col]) => {
    const b = box(board, x, y, 534, 108, "abs", "", { background: "#fff", borderRadius: "18px", border: `3px solid ${col}`, transformOrigin: side === "L" ? "0 50%" : "100% 50%" });
    box(b, 18, 10, 400, 34, "abs nowrap", who, { fontSize: "21px", fontWeight: 900, color: col });
    const tx = box(b, 18, 50, 504, 44, "abs nowrap", "", { fontSize: "24px", fontWeight: 700, color: "#2D1624" });
    return { b, tx, text };
  });
  // 共识契约盾牌
  const shieldBox = box(board, 598, 372, 534, 150, "abs", "");
  const sSvg = sv("svg", { width: 534, height: 150, viewBox: "0 0 534 150" }, shieldBox); sSvg.style.overflow = "visible";
  const shieldPath = sv("path", { d: "M70,14 L122,32 C122,82 102,118 70,136 C38,118 18,82 18,32 Z", fill: "rgba(236,72,153,0)", stroke: "#F9FAFB", "stroke-width": 6, "stroke-linejoin": "round", "stroke-dasharray": 420, "stroke-dashoffset": 420 }, sSvg);
  const checkP = sv("path", { d: "M46,76 L64,94 L96,58", fill: "none", stroke: "#fff", "stroke-width": 8, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": 90, "stroke-dashoffset": 90 }, sSvg);
  const sT1 = box(shieldBox, 150, 22, 380, 46, "abs nowrap", "🛡️ 防死循环契约", { fontSize: "32px", fontWeight: 900, color: "#FBCFE8" });
  const sT2 = box(shieldBox, 150, 76, 380, 40, "abs nowrap", "最多修订 1 轮 · DFS 自动解环", { fontSize: "24px", fontWeight: 800, color: "#F9FAFB" });
  const circle = sv("ellipse", { cx: 268, cy: 75, rx: 285, ry: 96, fill: "none", stroke: "#FDE68A", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": 1300, "stroke-dashoffset": 1300, transform: "rotate(-3 268 75)" }, sSvg);
  // 头像
  const avDef = [["agy", "#1", "Antigravity", 245, 410, "#F472B6"], ["codex", "#2", "Codex", 245, 600, "#10B981"], ["dsh", "#3", "DeepSeek", 1675, 410, "#8B5CF6"], ["shield", "#4", "共识契约", 1675, 600, "#F59E0B"]];
  const avs = avDef.map(([k, no, name, cx, cy, col], i) => {
    const g = box(lay, cx - 70, cy - 70, 140, 175, "abs", "", { transformOrigin: "50% 40%" });
    const ring = box(g, 0, 0, 140, 140, "abs center", "", { borderRadius: "50%", background: "#fff", border: `4px solid ${col}`, boxShadow: "0 10px 24px rgba(45,22,36,.12)" });
    if (k === "shield") ring.innerHTML = `<span style="font-size:64px">🛡️</span>`; else agentIcon(ring, k, 92, 40 + i);
    const glow = box(g, -12, -12, 164, 164, "abs", "", { borderRadius: "50%", border: `5px solid ${col}`, opacity: 0 });
    box(g, 96, -4, 48, 34, "abs pill center mono", no, { fontSize: "18px", background: col, color: "#fff", padding: "2px 8px", justifyContent: "center" });
    box(g, -30, 146, 200, 32, "abs center nowrap", name, { fontSize: "22px", fontWeight: 800 });
    return { g, glow, ring };
  });
  // 角色
  const ms = svgLayer(root); const M = new Mascot(ms, 4);
  const tSpk = [c(6) + 0.05, c(7) + 0.05, c(8) + 0.05, c(9) + 0.45];
  const tCircle = c(9) + 1.55;
  const GY = 880;
  const jumps = [
    { t: 0.15, to: [760, GY], d: 0.6, h: 150 },
    { t: c(4) - 0.2, to: [620, GY], d: 0.45, h: 90 },
    { t: tSpk[0] - 0.35, to: [700, GY], d: 0.45, h: 110 },
    { t: tSpk[1] - 0.35, to: [820, GY], d: 0.45, h: 110 },
    { t: tSpk[2] - 0.35, to: [1150, GY], d: 0.5, h: 130 },
    { t: tSpk[3] - 0.35, to: [1260, GY], d: 0.45, h: 110 },
    { t: c(10) + 0.1, to: [960, GY], d: 0.6, h: 200, spin: true },
  ];
  const sfx = [
    { t: 0.2, type: "whoosh", gain: .4 }, { t: 0.25, type: "chime", gain: .6 },
    ...bdg.map((_, i) => ({ t: w(1, "黑板") + i * 0.15, type: "softpop", gain: .5, p: i })),
    { t: c(3) + 0.1, type: "scratch" }, { t: c(3) + 0.7, type: "boop" },
    { t: c(4) + 0.05, type: "bloop" },
    ...[0, 1, 2].map(i => ({ t: c(4) + 0.9 + i * 0.35, type: "chalk", dur: 0.3 })),
    ...avs.map((_, i) => ({ t: c(5) + 0.1 + i * 0.18, type: "softpop", p: i })),
    ...tSpk.slice(0, 3).map(t => ({ t, type: "bloop" })),
    { t: tSpk[3], type: "chalk", dur: 0.9 },
    { t: tSpk[3] + 0.9, type: "lock" },
    { t: tCircle, type: "chalk", dur: 0.7 },
    { t: c(10) + 0.1, type: "whoosh" }, { t: c(10) + 0.75, type: "chime" },
  ];
  return {
    sfx, exit: "fade", exitDur: 0.3,
    update(lt, gt) {
      pop(board, lt, 0.05, { from: .9 });
      bdg.forEach((b, i) => pop(b, lt, w(1, "黑板") + i * 0.15, { from: .3, dy: 12 }));
      css(roundNo, { o: prog(lt, c(6), c(6) + 0.3) });
      // 涂鸦
      const dIn = prog(lt, c(3) + 0.05, c(3) + 0.3), dOut = prog(lt, c(4) - 0.1, c(4) + 0.2);
      css(doodle, { o: dIn * (1 - dOut) }); css(doodleLabel, { o: dIn * (1 - dOut) });
      pop(xMark, lt, c(3) + 0.65, { from: 2.2 });
      // 立项
      pop(chairPill, lt, c(4) + 0.05, { from: .4 });
      typeText(chairTxt, "立项：科研假设生成与同行评审 → 拆解 3 条要点", lt, c(4) + 0.3, 20);
      notes.forEach((n, i) => { const t0 = c(4) + 0.9 + i * 0.35; const s = spring(lt - t0); css(n, { o: prog(lt, t0, t0 + .1), tf: `rotate(${lerp(-12, [-1.5, 1, -0.8][i], s)}deg) scale(${lerp(.5, 1, s)})` }); });
      // 头像
      avs.forEach((a, i) => {
        const t0 = c(5) + 0.1 + i * 0.18;
        const speaking = lt > tSpk[i] && lt < (i < 3 ? tSpk[i + 1] : c(10) + 0.4);
        const s = spring(lt - t0), sp = speaking ? 1 + 0.06 * Math.sin((lt - tSpk[i]) * 9) : 1;
        css(a.g, { o: prog(lt, t0, t0 + 0.12), tf: `scale(${(lerp(.3, 1, s) * sp).toFixed(4)})` });
        css(a.glow, { o: speaking ? 0.5 + 0.5 * Math.sin(lt * 8) : 0, tf: `scale(${1 + 0.08 * Math.sin(lt * 8)})` });
        css(a.ring, { background: speaking ? "#FFF1F7" : "#fff" });
      });
      // 气泡
      bubbles.forEach((b, i) => { pop(b.b, lt, tSpk[i], { from: .3 }); typeText(b.tx, b.text, lt, tSpk[i] + 0.2, 17); });
      // 盾牌
      const sp = prog(lt, tSpk[3], tSpk[3] + 0.9);
      attr(shieldPath, { "stroke-dashoffset": (420 * (1 - sp)).toFixed(1), opacity: sp > 0.01 ? 1 : 0, fill: `rgba(236,72,153,${(0.55 * prog(lt, tSpk[3] + 0.8, tSpk[3] + 1.1)).toFixed(3)})` });
      const cp = prog(lt, tSpk[3] + 0.9, tSpk[3] + 1.15);
      attr(checkP, { "stroke-dashoffset": (90 * (1 - cp)).toFixed(1), opacity: cp > 0.01 ? 1 : 0 });
      const glow = lt > tSpk[3] + 0.9 ? 0.6 + 0.4 * Math.sin(lt * 5) : 0;
      shieldBox.style.filter = glow ? `drop-shadow(0 0 ${(12 * glow).toFixed(1)}px rgba(244,114,182,.9))` : "none";
      fadeIn(sT1, lt, tSpk[3] + 0.3, 0.3, 10); fadeIn(sT2, lt, tSpk[3] + 0.6, 0.3, 10);
      const cirP = Ease.inOut(prog(lt, tCircle, tCircle + 0.7));
      attr(circle, { "stroke-dashoffset": (1300 * (1 - cirP)).toFixed(1), opacity: cirP > 0.01 ? 1 : 0 });
      const final = lt > c(10);
      css(board, { boxShadow: `0 0 0 ${final ? 10 + 4 * Math.sin(lt * 6) : 6}px rgba(244,114,182,.22), 0 0 ${final ? 70 : 46}px rgba(236,72,153,.5), 0 20px 40px rgba(45,22,36,.25)` });
      // 角色：指挥家式跳跃点头 + 粉笔
      const m = motion(lt, gt, [-150, GY], jumps);
      const spkIdx = tSpk.filter(t => lt > t).length - 1;
      const drawing = (lt > tSpk[3] && lt < tSpk[3] + 1.0) || (lt > tCircle && lt < tCircle + 0.8) || (lt > c(4) + 0.9 && lt < c(4) + 2.0);
      const nod = !m.air && spkIdx >= 0 ? Math.sin(gt * Math.PI * 2 / BEAT) * 5 : 0;
      M.set({ ...m, s: 0.92, gt, prop: "chalk", rot: m.rot + nod,
        eyes: final ? "happy" : (spkIdx >= 0 ? "open" : (lt > c(3) && lt < c(4) ? "squint" : "open")),
        look: spkIdx >= 0 ? (spkIdx < 2 ? -1 : 1) : 0, lookY: -1,
        armR: drawing ? 70 + 25 * Math.sin(gt * 14) : (m.air ? 80 : 45 + 10 * Math.sin(gt * 4)), armL: final ? wave(gt) : (m.air ? 60 : -10),
        o: lt < 0.15 ? 0 : 1 });
    },
  };
});
