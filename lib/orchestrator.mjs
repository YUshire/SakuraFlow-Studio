import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { executeAgent } from './runners.mjs';

const MAX_LOG_CHARS = 35000;

function appendCapped(cur, chunk) {
  const next = (cur || '') + chunk;
  return next.length > MAX_LOG_CHARS
    ? '...(earlier output truncated; see artifacts file)...\n' + next.slice(-MAX_LOG_CHARS)
    : next;
}

export function listWorkspaceFiles(dir, base = '') {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name === '.git') continue;
    const rel = base ? `${base}/${item.name}` : item.name;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push({ path: rel, type: 'dir' });
      if (results.length < 240) results.push(...listWorkspaceFiles(full, rel));
    } else {
      const stat = fs.statSync(full);
      results.push({ path: rel, type: 'file', size: stat.size, mtime: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs });
    }
  }
  return results;
}

function snapshotWorkspace(dir) {
  const map = new Map();
  for (const f of listWorkspaceFiles(dir)) {
    if (f.type === 'file') map.set(f.path, `${f.size}:${Math.floor(f.mtimeMs)}`);
  }
  return map;
}

function extractSummaryExcerpt(md = '') {
  const cleaned = String(md)
    .replace(/^#+\s*/gm, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^---+$/.test(l) && !/^VERDICT:/i.test(l));
  return cleaned.slice(0, 4).join(' ').slice(0, 260) || '已完成交付，点击查看全文。';
}

// ---------------------------------------------------------------------------
// Structured Deliverables Builder (Answers: "What are the MOST IMPORTANT outputs?")
// ---------------------------------------------------------------------------
export function buildDeliverablesManifest(run, agents) {
  const flowEdges = run.graph.edges.filter((e) => e.type !== 'review_loop');
  const agentNodes = run.graph.nodes.filter((n) => n.type === 'agent');
  const outDegree = new Map(agentNodes.map((n) => [n.id, 0]));
  for (const e of flowEdges) {
    if (outDegree.has(e.from)) outDegree.set(e.from, outDegree.get(e.from) + 1);
  }

  // Terminal / sink nodes = highest-level final deliverable producers
  const terminalIds = new Set(agentNodes.filter((n) => (outDegree.get(n.id) || 0) === 0).map((n) => n.id));

  const nodeDeliverables = agentNodes
    .map((n) => {
      const st = run.nodeStates?.[n.id];
      if (!st || st.status !== 'completed') return null;
      const ag = agents.find((a) => a.id === n.agentId);
      const verdictMatch = (st.output || '').match(/VERDICT:\s*(PASS|REVISE)/i);
      return {
        nodeId: n.id,
        nodeTitle: n.title,
        roleTag: n.roleTag || '',
        agentName: ag?.name || n.agentId,
        agentMode: ag?.mode || 'local_cli',
        isPrimary: terminalIds.has(n.id),
        durationMs: st.durationMs || 0,
        artifactFile: st.artifactFile || null,
        workspaceFiles: Array.isArray(st.touchedFiles) ? st.touchedFiles : [],
        verdict: verdictMatch ? verdictMatch[1].toUpperCase() : null,
        excerpt: extractSummaryExcerpt(st.output),
        fullPreview: (st.output || '').slice(0, 8000),
      };
    })
    .filter(Boolean);

  // Determine the single most important final deliverable
  let primary = nodeDeliverables.find((d) => d.isPrimary) || nodeDeliverables[nodeDeliverables.length - 1] || null;
  if (primary) primary.isPrimary = true;

  const sharedFiles = listWorkspaceFiles(path.join(run.workspaceDir, 'shared_workspace'))
    .filter((f) => f.type === 'file')
    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0))
    .map((f) => ({ path: `shared_workspace/${f.path}`, name: f.path, size: f.size, mtime: f.mtime }));

  const manifest = {
    generatedAt: new Date().toISOString(),
    workspaceDir: run.workspaceDir,
    primary,
    nodeDeliverables,
    keyWorkspaceFiles: sharedFiles.slice(0, 12),
  };

  // Persist human-readable DELIVERABLES_INDEX.md in workspace root
  try {
    const mdLines = [
      `# 🌸 SakuraFlow 协作成果总览 — ${run.title}`,
      ``,
      `- **运行 ID**：\`${run.id}\``,
      `- **最终状态**：\`${run.status}\``,
      `- **共享工作空间**：\`${run.workspaceDir}\``,
      ``,
      `## 🏆 最关键最终产物`,
      primary
        ? `- **产出实体**：${primary.nodeTitle} (${primary.agentName})\n- **主报告文件**：\`${primary.artifactFile}\`\n- **核心摘要**：${primary.excerpt}`
        : '- 尚未产生最终节点交付物。',
      ``,
      `## 📋 各协作实体产物清单`,
      ...nodeDeliverables.map(
        (d) =>
          `- **${d.nodeTitle}** (${d.agentName}) → 报告 \`${d.artifactFile}\`${
            d.workspaceFiles.length ? ` ｜ 写入工作空间文件：${d.workspaceFiles.map((f) => `\`${f}\``).join(', ')}` : ''
          }`
      ),
      ``,
      `## 📁 共享工作空间生成文件`,
      ...(sharedFiles.length
        ? sharedFiles.map((f) => `- \`${f.path}\` (${(f.size / 1024).toFixed(1)} KB)`)
        : ['- (无额外写入文件，全部交付物在 artifacts/ 目录)']),
    ];
    fs.writeFileSync(path.join(run.workspaceDir, 'DELIVERABLES_INDEX.md'), mdLines.join('\n') + '\n', 'utf8');
  } catch {}

  return manifest;
}

