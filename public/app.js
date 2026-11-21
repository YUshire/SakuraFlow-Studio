const appState = {
  agents: [],
  envKeys: [],
  envSummary: { localInstalled: 0, remoteConfigured: 0, verifiedCount: 0 },
  templates: {},
  graph: { id: 'research', name: '', nodes: [], edges: [] },
  runs: [],
  activeRunId: null,
  blackboards: [],
  activeBbId: null,
  bbDefaultChairId: null,
  bbRosterOrder: [], // [{ id, enabled }]
  selectedNodeId: null,
  selectedEdgeId: null,
  activeEdges: new Set(),
  zoom: 1,
  panX: 20,
  panY: 20,
  draggingNode: null,
  panning: null,
  connectingFrom: null,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const NODE_W = 268;
const NODE_H_FALLBACK = 140;

const RUN_STATUS_LABEL = {
  running: '⚡ 运行中',
  completed: '✅ 已完成',
  interrupted: '⏸ 已中断(可续跑)',
  failed: '❌ 失败',
  aborted: '⏹ 已中止',
};

const REMOTE_PRESETS = {
  deepseek: { name: 'DeepSeek API', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner' },
  openai: { name: 'OpenAI GPT', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  openrouter: { name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  siliconflow: { name: '硅基流动 Qwen', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-235B-A22B' },
};

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function getActiveRun() {
  return appState.runs.find((r) => r.id === appState.activeRunId) || null;
}

function modeBadge(agent) {
  if (!agent) return '';
  if (agent.mode === 'ssh_remote') return '⚡ SSH 算力';
  if (agent.mode === 'remote_api') return '☁️ 远程 API';
  if (agent.mode === 'local_ollama') return '🏠 本地 Ollama';
  if (agent.mode === 'simulator') return '🌸 演练';
  return '🖥️ 本地 CLI';
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function switchMainTab(tabName) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `tab-${tabName}`));
  if (tabName === 'canvas') setTimeout(() => { renderCanvas(); fitToView(); }, 30);
}

$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchMainTab(btn.dataset.tab));
});
$('#btn-goto-bb')?.addEventListener('click', () => switchMainTab('blackboard'));

$$('.drawer-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchDrawerTab(btn.dataset.dtab));
});

function switchDrawerTab(name) {
  $$('.drawer-tab').forEach((b) => b.classList.toggle('active', b.dataset.dtab === name));
  $$('.drawer-body').forEach((b) => b.classList.toggle('active', b.id === `dtab-${name}`));
  if (name === 'deliverables') renderDeliverablesTab();
}

// ---------------------------------------------------------------------------
// Canvas Transform (Pan, Zoom, Fit-to-View)
// ---------------------------------------------------------------------------
function applyWorldTransform() {
  $('#canvas-world').style.transform = `translate(${appState.panX}px, ${appState.panY}px) scale(${appState.zoom})`;
  $('#zoom-label').textContent = `${Math.round(appState.zoom * 100)}%`;
}

function clientToWorld(clientX, clientY) {
  const rect = $('#canvas-viewport').getBoundingClientRect();
  return {
    x: (clientX - rect.left - appState.panX) / appState.zoom,
    y: (clientY - rect.top - appState.panY) / appState.zoom,
  };
}

function fitToView() {
  const vp = $('#canvas-viewport');
  if (!vp || !appState.graph.nodes.length) return;
  const rect = vp.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  appState.graph.nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + 185);
  });
  const graphW = Math.max(300, maxX - minX);
  const graphH = Math.max(240, maxY - minY + 70);
  const pad = 44;
  const scaleX = (rect.width - pad * 2) / graphW;
  const scaleY = (rect.height - pad * 2 - 44) / graphH;
  appState.zoom = Math.max(0.55, Math.min(1, +Math.min(scaleX, scaleY).toFixed(2)));
  appState.panX = Math.round((rect.width - graphW * appState.zoom) / 2 - minX * appState.zoom);
  appState.panY = Math.round((rect.height - 44 - graphH * appState.zoom) / 2 - minY * appState.zoom);
  applyWorldTransform();
}

$('#btn-zoom-in').addEventListener('click', () => { appState.zoom = Math.min(1.6, +(appState.zoom + 0.1).toFixed(2)); applyWorldTransform(); });
$('#btn-zoom-out').addEventListener('click', () => { appState.zoom = Math.max(0.5, +(appState.zoom - 0.1).toFixed(2)); applyWorldTransform(); });
$('#btn-zoom-reset').addEventListener('click', () => fitToView());

$('#canvas-viewport').addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  appState.zoom = Math.max(0.5, Math.min(1.6, +(appState.zoom + (e.deltaY < 0 ? 0.08 : -0.08)).toFixed(2)));
  applyWorldTransform();
}, { passive: false });

$('#canvas-viewport').addEventListener('mousedown', (e) => {
  if (e.target === $('#canvas-viewport') || e.target === $('#canvas-world') || e.target === $('#edges-svg')) {
    appState.selectedNodeId = null;
    appState.selectedEdgeId = null;
    $$('.entity-node').forEach((n) => n.classList.remove('selected'));
    renderEdges();
    renderInspectorConfig();
    appState.panning = { startX: e.clientX, startY: e.clientY, origX: appState.panX, origY: appState.panY };
  }
});

window.addEventListener('mousemove', (e) => {
  if (appState.panning) {
    appState.panX = appState.panning.origX + (e.clientX - appState.panning.startX);
    appState.panY = appState.panning.origY + (e.clientY - appState.panning.startY);
    applyWorldTransform();
  } else if (appState.draggingNode) {
    const pt = clientToWorld(e.clientX, e.clientY);
    const node = appState.graph.nodes.find((n) => n.id === appState.draggingNode.id);
    if (node) {
      node.x = Math.max(20, Math.round(pt.x - appState.draggingNode.offsetX));
      node.y = Math.max(20, Math.round(pt.y - appState.draggingNode.offsetY));
      const el = document.querySelector(`.entity-node[data-id="${node.id}"]`);
      if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; }
      renderEdges();
    }
  } else if (appState.connectingFrom) {
    const pt = clientToWorld(e.clientX, e.clientY);
    const src = appState.graph.nodes.find((n) => n.id === appState.connectingFrom);
    if (src) {
      const h = getNodeHeight(src.id);
      const tmp = $('#temp-edge');
      tmp.classList.remove('hidden');
      tmp.setAttribute('d', bezierPath(src.x + NODE_W, src.y + h / 2, pt.x, pt.y));
    }
  }
});

window.addEventListener('mouseup', () => {
  if (appState.draggingNode) { appState.draggingNode = null; saveGraphDebounced(); }
  appState.panning = null;
  if (appState.connectingFrom) { appState.connectingFrom = null; $('#temp-edge').classList.add('hidden'); }
});

let saveTimer = null;
function saveGraphDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/graph', { method: 'PUT', body: JSON.stringify(appState.graph) }).catch(() => {});
  }, 350);
}

// ---------------------------------------------------------------------------
// Canvas Rendering
// ---------------------------------------------------------------------------
function getNodeHeight(nodeId) {
  const el = document.querySelector(`.entity-node[data-id="${nodeId}"]`);
  return el ? el.offsetHeight : NODE_H_FALLBACK;
}

