import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  discoverAllAgents,
  sanitizeAgentsForClient,
  createRemoteAgentRecord,
} from './lib/discovery.mjs';
import { executeAgent, killProcessTree, profileAgentLive } from './lib/runners.mjs';
import {
  listWorkspaceFiles,
  buildDeliverablesManifest,
  runCanvasGraph,
} from './lib/orchestrator.mjs';
import { buildZipBufferFromDir } from './lib/zip.mjs';
import { runBlackboardRoundtable } from './lib/blackboard.mjs';
import { createSshHostRecord, probeSshHost } from './lib/ssh.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.SAKURAFLOW_PORT || 3888);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const WORKSPACES_DIR = path.join(__dirname, 'workspaces');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

const GRAPH_FILE = path.join(DATA_DIR, 'graph.json');
const RUNS_FILE = path.join(DATA_DIR, 'runs.json');
const BLACKBOARDS_FILE = path.join(DATA_DIR, 'blackboards.json');
const ENV_FILE = path.join(DATA_DIR, 'env_overrides.json');
const REMOTE_AGENTS_FILE = path.join(DATA_DIR, 'remote_agents.json');
const SSH_HOSTS_FILE = path.join(DATA_DIR, 'ssh_hosts.json');
const PROFILES_FILE = path.join(DATA_DIR, 'agent_profiles.json');

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Open-Domain Templates (Agent-Agnostic: Auto-bound to User's Available Agents)
// ---------------------------------------------------------------------------
const BASE_TEMPLATES = {
  research: {
    id: 'research',
    name: '🔬 科学研究协作图谱',
    description: '适用于学术调研、假设推演、实验设计与同行评审（含并行分叉 + 审稿闭环）',
    nodes: [
      {
        id: 'n_trigger',
        type: 'trigger',
        title: '课题发起与研究目标',
        roleTag: 'Research Brief',
        goal: '探索“多智能体异构协作在复杂科学假设生成中如何降低单一模型幻觉”，请输出理论假设、可验证的对比实验方案，并经过同行评审后形成精炼的研究简报。',
        x: 60,
        y: 205,
      },
      {
        id: 'n_lit',
        type: 'agent',
        title: '文献与理论研究员',
        roleTag: 'Literature & Theory',
        preferredSlot: 0,
        modelOverride: '',
        systemPrompt:
          '你是科研团队的文献与理论研究员。围绕课题目标，梳理核心理论背景、提出 2-3 个可证伪的科学假设 (Hypotheses)，并明确关键变量与预期机制。',
        x: 475,
        y: 65,
      },
      {
        id: 'n_exp',
        type: 'agent',
        title: '实验与建模工程师',
        roleTag: 'Experiment Design',
        preferredSlot: 1,
        modelOverride: '',
        systemPrompt:
          '你是科研团队的实验与建模工程师。围绕课题目标设计严谨的对照实验、评估指标 (Metrics)、消融实验方案，并可在共享工作空间编写最小可复现的验证脚本或数据结构。',
        x: 475,
        y: 345,
      },
      {
        id: 'n_peer',
        type: 'agent',
        title: '独立同行评审员',
        roleTag: 'Peer Reviewer',
        preferredSlot: 2,
        modelOverride: '',
        systemPrompt:
          '你是顶会独立同行评审员 (Peer Reviewer)。同时审阅上游的理论假设与实验设计，指出潜在的逻辑漏洞、混杂变量或不可复现之处，并给出建设性改进意见。最后一行写明 VERDICT: PASS 或 VERDICT: REVISE。',
        x: 890,
        y: 205,
      },
      {
        id: 'n_synth',
        type: 'agent',
        title: '论文综述与结论官',
        roleTag: 'Synthesis Chair',
        preferredSlot: 0,
        modelOverride: '',
        systemPrompt:
          '你是首席研究员。综合理论假设、实验方案与同行评审意见，输出一份结构清晰的最终研究提案摘要 (Abstract + Methodology + Risk Mitigation)。',
        x: 1305,
        y: 205,
      },
    ],
    edges: [
      { id: 'e1', from: 'n_trigger', to: 'n_lit', label: '理论探索', type: 'flow' },
      { id: 'e2', from: 'n_trigger', to: 'n_exp', label: '实验建模', type: 'flow' },
      { id: 'e3', from: 'n_lit', to: 'n_peer', label: '假设送审', type: 'flow' },
      { id: 'e4', from: 'n_exp', to: 'n_peer', label: '实验送审', type: 'flow' },
      { id: 'e5', from: 'n_peer', to: 'n_synth', label: '汇总成稿', type: 'flow' },
      { id: 'e6', from: 'n_peer', to: 'n_exp', label: '打回修订', type: 'review_loop' },
    ],
  },

  software: {
    id: 'software',
    name: '💻 软件工程研发图谱',
    description: '架构规划 → 核心开发 → 独立审查与自动返工闭环（支持共享工作空间落盘代码）',
    nodes: [
      {
        id: 'n_trigger',
        type: 'trigger',
        title: '产品需求与验收标准',
        roleTag: 'Project Input',
        goal: '在共享工作空间中编写一个零依赖的 Python 脚本 file_stats.py，用于统计目录内各扩展名文件数和体积并输出 Markdown 表格，附带 verify.py 自测脚本。',
        x: 60,
        y: 205,
      },
      {
        id: 'n_plan',
        type: 'agent',
        title: '架构与方案规划师',
        roleTag: 'Architect & Planner',
        preferredSlot: 0,
        modelOverride: '',
        systemPrompt: '你是资深系统架构师。将需求转化为清晰的模块设计、文件目录结构、函数签名与边界条件清单。',
        x: 475,
        y: 205,
      },
      {
        id: 'n_dev',
        type: 'agent',
        title: '核心开发工程师',
        roleTag: 'Developer',
        preferredSlot: 1,
        modelOverride: '',
        systemPrompt:
          '你是核心开发工程师。严格按照上游架构方案在共享工作空间中编写完整、可运行的代码与自测脚本，并汇报文件清单与运行验证结果。',
        x: 890,
        y: 205,
      },
      {
        id: 'n_rev',
        type: 'agent',
        title: '独立代码审查员',
        roleTag: 'Code Reviewer',
        preferredSlot: 2,
        modelOverride: '',
        systemPrompt:
          '你是独立代码审查员。检查共享工作空间中的真实代码文件与边界处理、安全性、可读性。最后一行明确给出 VERDICT: PASS 或 VERDICT: REVISE。',
        x: 1305,
        y: 205,
      },
    ],
    edges: [
      { id: 'e1', from: 'n_trigger', to: 'n_plan', label: '需求交接', type: 'flow' },
      { id: 'e2', from: 'n_plan', to: 'n_dev', label: '方案下发', type: 'flow' },
      { id: 'e3', from: 'n_dev', to: 'n_rev', label: '提交审查', type: 'flow' },
      { id: 'e4', from: 'n_rev', to: 'n_dev', label: '打回返工', type: 'review_loop' },
    ],
  },

  debate: {
    id: 'debate',
    name: '⚔️ 红蓝多智能体辩论会',
    description: '并行正反方深度对抗推演，最终由中立裁决官提炼高置信度决策共识',
    nodes: [
      {
        id: 'n_trigger',
        type: 'trigger',
        title: '辩论议题 / 决策问题',
        roleTag: 'Proposition',
        goal: '在个人科研与独立开发场景下，“本地多智能体画布编排”相比“单一全能大模型长对话”，是否具备长期不可替代的工程价值？',
        x: 60,
        y: 205,
      },
      {
        id: 'n_pro',
        type: 'agent',
        title: '正方论证专家',
        roleTag: 'Proponent',
        preferredSlot: 0,
        modelOverride: '',
        systemPrompt: '你是正方首席辩手。请从认知分工、去幻觉机制、异构模型互补等维度给出最有力的论据与案例。',
        x: 475,
        y: 70,
      },
      {
        id: 'n_con',
        type: 'agent',
        title: '反方批判专家',
        roleTag: 'Red-Team Critic',
        preferredSlot: 1,
        modelOverride: '',
        systemPrompt: '你是反方红队批判专家。请尖锐指出多智能体编排的上下文损耗、延迟叠加与复杂度风险。',
        x: 475,
        y: 340,
      },
      {
        id: 'n_judge',
        type: 'agent',
        title: '综合裁决与共识官',
        roleTag: 'Consensus Judge',
        preferredSlot: 2,
        modelOverride: '',
        systemPrompt: '你是中立裁决官。分别评估正反双方论点质量，指出各自成立的前提条件，并给出务实的最佳实践建议。',
        x: 890,
        y: 205,
      },
    ],
    edges: [
      { id: 'e1', from: 'n_trigger', to: 'n_pro', label: '正方立论', type: 'flow' },
      { id: 'e2', from: 'n_trigger', to: 'n_con', label: '反方质询', type: 'flow' },
      { id: 'e3', from: 'n_pro', to: 'n_judge', label: '正方陈词', type: 'flow' },
      { id: 'e4', from: 'n_con', to: 'n_judge', label: '反方陈词', type: 'flow' },
    ],
  },

  blank: {
    id: 'blank',
    name: '🌸 空白自由画布',
    description: '从零开始自由拖拽实体节点、建立任意连接关系',
    nodes: [
      {
        id: 'n_trigger',
        type: 'trigger',
        title: '任务 / 课题输入源',
        roleTag: 'Input',
        goal: '在此输入你的任意目标：科研问题、软件需求、创意策划或数据分析任务...',
        x: 100,
        y: 210,
      },
      {
        id: 'n_agent_1',
        type: 'agent',
        title: '协作智能体 #1',
        roleTag: 'Specialist',
        preferredSlot: 0,
        modelOverride: '',
        systemPrompt: '请围绕输入目标给出清晰、结构化、高质量的专业分析与产出。',
        x: 520,
        y: 210,
      },
    ],
    edges: [{ id: 'e1', from: 'n_trigger', to: 'n_agent_1', label: '任务输入', type: 'flow' }],
  },
};

function bindTemplateToAvailableAgents(tpl, agents) {
  const usable = agents.filter((a) => a.headlessSupported && a.installed && a.id !== 'simulator');
  const pool = usable.length > 0 ? usable : agents.filter((a) => a.id === 'simulator');
  const clone = structuredClone(tpl);
  clone.nodes.forEach((n, idx) => {
    if (n.type === 'agent') {
      const slot = typeof n.preferredSlot === 'number' ? n.preferredSlot : idx;
      n.agentId = pool[slot % pool.length]?.id || 'simulator';
      delete n.preferredSlot;
    }
  });
  return clone;
}

// ---------------------------------------------------------------------------
// State & Startup Reconciliation
// ---------------------------------------------------------------------------
let remoteAgents = readJson(REMOTE_AGENTS_FILE, []);
let sshHosts = readJson(SSH_HOSTS_FILE, []);
let savedProfiles = readJson(PROFILES_FILE, {});
let envOverrides = readJson(ENV_FILE, {});
let runsState = readJson(RUNS_FILE, []);
let blackboardsState = readJson(BLACKBOARDS_FILE, []);
let cachedAgents = [];
let currentGraph = null;

function saveBlackboards() {
  writeJson(BLACKBOARDS_FILE, blackboardsState.slice(0, 15));
}

const activeChildren = new Map();
const activeAborts = new Map();
const sseClients = new Set();

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

function saveRuns() {
  const trimmed = runsState.slice(0, 15).map((r) => ({
    ...r,
    nodeStates: Object.fromEntries(
      Object.entries(r.nodeStates || {}).map(([k, v]) => [
        k,
        {
          ...v,
          stdout: (v.stdout || '').slice(-12000),
          stderr: (v.stderr || '').slice(-6000),
          output: (v.output || '').slice(0, 15000),
        },
      ])
    ),
  }));
  writeJson(RUNS_FILE, trimmed);
}

(function reconcileStaleRuns() {
  let dirty = false;
  for (const run of runsState) {
    if (run.status === 'running') {
      run.status = 'interrupted';
      run.interruptedAt = new Date().toISOString();
      for (const st of Object.values(run.nodeStates || {})) {
        if (st.status === 'running') st.status = 'interrupted';
      }
      dirty = true;
    }
  }
  if (dirty) saveRuns();
  let bbDirty = false;
  for (const bb of blackboardsState) {
    if (bb.status === 'running') {
      bb.status = 'interrupted';
      bb.phaseLabel = '⏸ 上次服务重启导致协商中断';
      bbDirty = true;
    }
  }
  if (bbDirty) saveBlackboards();
})();

function launchGraphRun({ title, goal, graph, customWorkspace = '', autoRevision = true, blackboardTranscript = null }) {
  const id = `sf-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  const workspaceDir = customWorkspace ? path.resolve(customWorkspace) : path.join(WORKSPACES_DIR, id);
  fs.mkdirSync(workspaceDir, { recursive: true });

  if (Array.isArray(blackboardTranscript) && blackboardTranscript.length > 0) {
    const md = [
      `# 🫧 SakuraFlow 圆桌黑板协商纪要 — ${title}`,
      ``,
      `## 用户原始目标`,
      goal,
      ``,
      `## 防死循环与收敛契约`,
      graph?.governance
        ? `- **分工共识**：${graph.governance.consensusRationale}\n- **终止条件**：${graph.governance.terminationRule}\n- **防死循环守卫**：${graph.governance.deadlockGuard}`
        : '',
      ``,
      `## 完整圆桌发言记录`,
      ...blackboardTranscript.map((t) => `### ${t.roleLabel} · ${t.agentName}\n\n${t.text}\n`),
    ].join('\n');
    fs.writeFileSync(path.join(workspaceDir, 'BLACKBOARD_ROUNDTABLE.md'), md, 'utf8');
  }

  const run = {
    id,
    title: (title || '自由画布协作').trim(),
    goal,
    workspaceDir,
    autoRevision,
    status: 'running',
    createdAt: new Date().toISOString(),
    graph: structuredClone(graph),
    nodeStates: {},
    messagePool: [],
    deliverables: null,
  };

  runsState.unshift(run);
  saveRuns();
  broadcast('run_created', run);
  runCanvasGraph({
    run,
    isResume: false,
    getAgents: () => cachedAgents,
    envOverrides,
    activeChildren,
    activeAborts,
    saveRuns,
    broadcast,
  }).catch(console.error);
  return run;
}

