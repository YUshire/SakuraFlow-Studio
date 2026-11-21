/* main.js —— 全局时间轴：场景调度、转场、章节、进度、音效事件汇总；暴露 window.renderFrame(frame) */
const App = { scenes: [], ready: false };
const TR = 0.42;   // 转场重叠时长

function helpers(T) {
  return {
    T,
    c: i => T.cues[i].start,
    e: i => T.cues[i].end,
    w: (i, sub, fb = 0) => { const cue = T.cues[i]; const k = cue.text.indexOf(sub); return k >= 0 ? cue.chars[k] : cue.start + fb; },
    dur: T.duration,
  };
}

async function init() {
  await document.fonts.ready;
  const T = window.TIMING;
  const host = document.getElementById("scenes");
  Petals.init();
  Subs.init(T);
  const sfx = [];
  T.scenes.forEach((sc, i) => {
    const root = el("div", "scene", host);
    root.dataset.id = sc.id;
    const X = helpers(sc);
    const inst = SceneFactories[sc.id](root, sc, X);
    inst.root = root; inst.T = sc; inst.index = i;
    App.scenes.push(inst);
    (inst.sfx || []).forEach(ev => sfx.push(Object.assign({}, ev, { t: +(sc.start + ev.t).toFixed(4), scene: sc.id })));
  });
  sfx.sort((a, b) => a.t - b.t);
  window.SFX_EVENTS = sfx;
  window.TOTAL_FRAMES = T.totalFrames;
  App.ready = true;
  window.__ready = true;
}

function renderFrame(frame) {
  const T = window.TIMING;
  const t = frame / FPS;
  App.frontPetals = 0;
  let current = 0;
  App.scenes.forEach((s, i) => {
    const lt = t - s.T.start, D = s.T.duration;
    const last = i === App.scenes.length - 1;
    const visible = lt >= 0 && (lt < D + TR || (last && lt <= D + 1));
    if (lt >= 0 && lt < D) current = i;
    if (!visible) { if (s._vis !== false) { s.root.style.display = "none"; s._vis = false; } return; }
    if (s._vis !== true) { s.root.style.display = "block"; s._vis = true; }
    // 转场
    const enter = s.enter || "slide";
    let o = 1, tf = "none";
    if (lt < TR && i > 0 && enter !== "none") {
      const p = Ease.out(lt / TR), sp = spring(lt);
      o = p;
      tf = enter === "zoom" ? `scale(${lerp(1.06, 1, sp)})` : `translateX(${(1 - sp) * 110}px)`;
    }
    if (lt > D && !last) {
      const p = Ease.inOut((lt - D) / (s.exitDur || TR));
      o *= 1 - clamp(p);
      tf = s.exit === "fade" ? "none" : `translateX(${-p * 90}px) scale(${1 - p * 0.03})`;
    }
    css(s.root, { o, tf });
    s.update(Math.min(lt, D + TR), t);
  });
  // 灰色旧世界层仅第 1 幕使用
  if (current !== 0) document.getElementById("gray").style.display = "none";
  // 章节
  const cs = App.scenes[current];
  const no = document.getElementById("chapNo"), tt = document.getElementById("chapTitle");
  const label = String(current + 1).padStart(2, "0") + " / 08";
  if (no._t !== label) { no.textContent = label; no._t = label; tt.textContent = cs.T.title; }
  const chap = document.getElementById("chapter");
  const clt = t - cs.T.start;
  css(chap, { tf: `scale(${lerp(0.85, 1, spring(clt))})` });
  css(document.getElementById("progressFill"), { width: (t / T.duration * 100).toFixed(3) + "%" });
  // 背景点阵视差漂移
  css(document.getElementById("bg"), { tf: `translate(${(-(t * 7) % 24).toFixed(2)}px, ${(-(t * 4) % 24).toFixed(2)}px)` });
  Petals.update(t, App.frontPetals);
  Subs.update(t);
  // 开头淡入 / 片尾淡出
  const fadeO = Math.max(1 - prog(t, 0, 0.35), prog(t, T.duration - 1.1, T.duration - 0.05));
  css(document.getElementById("fade"), { o: fadeO });
  return true;
}
window.renderFrame = renderFrame;
window.addEventListener("load", () => { init().then(() => { const f = +(new URLSearchParams(location.search).get("f") || 0); renderFrame(f); }); });