function bezierPath(x1, y1, x2, y2, isLoop = false) {
  if (isLoop) {
    const midY = Math.max(y1, y2) + 115;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  }
  // Skip-column same-row edge: gently arch underneath so it never passes behind an intermediate node card
  if (x2 - x1 > 460 && Math.abs(y2 - y1) < 90) {
    const archY = Math.max(y1, y2) + 125;
    return `M ${x1} ${y1} C ${x1 + 120} ${archY}, ${x2 - 120} ${archY}, ${x2} ${y2}`;
  }
  const dx = Math.max(70, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function renderEdges() {
  const svgLayer = $('#edges-layer');
  svgLayer.innerHTML = appState.graph.edges
    .map((edge) => {
      const src = appState.graph.nodes.find((n) => n.id === edge.from);
      const dst = appState.graph.nodes.find((n) => n.id === edge.to);
      if (!src || !dst) return '';
      const isLoop = edge.type === 'review_loop';
      const sh = getNodeHeight(src.id);
      const dh = getNodeHeight(dst.id);
      const x1 = isLoop ? src.x + NODE_W / 2 : src.x + NODE_W;
      const y1 = isLoop ? src.y + sh : src.y + sh / 2;
      const x2 = isLoop ? dst.x + NODE_W / 2 : dst.x;
      const y2 = isLoop ? dst.y + dh : dst.y + dh / 2;
      const d = bezierPath(x1, y1, x2, y2, isLoop);
      const isSelected = appState.selectedEdgeId === edge.id;
      const isActive = appState.activeEdges.has(edge.id);
      const marker = isActive ? 'url(#arrow-active)' : isLoop ? 'url(#arrow-loop)' : 'url(#arrow-flow)';
      const mx = (x1 + x2) / 2;
      const isSkipArch = !isLoop && x2 - x1 > 460 && Math.abs(y2 - y1) < 90;
      const my = isLoop ? Math.max(y1, y2) + 88 : isSkipArch ? Math.max(y1, y2) + 96 : (y1 + y2) / 2;
      const label = edge.label || (isLoop ? '打回修订' : '流转');
      const boxW = Math.max(66, label.length * 11 + 22);
      return `
        <g class="edge-group" data-edge-id="${edge.id}">
          <path class="edge-hit" d="${d}" data-edge-id="${edge.id}"></path>
          <path class="edge-path ${isLoop ? 'loop' : ''} ${isSelected ? 'selected' : ''} ${isActive ? 'active-flow' : ''}" d="${d}" marker-end="${marker}"></path>
          <rect class="edge-label-bg ${isSelected ? 'selected' : ''}" x="${mx - boxW / 2}" y="${my - 12}" width="${boxW}" height="24" data-edge-id="${edge.id}"></rect>
          <text class="edge-label-text" x="${mx}" y="${my}">${esc(label)}</text>
        </g>
      `;
    })
    .join('');

  svgLayer.querySelectorAll('[data-edge-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      appState.selectedEdgeId = el.dataset.edgeId;
      appState.selectedNodeId = null;
      $$('.entity-node').forEach((n) => n.classList.remove('selected'));
      renderEdges();
      renderInspectorConfig();
      switchDrawerTab('config');
    });
  });
}

function renderNodes() {
  const layer = $('#nodes-layer');
  const run = getActiveRun();

  layer.innerHTML = appState.graph.nodes
    .map((node) => {
      const isTrigger = node.type === 'trigger';
      const st = run?.nodeStates?.[node.id] || { status: 'idle' };
      const agent = !isTrigger ? appState.agents.find((a) => a.id === node.agentId) : null;
      const statusText = {
        idle: '就绪',
        pending: '等待上游',
        running: '🌸 思考中...',
        completed: st.durationMs ? `✓ ${(st.durationMs / 1000).toFixed(1)}s` : '✓ 完成',
        interrupted: '⏸ 已中断',
        failed: '✕ 异常',
        aborted: '已中止',
      }[st.status || 'idle'];

      const previewText = isTrigger
        ? (node.goal || '点击右侧编辑课题或任务目标...')
        : st.status === 'running'
        ? (st.thinkingPreview || '🧠 正在深度思考...')
        : st.output
        ? st.output.slice(0, 140)
        : (node.systemPrompt || '等待上游信号激活...');

      return `
        <div class="entity-node ${isTrigger ? 'trigger-node' : 'agent-node'} status-${st.status || 'idle'} ${appState.selectedNodeId === node.id ? 'selected' : ''}"
             data-id="${node.id}" style="left:${node.x}px; top:${node.y}px;">
          ${!isTrigger ? `<div class="port port-in" data-port-in="${node.id}" title="拖入此处连线"></div>` : ''}
          <div class="port port-out" data-port-out="${node.id}" title="拖出连线到其他实体"></div>

          <div class="node-head">
            <div>
              <div class="node-role-tag">${esc(node.roleTag || (isTrigger ? 'INPUT' : 'ENTITY'))}</div>
              <div class="node-title">${esc(node.title)}</div>
            </div>
            <span class="node-state-badge ${st.status || 'idle'}">${esc(statusText)}</span>
          </div>

          <div class="node-meta-row">
            ${
              isTrigger
                ? `<span class="agent-chip"><span class="agent-dot"></span>开放输入源</span>`
                : `<span class="agent-chip"><span class="agent-dot" style="background:${agent?.accent || '#ec4899'}"></span>${esc(agent?.name || node.agentId)}</span>
                   <span class="muted">${esc(modeBadge(agent))}</span>`
            }
          </div>

          <div class="node-thinking-box"><div class="node-thinking-text">${esc(previewText)}</div></div>
        </div>
      `;
    })
    .join('');

  layer.querySelectorAll('.entity-node').forEach((el) => {
    const nodeId = el.dataset.id;
    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('port')) return;
      e.stopPropagation();
      const prevNode = appState.selectedNodeId;
      const hadEdge = Boolean(appState.selectedEdgeId);
      appState.selectedNodeId = nodeId;
      appState.selectedEdgeId = null;
      const node = appState.graph.nodes.find((n) => n.id === nodeId);
      const pt = clientToWorld(e.clientX, e.clientY);
      appState.draggingNode = { id: nodeId, offsetX: pt.x - node.x, offsetY: pt.y - node.y };
      if (prevNode !== nodeId || hadEdge) {
        $$('.entity-node').forEach((nEl) => nEl.classList.toggle('selected', nEl.dataset.id === nodeId));
        if (hadEdge) renderEdges();
        renderInspectorConfig();
        renderThinkingStream();
      }
    });
  });

  layer.querySelectorAll('[data-port-out]').forEach((port) => {
    port.addEventListener('mousedown', (e) => { e.stopPropagation(); appState.connectingFrom = port.dataset.portOut; });
  });

  layer.querySelectorAll('[data-port-in]').forEach((port) => {
    port.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      const targetId = port.dataset.portIn;
      const fromId = appState.connectingFrom;
      if (fromId && targetId && fromId !== targetId && !appState.graph.edges.some((ed) => ed.from === fromId && ed.to === targetId)) {
        appState.graph.edges.push({ id: `e_${Date.now().toString(36)}`, from: fromId, to: targetId, label: '协作流转', type: 'flow' });
        saveGraphDebounced();
        renderEdges();
      }
      appState.connectingFrom = null;
      $('#temp-edge').classList.add('hidden');
    });
  });
}

function renderCanvas() {
  renderNodes();
  renderEdges();
}

// ---------------------------------------------------------------------------
// Inspector: Config, Thinking, Pool, and Final Deliverables
// ---------------------------------------------------------------------------
function renderInspectorConfig() {
  $('#config-empty').classList.add('hidden');
  $('#config-trigger').classList.add('hidden');
  $('#config-agent').classList.add('hidden');
  $('#config-edge').classList.add('hidden');

  if (appState.selectedNodeId) {
    const node = appState.graph.nodes.find((n) => n.id === appState.selectedNodeId);
    if (!node) return;
    if (node.type === 'trigger') {
      $('#config-trigger').classList.remove('hidden');
      $('#cfg-t-title').value = node.title || '';
      $('#cfg-t-tag').value = node.roleTag || '';
      $('#cfg-t-goal').value = node.goal || '';
    } else {
      $('#config-agent').classList.remove('hidden');
      $('#cfg-a-title').value = node.title || '';
      $('#cfg-a-tag').value = node.roleTag || '';
      $('#cfg-a-model').value = node.modelOverride || '';
      $('#cfg-a-prompt').value = node.systemPrompt || '';
      const runnable = appState.agents.filter((a) => a.installed && a.headlessSupported);
      $('#cfg-a-agent').innerHTML = runnable
        .map((a) => `<option value="${a.id}" ${a.id === node.agentId ? 'selected' : ''}>[${modeBadge(a)}] ${esc(a.name)} · ${esc(a.modelConfig.currentModel)}</option>`)
        .join('');
      updateAgentModelHint(node.agentId);
    }
  } else if (appState.selectedEdgeId) {
    const edge = appState.graph.edges.find((e) => e.id === appState.selectedEdgeId);
    if (!edge) return;
    const src = appState.graph.nodes.find((n) => n.id === edge.from);
    const dst = appState.graph.nodes.find((n) => n.id === edge.to);
    $('#config-edge').classList.remove('hidden');
    $('#cfg-e-endpoints').textContent = `${src?.title || edge.from}  ➜  ${dst?.title || edge.to}`;
    $('#cfg-e-label').value = edge.label || '';
    $('#cfg-e-type').value = edge.type || 'flow';
  } else {
    $('#config-empty').classList.remove('hidden');
  }
}

function updateAgentModelHint(agentId) {
  const ag = appState.agents.find((a) => a.id === agentId);
  if (!ag) return;
  const verifiedText = ag.profileStatus === 'verified' ? '✅ 已授权实测' : '⏳ 建议去智能体中心授权自检';
  $('#cfg-a-model-hint').innerHTML = `<strong>模式：</strong>${modeBadge(ag)} · ${verifiedText}<br/><strong>模型：</strong>${esc(ag.modelConfig.currentModel)}`;
}

