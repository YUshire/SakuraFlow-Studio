import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
const LOCAL_APPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

function resolveFirstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function whichBin(bin) {
  return new Promise((resolve) => {
    const cmd = IS_WIN ? 'where.exe' : 'which';
    execFile(cmd, [bin], { timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const line = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      resolve(line || null);
    });
  });
}

export function runCmdCapture(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const isCmd = IS_WIN && (cmd.toLowerCase().endsWith('.cmd') || cmd.toLowerCase().endsWith('.bat'));
    const file = isCmd ? 'cmd.exe' : cmd;
    const finalArgs = isCmd ? ['/c', cmd, ...args] : args;
    execFile(file, finalArgs, { timeout: timeoutMs, windowsHide: true }, (_err, stdout, stderr) => {
      resolve(`${stdout || ''}\n${stderr || ''}`.trim());
    });
  });
}

function firstLine(s) {
  return (s || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
}

function maskKey(k = '') {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Safe Config Introspectors (Generic, Zero Hardcoded Personal Data or Secrets)
// ---------------------------------------------------------------------------
function inspectClaudeConfig() {
  const cfgPath = path.join(HOME, '.claude', 'settings.json');
  if (!fs.existsSync(cfgPath)) return { detectedModel: 'Claude Default', gateway: 'Anthropic Official', effort: 'default', mcpServers: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const env = raw.env || {};
    return {
      configPath: cfgPath,
      detectedModel: env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL || raw.model || 'Claude Default',
      gateway: env.ANTHROPIC_BASE_URL || 'Anthropic Official',
      effort: raw.effortLevel || 'default',
      mcpServers: Array.isArray(raw.enabledMcpjsonServers) ? raw.enabledMcpjsonServers : [],
    };
  } catch {
    return { detectedModel: 'Claude Default', gateway: 'Anthropic Official', effort: 'default', mcpServers: [] };
  }
}

function inspectCodexConfig() {
  const cfgPath = path.join(HOME, '.codex', 'config.toml');
  if (!fs.existsSync(cfgPath)) {
    return { detectedModel: 'Codex Default', gateway: 'OpenAI Codex', effort: 'medium', mcpServers: [], desktopCliPath: null };
  }
  try {
    const text = fs.readFileSync(cfgPath, 'utf8');
    const modelMatch = text.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
    const effortMatch = text.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m);
    const tierMatch = text.match(/^\s*service_tier\s*=\s*["']([^"']+)["']/m);
    const cliMatch = text.match(/^\s*CODEX_CLI_PATH\s*=\s*["']([^"']+)["']/m);
    const mcpMatches = [...text.matchAll(/^\[mcp_servers\.([a-zA-Z0-9_-]+)\]/gm)].map((m) => m[1]);
    return {
      configPath: cfgPath,
      detectedModel: modelMatch ? modelMatch[1] : 'Codex Default',
      gateway: `OpenAI 登录态 (${tierMatch ? tierMatch[1] : 'default'})`,
      effort: effortMatch ? effortMatch[1] : 'medium',
      mcpServers: [...new Set(mcpMatches)],
      desktopCliPath: cliMatch && fs.existsSync(cliMatch[1]) ? cliMatch[1] : null,
    };
  } catch {
    return { detectedModel: 'Codex Default', gateway: 'OpenAI Codex', effort: 'medium', mcpServers: [], desktopCliPath: null };
  }
}

function buildDshDesktopBridge(dataDir) {
  const desktopPatch = path.join(HOME, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  const wbEntry = path.join(HOME, '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-connect-workbuddy', 'lib', 'index.js');
  if (!fs.existsSync(desktopPatch) || !fs.existsSync(wbEntry)) return null;
  try {
    const raw = fs.readFileSync(desktopPatch, 'utf8');
    const lines = raw.split(/\r?\n/);
    const blocks = [];
    let cur = [];
    for (const l of lines) {
      if (/^- id:/.test(l)) {
        if (cur.length) blocks.push(cur.join('\n'));
        cur = [l];
      } else if (cur.length) cur.push(l);
    }
    if (cur.length) blocks.push(cur.join('\n'));
    const wb = blocks.find((b) => b.startsWith('- id: dsh-connect-workbuddy'));
    const def = blocks.find((b) => b.startsWith('- id: agent-default-model'));
    const defTuned = def ? def.replace(/reasoningEffort:\s*max/, 'reasoningEffort: high') : '';
    if (!wb) return null;
    const pluginUrl = 'file:///' + wbEntry.replace(/\\/g, '/');
    const wbFixed = wb.replace(/name:\s*dsh-connect-workbuddy/, `name: ${pluginUrl}`);
    const indentedWb = wbFixed.split('\n').map((l) => `    ${l}`).join('\n');
    const bridgePath = path.join(dataDir, 'dsh_workbuddy_bridge.yml');
    fs.writeFileSync(bridgePath, `- insert:\n${indentedWb}\n${defTuned}\n`, 'utf8');
    // Also generate a quota-fallback bridge using hy4std in case deepseek-v4.1-flash hits 429 rate limits
    const fallbackDef = defTuned.replace(/model:\s*[^\r\n]+/, 'model: hy4std');
    const fallbackPath = path.join(dataDir, 'dsh_workbuddy_fallback.yml');
    fs.writeFileSync(fallbackPath, `- insert:\n${indentedWb}\n${fallbackDef}\n`, 'utf8');
    return bridgePath;
  } catch {
    return null;
  }
}

function inspectDshConfig() {
  const desktopPatch = path.join(HOME, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  const importedPath = path.join(HOME, '.dsh', 'settings.yaml.imported');
  const target = fs.existsSync(desktopPatch) ? desktopPatch : importedPath;
  if (!fs.existsSync(target)) return { detectedModel: 'DeepSeek Default', gateway: 'deepseek-official', effort: 'high', mcpServers: [] };
  try {
    const text = fs.readFileSync(target, 'utf8');
    const defIdx = text.indexOf('agent-default-model');
    const slice = defIdx >= 0 ? text.slice(defIdx, defIdx + 300) : text;
    const providerMatch = slice.match(/^\s+provider:\s*([^\r\n]+)/m);
    const modelMatch = slice.match(/^\s+model:\s*([^\r\n]+)/m);
    const effortMatch = slice.match(/^\s+reasoningEffort:\s*([^\r\n]+)/m);
    return {
      configPath: target,
      detectedModel: modelMatch ? modelMatch[1].trim() : 'DeepSeek Default',
      gateway: providerMatch ? `${providerMatch[1].trim()} (复用桌面登录态)` : 'deepseek-official',
      effort: effortMatch ? effortMatch[1].trim() : 'high',
      mcpServers: [],
    };
  } catch {
    return { detectedModel: 'DeepSeek Default', gateway: 'deepseek-official', effort: 'high', mcpServers: [] };
  }
}

async function inspectAgyModels(agyPath) {
  if (!agyPath) return [];
  const raw = await runCmdCapture(agyPath, ['models'], 6000);
  const models = [];
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\t+/);
    if (parts.length >= 2 && /^[a-z0-9-]+$/i.test(parts[0])) {
      models.push({ id: parts[0], label: parts[1] });
    }
  }
  return models;
}

async function inspectOllamaModels() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Universal Local + Remote Agent Discovery
// ---------------------------------------------------------------------------
export async function discoverAllAgents({ dataDir, remoteAgents = [], sshHosts = [], savedProfiles = {} }) {
  const claudeCfg = inspectClaudeConfig();
  const codexCfg = inspectCodexConfig();
  const dshCfg = inspectDshConfig();
  const dshBridge = buildDshDesktopBridge(dataDir);
  const dshFallbackBridge = dshBridge ? path.join(dataDir, 'dsh_workbuddy_fallback.yml') : null;

  const [
    agyBin,
    claudeBin,
    codexBin,
    dshBin,
    geminiBin,
    opencodeBin,
    aiderBin,
    ollamaBin,
    ollamaModels,
  ] = await Promise.all([
    Promise.resolve(
      resolveFirstExisting([
        path.join(LOCAL_APPDATA, 'agy', 'bin', IS_WIN ? 'agy.exe' : 'agy'),
        path.join(HOME, '.local', 'bin', 'agy'),
      ])
    ).then((p) => p || whichBin('agy')),
    Promise.resolve(
      resolveFirstExisting([
        path.join(HOME, '.local', 'bin', IS_WIN ? 'claude.exe' : 'claude'),
        path.join(APPDATA, 'npm', 'claude.cmd'),
      ])
    ).then((p) => p || whichBin(IS_WIN ? 'claude.exe' : 'claude')),
    Promise.resolve(
      codexCfg.desktopCliPath ||
        resolveFirstExisting([
          path.join(APPDATA, 'npm', 'codex.cmd'),
          'C:\\Program Files\\nodejs\\node_global\\codex.cmd',
        ])
    ).then((p) => p || whichBin(IS_WIN ? 'codex.cmd' : 'codex') || whichBin('codex')),
    Promise.resolve(
      resolveFirstExisting([
        path.join(LOCAL_APPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      ])
    ).then((p) => p || whichBin('dsh')),
    whichBin(IS_WIN ? 'gemini.cmd' : 'gemini').then((p) => p || whichBin('gemini')),
    whichBin('opencode'),
    whichBin('aider'),
    Promise.resolve(
      resolveFirstExisting([path.join(LOCAL_APPDATA, 'Programs', 'Ollama', 'ollama.exe')])
    ).then((p) => p || whichBin('ollama')),
    inspectOllamaModels(),
  ]);

  const [agyVer, claudeVer, codexVer, dshVer, geminiVer, opencodeVer, aiderVer, agyModels] = await Promise.all([
    agyBin ? runCmdCapture(agyBin, ['--version'], 4000) : '',
    claudeBin ? runCmdCapture(claudeBin, ['--version'], 4000) : '',
    codexBin ? runCmdCapture(codexBin, ['--version'], 4000) : '',
    dshBin ? runCmdCapture(dshBin, ['--version'], 4000) : '',
    geminiBin ? runCmdCapture(geminiBin, ['--version'], 4000) : '',
    opencodeBin ? runCmdCapture(opencodeBin, ['--version'], 4000) : '',
    aiderBin ? runCmdCapture(aiderBin, ['--version'], 4000) : '',
    inspectAgyModels(agyBin),
  ]);

  const localCatalog = [
    {
      id: 'agy',
      mode: 'local_cli',
      name: 'Antigravity',
      shortName: 'AGY',
      vendor: 'Google DeepMind',
      installed: Boolean(agyBin),
      executable: agyBin,
      version: firstLine(agyVer) || 'not installed',
      headlessSupported: Boolean(agyBin),
      accent: '#ec4899',
      modelConfig: {
        currentModel: agyModels[0]?.label || 'Antigravity Default',
        gateway: '本地 Antigravity 登录态',
        effort: 'low / medium / high / xhigh',
        availableModels: agyModels.slice(0, 12),
        mcpServers: [],
      },
      invocationPreview: 'agy --dangerously-skip-permissions -p="<prompt>"',
    },
    {
      id: 'claude',
      mode: 'local_cli',
      name: 'Claude Code',
      shortName: 'CLAUDE',
      vendor: 'Anthropic CLI',
      installed: Boolean(claudeBin),
      executable: claudeBin,
      version: firstLine(claudeVer) || 'not installed',
      headlessSupported: Boolean(claudeBin),
      accent: '#f43f5e',
      modelConfig: {
        currentModel: claudeCfg.detectedModel,
        gateway: claudeCfg.gateway,
        effort: claudeCfg.effort,
        availableModels: [],
        mcpServers: claudeCfg.mcpServers,
      },
      invocationPreview: 'claude -p --dangerously-skip-permissions (stdin)',
    },
    {
      id: 'codex',
      mode: 'local_cli',
      name: 'OpenAI Codex CLI',
      shortName: 'CODEX',
      vendor: 'OpenAI',
      installed: Boolean(codexBin),
      executable: codexBin,
      version: firstLine(codexVer) || 'not installed',
      headlessSupported: Boolean(codexBin),
      accent: '#db2777',
      modelConfig: {
        currentModel: codexCfg.detectedModel,
        gateway: codexCfg.gateway,
        effort: codexCfg.effort,
        availableModels: [],
        mcpServers: codexCfg.mcpServers,
      },
      invocationPreview: 'codex exec --skip-git-repo-check -s workspace-write -C <dir> -',
    },
    {
      id: 'dsh',
      mode: 'local_cli',
      name: 'DeepSeek Harness',
      shortName: 'DSH',
      vendor: 'DeepSeek',
      installed: Boolean(dshBin),
      executable: dshBin,
      bridgePatch: dshBridge,
      fallbackBridgePatch: dshFallbackBridge,
      version: firstLine(dshVer) || 'not installed',
      headlessSupported: Boolean(dshBin),
      accent: '#a855f7',
      modelConfig: {
        currentModel: dshCfg.detectedModel,
        gateway: dshCfg.gateway,
        effort: dshCfg.effort,
        availableModels: [],
        mcpServers: [],
      },
      invocationPreview: dshBridge ? 'dsh headless --patch <desktop-bridge> -' : 'dsh headless -',
    },
    {
      id: 'gemini',
      mode: 'local_cli',
      name: 'Gemini CLI',
      shortName: 'GEM',
      vendor: 'Google',
      installed: Boolean(geminiBin),
      executable: geminiBin,
      version: firstLine(geminiVer) || 'not installed',
      headlessSupported: Boolean(geminiBin),
      accent: '#f472b6',
      modelConfig: {
        currentModel: 'Gemini CLI Default',
        gateway: '本地 Gemini CLI 登录态',
        effort: 'default',
        availableModels: [],
        mcpServers: [],
      },
      invocationPreview: 'gemini -p "<prompt>"',
    },
    {
      id: 'opencode',
      mode: 'local_cli',
      name: 'OpenCode CLI',
      shortName: 'OC',
      vendor: 'OpenCode',
      installed: Boolean(opencodeBin),
      executable: opencodeBin,
      version: firstLine(opencodeVer) || 'not installed',
      headlessSupported: Boolean(opencodeBin),
      accent: '#fb7185',
      modelConfig: {
        currentModel: 'OpenCode Default',
        gateway: '本地 OpenCode 配置',
        effort: 'default',
        availableModels: [],
        mcpServers: [],
      },
      invocationPreview: 'opencode run "<prompt>"',
    },
    {
      id: 'aider',
      mode: 'local_cli',
      name: 'Aider CLI',
      shortName: 'AIDER',
      vendor: 'Aider',
      installed: Boolean(aiderBin),
      executable: aiderBin,
      version: firstLine(aiderVer) || 'not installed',
      headlessSupported: Boolean(aiderBin),
      accent: '#e879f9',
      modelConfig: {
        currentModel: 'Aider Configured Model',
        gateway: '本地 Aider 配置',
        effort: 'default',
        availableModels: [],
        mcpServers: [],
      },
      invocationPreview: 'aider --yes-always --message "<prompt>"',
    },
    {
      id: 'ollama',
      mode: 'local_ollama',
      name: 'Ollama Local',
      shortName: 'OLLAMA',
      vendor: 'Local LLM Runtime',
      installed: Boolean(ollamaBin) || ollamaModels.length > 0,
      executable: ollamaBin || 'http://127.0.0.1:11434',
      version: ollamaModels.length > 0 ? `Running (${ollamaModels.length} models)` : ollamaBin ? 'Installed (service stopped)' : 'not installed',
      headlessSupported: ollamaModels.length > 0,
      accent: '#9d7a8d',
      modelConfig: {
        currentModel: ollamaModels[0] || '未启动本地 Ollama 服务',
        gateway: 'http://127.0.0.1:11434',
        effort: 'local',
        availableModels: ollamaModels.map((m) => ({ id: m, label: m })),
        mcpServers: [],
      },
      invocationPreview: 'POST http://127.0.0.1:11434/api/chat',
    },
  ];

  // User-configured Remote API Agents (OpenAI-compatible or Anthropic-compatible)
  const remoteEntries = remoteAgents.map((r) => ({
    id: r.id,
    mode: 'remote_api',
    name: r.name,
    shortName: (r.shortName || 'API').slice(0, 6).toUpperCase(),
    vendor: r.protocol === 'anthropic' ? 'Anthropic API Compatible' : 'OpenAI API Compatible',
    installed: true,
    executable: r.baseUrl,
    version: 'Remote API',
    headlessSupported: true,
    accent: r.accent || '#ec4899',
    remoteConfig: {
      protocol: r.protocol || 'openai',
      baseUrl: r.baseUrl,
      model: r.model,
      apiKeyMasked: maskKey(r.apiKey),
      hasApiKey: Boolean(r.apiKey),
    },
    // Internal secret kept only in memory for runner; stripped before HTTP response via sanitizeAgentsForClient
    _apiKey: r.apiKey,
    modelConfig: {
      currentModel: r.model,
      gateway: r.baseUrl,
      effort: 'remote',
      availableModels: [],
      mcpServers: [],
    },
    invocationPreview: `${r.protocol === 'anthropic' ? 'POST /messages' : 'POST /chat/completions'} (${r.model})`,
  }));

  // User-configured SSH Remote Compute / GPU Servers
  const sshEntries = sshHosts.map((s) => ({
    id: s.id,
    mode: 'ssh_remote',
    name: s.name,
    shortName: (s.shortName || 'SSH').slice(0, 6).toUpperCase(),
    vendor: `SSH Remote (${s.username}@${s.host}:${s.port || 22})`,
    installed: true,
    executable: `ssh://${s.username}@${s.host}:${s.port || 22}`,
    version: 'SSH Compute',
    headlessSupported: true,
    accent: s.accent || '#7c3aed',
    sshConfig: s,
    modelConfig: {
      currentModel: s.gpuSummary || `远程执行器: ${s.runnerTemplate || 'python3'}`,
      gateway: `${s.username}@${s.host}:${s.port || 22} (${s.remoteWorkdir || '~/sakuraflow_workspace'})`,
      effort: 'remote_gpu',
      availableModels: [],
      mcpServers: [],
    },
    invocationPreview: `ssh -p ${s.port || 22} ${s.username}@${s.host} (${s.runnerTemplate})`,
  }));

  const simulatorEntry = {
    id: 'simulator',
    mode: 'simulator',
    name: 'Sakura Simulator',
    shortName: 'SIM',
    vendor: 'Built-in Dry-Run Engine',
    installed: true,
    executable: 'internal://sakura-simulator',
    version: '3.0.0',
    headlessSupported: true,
    accent: '#fb7185',
    modelConfig: {
      currentModel: '内置流式思考演练引擎 (零消耗)',
      gateway: 'In-Process',
      effort: 'instant',
      availableModels: [],
      mcpServers: [],
    },
    invocationPreview: 'internal://sakura-simulator',
  };

  // Merge user-authorized dynamic profiles (savedProfiles[id]) cleanly
  const all = [...localCatalog, ...remoteEntries, ...sshEntries, simulatorEntry].map((agent) => {
    const prof = savedProfiles[agent.id];
    if (agent.id === 'simulator') {
      return {
        ...agent,
        profileStatus: 'verified',
        profile: {
          verifiedAt: new Date().toISOString(),
          latencyMs: 350,
          reportedModel: 'Built-in Simulator',
          scores: { planning: 80, coding: 80, research: 80, review: 80, speed: 100, tooling: 100 },
          bestDomains: ['零成本演练画布连线', '验证并行分支与打回闭环', '录制演示视频'],
          summary: '内置模拟智能体，无需任何外部环境或 API Key 即可完整演练多智能体协作流程。',
          watchouts: '仅输出模拟报告，正式任务请切换为已授权验证的本地 CLI 或远程 API 智能体。',
        },
      };
    }

    if (prof) {
      return {
        ...agent,
        profileStatus: prof.status || 'verified',
        profile: prof,
      };
    }

    return {
      ...agent,
      profileStatus: agent.installed ? 'unverified' : 'not_installed',
      profile: {
        scores: null,
        bestDomains: [],
        summary: agent.installed
          ? '已探测到该智能体。点击「🔐 授权自检并生成画像」后，系统将向它发起一次轻量探测，动态获取其真实响应速度、可用状态与领域能力画像。'
          : '当前环境中未检测到此 CLI（可按需安装，或在上方添加远程 API Key 模型替代）。',
        watchouts: agent.installed
          ? '尚未完成用户授权自检；建议先点击「授权自检」确认本机登录态或 API 连通性正常。'
          : '未安装。',
      },
    };
  });

  return all;
}

export function sanitizeAgentsForClient(agents) {
  return agents.map(({ _apiKey, ...rest }) => rest);
}

export function createRemoteAgentRecord(input) {
  return {
    id: input.id || `api_${crypto.randomBytes(3).toString('hex')}`,
    name: String(input.name || 'Custom API Agent').trim(),
    shortName: String(input.shortName || 'API').trim().slice(0, 6).toUpperCase(),
    protocol: input.protocol === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: String(input.baseUrl || '').trim().replace(/\/+$/, ''),
    model: String(input.model || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
    accent: input.accent || '#ec4899',
    createdAt: new Date().toISOString(),
  };
}