async function refreshAgents() {
  cachedAgents = await discoverAllAgents({ dataDir: DATA_DIR, remoteAgents, sshHosts, savedProfiles });
  return cachedAgents;
}

// ---------------------------------------------------------------------------
// HTTP Server & REST API
// ---------------------------------------------------------------------------
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 5_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // Environment Discovery & Agents List
    if (req.method === 'GET' && pathname === '/api/agents') {
      if (url.searchParams.get('refresh') === '1' || cachedAgents.length === 0) {
        await refreshAgents();
      }
      const clientAgents = sanitizeAgentsForClient(cachedAgents);
      return sendJson(res, 200, {
        platform: process.platform,
        agents: clientAgents,
        envKeys: Object.keys(envOverrides),
        summary: {
          localInstalled: clientAgents.filter((a) => a.mode === 'local_cli' && a.installed).length,
          remoteConfigured: clientAgents.filter((a) => a.mode === 'remote_api').length,
          verifiedCount: clientAgents.filter((a) => a.profileStatus === 'verified' && a.id !== 'simulator').length,
        },
      });
    }

    // User-Authorized Live Self-Profiling for a single agent
    if (req.method === 'POST' && pathname === '/api/agents/profile') {
      const { agentId } = await readBody(req);
      const agent = cachedAgents.find((a) => a.id === agentId);
      if (!agent) return sendJson(res, 404, { error: 'Agent not found' });
      const pingDir = path.join(DATA_DIR, 'ping_sandbox');
      fs.mkdirSync(pingDir, { recursive: true });
      const profile = await profileAgentLive({ agent, cwd: pingDir, envOverrides });
      savedProfiles[agentId] = profile;
      writeJson(PROFILES_FILE, savedProfiles);
      await refreshAgents();
      return sendJson(res, 200, { agentId, profile, agents: sanitizeAgentsForClient(cachedAgents) });
    }

    // Batch Authorized Profiling for all installed/configured agents
    if (req.method === 'POST' && pathname === '/api/agents/profile-all') {
      const pingDir = path.join(DATA_DIR, 'ping_sandbox');
      fs.mkdirSync(pingDir, { recursive: true });
      const targets = cachedAgents.filter((a) => a.installed && a.headlessSupported && a.id !== 'simulator');
      const results = await Promise.all(
        targets.map(async (agent) => {
          const profile = await profileAgentLive({ agent, cwd: pingDir, envOverrides });
          savedProfiles[agent.id] = profile;
          return { agentId: agent.id, ok: profile.ok };
        })
      );
      writeJson(PROFILES_FILE, savedProfiles);
      await refreshAgents();
      return sendJson(res, 200, { results, agents: sanitizeAgentsForClient(cachedAgents) });
    }

    // Ping check
    if (req.method === 'POST' && pathname === '/api/agents/ping') {
      const { agentId, modelOverride } = await readBody(req);
      const agent = cachedAgents.find((a) => a.id === agentId);
      if (!agent) return sendJson(res, 404, { error: 'Agent not found' });
      const pingDir = path.join(DATA_DIR, 'ping_sandbox');
      fs.mkdirSync(pingDir, { recursive: true });
      const result = await executeAgent({
        agent,
        prompt: `Reply with exactly: OK_${agent.id.toUpperCase()}`,
        cwd: pingDir,
        modelOverride: modelOverride || '',
        envOverrides,
        idleTimeoutMs: 35000,
        maxTimeoutMs: 45000,
      });
      return sendJson(res, 200, { agentId, ...result });
    }

    // Remote API Agent Management (Base URL + API Key + Model ID)
    if (req.method === 'POST' && pathname === '/api/remote-agents') {
      const body = await readBody(req);
      if (!body.name || !body.baseUrl || !body.model || !body.apiKey) {
        return sendJson(res, 400, { error: '请填写完整的名称、Base URL、Model ID 与 API Key' });
      }
      const rec = createRemoteAgentRecord(body);
      const existingIdx = remoteAgents.findIndex((r) => r.id === rec.id);
      if (existingIdx >= 0) remoteAgents[existingIdx] = rec;
      else remoteAgents.push(rec);
      writeJson(REMOTE_AGENTS_FILE, remoteAgents);
      await refreshAgents();
      return sendJson(res, 201, { ok: true, id: rec.id, agents: sanitizeAgentsForClient(cachedAgents) });
    }

    const delRemoteMatch = pathname.match(/^\/api\/remote-agents\/([^/]+)$/);
    if (req.method === 'DELETE' && delRemoteMatch) {
      const id = delRemoteMatch[1];
      remoteAgents = remoteAgents.filter((r) => r.id !== id);
      delete savedProfiles[id];
      writeJson(REMOTE_AGENTS_FILE, remoteAgents);
      writeJson(PROFILES_FILE, savedProfiles);
      await refreshAgents();
      return sendJson(res, 200, { ok: true, agents: sanitizeAgentsForClient(cachedAgents) });
    }

    // SSH Remote Compute / GPU Host Management
    if (req.method === 'POST' && pathname === '/api/ssh-hosts') {
      const body = await readBody(req);
      if (!body.name || !body.host || !body.username) {
        return sendJson(res, 400, { error: '请填写完整的 SSH 服务器名称、Host/IP 与用户名' });
      }
      const rec = createSshHostRecord(body);
      const idx = sshHosts.findIndex((s) => s.id === rec.id);
      if (idx >= 0) sshHosts[idx] = rec;
      else sshHosts.push(rec);
      writeJson(SSH_HOSTS_FILE, sshHosts);
      await refreshAgents();
      return sendJson(res, 201, { ok: true, id: rec.id, host: rec, agents: sanitizeAgentsForClient(cachedAgents) });
    }

    const probeSshMatch = pathname.match(/^\/api\/ssh-hosts\/([^/]+)\/probe$/);
    if (req.method === 'POST' && probeSshMatch) {
      const hostRec = sshHosts.find((s) => s.id === probeSshMatch[1]);
      if (!hostRec) return sendJson(res, 404, { error: 'SSH 服务器不存在' });
      const probe = await probeSshHost(hostRec);
      if (probe.ok) {
        hostRec.gpuSummary = `${probe.gpuSummary} · ${probe.pythonInfo || probe.osInfo}`;
        writeJson(SSH_HOSTS_FILE, sshHosts);
        savedProfiles[hostRec.id] = {
          ok: true,
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          latencyMs: probe.durationMs,
          reportedModel: hostRec.gpuSummary,
          scores: { planning: 75, coding: 94, research: 96, review: 82, speed: 95, tooling: 98 },
          bestDomains: ['远程 GPU 模型训练', '大规模仿真与数值实验', 'Linux 科研环境执行'],
          summary: `SSH 连通正常 (${probe.osInfo})，检测到算力：${probe.gpuSummary}。`,
          watchouts: `远端工作目录: ${hostRec.remoteWorkdir} | 执行器: ${hostRec.runnerTemplate}`,
        };
        writeJson(PROFILES_FILE, savedProfiles);
        await refreshAgents();
      }
      return sendJson(res, 200, { ...probe, agents: sanitizeAgentsForClient(cachedAgents) });
    }

    const delSshMatch = pathname.match(/^\/api\/ssh-hosts\/([^/]+)$/);
    if (req.method === 'DELETE' && delSshMatch) {
      const id = delSshMatch[1];
      sshHosts = sshHosts.filter((s) => s.id !== id);
      delete savedProfiles[id];
      writeJson(SSH_HOSTS_FILE, sshHosts);
      writeJson(PROFILES_FILE, savedProfiles);
      await refreshAgents();
      return sendJson(res, 200, { ok: true, agents: sanitizeAgentsForClient(cachedAgents) });
    }

    // Env Overrides
    if (req.method === 'POST' && pathname === '/api/env') {
      const { key, value } = await readBody(req);
      if (typeof key === 'string' && key.trim()) {
        if (value) envOverrides[key.trim()] = String(value);
        else delete envOverrides[key.trim()];
        writeJson(ENV_FILE, envOverrides);
      }
      return sendJson(res, 200, { ok: true, envKeys: Object.keys(envOverrides) });
    }

    // Templates (Auto-bound to User's Available Agents!)
    if (req.method === 'GET' && pathname === '/api/templates') {
      const bound = Object.fromEntries(
        Object.entries(BASE_TEMPLATES).map(([k, tpl]) => [k, bindTemplateToAvailableAgents(tpl, cachedAgents)])
      );
      return sendJson(res, 200, bound);
    }

    if (req.method === 'GET' && pathname === '/api/graph') {
      return sendJson(res, 200, currentGraph);
    }

    if (req.method === 'PUT' && pathname === '/api/graph') {
      const next = await readBody(req);
      if (next && Array.isArray(next.nodes) && Array.isArray(next.edges)) {
        currentGraph = next;
        writeJson(GRAPH_FILE, currentGraph);
        return sendJson(res, 200, currentGraph);
      }
      return sendJson(res, 400, { error: 'Invalid graph' });
    }

    // Blackboard Autonomous Roundtable API
    if (req.method === 'GET' && pathname === '/api/blackboard') {
      const usable = cachedAgents.filter((a) => a.installed && a.headlessSupported && a.id !== 'simulator');
      const defaultChairAgentId = usable[0]?.id || 'simulator';
      return sendJson(res, 200, {
        defaultChairAgentId,
        sessions: blackboardsState,
      });
    }

    if (req.method === 'POST' && pathname === '/api/blackboard/start') {
      const body = await readBody(req);
      const goal = String(body.goal || '').trim();
      if (!goal) return sendJson(res, 400, { error: '请输入你想让智能体团队自主协商的任务目标' });

      const usable = cachedAgents.filter((a) => a.installed && a.headlessSupported && a.id !== 'simulator');
      const fallbackId = usable[0]?.id || 'simulator';
      const chairAgentId = body.chairAgentId || fallbackId;
      const participantAgentIds =
        Array.isArray(body.participantAgentIds) && body.participantAgentIds.length > 0
          ? body.participantAgentIds
          : usable.length > 0
          ? usable.map((a) => a.id)
          : ['simulator'];

      const session = {
        id: `bb-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
        title: String(body.title || goal.slice(0, 20)).trim(),
        goal,
        chairAgentId,
        participantAgentIds,
        autoExecute: Boolean(body.autoExecute),
        status: 'running',
        phase: 'intent',
        phaseLabel: '① 正在启动总意图解析智能体...',
        createdAt: new Date().toISOString(),
        intentBrief: '',
        transcript: [],
        generatedGraph: null,
        governance: null,
        launchedRunId: null,
      };

      blackboardsState.unshift(session);
      saveBlackboards();
      broadcast('bb_started', session);

      runBlackboardRoundtable({
        session,
        getAgents: () => cachedAgents,
        envOverrides,
        dataDir: DATA_DIR,
        activeChildren,
        activeAborts,
        saveSessions: saveBlackboards,
        broadcast,
        onGraphReady: async (doneSession, graph) => {
          currentGraph = graph;
          writeJson(GRAPH_FILE, currentGraph);
          if (doneSession.autoExecute) {
            const run = launchGraphRun({
              title: doneSession.title,
              goal: doneSession.goal,
              graph,
              autoRevision: true,
              blackboardTranscript: doneSession.transcript,
            });
            doneSession.launchedRunId = run.id;
            saveBlackboards();
            broadcast('bb_run_launched', { sessionId: doneSession.id, run });
          }
        },
      }).catch(console.error);

      return sendJson(res, 201, session);
    }

    const bbApplyMatch = pathname.match(/^\/api\/blackboard\/([^/]+)\/apply$/);
    if (req.method === 'POST' && bbApplyMatch) {
      const session = blackboardsState.find((b) => b.id === bbApplyMatch[1]);
      if (!session || !session.generatedGraph) return sendJson(res, 404, { error: '未找到已生成的圆桌协作画布' });
      const body = await readBody(req);
      currentGraph = structuredClone(session.generatedGraph);
      writeJson(GRAPH_FILE, currentGraph);
      let run = null;
      if (body.execute) {
        run = launchGraphRun({
          title: session.title,
          goal: session.goal,
          graph: currentGraph,
          autoRevision: true,
          blackboardTranscript: session.transcript,
        });
        session.launchedRunId = run.id;
        saveBlackboards();
      }
      return sendJson(res, 200, { ok: true, graph: currentGraph, run });
    }

    const bbAbortMatch = pathname.match(/^\/api\/blackboard\/([^/]+)\/abort$/);
    if (req.method === 'POST' && bbAbortMatch) {
      const session = blackboardsState.find((b) => b.id === bbAbortMatch[1]);
      if (!session) return sendJson(res, 404, { error: 'Session not found' });
      session.status = 'aborted';
      session.phaseLabel = '⏹ 圆桌协商已由用户中止';
      const set = activeChildren.get(session.id);
      if (set) for (const child of set) killProcessTree(child);
      const aborts = activeAborts.get(session.id);
      if (aborts) for (const ctrl of aborts) try { ctrl.abort(); } catch {}
      saveBlackboards();
      broadcast('bb_failed', { sessionId: session.id, error: '已中止' });
      return sendJson(res, 200, { ok: true });
    }

    // Runs CRUD + Deliverables + Resume + Abort
    if (req.method === 'GET' && pathname === '/api/runs') {
      let dirty = false;
      for (const r of runsState) {
        if (r.status === 'running' && !activeChildren.has(r.id)) {
          r.status = 'interrupted';
          for (const st of Object.values(r.nodeStates || {})) {
            if (st.status === 'running') st.status = 'interrupted';
          }
          dirty = true;
        }
        if (!r.deliverables && fs.existsSync(r.workspaceDir)) {
          r.deliverables = buildDeliverablesManifest(r, cachedAgents);
          dirty = true;
        }
      }
      if (dirty) saveRuns();
      return sendJson(res, 200, runsState);
    }

    if (req.method === 'POST' && pathname === '/api/runs') {
      const body = await readBody(req);
      const graph = body.graph || currentGraph;
      const trigger = graph.nodes.find((n) => n.type === 'trigger');
      const goal = (body.goal || trigger?.goal || '').trim();
      if (!goal) return sendJson(res, 400, { error: '请先在输入源节点填写任务或研究目标' });

      // Robustness check: ensure all agent nodes point to installed/runnable agents
      const missing = graph.nodes
        .filter((n) => n.type === 'agent')
        .filter((n) => {
          const ag = cachedAgents.find((a) => a.id === n.agentId);
          return !ag || !ag.installed || !ag.headlessSupported;
        });
      if (missing.length > 0) {
        return sendJson(res, 400, {
          error: `节点 ${missing.map((m) => `「${m.title}」`).join('、')} 绑定的智能体当前不可用，请切换到已探测的本地智能体或已配置的远程 API 模型。`,
        });
      }

      const run = launchGraphRun({
        title: (body.title || trigger?.title || graph.name || '自由画布协作').trim(),
        goal,
        graph,
        customWorkspace: body.customWorkspace || '',
        autoRevision: body.autoRevision !== false,
      });
      return sendJson(res, 201, run);
    }

    const delivMatch = pathname.match(/^\/api\/runs\/([^/]+)\/deliverables$/);
    if (req.method === 'GET' && delivMatch) {
      const run = runsState.find((r) => r.id === delivMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run not found' });
      run.deliverables = buildDeliverablesManifest(run, cachedAgents);
      saveRuns();
      return sendJson(res, 200, run.deliverables);
    }

    const resumeMatch = pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
    if (req.method === 'POST' && resumeMatch) {
      const run = runsState.find((r) => r.id === resumeMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run not found' });
      if (activeChildren.has(run.id)) return sendJson(res, 409, { error: '该会话当前仍在运行中' });
      run.status = 'running';
      saveRuns();
      broadcast('run_updated', run);
      runCanvasGraph({
        run,
        isResume: true,
        getAgents: () => cachedAgents,
        envOverrides,
        activeChildren,
        activeAborts,
        saveRuns,
        broadcast,
      }).catch(console.error);
      return sendJson(res, 200, run);
    }

    const abortMatch = pathname.match(/^\/api\/runs\/([^/]+)\/abort$/);
    if (req.method === 'POST' && abortMatch) {
      const run = runsState.find((r) => r.id === abortMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run not found' });
      run.status = 'aborted';
      const set = activeChildren.get(run.id);
      if (set) for (const child of set) killProcessTree(child);
      const aborts = activeAborts.get(run.id);
      if (aborts) for (const ctrl of aborts) try { ctrl.abort(); } catch {}
      saveRuns();
      broadcast('run_updated', run);
      return sendJson(res, 200, { ok: true });
    }

    const filesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/files$/);
    if (req.method === 'GET' && filesMatch) {
      const run = runsState.find((r) => r.id === filesMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run not found' });
      return sendJson(res, 200, { workspaceDir: run.workspaceDir, files: listWorkspaceFiles(run.workspaceDir) });
    }

    const readFileMatch = pathname.match(/^\/api\/runs\/([^/]+)\/file$/);
    if (req.method === 'GET' && readFileMatch) {
      const run = runsState.find((r) => r.id === readFileMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run not found' });
      const rel = url.searchParams.get('path') || '';
      const target = path.resolve(run.workspaceDir, rel);
      if (!target.startsWith(path.resolve(run.workspaceDir))) return sendJson(res, 403, { error: 'Forbidden' });
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return sendJson(res, 404, { error: 'Not found' });
      return sendJson(res, 200, { path: rel, content: fs.readFileSync(target, 'utf8').slice(0, 120000) });
    }

    const downloadMatch = pathname.match(/^\/api\/runs\/([^/]+)\/download$/);
    if (req.method === 'GET' && downloadMatch) {
      const run = runsState.find((r) => r.id === downloadMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run not found' });
      const dir = path.resolve(run.workspaceDir);
      if (!fs.existsSync(dir)) return sendJson(res, 404, { error: 'Workspace not found' });
      const zipBuf = buildZipBufferFromDir(dir);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="SakuraFlow-${run.id}.zip"`,
        'Content-Length': zipBuf.length,
        'Cache-Control': 'no-store',
      });
      return res.end(zipBuf);
    }

    const openMatch = pathname.match(/^\/api\/runs\/([^/]+)\/open$/);
    if (req.method === 'POST' && openMatch) {
      const run = runsState.find((r) => r.id === openMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run not found' });
      const dir = path.resolve(run.workspaceDir);
      if (!fs.existsSync(dir)) return sendJson(res, 404, { error: `目录不存在: ${dir}` });

      await new Promise((resolve, reject) => {
        if (process.platform === 'win32') {
          const safeDir = dir.replace(/'/g, "''");
          execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `(New-Object -ComObject Shell.Application).Open('${safeDir}')`],
            { timeout: 8000, windowsHide: true },
            (err) => (err ? reject(err) : resolve())
          );
        } else {
          const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
          execFile(opener, [dir], { timeout: 8000 }, (err) => (err ? reject(err) : resolve()));
        }
      });
      return sendJson(res, 200, { ok: true, workspaceDir: dir });
    }

    // Static assets (always no-store so UI stays in sync)
    const safeRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, safeRel);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

(async () => {
  await refreshAgents();
  currentGraph = readJson(GRAPH_FILE, bindTemplateToAvailableAgents(BASE_TEMPLATES.research, cachedAgents));
  // Ensure any saved graph referencing missing agents gracefully stays editable
  server.listen(PORT, '127.0.0.1', () => {
    const localIds = cachedAgents.filter((a) => a.mode === 'local_cli' && a.installed).map((a) => a.id);
    const remoteIds = cachedAgents.filter((a) => a.mode === 'remote_api').map((a) => a.name);
    console.log(`\n🌸 ============================================================ 🌸`);
    console.log(`   SakuraFlow Studio v1.0 — 开源通用多智能体协作画布平台`);
    console.log(`   访问地址: http://127.0.0.1:${PORT}`);
    console.log(`   本机探测 CLI: ${localIds.length ? localIds.join(', ') : '(无 — 可接入远程 API Key)'}`);
    console.log(`   远程 API 模型: ${remoteIds.length ? remoteIds.join(', ') : '(尚未配置)'}`);
    console.log(`🌸 ============================================================ 🌸\n`);
  });
})();