function bindConfigInputs() {
  const updateSelectedNode = (fn) => {
    const node = appState.graph.nodes.find((n) => n.id === appState.selectedNodeId);
    if (!node) return;
    fn(node);
    renderCanvas();
    saveGraphDebounced();
  };
  $('#cfg-t-title').addEventListener('input', (e) => updateSelectedNode((n) => (n.title = e.target.value)));
  $('#cfg-t-tag').addEventListener('input', (e) => updateSelectedNode((n) => (n.roleTag = e.target.value)));
  $('#cfg-t-goal').addEventListener('input', (e) => updateSelectedNode((n) => (n.goal = e.target.value)));
  $('#cfg-a-title').addEventListener('input', (e) => updateSelectedNode((n) => (n.title = e.target.value)));
  $('#cfg-a-tag').addEventListener('input', (e) => updateSelectedNode((n) => (n.roleTag = e.target.value)));
  $('#cfg-a-agent').addEventListener('change', (e) => { updateSelectedNode((n) => (n.agentId = e.target.value)); updateAgentModelHint(e.target.value); });
  $('#cfg-a-model').addEventListener('input', (e) => updateSelectedNode((n) => (n.modelOverride = e.target.value.trim())));
  $('#cfg-a-prompt').addEventListener('input', (e) => updateSelectedNode((n) => (n.systemPrompt = e.target.value)));

  $('#btn-delete-node').addEventListener('click', () => {
    if (!appState.selectedNodeId) return;
    appState.graph.nodes = appState.graph.nodes.filter((n) => n.id !== appState.selectedNodeId);
    appState.graph.edges = appState.graph.edges.filter((e) => e.from !== appState.selectedNodeId && e.to !== appState.selectedNodeId);
    appState.selectedNodeId = null;
    renderCanvas(); renderInspectorConfig(); saveGraphDebounced();
  });

  $('#cfg-e-label').addEventListener('input', (e) => {
    const ed = appState.graph.edges.find((x) => x.id === appState.selectedEdgeId);
    if (ed) { ed.label = e.target.value; renderEdges(); saveGraphDebounced(); }
  });
  $('#cfg-e-type').addEventListener('change', (e) => {
    const ed = appState.graph.edges.find((x) => x.id === appState.selectedEdgeId);
    if (ed) { ed.type = e.target.value; renderEdges(); saveGraphDebounced(); }
  });
  $('#btn-delete-edge').addEventListener('click', () => {
    appState.graph.edges = appState.graph.edges.filter((x) => x.id !== appState.selectedEdgeId);
    appState.selectedEdgeId = null;
    renderEdges(); renderInspectorConfig(); saveGraphDebounced();
  });
}

function renderThinkingStream() {
  const run = getActiveRun();
  const node = appState.graph.nodes.find((n) => n.id === appState.selectedNodeId);
  if (!node) { $('#stream-node-title').textContent = '选择画布实体节点查看实时思考流'; $('#stream-node-meta').textContent = ''; return; }
  const st = run?.nodeStates?.[node.id];
  $('#stream-node-title').textContent = `${node.title} (${node.agentId || 'Input'})`;
  $('#stream-node-meta').textContent = st?.artifactFile ? `产物: ${st.artifactFile}` : st?.status || 'idle';
  const text = st ? ((st.stdout || st.output || '') + (st.stderr ? `\n\n--- THINKING / DIAGNOSTICS ---\n${st.stderr}` : '')) : '该节点尚未在当前运行中执行。';
  $('#stream-box').textContent = text || '等待输出...';
}

function renderMessagePool() {
  const run = getActiveRun();
  const list = $('#pool-list');
  if (!run || !run.messagePool?.length) {
    list.innerHTML = `<div class="empty-note">暂无消息池记录。点击「启动画布协作」即可观看实体之间的实时接力。</div>`;
    return;
  }
  const items = run.messagePool.slice().reverse();
  list.innerHTML = items.map((r, idx) => {
    const artifactMatch = r.artifactFile || (r.summary && r.summary.match(/->\s*(artifacts\/[^\s(]+)/)?.[1]) || null;
    const hasMore = Boolean(artifactMatch || r.fullText || r.detail);
    return `
      <div class="pool-item kind-${r.kind || 'info'}" data-pool-idx="${idx}" title="点击展开或弹窗查看完整内容">
        <div class="pool-meta">
          <span><strong>${esc(r.from)}</strong> ➜ <strong>${esc(r.to)}</strong></span>
          <span>${new Date(r.timestamp).toLocaleTimeString()}</span>
        </div>
        <div>${esc(r.summary)}</div>
        ${r.detail ? `<div class="pool-detail">${esc(r.detail)}</div>` : ''}
        ${
          hasMore
            ? `<div class="pool-action-row">
                 <span class="pool-expand-inline" data-inline-idx="${idx}">▾ 原地展开/收起</span>
                 <span class="pool-open-modal">🔍 弹窗阅读全文</span>
               </div>`
            : ''
        }
      </div>
    `;
  }).join('');

  list.querySelectorAll('.pool-item').forEach((card) => {
    const idx = Number(card.dataset.poolIdx);
    const rec = items[idx];
    if (!rec) return;

    card.querySelector('.pool-expand-inline')?.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('expanded');
      const detailEl = card.querySelector('.pool-detail');
      if (detailEl && card.classList.contains('expanded') && rec.fullText) {
        detailEl.textContent = rec.fullText;
      }
    });

    card.addEventListener('click', async () => {
      const artifactFile = rec.artifactFile || (rec.summary && rec.summary.match(/->\s*(artifacts\/[^\s(]+)/)?.[1]) || null;
      if (artifactFile) {
        await previewRunFile(run.id, artifactFile, true);
        return;
      }
      // Try matching node output by nodeId or title
      const matchedNode = run.graph?.nodes?.find((n) => n.id === rec.nodeId || n.title === rec.from || n.title === rec.to);
      const st = matchedNode ? run.nodeStates?.[matchedNode.id] : null;
      const bodyText =
        rec.fullText ||
        st?.output ||
        st?.stdout ||
        (rec.detail ? `${rec.summary}\n\n---\n\n${rec.detail}` : rec.summary);

      $('#doc-modal-title').textContent = `💬 消息池详情 · ${rec.from} ➜ ${rec.to}`;
      $('#doc-modal-path').textContent = `${new Date(rec.timestamp).toLocaleString()} · Agent: ${rec.agentId || 'system'}`;
      $('#doc-modal-body').textContent = bodyText;
      $('#doc-modal-body').scrollTop = 0;
      $('#doc-modal').classList.remove('hidden');
    });
  });
}

// ---------------------------------------------------------------------------
// Final Deliverables Showcase (Answers: "What is the MOST IMPORTANT output?")
// ---------------------------------------------------------------------------
async function previewRunFile(runId, relPath, openModal = true) {
  try {
    const res = await api(`/api/runs/${runId}/file?path=${encodeURIComponent(relPath)}`);
    $('#file-viewer').textContent = `=== ${relPath} ===\n\n${res.content}`;
    $('#file-viewer').scrollTop = 0;
    if (openModal) {
      const run = appState.runs.find((r) => r.id === runId);
      $('#doc-modal-title').textContent = `📄 ${relPath}`;
      $('#doc-modal-path').textContent = run ? `${run.workspaceDir}\\${relPath.replace(/\//g, '\\')}` : relPath;
      $('#doc-modal-body').textContent = res.content;
      $('#doc-modal-body').scrollTop = 0;
      $('#doc-modal').classList.remove('hidden');
    }
  } catch (e) {
    $('#file-viewer').textContent = `无法读取 ${relPath}: ${e.message}`;
    if (openModal) alert(`无法打开文件 ${relPath}: ${e.message}`);
  }
}

$('#btn-modal-close')?.addEventListener('click', () => $('#doc-modal').classList.add('hidden'));
$('#doc-modal-backdrop')?.addEventListener('click', () => $('#doc-modal').classList.add('hidden'));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#doc-modal')?.classList.add('hidden');
});
$('#btn-modal-copy')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#doc-modal-body').textContent || '');
    $('#btn-modal-copy').textContent = '✅ 已复制';
    setTimeout(() => { $('#btn-modal-copy').textContent = '📋 复制全文'; }, 1500);
  } catch {}
});
$('#btn-modal-open-dir')?.addEventListener('click', () => openRunWorkspaceFolder($('#btn-modal-open-dir')));

