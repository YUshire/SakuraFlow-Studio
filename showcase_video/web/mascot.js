/* mascot.js —— 核心 IP「Clawd-Sakura」：头顶小樱花的珊瑚橙小 Claude 机器人（纯 SVG 参数化）
 * 6 套状态机：idleBounce / jumpArc / pointExplain / chalkBoard / sweatPanic / celebrateTeam
 * 坐标原点 = 脚底中心；所有形变以脚底为锚点（挤压拉伸不穿地）。 */
class Mascot {
  constructor(parent, seed = 1) {
    this.seed = seed;
    this.root = sv("g", {}, parent);
    this.burst = sv("g", {}, this.root);          // 落地樱花粒子（世界坐标）
    this.burstEls = [0, 1, 2].map(() => sakuraFlower(this.burst, 9));
    this.g = sv("g", {}, this.root);
    const g = this.g;
    // 阴影
    this.shadow = sv("ellipse", { cx: 0, cy: 2, rx: 54, ry: 8, fill: "#B45338", opacity: .16 }, this.root);
    this.root.insertBefore(this.shadow, this.g);
    // 腿
    this.legs = [-42, -18, 6, 30].map(x => sv("rect", { x, y: -18, width: 12, height: 18, rx: 3, fill: "#C4633F", stroke: "#B45338", "stroke-width": 1.5 }, g));
    // 手臂（像素小短臂）
    const mkArm = (side) => {
      const a = sv("g", {}, g);
      sv("rect", { x: side < 0 ? -26 : 0, y: -8, width: 26, height: 16, rx: 5, fill: "#D97757", stroke: "#B45338", "stroke-width": 2 }, a);
      return a;
    };
    this.armL = mkArm(-1); this.armR = mkArm(1);
    // 身体
    sv("rect", { x: -60, y: -112, width: 120, height: 96, rx: 22, fill: "#D97757", stroke: "#B45338", "stroke-width": 2.5 }, g);
    sv("rect", { x: -46, y: -105, width: 92, height: 16, rx: 8, fill: "#fff", opacity: .24 }, g);
    sv("rect", { x: -60, y: -40, width: 120, height: 24, rx: 0, fill: "#B45338", opacity: .10 }, g);
    // 腮红
    this.cheeks = [-40, 40].map(x => sv("ellipse", { cx: x, cy: -50, rx: 9, ry: 5, fill: "#F9A8D4", opacity: .75 }, g));
    // 眼睛
    this.eyes = [-1, 1].map(side => {
      const e = sv("g", {}, g);
      const o = {
        g: e,
        open: sv("g", {}, e),
        closed: sv("path", { d: "M-9,1 Q0,5 9,1", fill: "none", stroke: "#2D1624", "stroke-width": 4.5, "stroke-linecap": "round" }, e),
        happy: sv("path", { d: "M-10,5 L0,-6 L10,5", fill: "none", stroke: "#2D1624", "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round" }, e),
        think: sv("g", {}, e),
        squint: sv("path", { d: side < 0 ? "M-8,-8 L7,0 L-8,8" : "M8,-8 L-7,0 L8,8", fill: "none", stroke: "#2D1624", "stroke-width": 4.5, "stroke-linecap": "round", "stroke-linejoin": "round" }, e),
      };
      sv("ellipse", { cx: 0, cy: 0, rx: 7.5, ry: 13, fill: "#2D1624" }, o.open);
      sv("circle", { cx: 2.2, cy: -5, r: 2.6, fill: "#fff" }, o.open);
      sv("circle", { cx: 0, cy: 0, r: 10.5, fill: "#fff", stroke: "#2D1624", "stroke-width": 3.4 }, o.think);
      sv("circle", { cx: 0, cy: 0, r: 5, fill: "#2D1624" }, o.think);
      return o;
    });
    // 头顶左侧小樱花
    this.flowerG = sv("g", {}, g);
    this.flower = sakuraFlower(this.flowerG, 15);
    // 道具
    this.props = {};
    const P = this.props;
    // 放大镜（右手）
    P.magnifier = sv("g", {}, this.armR);
    sv("line", { x1: 24, y1: 0, x2: 40, y2: -12, stroke: "#7C4A3A", "stroke-width": 6, "stroke-linecap": "round" }, P.magnifier);
    sv("circle", { cx: 52, cy: -24, r: 17, fill: "rgba(186,230,253,.55)", stroke: "#2D1624", "stroke-width": 4 }, P.magnifier);
    sv("path", { d: "M44,-30 Q48,-36 56,-36", fill: "none", stroke: "#fff", "stroke-width": 3, "stroke-linecap": "round" }, P.magnifier);
    // 粉笔
    P.chalk = sv("g", {}, this.armR);
    sv("rect", { x: 20, y: -22, width: 9, height: 30, rx: 3, fill: "#fff", stroke: "#CBD5E1", "stroke-width": 1.5, transform: "rotate(35 24 -7)" }, P.chalk);
    // 听诊器
    P.steth = sv("g", {}, g);
    sv("path", { d: "M-30,-18 C-30,6 30,6 30,-18", fill: "none", stroke: "#64748B", "stroke-width": 4, "stroke-linecap": "round" }, P.steth);
    P.stethHand = sv("g", {}, this.armR);
    sv("path", { d: "M20,0 C34,6 40,-6 46,-16", fill: "none", stroke: "#64748B", "stroke-width": 4, "stroke-linecap": "round" }, P.stethHand);
    sv("circle", { cx: 48, cy: -20, r: 9, fill: "#E2E8F0", stroke: "#475569", "stroke-width": 3 }, P.stethHand);
    // ZIP 礼盒（举过头顶）
    P.zip = sv("g", {}, g);
    sv("rect", { x: -38, y: -196, width: 76, height: 62, rx: 10, fill: "#F472B6", stroke: "#DB2777", "stroke-width": 3 }, P.zip);
    sv("rect", { x: -44, y: -206, width: 88, height: 18, rx: 6, fill: "#EC4899", stroke: "#DB2777", "stroke-width": 3 }, P.zip);
    sv("rect", { x: -6, y: -206, width: 12, height: 72, fill: "#FDF2F8" }, P.zip);
    sv("path", { d: "M0,-206 C-18,-226 -30,-210 -10,-206 M0,-206 C18,-226 30,-210 10,-206", fill: "#FDF2F8", stroke: "#DB2777", "stroke-width": 2.5 }, P.zip);
    const zt = sv("text", { x: 0, y: -150, "text-anchor": "middle", "font-size": 20, "font-weight": 800, fill: "#fff", "font-family": "Consolas, monospace" }, P.zip); zt.textContent = ".zip";
    // 蓝色汗滴
    P.sweat = sv("g", {}, g);
    this.drops = [[64, -110], [-70, -96], [72, -78]].map(([x, y]) => sv("path", { d: "M0,-12 C5,-4 8,1 8,5 C8,10 4,13 0,13 C-4,13 -8,10 -8,5 C-8,1 -5,-4 0,-12 Z", fill: "#60A5FA", stroke: "#2563EB", "stroke-width": 1.5, transform: `translate(${x},${y})` }, P.sweat));
    // 数据光球坐骑（在身体下方）
    this.orb = sv("g", {}, this.root);
    this.root.insertBefore(this.orb, this.shadow);
    const defs = sv("defs", {}, this.orb);
    const rg = sv("radialGradient", { id: "orbGrad" + seed, cx: "35%", cy: "35%", r: "70%" }, defs);
    sv("stop", { offset: "0", "stop-color": "#FFFFFF" }, rg); sv("stop", { offset: ".35", "stop-color": "#F9A8D4" }, rg); sv("stop", { offset: "1", "stop-color": "#EC4899" }, rg);
    this.orbTrail = [0, 1, 2, 3, 4].map(i => sv("circle", { r: 26 - i * 4, fill: "#F472B6", opacity: .25 - i * .04 }, this.orb));
    this.orbBall = sv("circle", { r: 40, fill: `url(#orbGrad${seed})`, stroke: "#fff", "stroke-width": 3 }, this.orb);
    this.orbGlow = sv("circle", { r: 54, fill: "none", stroke: "#F472B6", "stroke-width": 3, opacity: .35 }, this.orb);
  }

