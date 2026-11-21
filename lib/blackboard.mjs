import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { executeAgent } from './runners.mjs';

// ---------------------------------------------------------------------------
// Deterministic Cycle-Breaking & Layered Auto-Layout for Self-Generated Graphs
// ---------------------------------------------------------------------------
function extractJsonBlock(text = '') {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function sanitizeAndLayoutGeneratedGraph(rawSpec, { goal, title, chairAgentId, participantAgentIds, agents }) {
  const validAgentIds = new Set(agents.filter((a) => a.installed && a.headlessSupported).map((a) => a.id));
  const fallbackPool = participantAgentIds.filter((id) => validAgentIds.has(id));
  if (fallbackPool.length === 0) fallbackPool.push(validAgentIds.has(chairAgentId) ? chairAgentId : 'simulator');

  const triggerNode = {
    id: 'n_trigger',
    type: 'trigger',
    title: title || '圆桌黑板协作总目标',
    roleTag: 'Blackboard Goal',
    goal,
    x: 60,
    y: 210,
  };

  let rawNodes = Array.isArray(rawSpec?.nodes) ? rawSpec.nodes : [];
  rawNodes = rawNodes.filter((n) => n && n.id && n.id !== 'n_trigger' && n.type !== 'trigger');

  // Fallback: if LLM didn't return structured nodes, create one node per participant cleanly
  if (rawNodes.length === 0) {
    rawNodes = fallbackPool.map((aid, idx) => {
      const ag = agents.find((a) => a.id === aid);
      return {
        id: `n_role_${idx + 1}`,
        title: `${ag?.name || aid} 协作角色 #${idx + 1}`,
        roleTag: `Role #${idx + 1}`,
        agentId: aid,
        systemPrompt: `你是圆桌协商推选出的第 ${idx + 1} 位协作专家，请结合黑板共识与上游产出高质量推进任务。`,
      };
    });
  }

  const seenNodeIds = new Set(['n_trigger']);
  const agentNodes = [];
  rawNodes.slice(0, 8).forEach((n, idx) => {
    let nid = String(n.id || `n_dyn_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (seenNodeIds.has(nid)) nid = `${nid}_${idx + 1}`;
    seenNodeIds.add(nid);
    const chosenAgent = validAgentIds.has(n.agentId) ? n.agentId : fallbackPool[idx % fallbackPool.length];
    agentNodes.push({
      id: nid,
      type: 'agent',
      title: String(n.title || `自组织实体 #${idx + 1}`).slice(0, 28),
      roleTag: String(n.roleTag || 'Autonomous Role').slice(0, 24),
      agentId: chosenAgent,
      modelOverride: n.modelOverride || '',
      systemPrompt: String(n.systemPrompt || '请根据黑板共识和上游上下文完成本岗位交付。'),
      x: 475,
      y: 210,
    });
  });

  // Validate edges + guarantee connectivity from n_trigger + break any illegal flow cycles (DFS back-edge detection)
  const rawEdges = Array.isArray(rawSpec?.edges) ? rawSpec.edges : [];
  const edges = [];
  const edgeKeys = new Set();

  for (const e of rawEdges) {
    if (!e || !seenNodeIds.has(e.from) || !seenNodeIds.has(e.to) || e.from === e.to) continue;
    if (e.to === 'n_trigger') continue;
    const type = e.type === 'review_loop' ? 'review_loop' : 'flow';
    const key = `${e.from}->${e.to}:${type}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      id: `e_${edges.length + 1}`,
      from: e.from,
      to: e.to,
      label: String(e.label || (type === 'review_loop' ? '打回修订' : '协作交接')).slice(0, 14),
      type,
    });
  }

  // Ensure every entry agent node with in-degree 0 gets connected from n_trigger,
  // EXCEPT if it already receives a review_loop edge (promote that edge to flow instead of wiring from n_trigger!)
  const hasIncomingFlow = new Set(edges.filter((e) => e.type === 'flow').map((e) => e.to));
  const hasIncomingLoop = new Set(edges.filter((e) => e.type === 'review_loop').map((e) => e.to));
  for (const n of agentNodes) {
    if (!hasIncomingFlow.has(n.id) && hasIncomingLoop.has(n.id)) {
      const loopEdge = edges.find((e) => e.type === 'review_loop' && e.to === n.id);
      if (loopEdge) {
        loopEdge.type = 'flow';
        hasIncomingFlow.add(n.id);
      }
    }
  }
  const entryNodes = agentNodes.filter((n) => !hasIncomingFlow.has(n.id));
  if (entryNodes.length === 0 && agentNodes.length > 0) {
    edges.unshift({ id: `e_entry_0`, from: 'n_trigger', to: agentNodes[0].id, label: '意图分发', type: 'flow' });
  } else {
    entryNodes.forEach((n, idx) => {
      const key = `n_trigger->${n.id}:flow`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push({ id: `e_entry_${idx + 1}`, from: 'n_trigger', to: n.id, label: '任务启动', type: 'flow' });
      }
    });
  }

  // Deterministic Anti-Deadlock Cycle Breaker (DFS on flow edges -> converts back-edges to bounded review_loop)
  const color = new Map(); // 0=unvisited, 1=visiting, 2=done
  const brokenCycles = [];
  function dfs(u) {
    color.set(u, 1);
    for (const edge of edges) {
      if (edge.type !== 'flow' || edge.from !== u) continue;
      const v = edge.to;
      const c = color.get(v) || 0;
      if (c === 1) {
        // Found a cycle in flow edges! Convert safely to bounded review_loop so execution NEVER deadlocks
        edge.type = 'review_loop';
        edge.label = edge.label || '有界修订环';
        brokenCycles.push(`${u} -> ${v}`);
      } else if (c === 0) {
        dfs(v);
      }
    }
    color.set(u, 2);
  }
  for (const id of seenNodeIds) {
    if ((color.get(id) || 0) === 0) dfs(id);
  }

  // Layered BFS auto-layout with generous spacing (415px columns, 230px rows)
  const levels = new Map([['n_trigger', 0]]);
  const queue = [{ id: 'n_trigger', lv: 0 }];
  const maxDepth = agentNodes.length + 2;
  while (queue.length) {
    const { id, lv } = queue.shift();
    if (lv >= maxDepth) continue;
    for (const e of edges) {
      if (e.type !== 'flow' || e.from !== id) continue;
      if ((levels.get(e.to) ?? -1) < lv + 1 && lv + 1 < maxDepth) {
        levels.set(e.to, lv + 1);
        queue.push({ id: e.to, lv: lv + 1 });
      }
    }
  }

  const allNodes = [triggerNode, ...agentNodes];
  const cols = new Map();
  for (const n of allNodes) {
    const lv = levels.get(n.id) ?? 1;
    if (!cols.has(lv)) cols.set(lv, []);
    cols.get(lv).push(n);
  }
  for (const [lv, list] of cols.entries()) {
    const startY = Math.max(60, 290 - (list.length * 230) / 2);
    list.forEach((n, idx) => {
      n.x = 60 + lv * 415;
      n.y = Math.round(startY + idx * 230);
    });
  }

  const governance = {
    maxRevisions: Math.min(2, Math.max(1, Number(rawSpec?.governance?.maxRevisions) || 1)),
    terminationRule:
      rawSpec?.governance?.terminationRule ||
      '当所有终端汇总节点完成交付、且审查节点输出 VERDICT: PASS 或达到最大修订轮次上限时自动收敛终止。',
    deadlockGuard:
      rawSpec?.governance?.deadlockGuard ||
      '强制采用有向无环主干 + 有界打回修订边（最多 1 轮返工），杜绝无限互相推诿或死循环。',
    consensusRationale:
      rawSpec?.rationale ||
      '圆桌团队已根据各自模型强项完成自由协商分工，并生成兼顾并行效率与质量校验的最优协作图谱。',
    brokenCyclesCount: brokenCycles.length,
  };

  return {
    graph: {
      id: `bb_${Date.now().toString(36)}`,
      name: `🫧 圆桌自组织：${(title || goal).slice(0, 24)}`,
      description: governance.consensusRationale,
      nodes: allNodes,
      edges,
      governance,
    },
    governance,
  };
}

// ---------------------------------------------------------------------------
// Blackboard Autonomous Roundtable Negotiation Engine
// (Grounded in LbMAS 2025 + AutoAgents IJCAI 2024 + Magentic-One / DyLAN)
// ---------------------------------------------------------------------------
export async function runBlackboardRoundtable({
  session,
  getAgents,
  envOverrides,
  dataDir,
  activeChildren,
  activeAborts,
  saveSessions,
  broadcast,
  onGraphReady,
}) {
  const childSet = new Set();
  const abortSet = new Set();
  activeChildren.set(session.id, childSet);
  activeAborts.set(session.id, abortSet);

  const bbWorkDir = path.join(dataDir, 'ping_sandbox');
  fs.mkdirSync(bbWorkDir, { recursive: true });

  const agents = getAgents();
  const chairAgent = agents.find((a) => a.id === session.chairAgentId) || agents.find((a) => a.id === 'simulator');
  const roster = session.participantAgentIds
    .map((id, idx) => {
      const ag = agents.find((a) => a.id === id);
      if (!ag) return null;
      return {
        order: idx + 1,
        id: ag.id,
        name: ag.name,
        mode: ag.mode,
        model: ag.profile?.reportedModel || ag.modelConfig?.currentModel || ag.name,
        domains: ag.profile?.bestDomains?.join('、') || '综合分析与执行',
        summary: ag.profile?.summary || '',
      };
    })
    .filter(Boolean);

  const rosterSummary = roster
    .map((r) => `- 成员 #${r.order} [${r.id}] ${r.name} (模型: ${r.model} | 模式: ${r.mode} | 强项: ${r.domains})`)
    .join('\n');

  const emitPhase = (phase, label) => {
    session.phase = phase;
    session.phaseLabel = label;
    saveSessions();
    broadcast('bb_phase', { sessionId: session.id, phase, label });
  };

  async function callSpeaker({ speakerId, order, roleLabel, agent, prompt }) {
    if (session.status === 'aborted') return null;
    const entry = {
      id: `sp_${crypto.randomBytes(3).toString('hex')}`,
      order,
      speakerId,
      roleLabel,
      agentId: agent.id,
      agentName: agent.name,
      status: 'speaking',
      text: '',
      startedAt: new Date().toISOString(),
    };
    session.transcript.push(entry);
    saveSessions();
    broadcast('bb_speech_start', { sessionId: session.id, entry });

    let pending = '';
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      if (!pending) return;
      broadcast('bb_speech_chunk', { sessionId: session.id, speechId: entry.id, chunk: pending });
      pending = '';
    };

    const res = await executeAgent({
      agent,
      prompt,
      cwd: bbWorkDir,
      envOverrides,
      idleTimeoutMs: 120000,
      maxTimeoutMs: 240000,
      childSet,
      abortSet,
      onChunk: (stream, chunk) => {
        if (stream === 'stdout') {
          entry.text += chunk;
          pending += chunk;
          if (!flushTimer) flushTimer = setTimeout(flush, 200);
        }
      },
    });
    if (flushTimer) {
      clearTimeout(flushTimer);
      flush();
    }

    entry.finishedAt = new Date().toISOString();
    entry.durationMs = res.durationMs;
    entry.status = res.ok ? 'done' : 'failed';
    if (!entry.text.trim()) entry.text = (res.stdout || res.stderr || '').trim();
    saveSessions();
    broadcast('bb_speech_done', { sessionId: session.id, entry });
    return { ok: res.ok, text: entry.text, entry };
  }

  try {
    // -----------------------------------------------------------------------
    // PHASE 1: Intent Parser / Meta-Orchestrator Analyzes Goal & Opens Blackboard
    // -----------------------------------------------------------------------
    emitPhase('intent', '① 总意图解析智能体正在拆解任务并立项黑板...');
    const intentPrompt = [
      `# SakuraFlow 黑板圆桌会议 — 总意图解析官 (Intent Parser & Chair)`,
      `你负责作为本次开放式多智能体协作的总入口。不要写任何文件，请直接以简洁清晰的中文输出黑板立项简报（250字以内）：`,
      `1. **核心意图与任务性质**（判断属于科研探索、软件工程、决策分析还是混合任务）`,
      `2. **成功交付标准**（最终要交付什么关键产物才算圆满完成）`,
      `3. **建议讨论焦点**（邀请在座成员围绕哪些分工、并行机会与防死循环边界展开协商）`,
      ``,
      `## 用户原始目标`,
      session.goal,
      ``,
      `## 本次圆桌可调动的智能体成员（按发言顺序 1..N）`,
      rosterSummary,
    ].join('\n');

    const intentRes = await callSpeaker({
      speakerId: 'intent_chair',
      order: 0,
      roleLabel: '👑 总意图解析官 (Intent Parser)',
      agent: chairAgent,
      prompt: intentPrompt,
    });
    if (session.status === 'aborted') return;
    if (!intentRes?.ok) throw new Error(`意图解析阶段失败: ${intentRes?.text?.slice(0, 200)}`);
    session.intentBrief = intentRes.text;

    // -----------------------------------------------------------------------
    // PHASE 2: Ordered 1 -> 2 -> 3 -> 4 Roundtable Negotiation on the Blackboard
    // -----------------------------------------------------------------------
    emitPhase('roundtable', `② 圆桌协商进行中（共 ${roster.length} 位智能体按 1→${roster.length} 顺序自由认领与讨论）...`);

    for (const member of roster) {
      if (session.status === 'aborted') return;
      const memberAgent = agents.find((a) => a.id === member.id) || chairAgent;
      const priorTranscript = session.transcript
        .map((t) => `### [${t.roleLabel} · ${t.agentName}]\n${t.text.slice(0, 1200)}`)
        .join('\n\n');

      const speakPrompt = [
        `# SakuraFlow 共享黑板圆桌协商 — 你是第 #${member.order} 位发言成员`,
        `你的真实身份：${member.name} (ID: ${member.id}，底层模型: ${member.model}，擅长: ${member.domains})`,
        `现在你正与其他真实队友围坐在共享黑板前自由协商，**请不要直接做完整个任务，也不要写任何文件**，只需像真人开需求启动会一样，简明扼要发言（200字以内）：`,
        `1. **角色认领**：结合总意图和前面队友已经认领的部分，你最适合承担什么岗位/子任务？（避免和前面队友重复，可主动提出并行或互补）`,
        `2. **协作连线建议**：你希望接收谁的产出，你的产物应该交接给谁？是否需要独立审查/辩论环节？`,
        `3. **防死循环与收敛建议**：如果涉及审查打回或观点分歧，你建议如何限定轮次与终止条件以确保收敛不死循环？`,
        ``,
        `## 用户原始任务`,
        session.goal,
        ``,
        `## 当前圆桌成员名单`,
        rosterSummary,
        ``,
        `## 共享黑板当前发言记录`,
        priorTranscript,
      ].join('\n');

      await callSpeaker({
        speakerId: member.id,
        order: member.order,
        roleLabel: `💬 成员 #${member.order} 协商发言`,
        agent: memberAgent,
        prompt: speakPrompt,
      });
    }

    if (session.status === 'aborted') return;

    // -----------------------------------------------------------------------
    // PHASE 3: Consensus Convergence & Dynamic Canvas Graph Generation
    // -----------------------------------------------------------------------
    emitPhase('synthesize', '③ 汇总圆桌共识，敲定防死循环契约并动态生成协作画布...');

    const fullBoard = session.transcript
      .map((t) => `### [${t.roleLabel} · ${t.agentName} (${t.agentId})]\n${t.text.slice(0, 1400)}`)
      .join('\n\n');

    const synthPrompt = [
      `# SakuraFlow 黑板共识收敛与动态画布生成器`,
      `你是总意图解析官与会议主席。请你完整阅读下方共享黑板上的圆桌讨论记录，综合各位成员认领的角色、协作关系与防死循环建议，**动态生成本次任务专属的协作拓扑图 JSON**。`,
      ``,
      `## 严格输出要求`,
      `- 不要写文件！只输出**一个合法 JSON 对象**（可用 \`\`\`json ... \`\`\` 包裹）。`,
      `- \`agentId\` 必须且只能从以下本次参会成员 ID 中选取：[${roster.map((r) => `"${r.id}"`).join(', ')}]`,
      `- 允许并行分支（同一上游连向多个实体）和汇聚（多个实体连向同一审查/汇总实体）。`,
      `- 正常主干连线 \`type\` 设为 \`"flow"\`（必须保持无环 DAG！），若需审查打回修订，直接从审查节点用 \`type: "review_loop"\` 连回原开发/实现节点即可，**不要单独新建“返工/二审”孤立节点**，绝不制造死循环。`,
      `- 建议生成 3-5 个精干核心实体节点，每个节点的 \`systemPrompt\` 必须高度贴合本次任务和该成员在圆桌上认领的具体职责。`,
      ``,
      `## JSON Schema`,
      `{`,
      `  "rationale": "2-3句中文说明圆桌最终达成的分工共识与为何这样连线",`,
      `  "governance": {`,
      `    "maxRevisions": 1,`,
      `    "terminationRule": "明确的收敛与终止验收条件",`,
      `    "deadlockGuard": "如何防止智能体之间无限互相打回或死循环"`,
      `  },`,
      `  "nodes": [`,
      `    { "id": "n_1", "title": "中文岗位名(8字内)", "roleTag": "英文短标签", "agentId": "成员ID", "systemPrompt": "详细具体的角色职责与交付要求" }`,
      `  ],`,
      `  "edges": [`,
      `    { "from": "n_trigger", "to": "n_1", "label": "简短关系(6字内)", "type": "flow" },`,
      `    { "from": "n_1", "to": "n_2", "label": "简短关系", "type": "flow" },`,
      `    { "from": "n_review", "to": "n_dev", "label": "打回修订", "type": "review_loop" }`,
      `  ]`,
      `}`,
      ``,
      `## 用户原始任务`,
      session.goal,
      ``,
      `## 完整圆桌黑板记录`,
      fullBoard,
    ].join('\n');

    const synthRes = await callSpeaker({
      speakerId: 'consensus_chair',
      order: roster.length + 1,
      roleLabel: '📜 共识收敛与画布生成',
      agent: chairAgent,
      prompt: synthPrompt,
    });
    if (session.status === 'aborted') return;

    const rawSpec = extractJsonBlock(synthRes?.text || '');
    const { graph, governance } = sanitizeAndLayoutGeneratedGraph(rawSpec, {
      goal: session.goal,
      title: session.title,
      chairAgentId: session.chairAgentId,
      participantAgentIds: session.participantAgentIds,
      agents,
    });

    session.generatedGraph = graph;
    session.governance = governance;
    session.status = 'completed';
    session.phase = 'ready';
    session.phaseLabel = '✅ 圆桌协商完成，已自动生成定制协作画布！';
    session.finishedAt = new Date().toISOString();
    saveSessions();

    broadcast('bb_graph_ready', { sessionId: session.id, session, graph, governance });
    if (onGraphReady) await onGraphReady(session, graph);
  } catch (err) {
    if (session.status !== 'aborted') {
      session.status = 'failed';
      session.error = err.message;
      session.phaseLabel = `❌ 协商异常: ${err.message}`;
      saveSessions();
      broadcast('bb_failed', { sessionId: session.id, error: err.message });
    }
  } finally {
    activeChildren.delete(session.id);
    activeAborts.delete(session.id);
  }
}