async function openRunWorkspaceFolder(btnEl) {
  const run = getActiveRun();
  if (!run) return;
  const orig = btnEl?.textContent || '📂 呼出文件夹';
  try {
    const res = await api(`/api/runs/${run.id}/open`, { method: 'POST' });
    if (res.workspaceDir) {
      try { await navigator.clipboard.writeText(res.workspaceDir); } catch {}
    }
    if (btnEl) {
      btnEl.textContent = '✅ 已触发(路径已复制)';
      setTimeout(() => { btnEl.textContent = orig; }, 2400);
    }
  } catch (err) {
    alert(`无法弹出系统资源管理器（若服务运行在后台无界面会话或远程服务器，请使用「📥 下载成果包」或粘贴已复制路径）：\n${run.workspaceDir}`);
  }
}

async function renderDeliverablesTab() {
  const run = getActiveRun();
  if (!run) {
    $('#deliv-empty').classList.remove('hidden');
    $('#deliv-content').classList.add('hidden');
    return;
  }
  $('#deliv-empty').classList.add('hidden');
  $('#deliv-content').classList.remove('hidden');
  $('#ws-path-label').textContent = run.id;
  if ($('#ws-path-banner')) $('#ws-path-banner').textContent = `📁 本地产物目录：${run.workspaceDir}`;

  let deliv = run.deliverables;
  try {
    deliv = await api(`/api/runs/${run.id}/deliverables`);
    run.deliverables = deliv;
  } catch {}

  const hero = $('#deliv-hero');
  if (deliv?.primary) {
    const p = deliv.primary;
    hero.innerHTML = `
      <div class="deliv-hero-eyebrow">🏆 最关键最终产物 · ${esc(p.nodeTitle)} (${esc(p.agentName)})</div>
      <div class="deliv-hero-title">${esc(run.title)}</div>
      <div class="deliv-hero-excerpt">${esc(p.excerpt)}</div>
      <div class="deliv-hero-actions">
        ${p.artifactFile ? `<button class="btn btn-primary btn-xs" id="btn-view-primary">👁 预览最终主报告</button>` : ''}
        <button class="btn btn-soft btn-xs" id="btn-copy-primary">📋 复制最终结论</button>
        <button class="btn btn-ghost btn-xs" id="btn-view-index">📑 成果总索引</button>
      </div>
    `;
    $('#btn-view-primary')?.addEventListener('click', () => previewRunFile(run.id, p.artifactFile));
    $('#btn-view-index')?.addEventListener('click', () => previewRunFile(run.id, 'DELIVERABLES_INDEX.md'));
    $('#btn-copy-primary')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(p.fullPreview || p.excerpt);
        $('#btn-copy-primary').textContent = '✅ 已复制';
        setTimeout(() => { $('#btn-copy-primary').textContent = '📋 复制最终结论'; }, 1500);
      } catch {}
    });
    if (p.artifactFile) previewRunFile(run.id, p.artifactFile, false);
  } else {
    hero.innerHTML = `<div class="deliv-hero-eyebrow">⏳ 协作进行中或尚未产出最终报告</div><div class="muted">当任意节点完成交付后，最关键的主成果将自动汇总展示在这里。</div>`;
  }

  // Per-Node Deliverable Cards
  const nodesBox = $('#deliv-nodes');
  const list = deliv?.nodeDeliverables || [];
  nodesBox.innerHTML = list.length
    ? list.map((d) => `
      <div class="deliv-node-card">
        <div class="deliv-node-top">
          <strong>${d.isPrimary ? '🏆 ' : '📌 '}${esc(d.nodeTitle)}</strong>
          <span class="muted">${esc(d.agentName)} · ${(d.durationMs / 1000).toFixed(1)}s</span>
        </div>
        <div class="muted">${esc(d.excerpt.slice(0, 110))}...</div>
        <div class="deliv-file-pills">
          ${d.artifactFile ? `<span class="file-pill" data-open-file="${esc(d.artifactFile)}">📄 主报告: ${esc(d.artifactFile.split('/').pop())}</span>` : ''}
          ${(d.workspaceFiles || []).map((wf) => `<span class="file-pill" data-open-file="${esc(wf)}">💾 ${esc(wf.replace('shared_workspace/', ''))}</span>`).join('')}
        </div>
      </div>
    `).join('')
    : '<div class="muted">暂无已完成节点产物</div>';

  nodesBox.querySelectorAll('[data-open-file]').forEach((pill) => {
    pill.addEventListener('click', () => previewRunFile(run.id, pill.dataset.openFile));
  });

  // Full Files Tree
  try {
    const fdata = await api(`/api/runs/${run.id}/files`);
    $('#files-list').innerHTML = fdata.files.map((f) =>
      f.type === 'dir'
        ? `<div class="file-item dir">📁 ${esc(f.path)}/</div>`
        : `<div class="file-item" data-fpath="${esc(f.path)}"><span>📄 ${esc(f.path)}</span><span class="muted">${(f.size / 1024).toFixed(1)}KB</span></div>`
    ).join('') || '<div class="muted" style="padding:6px;">空目录</div>';
    $('#files-list').querySelectorAll('[data-fpath]').forEach((row) => {
      row.addEventListener('click', () => previewRunFile(run.id, row.dataset.fpath));
    });
  } catch {}
}

function renderRunsList() {
  $('#runs-count').textContent = appState.runs.length;
  const box = $('#runs-list');
  if (!appState.runs.length) { box.innerHTML = `<div class="muted">暂无历史运行记录</div>`; return; }
  box.innerHTML = appState.runs.slice(0, 10).map((r) => `
    <div class="run-row ${r.id === appState.activeRunId ? 'active' : ''}" data-run-id="${r.id}">
      <div class="run-row-top">
        <span>${esc(r.title)}</span>
        <span class="muted">${esc(RUN_STATUS_LABEL[r.status] || r.status)}</span>
      </div>
      <div class="muted">${new Date(r.createdAt).toLocaleTimeString()} · ${r.graph.nodes.length} 实体</div>
    </div>
  `).join('');
  box.querySelectorAll('.run-row').forEach((row) => {
    row.addEventListener('click', () => {
      appState.activeRunId = row.dataset.runId;
      const run = getActiveRun();
      if (run) {
        appState.graph = structuredClone(run.graph);
        renderCanvas(); renderRunsList(); renderMessagePool(); renderThinkingStream(); updateRunControls();
        if (run.status === 'completed') switchDrawerTab('deliverables');
      }
    });
  });
}

function updateRunControls() {
  const run = getActiveRun();
  const isRunning = run?.status === 'running';
  const canResume = Boolean(run && ['interrupted', 'failed', 'aborted'].includes(run.status));
  $('#btn-abort-run').classList.toggle('hidden', !isRunning);
  $('#btn-resume-run').classList.toggle('hidden', !canResume);
  const bar = $('#run-badge-bar');
  if (run) { bar.classList.remove('hidden'); bar.textContent = `当前会话: ${run.id} (${RUN_STATUS_LABEL[run.status] || run.status})`; }
  else bar.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Toolbar Actions
// ---------------------------------------------------------------------------
$('#template-select').addEventListener('change', (e) => {
  const tpl = appState.templates[e.target.value];
  if (!tpl) return;
  appState.graph = structuredClone(tpl);
  appState.activeRunId = null;
  appState.selectedNodeId = appState.graph.nodes[0]?.id || null;
  appState.selectedEdgeId = null;
  renderCanvas(); fitToView(); renderInspectorConfig(); saveGraphDebounced();
});

$('#btn-add-node').addEventListener('click', () => {
  const usable = appState.agents.find((a) => a.installed && a.headlessSupported && a.id !== 'simulator') || { id: 'simulator' };
  const count = appState.graph.nodes.filter((n) => n.type === 'agent').length + 1;
  const newNode = {
    id: `n_agent_${Date.now().toString(36)}`,
    type: 'agent',
    title: `自定义智能体 #${count}`,
    roleTag: 'Specialist',
    agentId: usable.id,
    modelOverride: '',
    systemPrompt: '请结合上游输入，从你的专业视角完成分析并输出清晰结论。',
    x: 260 + (count * 60) % 480,
    y: 120 + (count * 50) % 280,
  };
  appState.graph.nodes.push(newNode);
  appState.selectedNodeId = newNode.id;
  renderCanvas(); renderInspectorConfig(); saveGraphDebounced();
});

$('#btn-auto-layout').addEventListener('click', () => {
  const flowEdges = appState.graph.edges.filter((e) => e.type !== 'review_loop');
  const levels = new Map();
  const trigger = appState.graph.nodes.find((n) => n.type === 'trigger') || appState.graph.nodes[0];
  if (!trigger) return;
  const queue = [{ id: trigger.id, lv: 0 }];
  levels.set(trigger.id, 0);
  const maxDepth = appState.graph.nodes.length + 1;
  while (queue.length) {
    const { id, lv } = queue.shift();
    if (lv >= maxDepth) continue;
    flowEdges.filter((e) => e.from === id).forEach((e) => {
      if ((levels.get(e.to) ?? -1) < lv + 1 && lv + 1 < maxDepth) {
        levels.set(e.to, lv + 1);
        queue.push({ id: e.to, lv: lv + 1 });
      }
    });
  }
  const cols = new Map();
  appState.graph.nodes.forEach((n) => {
    const lv = levels.get(n.id) ?? 1;
    if (!cols.has(lv)) cols.set(lv, []);
    cols.get(lv).push(n);
  });
  for (const [lv, list] of cols.entries()) {
    const startY = Math.max(60, 290 - (list.length * 230) / 2);
    list.forEach((n, idx) => { n.x = 60 + lv * 415; n.y = Math.round(startY + idx * 230); });
  }
  renderCanvas(); fitToView(); saveGraphDebounced();
});

$('#btn-run-canvas').addEventListener('click', async () => {
  const trigger = appState.graph.nodes.find((n) => n.type === 'trigger');
  const goal = (trigger?.goal || '').trim();
  if (!goal) return alert('请先在输入源实体中填写课题或任务目标！');
  try {
    const run = await api('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        title: trigger?.title || appState.graph.name || '自由画布协作',
        goal,
        customWorkspace: $('#cfg-t-workspace')?.value.trim() || '',
        autoRevision: $('#chk-auto-revise').checked,
        graph: appState.graph,
      }),
    });
    appState.activeRunId = run.id;
    if (!appState.runs.find((r) => r.id === run.id)) appState.runs.unshift(run);
    renderCanvas(); renderRunsList(); renderMessagePool(); updateRunControls(); switchDrawerTab('pool');
  } catch (err) {
    alert(`无法启动: ${err.message}`);
  }
});