  /* 统一状态写入 */
  set(st) {
    const s = st.s ?? 1, sx = st.sx ?? 1, sy = st.sy ?? 1, rot = st.rot ?? 0, x = st.x, y = st.y;
    const gt = st.gt ?? 0;
    this.root.style.display = st.hidden ? "none" : "";
    if (st.hidden) return;
    this.root.setAttribute("opacity", (st.o ?? 1).toFixed(3));
    const flip = st.flip ?? 1;
    attr(this.g, { transform: `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${(s * sx * flip).toFixed(4)},${(s * sy).toFixed(4)})` });
    // 阴影（离地越高越小）
    const ground = st.ground ?? y, hgt = Math.max(0, ground - y);
    const shk = clamp(1 - hgt / 400, 0.35, 1);
    attr(this.shadow, { transform: `translate(${x.toFixed(1)},${ground.toFixed(1)}) scale(${(s * shk * sx).toFixed(3)},${(s * shk).toFixed(3)})`, opacity: st.orb ? 0 : (0.16 * shk).toFixed(3) });
    // 腿：交替踏步
    const step = st.legPhase ?? 0;
    this.legs.forEach((l, i) => l.setAttribute("transform", `translate(0,${(((i % 2) ? 1 : -1) * step).toFixed(2)})`));
    // 手臂
    // 角度约定：两臂均为 正值 = 抬起（0 = 水平，负值 = 下垂）
    const aL = st.armL ?? -14, aR = st.armR ?? -14;
    attr(this.armL, { transform: `translate(-58,-56) rotate(${aL.toFixed(2)})` });
    attr(this.armR, { transform: `translate(58,-56) rotate(${(-aR).toFixed(2)})` });
    // 眼睛
    let mode = st.eyes || "open";
    if (mode === "open" && !st.noBlink && Mascot.blinking(gt, this.seed)) mode = "closed";
    const look = (st.look ?? 0) * 6, lookY = (st.lookY ?? 0) * 4;
    this.eyes.forEach((e, i) => {
      attr(e.g, { transform: `translate(${(i ? 24 : -24) + look},${-68 + lookY})` });
      for (const k of ["open", "closed", "happy", "think", "squint"]) {
        const on = k === mode; if (e["_" + k] !== on) { e[k].style.display = on ? "" : "none"; e["_" + k] = on; }
      }
    });
    // 樱花：跟随运动轻晃
    const wob = st.flowerRot ?? Math.sin(gt * 5.2) * 6;
    const fs = st.flowerScale ?? 1;
    attr(this.flowerG, { transform: `translate(${-34 + (st.flowerDx ?? 0)},${-112 + (st.flowerDy ?? 0)}) rotate(${(wob + (st.flowerExtraRot ?? 0)).toFixed(2)}) scale(${fs})` });
    this.flowerG.setAttribute("opacity", (st.flowerO ?? 1).toFixed(3));
    // 道具
    const prop = st.prop || "none";
    this.props.magnifier.style.display = prop === "magnifier" ? "" : "none";
    this.props.chalk.style.display = prop === "chalk" ? "" : "none";
    this.props.steth.style.display = prop === "steth" ? "" : "none";
    this.props.stethHand.style.display = prop === "steth" ? "" : "none";
    this.props.zip.style.display = prop === "zip" ? "" : "none";
    if (prop === "zip") attr(this.props.zip, { transform: `translate(0,${(st.zipDy ?? 0).toFixed(1)}) scale(${st.zipS ?? 1})` });
    // 汗滴 + 摇头
    const sw = !!st.sweat;
    this.props.sweat.style.display = sw ? "" : "none";
    if (sw) this.drops.forEach((d, i) => { const ph = (gt * 2.2 + i * .33) % 1; d.setAttribute("opacity", (1 - ph).toFixed(2)); d.setAttribute("transform", `translate(${[64, -70, 72][i] + (i === 1 ? -ph * 10 : ph * 10)},${[-110, -96, -78][i] + ph * 22}) scale(${0.8 + 0.4 * (1 - ph)})`); });
    // 光球坐骑
    this.orb.style.display = st.orb ? "" : "none";
    if (st.orb) {
      const tr = st.trail || [];
      attr(this.orbBall, { cx: x.toFixed(1), cy: (y + 36 * s).toFixed(1), r: (40 * s).toFixed(1) });
      attr(this.orbGlow, { cx: x.toFixed(1), cy: (y + 36 * s).toFixed(1), r: (52 * s + 4 * Math.sin(gt * 8)).toFixed(1) });
      this.orbTrail.forEach((c, i) => { const p = tr[i] || [x, y]; attr(c, { cx: p[0].toFixed(1), cy: (p[1] + 36 * s).toFixed(1), r: ((26 - i * 4) * s * 1.2).toFixed(1) }); });
    }
    // 落地樱花粒子
    const la = st.landAge ?? 99;
    if (la < 0.75 && st.landPos) {
      this.burst.style.display = "";
      this.burstEls.forEach((b, i) => {
        const ang = -Math.PI / 2 + (i - 1) * 1.05, d = (30 + 44 * Ease.out(la / 0.6)) * s;
        const bx = st.landPos[0] + Math.cos(ang) * d * 1.3, by = st.landPos[1] + Math.sin(ang) * d * 0.55 - 8 * s;
        attr(b, { transform: `translate(${bx.toFixed(1)},${by.toFixed(1)}) rotate(${(la * 360 * (i - 1)).toFixed(1)}) scale(${(s * (1 - la / 0.8) * 1.1).toFixed(3)})`, opacity: (1 - la / 0.75).toFixed(3) });
      });
    } else this.burst.style.display = "none";
  }

