/* scenes2.js —— Scene 5 ~ 8 */

/* =========================== Scene 5 · 共识变身自由画布 =========================== */
registerScene("s5", (root, T, X) => {
  const { c, e, w } = X;
  const wrap = el("div", "layer", root, "", { transformOrigin: "50% 50%" });
  // 变形前的迷你黑板残影（0 ~ 0.9s 坍缩展开为 5 张卡片）
  const bbGhost = box(wrap, 380, 170, 1160, 630, "abs", "", { background: "#2A2532", borderRadius: "26px", border: "5px solid #F9A8D4", boxShadow: "0 0 36px rgba(236,72,153,.4)" });
  const svgE = svgLayer(wrap);
  // 5 个实体卡片
  const nodesDef = [
    ["n0", "👑 总意图解析官", "Antigravity · Chair", 70, 390, 290, 180, "agy", "立项完成 · 已分发并行子任务"],
    ["n1", "📚 文献研究员", "Antigravity · CLI", 470, 150, 410, 260, "agy", "检索 LbMAS / Blackboard MAS 2025 文献\n提炼 H1: 动态认领比固定 DAG 降低 38% 幻觉\n构建可证伪理论边界与变量定义..."],
    ["n2", "🧪 实验建模师", "OpenAI Codex · CLI", 470, 540, 410, 260, "codex", "import numpy as np, scipy.stats as st\n# Monte Carlo Power Analysis (N=400)\npower = simulate_blackboard_mas(alpha=0.01)\n>>> [Rev 2] 补充异构基线显著性检验 p<0.003"],
    ["n3", "🔍 独立同行评审员", "DeepSeek · 红队审稿", 1030, 340, 410, 270, "dsh", "交叉核对理论假设 H1 与功效模拟脚本...\n⚠ 发现样本量敏感度未覆盖极端长尾分布\n→ 触发 review_loop 打回实验建模师修订 1 轮\n✓ 复审通过：统计功效 0.94，逻辑闭环！"],
    ["n4", "📝 论文综述官", "Claude Code · 终审汇总", 1560, 390, 290, 180, "claude", "整合理论 + 实验 + 审稿纪要\n生成主报告与 .zip 成果包"],
  ];
  // 黑板内初始位置（用于 Morph 转场）
  const fromPos = [[430, 230], [450, 360], [450, 520], [980, 360], [980, 520]];
  const nodes = nodesDef.map(([id, title, sub, x, y, w0, h0, ic, thinkTxt], i) => {
    const cd = box(wrap, x, y, w0, h0, "abs card", "", { transformOrigin: "0 0" });
    const glow = el("div", "", cd, "", { position: "absolute", inset: "-3px", borderRadius: "22px", border: "3px solid #EC4899", boxShadow: "0 0 28px rgba(236,72,153,.45)", opacity: 0, pointerEvents: "none" });
    const hd = box(cd, 16, 14, w0 - 32, 54, "abs", "", { display: "flex", alignItems: "center", gap: "10px" });
    const icBox = el("div", "center", hd, "", { width: "44px", height: "44px" }); agentIcon(icBox, ic, 42, 50 + i);
    const tb = el("div", "", hd);
    el("div", "nowrap", tb, title, { fontSize: "22px", fontWeight: 900 });
    el("div", "nowrap muted mono", tb, sub, { fontSize: "15px", fontWeight: 700 });
    const st = el("div", "pill mono", hd, "IDLE", { marginLeft: "auto", fontSize: "14px", background: "#FDF2F8", color: "#DB2777", padding: "3px 10px" });
    // 端口小圆点
    box(cd, -7, h0 / 2 - 7, 14, 14, "abs", "", { borderRadius: "50%", background: "#fff", border: "3px solid #EC4899" });
    box(cd, w0 - 7, h0 / 2 - 7, 14, 14, "abs", "", { borderRadius: "50%", background: "#EC4899" });
    // Thinking 框
    const tkH = h0 - 84;
    const tk = box(cd, 16, 72, w0 - 32, tkH, "abs mono", "", { background: "#FFF5F9", border: "1.5px solid #F9A8D4", borderRadius: "12px", padding: "10px 12px", fontSize: i === 1 || i === 2 || i === 3 ? "16px" : "15px", lineHeight: "24px", color: "#4A253B", overflow: "hidden", whiteSpace: "pre-wrap" });
    const tkHead = el("div", "mono", tk, "💭 Thinking Stream", { fontSize: "13px", fontWeight: 800, color: "#EC4899", marginBottom: "4px" });
    const tkBody = el("div", "", tk, "");
    return { cd, glow, st, tkBody, thinkTxt, x, y, w: w0, h: h0, fx: fromPos[i][0], fy: fromPos[i][1] };
  });
  // 贝塞尔连线 + 关系胶囊
  const edgesDef = [
    [[360, 480], [415, 480], [415, 280], [470, 280], "理论探索", "#EC4899", false],
    [[360, 480], [415, 480], [415, 670], [470, 670], "实验建模", "#EC4899", false],
    [[880, 280], [955, 280], [955, 445], [1030, 445], "假设送审", "#EC4899", false],
    [[880, 670], [955, 670], [955, 505], [1030, 505], "代码送审", "#EC4899", false],
    [[1235, 610], [1235, 895], [675, 895], [675, 800], "打回修订", "#A855F7", true],
    [[1440, 475], [1500, 475], [1500, 480], [1560, 480], "终审收敛", "#10B981", false],
  ];
  const edges = edgesDef.map(([p0, p1, p2, p3, label, col, isRev]) => {
    const curve = [p0, p1, p2, p3];
    const base = sv("path", { d: bezPath(curve), fill: "none", stroke: isRev ? "#E9D5FF" : "#F9A8D4", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": 900, "stroke-dashoffset": 900 }, svgE);
    const flow = sv("path", { d: bezPath(curve), fill: "none", stroke: col, "stroke-width": 4.5, "stroke-dasharray": isRev ? "10 12" : "14 16", "stroke-linecap": "round", opacity: 0 }, svgE);
    const mid = bez(p0, p1, p2, p3, 0.5);
    const pill = box(wrap, mid[0] - 68, mid[1] - 19, 136, 38, "abs pill center nowrap", label, { fontSize: "18px", background: "#fff", color: col, border: `2px solid ${col}`, boxShadow: "0 6px 16px rgba(236,72,153,.12)", justifyContent: "center" });
    return { curve, base, flow, pill };
  });
  // 评审 Verdict 徽章（挂在评审节点顶部）
  const vRev = box(wrap, 1060, 286, 350, 46, "abs pill center mono nowrap", "⚠ VERDICT: REVISE · 打回修订 1 轮", { fontSize: "20px", background: "#F3E8FF", color: "#7E22CE", border: "2.5px solid #A855F7", justifyContent: "center", boxShadow: "0 10px 24px rgba(168,85,247,.25)" });
  const vPass = box(wrap, 1060, 286, 350, 46, "abs pill center mono nowrap", "✓ VERDICT: PASS · 严谨收敛", { fontSize: "20px", background: "#ECFDF5", color: "#047857", border: "2.5px solid #10B981", justifyContent: "center", boxShadow: "0 10px 24px rgba(16,185,129,.25)" });
  // 角色层（跟随 wrap 缩放）
  const ms = svgLayer(wrap); const M = new Mascot(ms, 5);
  const tMorph = 0.85, tEdges = 1.4, tZoom = c(3) + 0.1, tRev = w(6, "漏洞") + 0.25, tBack = c(7) + 0.05, tPass = w(8, "严谨") - 0.15;
  const sfx = [
    { t: 0.12, type: "whoosh" },
    ...[0, 1, 2, 3, 4].map(i => ({ t: 0.55 + i * 0.14, type: "pop", p: i })),
    ...[0, 1, 2, 3].map(i => ({ t: tEdges + i * 0.16, type: "softpop", p: i })),
    { t: tZoom, type: "whoosh", gain: .5 },
    { t: c(5) + 0.1, type: "whoosh", gain: .6 },
    { t: tRev, type: "boop" },
    { t: tBack + 0.15, type: "whoosh", gain: .6 },
    { t: tPass, type: "ding" },
    { t: tPass + 0.35, type: "chime" },
  ];
  return {
    sfx, enter: "zoom",
    update(lt, gt) {
      // 黑板残影消散
      const mp = Ease.inOut(prog(lt, 0.1, tMorph));
      css(bbGhost, { o: 1 - mp, tf: `scale(${lerp(1, 1.12, mp)})` });
      // 镜头推进 Zoom 1.25x（特写并行节点与审稿打回，同时留足顶部与四角空间）
      const zIn = Ease.inOut(prog(lt, tZoom, tZoom + 1.1));
      const zPan = Ease.inOut(prog(lt, c(6) - 0.2, c(6) + 0.9));
      const zOut = Ease.inOut(prog(lt, tPass - 0.2, tPass + 0.8));
      const z = lerp(1, 1.24, zIn * (1 - zOut));
      const focusX = lerp(960, lerp(690, 1080, zPan), zIn * (1 - zOut));
      const focusY = lerp(500, lerp(410, 490, zPan), zIn * (1 - zOut));
      css(wrap, { tf: `translate(${(960 - focusX * z).toFixed(1)}px, ${(520 - focusY * z).toFixed(1)}px) scale(${z.toFixed(4)})` });
      // 5 个节点从黑板位置飞入画布位置
      nodes.forEach((n, i) => {
        const s = clamp(spring(lt - (0.2 + i * 0.1)), 0, 1.08);
        const x = lerp(n.fx, n.x, s), y = lerp(n.fy, n.y, s);
        css(n.cd, { left: x.toFixed(1) + "px", top: y.toFixed(1) + "px", o: prog(lt, 0.1 + i * 0.08, 0.35 + i * 0.08), tf: `scale(${lerp(0.55, 1, s).toFixed(4)})` });
        // 呼吸光晕与状态
        let active = false, done = false, status = "READY", col = "#DB2777", bg = "#FDF2F8";
        if (i === 0) { done = lt > 1.2; status = done ? "✓ DONE" : "INIT"; }
        if (i === 1 || i === 2) {
          active = lt > c(3) - 0.2 && lt < tPass;
          if (i === 2 && lt > tBack && lt < tPass) { status = "↻ REVISING"; col = "#7E22CE"; bg = "#F3E8FF"; }
          else if (lt >= tPass) { done = true; status = "✓ PASS"; }
          else if (active) { status = "⚡ THINKING"; }
        }
        if (i === 3) {
          active = lt > c(5) + 0.6 && lt < tPass;
          if (lt > tRev && lt < tPass) { status = "REVISE"; col = "#7E22CE"; bg = "#F3E8FF"; }
          else if (lt >= tPass) { done = true; status = "✓ PASS"; }
          else if (active) status = "🔍 REVIEW";
        }
        if (i === 4) { active = lt >= tPass; done = lt > tPass + 1.1; status = done ? "✓ DONE" : (active ? "⚡ MERGE" : "WAIT"); }
        if (done) { col = "#047857"; bg = "#ECFDF5"; }
        if (n.st._t !== status) { n.st.textContent = status; n.st._t = status; css(n.st, { color: col, background: bg }); }
        css(n.glow, { o: active ? 0.55 + 0.45 * Math.sin(lt * 7 + i) : 0, borderColor: col });
        // Thinking 实时滚动
        const tStart = i === 0 ? 0.5 : (i <= 2 ? c(3) : (i === 3 ? c(5) + 0.5 : tPass));
        typeText(n.tkBody, n.thinkTxt, lt, tStart, i <= 2 ? 26 : 30, active);
      });
      // 连线生长 & 流光
      edges.forEach((ed, i) => {
        const t0 = i < 4 ? tEdges + i * 0.16 : (i === 4 ? tBack : tPass + 0.1);
        const p = Ease.out(prog(lt, t0, t0 + 0.55));
        attr(ed.base, { "stroke-dashoffset": (900 * (1 - p)).toFixed(1) });
        const flowing = p > 0.7 && (i !== 4 || lt < tPass + 0.2);
        attr(ed.flow, { opacity: flowing ? 0.95 : 0, "stroke-dashoffset": (-lt * 130).toFixed(1) });
        pop(ed.pill, lt, t0 + 0.25, { from: .3 });
        if (i === 4 && lt > tPass + 0.3) css(ed.pill, { o: 0.35 });
      });
      pop(vRev, lt, tRev, { from: .3, out: tPass - 0.1 });
      pop(vPass, lt, tPass, { from: .3 });
      // ---- 小 Claude：骑在粉色数据光球上沿贝塞尔曲线滑翔 + 遇 REVISE 急刹车回旋 ----
      let curveIdx = 2, u = 0, brake = 0, flip = 1;
      if (lt < c(4) + 0.2) { curveIdx = 0; u = Ease.inOut(prog(lt, 1.6, c(4) + 0.1)); }
      else if (lt < tRev) { curveIdx = 2; u = Ease.inOut(prog(lt, c(4) + 0.2, tRev - 0.1)); }
      else if (lt < tBack + 0.25) { curveIdx = 2; u = 1; brake = Math.sin(prog(lt, tRev, tBack + 0.25) * Math.PI); flip = -1; }
      else if (lt < tPass - 0.2) { curveIdx = 4; u = Ease.inOut(prog(lt, tBack + 0.25, tPass - 0.35)); flip = -1; }
      else { curveIdx = 5; u = Ease.inOut(prog(lt, tPass, tPass + 1.2)); flip = 1; }
      const cv = edges[curveIdx].curve;
      const pt = bezAt(cv, u);
      const trail = [1, 2, 3, 4, 5].map(k => bezAt(cv, clamp(u - k * 0.045)));
      M.set({
        x: pt[0], y: pt[1] - 28, s: 0.56, gt, orb: true, trail, flip,
        sx: 1 + 0.14 * brake, sy: 1 - 0.12 * brake,
        rot: brake ? -24 * brake : (flip * 10 * Math.sin(u * Math.PI)),
        eyes: brake > 0.2 ? "squint" : (lt >= tPass ? "happy" : "open"),
        look: flip * 0.7, armL: 55, armR: lt >= tPass ? wave(gt) : 45,
        o: prog(lt, 1.3, 1.6),
      });
    },
  };
});

/* =========================== Scene 6 · 成果交付闭环 =========================== */
registerScene("s6", (root, T, X) => {
  const { c, e, w } = X;
  const lay = el("div", "layer", root);
  // 左侧：已全部绿灯完成的迷你画布缩略视图
  const left = box(lay, 70, 118, 690, 770, "abs card");
  box(left, 26, 22, 620, 42, "abs nowrap h-title", "✅ 画布执行完毕 · 5 / 5 节点收敛");
  const lSvg = sv("svg", { width: 690, height: 770, viewBox: "0 0 690 770" }, left);
  const miniEdges = [[[130, 230], [270, 155]], [[130, 230], [270, 305]], [[390, 155], [520, 230]], [[390, 305], [520, 230]]];
  miniEdges.forEach(([a, b]) => sv("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#10B981", "stroke-width": 4 }, lSvg));
  const miniPos = [[60, 200, "👑 立项"], [250, 125, "📚 理论"], [250, 275, "🧪 实验"], [470, 200, "📝 终审"]];
  miniPos.forEach(([x, y, t]) => box(left, x, y, 150, 58, "abs card nobar center nowrap", `<span style="color:#10B981">●</span>&nbsp;<b>${t}</b>`, { borderColor: "#6EE7B7", background: "#ECFDF5", fontSize: "20px" }));
  // 真实落盘文件胶囊列表
  box(left, 26, 378, 620, 38, "abs nowrap", "📂 逐节点真实落盘文件映射", { fontSize: "23px", fontWeight: 900 });
  const files = [
    ["01_theoretical_framework.md", "Antigravity · 理论框架", "#EC4899"],
    ["power_plan.py", "OpenAI Codex · 功效模拟脚本", "#10B981"],
    ["03_peer_review.md", "DeepSeek · 同行评审意见", "#8B5CF6"],
    ["BLACKBOARD_ROUNDTABLE.md", "全员圆桌协商完整纪要", "#F59E0B"],
  ];
  const fileEls = files.map(([f, by, col], i) => box(left, 26, 428 + i * 78, 638, 66, "abs", `
    <div style="display:flex;align-items:center;height:100%;padding:0 18px;gap:14px">
      <span style="font-size:28px">📄</span>
      <div><div class="mono" style="font-size:21px;font-weight:800;color:#2D1624">${f}</div><div class="muted" style="font-size:16px;font-weight:700">${by}</div></div>
      <span class="pill mono" style="margin-left:auto;font-size:15px;background:#ECFDF5;color:#047857">SAVED ✓</span>
    </div>`, { background: "#FFF9FC", borderRadius: "14px", border: `1.5px solid #F3D4E1`, borderLeft: `6px solid ${col}` }));
  // 右侧抽屉：「🎁 最终成果」面板
  const drawer = box(lay, 800, 118, 1050, 770, "abs card", "", { borderRadius: "24px" });
  box(drawer, 32, 22, 700, 44, "abs nowrap", "🎁 最终成果 · Deliverables Hub", { fontSize: "30px", fontWeight: 900 });
  const hero = box(drawer, 32, 82, 986, 250, "abs", `
    <div style="padding:22px 26px">
      <div style="display:flex;align-items:center;gap:12px"><span class="pill" style="background:#EC4899;color:#fff;font-size:19px">🏆 最关键最终产物</span><span class="mono muted" style="font-size:18px">DELIVERABLES_INDEX.md</span></div>
      <div style="font-size:28px;font-weight:900;margin-top:14px;color:#2D1624">《黑板自组织多智能体科研假设生成与统计功效验证总报告》</div>
      <div style="font-size:21px;color:#6B4A5C;margin-top:10px;line-height:34px;font-weight:700">• 核心结论：1→2→3→4 圆桌认领 + 1 轮红队审稿闭环，统计功效达 <b style="color:#DB2777">0.94 (p &lt; 0.003)</b><br>• 已自动汇总 4 份节点产物与圆桌共识契约，零人工拼接即刻可用。</div>
    </div>`, { background: "linear-gradient(135deg,#FFF0F7,#FFFFFF 65%,#FDF2F8)", border: "2.5px solid #F472B6", borderRadius: "20px", boxShadow: "0 14px 32px rgba(236,72,153,.16)" });
  const btnPrev = box(drawer, 32, 356, 320, 66, "abs center nowrap", "👁 预览最终主报告", { fontSize: "24px", fontWeight: 900, background: "#FDF2F8", color: "#DB2777", border: "2px solid #F472B6", borderRadius: "16px" });
  const btnZip = box(drawer, 376, 356, 370, 66, "abs center nowrap", "📥 下载成果包 (.zip)", { fontSize: "24px", fontWeight: 900, background: "linear-gradient(90deg,#F472B6,#EC4899)", color: "#fff", borderRadius: "16px", boxShadow: "0 10px 24px rgba(236,72,153,.32)" });
  // ZIP 下载入袋动画区
  const folder = box(drawer, 32, 446, 610, 300, "abs", `
    <div style="padding:20px 24px">
      <div style="font-size:22px;font-weight:900;color:#6B4A5C">📦 一键零依赖打包输出</div>
      <div class="mono" style="margin-top:12px;font-size:22px;font-weight:800;color:#DB2777">SakuraFlow_Deliverables_v4.zip</div>
      <div class="muted" style="margin-top:6px;font-size:18px;font-weight:700">内含：主报告 + 全部代码脚本 + 审稿意见 + 圆桌纪要</div>
    </div>`, { background: "#FFFBFD", border: "2px dashed #F9A8D4", borderRadius: "18px" });
  const zipIcon = box(folder, 430, 130, 150, 140, "abs center", `<div style="text-align:center"><div style="font-size:74px;line-height:1">🗜️</div><div class="mono pill" style="background:#EC4899;color:#fff;font-size:17px;margin-top:6px">248 KB · ZIP</div></div>`);
  // 居中高清文档预览弹窗
  const modal = box(lay, 490, 170, 940, 640, "abs card", `
    <div style="height:56px;background:linear-gradient(90deg,#FDF2F8,#fff);border-bottom:1.5px solid #F3D4E1;display:flex;align-items:center;padding:0 24px;gap:12px">
      <span style="font-size:24px">🌸</span><b style="font-size:23px">主报告高清预览 · DELIVERABLES_INDEX.md</b>
      <span class="pill mono" style="margin-left:auto;background:#ECFDF5;color:#047857;font-size:16px">Markdown 渲染</span>
    </div>
    <div style="padding:26px 32px;font-size:22px;line-height:38px;color:#2D1624;font-weight:700">
      <div style="font-size:29px;font-weight:900;color:#DB2777;margin-bottom:12px"># 1. 执行摘要（Executive Summary）</div>
      <div>本次任务由 <b>Antigravity</b> 担任总意图解析官，经 1 轮黑板圆桌协商达成共识拓扑。</div>
      <div style="margin-top:14px;padding:14px 18px;background:#FDF2F8;border-left:5px solid #EC4899;border-radius:10px">
        <b>关键发现：</b>独立审稿节点在第 1 轮捕获长尾样本偏差并自动打回 <span class="mono">power_plan.py</span>，修订后统计功效提升至 <b>94.2%</b>。
      </div>
      <div style="font-size:26px;font-weight:900;color:#DB2777;margin-top:18px"># 2. 产物清单与复现实验脚本</div>
      <div class="mono" style="font-size:19px;color:#6B4A5C;margin-top:6px">├── 01_theoretical_framework.md  (12.4 KB)<br>├── power_plan.py                (4.8 KB, passed)<br>├── 03_peer_review.md            (8.1 KB, VERDICT: PASS)<br>└── BLACKBOARD_ROUNDTABLE.md     (6.2 KB)</div>
    </div>`, { zIndex: 5, boxShadow: "0 26px 70px rgba(45,22,36,.28)" });
  // 光标
  const curSvg = svgLayer(root);
  const cursor = sv("path", { d: "M0,0 L0,36 L10,27 L17,43 L24,40 L17,25 L30,25 Z", fill: "#fff", stroke: "#2D1624", "stroke-width": 2.5 }, curSvg);
  // 角色 + 3 只迷你伙伴庆祝
  const ms = svgLayer(root);
  const partners = [["agy", 1470], ["codex", 1565], ["dsh", 1745]].map(([k, x], i) => ({ p: partner(ms, k, "s6p" + i), x }));
  const M = new Mascot(ms, 6);
  const tDrawer = c(1) - 0.1, tHero = c(2) - 0.1, tPrev = c(2) + 0.35, tFiles = c(3) + 0.05, tZip = c(4) + 0.15;
  const modalBg = box(lay, 0, 0, 1920, 1080, "abs", "", { background: "rgba(45,22,36,.32)", zIndex: 4, pointerEvents: "none" });
  const jumps = [
    { t: 0.15, to: [1655, 790], d: 0.6, h: 160 },
    { t: tZip, to: [1655, 790], d: 0.65, h: 190, spin: true },
  ];
  const sfx = [
    { t: tDrawer, type: "whoosh" },
    { t: tHero, type: "pop" },
    { t: tPrev, type: "click" }, { t: tPrev + 0.12, type: "softpop" },
    ...files.map((_, i) => ({ t: tFiles + i * 0.25, type: "tick", p: i })),
    { t: tZip, type: "click" }, { t: tZip + 0.15, type: "zip" }, { t: tZip + 0.6, type: "chime" },
  ];
  return {
    sfx,
    update(lt, gt) {
      pop(left, lt, 0.05, { from: .92 });
      const ds = spring(lt - tDrawer);
      css(drawer, { o: prog(lt, tDrawer, tDrawer + 0.2), tf: `translateX(${(1 - ds) * 520}px)` });
      pop(hero, lt, tHero, { from: .75, dy: 24 });
      pop(btnPrev, lt, tHero + 0.2, { from: .6 });
      pop(btnZip, lt, tHero + 0.32, { from: .6 });
      fileEls.forEach((f, i) => pop(f, lt, tFiles + i * 0.25, { from: .6, dx: -30 }));
      // 预览弹窗（在 tPrev 弹出，在 tFiles + 0.35 收起，全不透明 + 暗化遮罩）
      const mIn = prog(lt, tPrev + 0.05, tPrev + 0.22), mOut = prog(lt, tFiles + 0.2, tFiles + 0.45);
      const mVis = mIn * (1 - mOut);
      css(modalBg, { o: mVis });
      css(modal, { o: mVis > 0.02 ? 1 : 0, tf: `scale(${lerp(0.65, 1, spring(lt - (tPrev + 0.05))) * (1 - mOut * 0.12)})` });
      pop(folder, lt, tFiles + 0.3, { from: .85 });
      pop(zipIcon, lt, tZip + 0.25, { from: .2, dy: -90 });
      // 光标移动：先点预览，再点下载
      const p1 = Ease.inOut(prog(lt, tPrev - 0.5, tPrev));
      const p2 = Ease.inOut(prog(lt, tZip - 0.6, tZip));
      const cx = lt < tFiles ? lerp(1350, 990, p1) : lerp(990, 1340, p2);
      const cy = lt < tFiles ? lerp(650, 510, p1) : lerp(510, 510, p2);
      const clk = (lt > tPrev && lt < tPrev + 0.16) || (lt > tZip && lt < tZip + 0.16);
      attr(cursor, { transform: `translate(${cx},${cy}) scale(${clk ? 0.84 : 1})`, opacity: prog(lt, tPrev - 0.6, tPrev - 0.3) * (1 - prog(lt, tZip + 0.8, tZip + 1.1)) });
      // 小 Claude 抱起 .zip 礼盒庆祝 + 迷你伙伴同跳
      const m = motion(lt, gt, [1655, 790], jumps);
      const hasZip = lt > tZip + 0.1;
      M.set({
        ...m, s: 0.78, gt, prop: hasZip ? "zip" : "none",
        zipS: spring(lt - (tZip + 0.1)), zipDy: Math.sin(gt * 8) * 6,
        eyes: hasZip ? "happy" : "open",
        armL: hasZip ? 125 : (m.air ? 60 : -14), armR: hasZip ? 125 : (m.air ? 60 : wave(gt)),
        o: lt < 0.1 ? 0 : 1,
      });
      partners.forEach((pt, i) => {
        const b = Math.abs(Math.sin((gt + i * 0.18) * Math.PI / BEAT)) * (hasZip ? 26 : 10);
        pt.p.set(pt.x, 790 - b, 1, 1, Math.sin(gt * 6 + i) * 6, hasZip, 0.56 * spring(lt - (0.4 + i * 0.12)));
      });
    },
  };
});

/* =========================== Scene 7 · 工程细节 Bento 快闪 =========================== */
registerScene("s7", (root, T, X) => {
  const { c, e, w } = X;
  const lay = el("div", "layer", root);
  const head = box(lay, 0, 96, 1920, 60, "abs center nowrap", `⚡ 工程级打磨：<span style="color:#DB2777">零依赖 · 防卡死 · 断点续跑</span>`, { fontSize: "42px", fontWeight: 900 });
  const cardsDef = [
    ["⚡ 零 npm 外部依赖", "纯原生 Node.js >= 18 · 30 秒 npm start 即刻开跑", "dependencies: 0  |  无需 npm install", 140, 180, "#EC4899"],
    ["⏩ 断点续跑 Resume", "中断自动校准状态，跳过已完成节点继续推进", "resume_from_checkpoint() → 0 重复消耗", 990, 180, "#10B981"],
    ["🛡️ 活跃心跳看门狗", "220ms 流式防卡死节流 · 30 分钟长考不误杀", "Windows taskkill /T 进程树干净回收", 140, 520, "#8B5CF6"],
    ["🔬 开放全领域通吃", "科研假设 / 软件工程 / 红蓝辩论 / 自由黑板", "自定义智能体 + 经典模板一键切换", 990, 520, "#F59E0B"],
  ];
  const tCard = [c(0) + 0.05, c(1) + 0.1, c(2) + 0.1, c(3) + 0.1, c(4) + 0.05];
  const cards = cardsDef.map(([title, desc, code, x, y, col], i) => {
    const cd = box(lay, x, y, 790, 300, "abs card", "", { transformOrigin: "50% 50%" });
    box(cd, 32, 28, 620, 50, "abs nowrap", title, { fontSize: "36px", fontWeight: 900 });
    box(cd, 32, 96, 720, 44, "abs nowrap", desc, { fontSize: "24px", fontWeight: 700, color: "#6B4A5C" });
    box(cd, 32, 166, 726, 64, "abs mono center nowrap", code, { fontSize: "22px", fontWeight: 800, background: "#FFF5F9", color: col, borderRadius: "14px", border: "1.5px solid #F3D4E1", justifyContent: "flex-start", padding: "0 22px" });
    const chk = box(cd, 690, 24, 68, 68, "abs center", "✅", { fontSize: "42px", background: "#ECFDF5", borderRadius: "50%", border: "2.5px solid #10B981" });
    return { cd, chk, x, y };
  });
  // 角色在 4 张卡片之间像跳格子一样踩点连跳
  const ms = svgLayer(root); const M = new Mascot(ms, 7);
  const spots = [[540, 180], [1390, 180], [540, 520], [1390, 520]];
  const tLand = [c(0) + 0.45, c(2) + 0.2, c(3) + 0.25, c(4) + 0.25];
  const jumps = tLand.map((tl, i) => ({ t: tl - 0.5, to: spots[i], d: 0.5, h: 170 }));
  const sfx = [
    ...tLand.map((tl, i) => ({ t: tl - 0.48, type: i % 2 ? "clap" : "kick" })),
    ...tLand.map((tl, i) => ({ t: tl, type: "ding", p: i })),
  ];
  return {
    sfx,
    update(lt, gt) {
      pop(head, lt, 0.05, { from: .85 });
      const appearT = [0.1, c(2) - 0.15, c(3) - 0.15, c(4) - 0.15];
      cards.forEach((cd, i) => {
        const s = spring(lt - appearT[i]);
        css(cd.cd, { o: prog(lt, appearT[i], appearT[i] + 0.15), tf: `perspective(900px) rotateX(${(1 - s) * 35}deg) scale(${lerp(0.75, 1, s)})` });
        const lit = lt >= tLand[i];
        pop(cd.chk, lt, tLand[i], { from: .2 });
        css(cd.cd, { borderColor: lit ? "#6EE7B7" : "#F3D4E1" });
      });
      const m = motion(lt, gt, [-120, 300], jumps);
      M.set({
        ...m, s: 0.68, gt,
        eyes: lt > tLand[3] ? "happy" : "open",
        armL: m.air ? 75 : -12, armR: m.air ? 75 : wave(gt),
        o: lt < 0.05 ? 0 : 1,
      });
    },
  };
});

/* =========================== Scene 8 · 开源号召定版 =========================== */
registerScene("s8", (root, T, X) => {
  const { c, e, w, dur } = X;
  const lay = el("div", "layer", root);
  const logoWrap = box(lay, 0, 170, 1920, 140, "abs center");
  const logo = el("div", "nowrap", logoWrap, `<span style="font-size:88px">🌸</span> Sakura<span style="color:#EC4899">Flow</span> Studio <span style="color:#EC4899">v4.0</span>`, { fontSize: "96px", fontWeight: 900 });
  const tag = box(lay, 0, 315, 1920, 56, "abs center nowrap", "把你的 AI 们变成一支会自己开圆桌会议的真团队", { fontSize: "36px", fontWeight: 800, color: "#6B4A5C" });
  // 极简终端代码条
  const term = box(lay, 310, 405, 1300, 110, "abs card nobar", "", { background: "#231922", borderColor: "#F472B6", borderWidth: "2.5px", borderRadius: "20px", boxShadow: "0 18px 46px rgba(45,22,36,.24)" });
  box(term, 24, 18, 120, 24, "abs", `<span style="display:inline-flex;gap:8px"><i style="width:13px;height:13px;border-radius:7px;background:#F472B6;display:inline-block"></i><i style="width:13px;height:13px;border-radius:7px;background:#FBBF24;display:inline-block"></i><i style="width:13px;height:13px;border-radius:7px;background:#34D399;display:inline-block"></i></span>`);
  const cmdBox = box(term, 32, 48, 1240, 48, "abs mono nowrap", "", { fontSize: "27px", fontWeight: 700, color: "#FDF2F8" });
  const repo = (window.CONFIG && window.CONFIG.repoUrl) || "https://github.com/<your-repo>/SakuraFlow";
  const cmdStr = `$ git clone ${repo} && npm start`;
  // 三枚胶囊徽章
  const bWrap = box(lay, 0, 550, 1920, 74, "abs center", "", { gap: "26px" });
  const pills = [
    ["📜 MIT Open Source", "#FDF2F8", "#DB2777"],
    ["⭐ Star on GitHub", "linear-gradient(90deg,#F472B6,#EC4899)", "#fff"],
    ["🖥️+☁️ Local + Remote Multi-Agent", "#F5F3FF", "#7C3AED"],
  ].map(([t, bg, col]) => el("div", "pill", bWrap, t, { fontSize: "27px", background: bg, color: col, padding: "14px 30px", border: "2px solid #F9A8D4", boxShadow: "0 10px 26px rgba(236,72,153,.16)" }));
  // 角色与 3 只迷你伙伴排成一排起跳招手定格
  const ms = svgLayer(root);
  const pLeft = partner(ms, "agy", "s8a");
  const pMid = partner(ms, "codex", "s8b");
  const pRight = partner(ms, "dsh", "s8c");
  const M = new Mascot(ms, 8);
  // 片尾独立飘落的小樱花
  const fallPet = sakuraFlower(ms, 18);
  const tPose = c(5) + 0.4, GY = 865;
  const jumps = [
    { t: 0.15, to: [880, GY], d: 0.6, h: 150 },
    { t: tPose, to: [880, GY - 20], d: 0.55, h: 95 },
  ];
  const sfx = [
    { t: 0.1, type: "chime" },
    ...Array.from({ length: 14 }, (_, i) => ({ t: c(3) + 0.2 + i * 0.12, type: "tick", gain: .5, p: i })),
    { t: c(4) + 0.15, type: "ding" },
    { t: tPose, type: "pop" },
    { t: tPose + 0.35, type: "outro" },
  ];
  return {
    sfx,
    update(lt, gt) {
      App.frontPetals = clamp(prog(lt, 0.2, 2.0), 0, 1);
      pop(logo, lt, 0.08, { from: .6, dy: 24 });
      fadeIn(tag, lt, 0.35, 0.4, 18);
      pop(term, lt, c(2) + 0.2, { from: .85, dy: 24 });
      typeText(cmdBox, cmdStr, lt, c(3) + 0.1, 24, true);
      pills.forEach((p, i) => pop(p, lt, c(4) + i * 0.18, { from: .4, dy: 20 }));
      // Star 徽章脉冲
      if (lt > c(4) + 0.5) css(pills[1], { tf: `scale(${1 + 0.06 * Math.sin(lt * 6)})` });
      // 齐跳定格
      const freeze = lt >= tPose + 0.32;
      const tEff = freeze ? tPose + 0.32 : lt;
      const gEff = freeze ? T.start + tPose + 0.32 : gt;
      const m = motion(tEff, gEff, [880, GY], jumps);
      const detach = prog(lt, dur - 2.4, dur - 0.4);
      M.set({
        ...m, s: 0.92, gt: gEff,
        eyes: "happy",
        armL: 135, armR: freeze ? 140 : wave(gt),
        flowerO: 1 - prog(detach, 0, 0.15),
      });
      const py = freeze ? GY - 60 : GY - Math.abs(Math.sin(gt * Math.PI / BEAT)) * 22;
      pLeft.set(660, py, 1, 1, -6, true, 0.85 * spring(lt - 0.3));
      pMid.set(1090, py, 1, 1, 5, true, 0.85 * spring(lt - 0.42));
      pRight.set(1260, py, 1, 1, 8, true, 0.85 * spring(lt - 0.54));
      // 头顶小樱花飘落成片尾淡出
      if (detach > 0) {
        const fx = (880 - 34 * 0.92) + Math.sin(detach * 7) * 55 + detach * 40;
        const fy = (m.y - 112 * 0.92) + detach * 210;
        attr(fallPet, { transform: `translate(${fx.toFixed(1)},${fy.toFixed(1)}) rotate(${(detach * 320).toFixed(1)}) scale(${(1.1 - 0.25 * detach).toFixed(2)})`, opacity: (1 - prog(detach, 0.75, 1)).toFixed(3) });
      } else attr(fallPet, { opacity: 0 });
    },
  };
});