$('#btn-abort-run').addEventListener('click', async () => {
  const run = getActiveRun();
  if (run) await api(`/api/runs/${run.id}/abort`, { method: 'POST' });
});

$('#btn-resume-run').addEventListener('click', async () => {
  const run = getActiveRun();
  if (!run) return;
  try {
    const updated = await api(`/api/runs/${run.id}/resume`, { method: 'POST' });
    const idx = appState.runs.findIndex((r) => r.id === updated.id);
    if (idx >= 0) appState.runs[idx] = updated;
    renderCanvas(); renderRunsList(); renderMessagePool(); updateRunControls(); switchDrawerTab('pool');
  } catch (err) { alert(`断点续跑失败: ${err.message}`); }
});

$('#btn-open-ws').addEventListener('click', () => openRunWorkspaceFolder($('#btn-open-ws')));
$('#btn-copy-ws-path')?.addEventListener('click', async () => {
  const run = getActiveRun();
  if (!run) return;
  try {
    await navigator.clipboard.writeText(run.workspaceDir);
    $('#btn-copy-ws-path').textContent = '✅ 已复制路径';
    setTimeout(() => { $('#btn-copy-ws-path').textContent = '📋 复制路径'; }, 1800);
  } catch {
    prompt('请复制以下本地路径：', run.workspaceDir);
  }
});
$('#btn-download-zip')?.addEventListener('click', () => {
  const run = getActiveRun();
  if (!run) return;
  window.location.href = `/api/runs/${run.id}/download`;
});

// ---------------------------------------------------------------------------
// View 2: Agent Hub (Authorized Self-Profiling + Remote API Manager)
// ---------------------------------------------------------------------------
function updateEnvSummaryPill() {
  const localN = appState.agents.filter((a) => a.mode === 'local_cli' && a.installed).length;
  const remoteN = appState.agents.filter((a) => a.mode === 'remote_api').length;
  const sshN = appState.agents.filter((a) => a.mode === 'ssh_remote').length;
  const pill = $('#env-summary-pill');
  pill.textContent = `🖥️ ${localN} 本地 · ☁️ ${remoteN} API · ⚡ ${sshN} SSH`;
  pill.className = `status-pill ${localN + remoteN + sshN > 0 ? 'pill-live' : 'pill-warn'}`;
}