  static blinking(gt, seed) {
    const P = 3.3 + (seed % 3) * 0.35;
    const k = Math.floor((gt + seed * 0.7) / P);
    const ph = (gt + seed * 0.7) - k * P;
    const at = 1.2 + hash(k + seed * 13) * 1.6;
    if (ph > at && ph < at + 0.13) return true;
    if (hash(k * 3 + seed) > 0.65 && ph > at + 0.26 && ph < at + 0.38) return true; // 偶尔双眨
    return false;
  }
}

/* ---------- 运动规划：抛物线跳跃 + 挤压拉伸 + 待机果冻呼吸 ----------
 * jumps: [{t, to:[x,y], d=0.6, h=160}] ；返回 {x,y,sx,sy,rot,air,landAge,landPos,legPhase,dir} */
const CROUCH = 0.13;
function motion(lt, gt, start, jumps = []) {
  let pos = start, lastLand = -99, landPos = null, dir = 1;
  for (const j of jumps) {
    const d = j.d ?? 0.6, h = j.h ?? 160, t0 = j.t, t1 = j.t + d, from = pos, to = j.to;
    const jd = Math.sign(to[0] - from[0]) || dir;
    if (lt < t0 - CROUCH) break;
    if (lt < t0) {                                      // 起跳挤压 1.18 / 0.82
      const e = Ease.inOut(prog(lt, t0 - CROUCH, t0));
      const ls = landSquash(lt - lastLand);
      return { x: from[0], y: from[1], sx: lerp(ls.sx, 1.18, e), sy: lerp(ls.sy, 0.82, e), rot: -jd * 4 * e, air: false, landAge: lt - lastLand, landPos, legPhase: 0, dir: jd, ground: from[1] };
    }
    if (lt < t1) {                                      // 空中拉伸 0.88 / 1.15
      const u = (lt - t0) / d;
      const x = lerp(from[0], to[0], Ease.sine(u) * 0.3 + u * 0.7);
      const y = lerp(from[1], to[1], u) - h * 4 * u * (1 - u);
      const v = Math.abs(1 - 2 * u);
      const k = prog(lt, t0, t0 + 0.08);
      const sx = lerp(1.18, 1 - 0.12 * Math.pow(v, .7), k), sy = lerp(0.82, 1 + 0.15 * Math.pow(v, .7), k);
      return { x, y, sx, sy, rot: jd * 9 * Math.sin(Math.PI * u) * (j.spin ? 0 : 1) + (j.spin ? 360 * jd * Ease.inOut(u) : 0), air: true, landAge: lt - lastLand, landPos, legPhase: 3 * Math.sin(u * 20), dir: jd, ground: lerp(from[1], to[1], u) };
    }
    pos = to; lastLand = t1; landPos = to; dir = jd;
  }
  const age = lt - lastLand;
  const ls = landSquash(age);
  const id = idle(gt);
  const w = prog(age, 0.35, 0.8);
  return { x: pos[0], y: pos[1], sx: ls.sx * lerp(1, id.sx, w), sy: ls.sy * lerp(1, id.sy, w), rot: 0, air: false, landAge: age, landPos, legPhase: id.leg * w, dir, ground: pos[1] };
}
function landSquash(age) {                               // 落地回弹
  if (age > 0.9 || age < 0) return { sx: 1, sy: 1 };
  const a = Math.exp(-6.5 * age) * Math.cos(16 * age);
  return { sx: 1 + 0.2 * a, sy: 1 - 0.2 * a };
}
function idle(gt) {                                      // 112 BPM 果冻呼吸 0.94 ↔ 1.05
  const ph = (gt / BEAT) % 1;
  const c = Math.cos(2 * Math.PI * ph);
  const sy = 0.995 + 0.055 * c;
  const leg = (Math.floor(gt / BEAT) % 2 ? 1 : -1) * 2.5 * Math.sin(Math.PI * ph);
  return { sx: 1 - (sy - 1) * 0.7, sy, leg };
}
/* 挥手 / 指向 / 摇头 辅助 */
const wave = (gt, speed = 9) => 110 + 25 * Math.sin(gt * speed);
const shake = (gt) => Math.sin(gt * 28) * 10;