// ---------------------------------------------------------------------------
// Parallel DAG + Review-Loop Orchestrator
// ---------------------------------------------------------------------------
function buildNodePrompt(run, node, upstreamEdges, extraFeedback = '', sshHosts = []) {
  const sharedCodeDir = path.join(run.workspaceDir, 'shared_workspace');
  const existingFiles = listWorkspaceFiles(sharedCodeDir)
    .filter((f) => f.type === 'file')
    .map((f) => `- ${f.path} (${f.size} B)`)
    .join('\n');

  const sshSection =
    Array.isArray(sshHosts) && sshHosts.length > 0
      ? [
          `## 可調用的远程 SSH 服务器 / GPU 算力节点`,
          ...sshHosts.map(
            (s) =>
              `- **${s.name}**: \`ssh -p ${s.port || 22} ${s.identityFile ? `-i "${s.identityFile}" ` : ''}${s.username}@${s.host}\` (远端目录: \`${
                s.remoteWorkdir || '~/sakuraflow_workspace'
              }\` | 算力/环境: ${s.gpuSummary || s.runnerTemplate || 'Linux'})`
          ),
        ].join('\n')
      : '';

  const triggerNode = run.graph.nodes.find((n) => n.type === 'trigger');
  const upstreamSections = upstreamEdges
    .map((e) => {
      const srcNode = run.graph.nodes.find((n) => n.id === e.from);
      if (!srcNode) return '';
      if (srcNode.type === 'trigger') {
        return `### [输入源: ${srcNode.title} | 关系: ${e.label || '任务输入'}]\n${srcNode.goal || run.goal}`;
      }
      const st = run.nodeStates[srcNode.id];
      if (!st?.output) return '';
      return `### [上游实体: ${srcNode.title} (${srcNode.agentId}) | 关系: ${e.label || '流转'}]\n${st.output.slice(0, 6000)}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  return [
    `# SakuraFlow 多智能体画布协作指令`,
    `## 你的实体身份: ${node.title} (${node.roleTag || 'Agent'})`,
    `${node.systemPrompt || '请高质量完成本节点职责。'}`,
    ``,
    `## 初始总目标 (${triggerNode?.title || '输入源'})`,
    `${run.goal}`,
    ``,
    upstreamSections ? `## 来自上游连线的共享上下文\n${upstreamSections}` : '',
    extraFeedback ? `## 审稿/审查打回反馈 (请重点修订)\n${extraFeedback}` : '',
    ``,
    `## 共享工作空间`,
    `目录路径: ${sharedCodeDir}`,
    `当前文件:\n${existingFiles || '(空目录)'}`,
    sshSection ? `\n${sshSection}` : '',
    ``,
    `## 协作与交付规范`,
    `- 请在开头用 2-3 句话给出清晰的核心结论摘要，再展开详细内容（Markdown 格式）。`,
    `- 若你有本地文件读写能力且任务需要代码/文档落盘，请写入共享工作空间 (${sharedCodeDir}) 并在汇报中列出你创建的文件名。`,
    `- 若你是审查/评审实体，请在末尾注明 \`VERDICT: PASS\` 或 \`VERDICT: REVISE\`。`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runCanvasGraph({
  run,
  isResume = false,
  getAgents,
  envOverrides,
  activeChildren,
  activeAborts,
  saveRuns,
  broadcast,
}) {
  const childSet = new Set();
  const abortSet = new Set();
  activeChildren.set(run.id, childSet);
  activeAborts.set(run.id, abortSet);

  const sharedCodeDir = path.join(run.workspaceDir, 'shared_workspace');
  const artifactsDir = path.join(run.workspaceDir, 'artifacts');
  fs.mkdirSync(sharedCodeDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });

  const appendPoolMessage = (entry) => {
    const record = { id: crypto.randomUUID().slice(0, 8), timestamp: new Date().toISOString(), ...entry };
    run.messagePool.push(record);
    fs.appendFileSync(path.join(run.workspaceDir, 'message_pool.jsonl'), JSON.stringify(record) + '\n', 'utf8');
    broadcast('pool_message', { runId: run.id, record });
  };

  const flowEdges = run.graph.edges.filter((e) => e.type !== 'review_loop');
  const reviewEdges = run.graph.edges.filter((e) => e.type === 'review_loop');
  const completedSet = new Set();

  for (const n of run.graph.nodes) {
    if (n.type === 'trigger') {
      run.nodeStates[n.id] = { status: 'completed', output: run.goal, stdout: run.goal, stderr: '', durationMs: 0 };
      completedSet.add(n.id);
      broadcast('node_status', { runId: run.id, nodeId: n.id, state: run.nodeStates[n.id] });
    } else if (isResume && run.nodeStates[n.id]?.status === 'completed') {
      completedSet.add(n.id);
    } else {
      run.nodeStates[n.id] = { status: 'pending', output: '', stdout: '', stderr: '', durationMs: 0, touchedFiles: [] };
      broadcast('node_status', { runId: run.id, nodeId: n.id, state: run.nodeStates[n.id] });
    }
  }
  saveRuns();

  const agentNodes = run.graph.nodes.filter((n) => n.type === 'agent');
  const runningSet = new Set();
  const failedSet = new Set();
  let revisionRounds = 0;

  async function executeSingleNode(node, extraFeedback = '') {
    if (run.status === 'aborted') return;
    runningSet.add(node.id);
    const agents = getAgents();
    const agent = agents.find((a) => a.id === node.agentId) || agents.find((a) => a.id === 'simulator');

    const incomingFlow = flowEdges.filter((e) => e.to === node.id);
    incomingFlow.forEach((e) => broadcast('edge_pulse', { runId: run.id, edgeId: e.id, active: true }));

    const beforeSnap = snapshotWorkspace(sharedCodeDir);

    run.nodeStates[node.id] = {
      status: 'running',
      agentId: agent.id,
      stdout: '',
      stderr: '',
      output: '',
      touchedFiles: [],
      thinkingPreview: '正在连接智能体并开始思考...',
      startedAt: new Date().toISOString(),
    };
    saveRuns();
    broadcast('node_status', { runId: run.id, nodeId: node.id, state: run.nodeStates[node.id] });

    appendPoolMessage({
      from: 'canvas',
      to: node.title,
      agentId: agent.id,
      kind: 'dispatch',
      summary: `节点 [${node.title}] (${agent.name}) 已激活，开始流式思考与执行`,
    });

    const sshHosts = agents.filter((a) => a.mode === 'ssh_remote' && a.sshConfig).map((a) => a.sshConfig);
    const prompt = buildNodePrompt(run, node, incomingFlow, extraFeedback, sshHosts);
    let res;
    let pendingOut = '';
    let pendingErr = '';
    let flushTimer = null;

    const flushChunks = () => {
      flushTimer = null;
      if (!pendingOut && !pendingErr) return;
      const st = run.nodeStates[node.id];
      const activeText = st.stdout && st.stdout.trim() ? st.stdout : st.stderr;
      const lines = (activeText || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !/^-{3,}$/.test(l) && !/^\[claude-code:/.test(l));
      const preview = lines.slice(-2).join(' · ').slice(0, 140) || '正在深度思考中...';
      st.thinkingPreview = preview;
      broadcast('node_thinking', {
        runId: run.id,
        nodeId: node.id,
        stdoutChunk: pendingOut,
        stderrChunk: pendingErr,
        thinkingPreview: preview,
      });
      pendingOut = '';
      pendingErr = '';
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      res = await executeAgent({
        agent,
        prompt,
        systemPrompt: node.systemPrompt || '',
        cwd: sharedCodeDir,
        modelOverride: node.modelOverride || '',
        envOverrides,
        idleTimeoutMs: 360000,
        maxTimeoutMs: 1800000,
        childSet,
        abortSet,
        onChunk: (stream, chunk) => {
          const st = run.nodeStates[node.id];
          if (stream === 'stdout') {
            st.stdout = appendCapped(st.stdout, chunk);
            pendingOut += chunk;
          } else {
            st.stderr = appendCapped(st.stderr, chunk);
            pendingErr += chunk;
          }
          if (!flushTimer) flushTimer = setTimeout(flushChunks, 220);
        },
      });
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushChunks();
      }
      const transientErr = !res.ok && /EOF|ECONNRESET|connection reset|TLS|ETIMEDOUT/i.test(`${res.stderr}\n${res.stdout}`);
      if (!transientErr || run.status === 'aborted' || attempt === 2) break;
      run.nodeStates[node.id].thinkingPreview = `网络瞬断，正在自动重试 (${attempt}/2)...`;
      broadcast('node_status', { runId: run.id, nodeId: node.id, state: run.nodeStates[node.id] });
      await new Promise((r) => setTimeout(r, 1500));
    }

    incomingFlow.forEach((e) => broadcast('edge_pulse', { runId: run.id, edgeId: e.id, active: false }));
    runningSet.delete(node.id);

    if (run.status === 'aborted') {
      run.nodeStates[node.id].status = 'aborted';
      broadcast('node_status', { runId: run.id, nodeId: node.id, state: run.nodeStates[node.id] });
      return;
    }

    // Track exact files created or modified by THIS node inside shared_workspace/
    const afterSnap = snapshotWorkspace(sharedCodeDir);
    const touchedFiles = [];
    for (const [rel, sig] of afterSnap.entries()) {
      if (beforeSnap.get(rel) !== sig) touchedFiles.push(`shared_workspace/${rel}`);
    }

    const output = (res.stdout || '').trim() || (res.stderr || '').trim();
    const safeName = node.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const artifactRel = `artifacts/${safeName}.md`;
    fs.writeFileSync(
      path.join(run.workspaceDir, artifactRel),
      `# ${node.title} (${agent.name})\n\n- 耗时: ${(res.durationMs / 1000).toFixed(2)}s\n- 状态: ${res.ok ? 'PASS' : 'FAIL'}\n${
        touchedFiles.length ? `- 写入工作空间文件: ${touchedFiles.join(', ')}\n` : ''
      }\n---\n\n${output}\n`,
      'utf8'
    );

    run.nodeStates[node.id] = {
      ...run.nodeStates[node.id],
      status: res.ok ? 'completed' : 'failed',
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      output,
      touchedFiles,
      artifactFile: artifactRel,
      finishedAt: new Date().toISOString(),
    };
    run.deliverables = buildDeliverablesManifest(run, getAgents());
    saveRuns();
    broadcast('node_status', { runId: run.id, nodeId: node.id, state: run.nodeStates[node.id] });

    if (!res.ok) {
      failedSet.add(node.id);
      appendPoolMessage({
        from: node.title,
        to: 'canvas',
        agentId: agent.id,
        kind: 'error',
        summary: `节点 [${node.title}] 执行失败 (exit=${res.exitCode})`,
        detail: (res.stderr || output).slice(0, 500),
      });
      return;
    }

    completedSet.add(node.id);
    appendPoolMessage({
      from: node.title,
      to: 'shared_pool',
      nodeId: node.id,
      agentId: agent.id,
      kind: 'artifact',
      artifactFile: artifactRel,
      touchedFiles,
      summary: `节点 [${node.title}] 完成交付 -> ${artifactRel} (${(res.durationMs / 1000).toFixed(1)}s)${
        touchedFiles.length ? ` · 生成 ${touchedFiles.length} 个文件` : ''
      }`,
      detail: output.slice(0, 600),
      fullText: output.slice(0, 15000),
    });

    if (/VERDICT:\s*REVISE/i.test(output) && run.autoRevision && revisionRounds < 1) {
      const loopEdge = reviewEdges.find((e) => e.from === node.id);
      if (loopEdge) {
        const targetNode = agentNodes.find((n) => n.id === loopEdge.to);
        if (targetNode) {
          revisionRounds += 1;
          broadcast('edge_pulse', { runId: run.id, edgeId: loopEdge.id, active: true });
          appendPoolMessage({
            from: node.title,
            to: targetNode.title,
            agentId: agent.id,
            kind: 'revision',
            summary: `[${node.title}] 触发打回修订闭环 -> 返回 [${targetNode.title}] 修订并复审`,
          });
          await executeSingleNode(targetNode, output);
          broadcast('edge_pulse', { runId: run.id, edgeId: loopEdge.id, active: false });
          if (run.status !== 'aborted' && !failedSet.has(targetNode.id)) {
            await executeSingleNode(node);
          }
        }
      }
    }
  }

  while (run.status === 'running') {
    const readyNodes = agentNodes.filter((n) => {
      if (completedSet.has(n.id) || runningSet.has(n.id) || failedSet.has(n.id)) return false;
      const deps = flowEdges.filter((e) => e.to === n.id).map((e) => e.from);
      return deps.every((d) => completedSet.has(d));
    });
    if (readyNodes.length === 0) break;
    await Promise.all(readyNodes.map((n) => executeSingleNode(n)));
    saveRuns();
    if (failedSet.size > 0) break;
  }

  activeChildren.delete(run.id);
  activeAborts.delete(run.id);

  if (run.status !== 'aborted') {
    run.status = failedSet.size > 0 ? 'failed' : 'completed';
    run.finishedAt = new Date().toISOString();
    run.deliverables = buildDeliverablesManifest(run, getAgents());
    appendPoolMessage({
      from: 'orchestrator',
      to: 'all',
      agentId: 'system',
      kind: run.status === 'completed' ? 'done' : 'error',
      summary:
        run.status === 'completed'
          ? `🎉 全部协作完成！请点击右侧「🎁 最终成果」直接查看主交付结论与文件索引。`
          : `画布执行因部分节点失败而中止，可点击「⏩ 断点续跑」恢复。`,
    });
  }
  saveRuns();
  broadcast('run_updated', run);
}