function renderAgentsShowcase() {
  updateEnvSummaryPill();
  const dims = [
    ['planning', '架构与规划'],
    ['coding', '代码工程'],
    ['research', '科研与推理'],
    ['review', '批判与审查'],
    ['speed', '响应速度'],
    ['tooling', '工具链生态'],
  ];

  // Show installed local CLIs + all remote APIs + simulator first, uninstalled at bottom
  const sorted = [...appState.agents].sort((a, b) => Number(b.installed) - Number(a.installed));

  $('#agents-showcase').innerHTML = sorted.map((a) => {
    const prof = a.profile || {};
    const statusPill =
      a.profileStatus === 'verified'
        ? `<span class="status-pill pill-live">✅ 已授权画像${prof.latencyMs ? ` (${(prof.latencyMs / 1000).toFixed(1)}s)` : ''}</span>`
        : a.profileStatus === 'auth_or_error'
        ? `<span class="status-pill pill-warn">⚠️ 需登录/鉴权</span>`
        : a.installed
        ? `<span class="status-pill pill-idle">⏳ 待授权自检</span>`
        : `<span class="status-pill pill-idle">未安装</span>`;

    return `
      <div class="sakura-card agent-profile-card">
        <div class="ap-head">
          <div class="ap-title">
            <div class="ap-icon" style="background:linear-gradient(135deg, ${a.accent}, #f472b6)">${esc(a.shortName)}</div>
            <div>
              <h3>${esc(a.name)}</h3>
              <span class="muted">${modeBadge(a)} · ${esc(a.version)}</span>
            </div>
          </div>
          ${statusPill}
        </div>

        <div class="ap-model-box">
          <div>模型配置：<code>${esc(prof.reportedModel || a.modelConfig.currentModel)}</code></div>
          <div>接入方式：<span>${esc(a.modelConfig.gateway)}</span></div>
          ${a.remoteConfig ? `<div>API Key：<code>${esc(a.remoteConfig.apiKeyMasked)}</code> (${esc(a.remoteConfig.protocol)})</div>` : ''}
          ${a.modelConfig.mcpServers?.length ? `<div>MCP 挂载：<code>${esc(a.modelConfig.mcpServers.join(', '))}</code></div>` : ''}
        </div>

        ${
          prof.scores
            ? `<div class="cap-grid">
                 ${dims.map(([k, lbl]) => `
                   <div class="cap-item">
                     <div class="cap-row"><span>${lbl}</span><span>${prof.scores[k] ?? 80}</span></div>
                     <div class="cap-track"><div class="cap-fill" style="width:${prof.scores[k] ?? 80}%"></div></div>
                   </div>
                 `).join('')}
               </div>`
            : `<div class="empty-note" style="padding:12px;font-size:12px;">${a.installed ? '尚未向该智能体发起授权自检；点击下方「🔐 授权自检并生成画像」后将动态测出真实模型与能力维度。' : '当前电脑未检测到此本地 CLI（可选安装，或使用上方远程 API 接入）。'}</div>`
        }

        ${
          prof.bestDomains?.length
            ? `<div class="domain-chips">${prof.bestDomains.map((d) => `<span class="domain-chip">${esc(d)}</span>`).join('')}</div>`
            : ''
        }

        <p style="font-size:12.5px;color:var(--ink-secondary);">${esc(prof.summary || '')}</p>
        ${prof.watchouts ? `<div class="watchout-note">💡 ${esc(prof.watchouts)}</div>` : ''}

        <div class="ap-actions">
          ${
            a.mode === 'ssh_remote'
              ? `<button class="btn btn-primary btn-xs probe-ssh-btn" data-sid="${a.id}">⚡ 探测远程 GPU 与环境 (nvidia-smi)</button>
                 <button class="btn btn-danger-ghost btn-xs del-ssh-btn" data-sid="${a.id}">🗑 移除</button>`
              : a.installed && a.headlessSupported && a.id !== 'simulator'
              ? `<button class="btn btn-primary btn-xs profile-one-btn" data-aid="${a.id}">🔐 授权自检并生成画像</button>
                 <button class="btn btn-soft btn-xs ping-btn" data-aid="${a.id}">🩺 快速 Ping</button>`
              : ''
          }
          ${a.mode === 'remote_api' ? `<button class="btn btn-danger-ghost btn-xs del-remote-btn" data-rid="${a.id}">🗑 移除</button>` : ''}
        </div>
        <div class="ping-out hidden" id="ping-out-${a.id}"></div>
      </div>
    `;
  }).join('');

  $$('.profile-one-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.aid;
      btn.disabled = true;
      btn.textContent = '⏳ 正在向智能体请求自检画像...';
      try {
        const data = await api('/api/agents/profile', { method: 'POST', body: JSON.stringify({ agentId: id }) });
        appState.agents = data.agents;
        renderAgentsShowcase();
        renderInspectorConfig();
      } catch (e) {
        alert(`自检失败: ${e.message}`);
        btn.disabled = false;
        btn.textContent = '🔐 授权自检并生成画像';
      }
    });
  });

  $$('.ping-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.aid;
      const out = $(`#ping-out-${id}`);
      out.classList.remove('hidden');
      out.textContent = `正在测试 ${id} 连通性...`;
      btn.disabled = true;
      try {
        const res = await api('/api/agents/ping', { method: 'POST', body: JSON.stringify({ agentId: id }) });
        out.textContent = `${res.ok ? '✅ PASS' : '❌ FAIL'} · ${(res.durationMs / 1000).toFixed(2)}s\nSTDOUT: ${res.stdout.trim()}${res.stderr ? '\nSTDERR: ' + res.stderr.trim().slice(0, 240) : ''}`;
      } catch (e) { out.textContent = `❌ ${e.message}`; }
      finally { btn.disabled = false; }
    });
  });

  $$('.del-remote-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('确认移除此远程 API 智能体？')) return;
      const data = await api(`/api/remote-agents/${btn.dataset.rid}`, { method: 'DELETE' });
      appState.agents = data.agents;
      renderAgentsShowcase(); renderInspectorConfig(); syncBlackboardRoster();
    });
  });

  $$('.probe-ssh-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.sid;
      const out = $(`#ping-out-${id}`);
      out.classList.remove('hidden');
      out.textContent = '正在通过 SSH 连接远程服务器并执行 nvidia-smi 算力探测...';
      btn.disabled = true;
      try {
        const res = await api(`/api/ssh-hosts/${id}/probe`, { method: 'POST', body: '{}' });
        if (res.agents) appState.agents = res.agents;
        renderAgentsShowcase();
        renderInspectorConfig();
        syncBlackboardRoster();
        const box = $(`#ping-out-${id}`);
        if (box) {
          box.classList.remove('hidden');
          box.textContent = res.ok
            ? `✅ SSH 连通成功 (${(res.durationMs / 1000).toFixed(2)}s)\nOS: ${res.osInfo}\nGPU: ${res.gpuSummary}\nPython: ${res.pythonInfo}`
            : `❌ SSH 连接失败: ${res.error}`;
        }
      } catch (err) {
        out.textContent = `❌ ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  });

  $$('.del-ssh-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('确认移除此 SSH 远程服务器节点？')) return;
      const data = await api(`/api/ssh-hosts/${btn.dataset.sid}`, { method: 'DELETE' });
      appState.agents = data.agents;
      renderAgentsShowcase(); renderInspectorConfig(); syncBlackboardRoster();
    });
  });

  $('#env-badges').innerHTML = appState.envKeys.length
    ? appState.envKeys.map((k) => `<span class="domain-chip">🔑 ${esc(k)}</span>`).join('')
    : '<span class="muted">未注入额外环境变量</span>';
}

$$('.remote-preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = REMOTE_PRESETS[btn.dataset.preset];
    if (!p) return;
    $('#ra-name').value = p.name;
    $('#ra-protocol').value = p.protocol;
    $('#ra-baseurl').value = p.baseUrl;
    $('#ra-model').value = p.model;
  });
});

$('#ssh-host-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/ssh-hosts', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#ssh-name').value.trim(),
        host: $('#ssh-host').value.trim(),
        port: Number($('#ssh-port').value) || 22,
        username: $('#ssh-user').value.trim(),
        identityFile: $('#ssh-key').value.trim(),
        remoteWorkdir: $('#ssh-workdir').value.trim(),
        runnerTemplate: $('#ssh-runner').value.trim(),
      }),
    });
    appState.agents = data.agents;
    renderAgentsShowcase();
    renderInspectorConfig();
    syncBlackboardRoster();
    alert('✅ SSH 远程算力节点已添加！可点击卡片上的「⚡ 探测远程 GPU 与环境」测试连通性，或直接在画布节点中绑定该服务器。');
  } catch (err) {
    alert(`添加 SSH 节点失败: ${err.message}`);
  }
});

$('#remote-agent-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/remote-agents', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#ra-name').value.trim(),
        protocol: $('#ra-protocol').value,
        baseUrl: $('#ra-baseurl').value.trim(),
        model: $('#ra-model').value.trim(),
        apiKey: $('#ra-apikey').value.trim(),
      }),
    });
    appState.agents = data.agents;
    $('#ra-apikey').value = '';
    renderAgentsShowcase();
    renderInspectorConfig();
    syncBlackboardRoster();
    alert('✅ 远程 API 智能体已添加！现在可以点击它的「🔐 授权自检」或在画布中直接选用。');
  } catch (err) {
    alert(`添加失败: ${err.message}`);
  }
});

$('#btn-refresh-agents').addEventListener('click', async () => {
  const data = await api('/api/agents?refresh=1');
  appState.agents = data.agents;
  appState.envKeys = data.envKeys || [];
  renderAgentsShowcase(); renderInspectorConfig(); syncBlackboardRoster();
});

$('#btn-profile-all').addEventListener('click', async () => {
  if (!confirm('授权 SakuraFlow 向当前已探测到的所有可用智能体各发送一条轻量自检提示词，以生成真实能力画像？')) return;
  const btn = $('#btn-profile-all');
  btn.disabled = true;
  btn.textContent = '⏳ 正在并行授权自检中...';
  try {
    const data = await api('/api/agents/profile-all', { method: 'POST', body: '{}' });
    appState.agents = data.agents;
    renderAgentsShowcase();
    renderInspectorConfig();
  } catch (err) { alert(`批量自检出错: ${err.message}`); }
  finally { btn.disabled = false; btn.textContent = '🔐 授权一键自检全部智能体'; }
});

$('#btn-save-env').addEventListener('click', async () => {
  const key = $('#env-key').value.trim();
  const value = $('#env-val').value.trim();
  if (!key) return;
  const data = await api('/api/env', { method: 'POST', body: JSON.stringify({ key, value }) });
  appState.envKeys = data.envKeys || [];
  $('#env-val').value = '';
  renderAgentsShowcase();
});

// ---------------------------------------------------------------------------
// View 0: Autonomous Blackboard Roundtable Controller (v4.0)
// ---------------------------------------------------------------------------
const BB_IDEAS = {
  research: {
    title: '多智能体协作科学假设验证研究',
    goal: '请团队围绕“异构多智能体黑板协商相比固定流水线，在复杂科研实验设计中如何平衡创新性与严谨性”展开自主分工，产出理论假设、验证指标方案与独立同行评审意见，最终汇总成研究简报。',
  },
  product: {
    title: '开源本地 Markdown 知识图谱工具孵化',
    goal: '请团队自主协商分工，为一个零依赖本地 Markdown 双向链接知识图谱工具完成产品需求定义、核心架构与代码实现，并经过独立审查后输出可运行原型与 README 文档。',
  },
  strategy: {
    title: '个人开发者开源项目曝光与增长策略',
    goal: '请团队围绕“如何让一个开源多智能体桌面编排项目在 GitHub 和技术视频平台获得高星标与高传播”进行多视角协商分析，产出技术差异化定位、演示脚本大纲与风险批判清单。',
  },
};

function syncBlackboardRoster() {
  const runnable = appState.agents.filter((a) => a.installed && a.headlessSupported);
  const existingMap = new Map(appState.bbRosterOrder.map((r) => [r.id, r]));
  const next = [];
  for (const item of appState.bbRosterOrder) {
    if (runnable.some((a) => a.id === item.id)) next.push(item);
  }
  for (const ag of runnable) {
    if (!existingMap.has(ag.id)) {
      next.push({ id: ag.id, enabled: ag.id !== 'simulator' });
    }
  }
  if (!next.some((r) => r.enabled) && next.length > 0) next[0].enabled = true;
  appState.bbRosterOrder = next;

  const chairSel = $('#bb-chair-select');
  if (chairSel) {
    const prevVal = chairSel.value || appState.bbDefaultChairId || runnable[0]?.id || 'simulator';
    chairSel.innerHTML = runnable
      .map((a) => `<option value="${a.id}" ${a.id === prevVal ? 'selected' : ''}>[${modeBadge(a)}] ${esc(a.name)} · ${esc(a.modelConfig.currentModel)}</option>`)
      .join('');
  }
  renderBlackboardRoster();
}

function renderBlackboardRoster() {
  const box = $('#bb-roster-list');
  if (!box) return;
  let orderNum = 0;
  box.innerHTML = appState.bbRosterOrder
    .map((item, idx) => {
      const ag = appState.agents.find((a) => a.id === item.id);
      if (!ag) return '';
      const numBadge = item.enabled ? `<span class="bb-order-num">${++orderNum}</span>` : `<span class="bb-order-num" style="opacity:.35;">-</span>`;
      return `
        <div class="bb-roster-row" data-ridx="${idx}">
          <div class="bb-roster-left">
            <input type="checkbox" class="bb-chk" ${item.enabled ? 'checked' : ''} />
            ${numBadge}
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(ag.name)}</div>
              <div class="muted">${modeBadge(ag)} · ${esc(ag.modelConfig.currentModel).slice(0, 26)}</div>
            </div>
          </div>
          <div class="bb-roster-btns">
            <button type="button" class="btn btn-ghost btn-xs bb-up" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn btn-ghost btn-xs bb-down" ${idx === appState.bbRosterOrder.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        </div>
      `;
    })
    .join('');

  box.querySelectorAll('.bb-roster-row').forEach((row) => {
    const idx = Number(row.dataset.ridx);
    row.querySelector('.bb-chk').addEventListener('change', (e) => {
      appState.bbRosterOrder[idx].enabled = e.target.checked;
      renderBlackboardRoster();
    });
    row.querySelector('.bb-up').addEventListener('click', () => {
      if (idx <= 0) return;
      const tmp = appState.bbRosterOrder[idx - 1];
      appState.bbRosterOrder[idx - 1] = appState.bbRosterOrder[idx];
      appState.bbRosterOrder[idx] = tmp;
      renderBlackboardRoster();
    });
    row.querySelector('.bb-down').addEventListener('click', () => {
      if (idx >= appState.bbRosterOrder.length - 1) return;
      const tmp = appState.bbRosterOrder[idx + 1];
      appState.bbRosterOrder[idx + 1] = appState.bbRosterOrder[idx];
      appState.bbRosterOrder[idx] = tmp;
      renderBlackboardRoster();
    });
  });
}

function getActiveBlackboard() {
  return appState.blackboards.find((b) => b.id === appState.activeBbId) || null;
}

function renderBlackboardHistory() {
  $('#bb-history-count').textContent = appState.blackboards.length;
  const list = $('#bb-history-list');
  if (!appState.blackboards.length) {
    list.innerHTML = `<div class="muted">暂无圆桌协商记录</div>`;
    return;
  }
  list.innerHTML = appState.blackboards
    .slice(0, 10)
    .map(
      (b) => `
      <div class="run-row ${b.id === appState.activeBbId ? 'active' : ''}" data-bb-id="${b.id}">
        <div class="run-row-top">
          <span>${esc(b.title)}</span>
          <span class="muted">${esc(RUN_STATUS_LABEL[b.status] || b.status)}</span>
        </div>
        <div class="muted">${new Date(b.createdAt).toLocaleTimeString()} · ${b.participantAgentIds.length} 成员协商</div>
      </div>
    `
    )
    .join('');
  list.querySelectorAll('[data-bb-id]').forEach((el) => {
    el.addEventListener('click', () => {
      appState.activeBbId = el.dataset.bbId;
      renderBlackboardHistory();
      renderBlackboardArena();
    });
  });
}

function renderBlackboardArena() {
  const bb = getActiveBlackboard();
  const isRunning = bb?.status === 'running';
  $('#btn-bb-abort').classList.toggle('hidden', !isRunning);
  $('#btn-bb-start').disabled = isRunning;

  const stepOrder = ['intent', 'roundtable', 'synthesize', 'ready'];
  const curIdx = bb ? stepOrder.indexOf(bb.phase) : -1;
  ['intent', 'roundtable', 'synthesize'].forEach((ph, idx) => {
    const el = $(`#bb-step-${ph}`);
    el.classList.remove('active', 'done');
    if (bb) {
      if (bb.status === 'completed' || curIdx > idx) el.classList.add('done');
      else if (curIdx === idx && bb.status === 'running') el.classList.add('active');
    }
  });
  $('#bb-phase-text').textContent = bb?.phaseLabel || '';

  const consEl = $('#bb-consensus-card');
  if (bb?.generatedGraph && bb?.governance) {
    const g = bb.generatedGraph;
    const gov = bb.governance;
    const agentNodes = g.nodes.filter((n) => n.type === 'agent');
    consEl.classList.remove('hidden');
    consEl.innerHTML = `
      <div class="section-mini-head">
        <span style="font-size:14px;color:var(--sakura-600);">📜 圆桌共识已达成 · 自动生成 ${agentNodes.length} 个协作实体 &amp; ${g.edges.length} 条关系连线</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-soft btn-xs" id="btn-bb-load-canvas">🌸 载入画布预览/微调</button>
          <button class="btn btn-primary btn-xs" id="btn-bb-exec-canvas">🚀 按自生成画布立即执行</button>
        </div>
      </div>
      <div class="bb-consensus-grid">
        <div class="bb-gov-box"><strong>🤝 分工共识理由</strong>${esc(gov.consensusRationale)}</div>
        <div class="bb-gov-box"><strong>🛡️ 防死循环守卫</strong>${esc(gov.deadlockGuard)}${gov.brokenCyclesCount ? `（校验器已自动化解 ${gov.brokenCyclesCount} 处潜在环路）` : ''}</div>
        <div class="bb-gov-box"><strong>🏁 收敛与终止契约</strong>${esc(gov.terminationRule)}</div>
      </div>
      <div class="bb-graph-preview-pills">
        <span class="muted" style="font-weight:700;">生成实体：</span>
        ${agentNodes.map((n) => `<span class="domain-chip">🤖 ${esc(n.title)} (${esc(n.agentId)})</span>`).join('')}
      </div>
    `;
    $('#btn-bb-load-canvas').addEventListener('click', () => applyBlackboardGraph(bb.id, false));
    $('#btn-bb-exec-canvas').addEventListener('click', () => applyBlackboardGraph(bb.id, true));
  } else {
    consEl.classList.add('hidden');
  }

  const feed = $('#bb-feed');
  if (!bb || !bb.transcript?.length) {
    feed.innerHTML = `
      <div class="bb-empty-arena">
        <div style="font-size:44px;margin-bottom:10px;">🫧🌸</div>
        <h3>共享黑板议事厅已就绪</h3>
        <p>在左侧输入任意目标，指定总意图解析官并排好 1→2→3→4 发言顺序，点击<strong>「开启黑板圆桌协商」</strong>——你将实时看到各位智能体在黑板上自主认领角色、协商分工与防死循环规则，并动态在 Sakura 画布上生成它们自己的协作拓扑！</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = bb.transcript
    .map((sp) => {
      const isChair = sp.speakerId === 'intent_chair' || sp.speakerId === 'consensus_chair';
      const dur = sp.durationMs ? `${(sp.durationMs / 1000).toFixed(1)}s` : sp.status === 'speaking' ? '正在发言...' : '';
      return `
        <article class="bb-speech-card ${isChair ? 'chair' : ''} ${sp.status === 'speaking' ? 'speaking' : ''}" data-speech-id="${sp.id}">
          <div class="bb-speech-head">
            <div class="bb-speech-title">
              <span>${esc(sp.roleLabel)}</span>
              <span class="domain-chip">${esc(sp.agentName)}</span>
            </div>
            <span class="muted">${esc(dur)}</span>
          </div>
          <div class="bb-speech-body">${esc(sp.text || '🧠 正在阅读共享黑板并组织发言...')}</div>
        </article>
      `;
    })
    .join('');
}

async function applyBlackboardGraph(sessionId, execute) {
  try {
    const res = await api(`/api/blackboard/${sessionId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ execute }),
    });
    appState.graph = res.graph;
    appState.selectedNodeId = appState.graph.nodes[0]?.id || null;
    appState.selectedEdgeId = null;
    if (res.run) {
      appState.activeRunId = res.run.id;
      if (!appState.runs.find((r) => r.id === res.run.id)) appState.runs.unshift(res.run);
      renderRunsList();
      renderMessagePool();
      updateRunControls();
      switchDrawerTab('pool');
    } else {
      appState.activeRunId = null;
      updateRunControls();
    }
    switchMainTab('canvas');
    renderCanvas();
    fitToView();
    renderInspectorConfig();
  } catch (err) {
    alert(`载入自生成画布失败: ${err.message}`);
  }
}

$$('.bb-idea-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idea = BB_IDEAS[btn.dataset.idea];
    if (!idea) return;
    $('#bb-title').value = idea.title;
    $('#bb-goal').value = idea.goal;
  });
});

$('#btn-bb-start').addEventListener('click', async () => {
  const goal = $('#bb-goal').value.trim();
  if (!goal) return alert('请先输入你想让智能体团队自主协商的任务目标！');
  const title = $('#bb-title').value.trim() || goal.slice(0, 18);
  const chairAgentId = $('#bb-chair-select').value;
  const participantAgentIds = appState.bbRosterOrder.filter((r) => r.enabled).map((r) => r.id);
  if (!participantAgentIds.length) return alert('请至少勾选 1 位参会智能体成员！');
  const autoExecute = $('#bb-auto-exec').checked;
  try {
    const session = await api('/api/blackboard/start', {
      method: 'POST',
      body: JSON.stringify({ title, goal, chairAgentId, participantAgentIds, autoExecute }),
    });
    appState.activeBbId = session.id;
    if (!appState.blackboards.find((b) => b.id === session.id)) appState.blackboards.unshift(session);
    renderBlackboardHistory();
    renderBlackboardArena();
  } catch (err) {
    alert(`启动圆桌失败: ${err.message}`);
  }
});

$('#btn-bb-abort').addEventListener('click', async () => {
  const bb = getActiveBlackboard();
  if (bb) await api(`/api/blackboard/${bb.id}/abort`, { method: 'POST' });
});

// ---------------------------------------------------------------------------
// SSE Real-Time Subscription
// ---------------------------------------------------------------------------
function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('connected', () => {
    $('#sse-status').textContent = '● 实时思考流已连接';
    $('#sse-status').className = 'status-pill pill-live';
  });
  es.addEventListener('edge_pulse', (e) => {
    const { runId, edgeId, active } = JSON.parse(e.data);
    if (runId !== appState.activeRunId) return;
    if (active) appState.activeEdges.add(edgeId);
    else appState.activeEdges.delete(edgeId);
    renderEdges();
  });
  es.addEventListener('node_status', (e) => {
    const { runId, nodeId, state } = JSON.parse(e.data);
    const run = appState.runs.find((r) => r.id === runId);
    if (run) {
      run.nodeStates[nodeId] = state;
      if (runId === appState.activeRunId) {
        renderCanvas();
        if (appState.selectedNodeId === nodeId) renderThinkingStream();
      }
    }
  });
  es.addEventListener('node_thinking', (e) => {
    const { runId, nodeId, stdoutChunk, stderrChunk, thinkingPreview } = JSON.parse(e.data);
    const run = appState.runs.find((r) => r.id === runId);
    if (!run) return;
    const st = run.nodeStates[nodeId] || (run.nodeStates[nodeId] = { status: 'running', stdout: '', stderr: '' });
    if (stdoutChunk) st.stdout = ((st.stdout || '') + stdoutChunk).slice(-30000);
    if (stderrChunk) st.stderr = ((st.stderr || '') + stderrChunk).slice(-15000);
    st.thinkingPreview = thinkingPreview;
    if (runId === appState.activeRunId) {
      const box = document.querySelector(`.entity-node[data-id="${nodeId}"] .node-thinking-text`);
      if (box) box.textContent = thinkingPreview;
      if (appState.selectedNodeId === nodeId && $('#dtab-thinking').classList.contains('active')) {
        requestAnimationFrame(() => {
          const viewer = $('#stream-box');
          const combined = (st.stdout || '') + (st.stderr ? `\n\n--- THINKING / DIAGNOSTICS ---\n${st.stderr}` : '');
          viewer.textContent = combined.slice(-30000);
          viewer.scrollTop = viewer.scrollHeight;
        });
      }
    }
  });
  es.addEventListener('pool_message', (e) => {
    const { runId, record } = JSON.parse(e.data);
    const run = appState.runs.find((r) => r.id === runId);
    if (run) { run.messagePool.push(record); if (runId === appState.activeRunId) renderMessagePool(); }
  });
  es.addEventListener('run_updated', (e) => {
    const updated = JSON.parse(e.data);
    const idx = appState.runs.findIndex((r) => r.id === updated.id);
    if (idx >= 0) appState.runs[idx] = updated;
    else appState.runs.unshift(updated);
    if (appState.activeRunId === updated.id) {
      appState.activeEdges.clear();
      renderCanvas(); renderMessagePool(); renderThinkingStream(); updateRunControls();
      if (updated.status === 'completed') switchDrawerTab('deliverables');
    }
    renderRunsList();
  });

  // Blackboard Roundtable SSE events
  es.addEventListener('bb_phase', (e) => {
    const { sessionId, phase, label } = JSON.parse(e.data);
    const bb = appState.blackboards.find((b) => b.id === sessionId);
    if (bb) {
      bb.phase = phase;
      bb.phaseLabel = label;
      if (appState.activeBbId === sessionId) renderBlackboardArena();
    }
  });
  es.addEventListener('bb_speech_start', (e) => {
    const { sessionId, entry } = JSON.parse(e.data);
    const bb = appState.blackboards.find((b) => b.id === sessionId);
    if (bb) {
      bb.transcript.push(entry);
      if (appState.activeBbId === sessionId) {
        renderBlackboardArena();
        const feed = $('#bb-feed');
        feed.scrollTop = feed.scrollHeight;
      }
    }
  });
  es.addEventListener('bb_speech_chunk', (e) => {
    const { sessionId, speechId, chunk } = JSON.parse(e.data);
    const bb = appState.blackboards.find((b) => b.id === sessionId);
    const sp = bb?.transcript?.find((t) => t.id === speechId);
    if (sp) {
      sp.text += chunk;
      if (appState.activeBbId === sessionId) {
        const bodyEl = document.querySelector(`[data-speech-id="${speechId}"] .bb-speech-body`);
        if (bodyEl) bodyEl.textContent = sp.text;
        const feed = $('#bb-feed');
        feed.scrollTop = feed.scrollHeight;
      }
    }
  });
  es.addEventListener('bb_speech_done', (e) => {
    const { sessionId, entry } = JSON.parse(e.data);
    const bb = appState.blackboards.find((b) => b.id === sessionId);
    if (bb) {
      const idx = bb.transcript.findIndex((t) => t.id === entry.id);
      if (idx >= 0) bb.transcript[idx] = entry;
      if (appState.activeBbId === sessionId) renderBlackboardArena();
    }
  });
  es.addEventListener('bb_graph_ready', (e) => {
    const { sessionId, session, graph, governance } = JSON.parse(e.data);
    const idx = appState.blackboards.findIndex((b) => b.id === sessionId);
    if (idx >= 0) appState.blackboards[idx] = session;
    else appState.blackboards.unshift(session);
    appState.graph = graph;
    if (appState.activeBbId === sessionId) {
      renderBlackboardHistory();
      renderBlackboardArena();
    }
  });
  es.addEventListener('bb_run_launched', (e) => {
    const { run } = JSON.parse(e.data);
    if (!run) return;
    appState.activeRunId = run.id;
    if (!appState.runs.find((r) => r.id === run.id)) appState.runs.unshift(run);
    renderRunsList();
    renderMessagePool();
    updateRunControls();
    switchMainTab('canvas');
    switchDrawerTab('pool');
  });
  es.addEventListener('bb_failed', (e) => {
    const { sessionId, error } = JSON.parse(e.data);
    const bb = appState.blackboards.find((b) => b.id === sessionId);
    if (bb) {
      bb.status = error === '已中止' ? 'aborted' : 'failed';
      bb.phaseLabel = error;
      renderBlackboardHistory();
      if (appState.activeBbId === sessionId) renderBlackboardArena();
    }
  });

  es.onerror = () => {
    $('#sse-status').textContent = '● 重连中...';
    $('#sse-status').className = 'status-pill pill-idle';
  };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function bootstrap() {
  const [agentsRes, templatesRes, graphRes, runsRes, bbRes] = await Promise.all([
    api('/api/agents'),
    api('/api/templates'),
    api('/api/graph'),
    api('/api/runs'),
    api('/api/blackboard'),
  ]);
  appState.agents = agentsRes.agents;
  appState.envKeys = agentsRes.envKeys || [];
  appState.templates = templatesRes;
  appState.graph = graphRes;
  appState.runs = runsRes;
  appState.blackboards = bbRes.sessions || [];
  appState.bbDefaultChairId = bbRes.defaultChairAgentId;
  appState.activeBbId = appState.blackboards[0]?.id || null;
  appState.selectedNodeId = appState.graph.nodes[0]?.id || null;

  $('#template-select').innerHTML = Object.values(templatesRes)
    .map((t) => `<option value="${t.id}" ${t.id === appState.graph.id ? 'selected' : ''}>${esc(t.name)}</option>`)
    .join('');

  bindConfigInputs();
  syncBlackboardRoster();
  renderBlackboardHistory();
  renderBlackboardArena();
  renderCanvas();
  fitToView();
  renderInspectorConfig();
  renderRunsList();
  renderAgentsShowcase();
  connectSSE();
}

bootstrap().catch(console.error);
