import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { executeSshTask } from './ssh.mjs';

function findLatestDshSessionIdForCwd(cwd) {
  try {
    const slug = `--${path.resolve(cwd).replace(/[:\\/]+/g, '-')}--`;
    const sessDir = path.join(os.homedir(), '.dsh', 'sessions', slug);
    if (!fs.existsSync(sessDir)) return null;
    const dirs = fs
      .readdirSync(sessDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('session-'))
      .map((d) => ({ name: d.name, mtimeMs: fs.statSync(path.join(sessDir, d.name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return dirs[0]?.name || null;
  } catch {
    return null;
  }
}

export function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch {}
  } else {
    try { child.kill('SIGTERM'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// 1. Remote OpenAI-Compatible & Anthropic-Compatible Streaming Runner
// ---------------------------------------------------------------------------
async function executeRemoteApi({ agent, prompt, modelOverride, systemPrompt, idleTimeoutMs = 120000, onChunk, abortController }) {
  const startTime = Date.now();
  const cfg = agent.remoteConfig;
  const apiKey = agent._apiKey;
  if (!cfg?.baseUrl || !apiKey) {
    return { ok: false, exitCode: -1, stdout: '', stderr: '缺少 Remote API 的 Base URL 或 API Key。', durationMs: 0 };
  }

  const model = modelOverride || cfg.model;
  const controller = abortController || new AbortController();
  let idleTimer = setTimeout(() => controller.abort(new Error('Remote API stream idle timeout')), idleTimeoutMs);
  const bump = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(new Error('Remote API stream idle timeout')), idleTimeoutMs);
  };

  let stdout = '';
  let stderr = '';

  try {
    if (cfg.protocol === 'anthropic') {
      const endpoint = cfg.baseUrl.endsWith('/messages') ? cfg.baseUrl : `${cfg.baseUrl}/messages`;
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          stream: true,
          system: systemPrompt || undefined,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        clearTimeout(idleTimer);
        return { ok: false, exitCode: res.status, stdout: '', stderr: `HTTP ${res.status}: ${errText.slice(0, 600)}`, durationMs: Date.now() - startTime };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bump();
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === 'content_block_delta' && evt.delta) {
              if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
                stderr += evt.delta.thinking;
                onChunk?.('stderr', evt.delta.thinking);
              } else if (evt.delta.type === 'text_delta' && evt.delta.text) {
                stdout += evt.delta.text;
                onChunk?.('stdout', evt.delta.text);
              }
            }
          } catch {}
        }
      }
    } else {
      // OpenAI-Compatible /chat/completions (supports DeepSeek, OpenAI, OpenRouter, SiliconFlow, vLLM, etc.)
      const endpoint = cfg.baseUrl.endsWith('/chat/completions')
        ? cfg.baseUrl
        : `${cfg.baseUrl}/chat/completions`;
      const messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
      });

      if (!res.ok) {
        const errText = await res.text();
        clearTimeout(idleTimer);
        return { ok: false, exitCode: res.status, stdout: '', stderr: `HTTP ${res.status}: ${errText.slice(0, 600)}`, durationMs: Date.now() - startTime };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bump();
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload);
            const delta = evt.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              stderr += delta.reasoning_content;
              onChunk?.('stderr', delta.reasoning_content);
            }
            if (delta?.content) {
              stdout += delta.content;
              onChunk?.('stdout', delta.content);
            }
          } catch {}
        }
      }
    }

    clearTimeout(idleTimer);
    return { ok: true, exitCode: 0, stdout, stderr, durationMs: Date.now() - startTime };
  } catch (err) {
    clearTimeout(idleTimer);
    return {
      ok: false,
      exitCode: err.name === 'AbortError' ? 124 : -1,
      stdout,
      stderr: stderr + `\n[Remote API Error] ${err.message}`,
      durationMs: Date.now() - startTime,
    };
  }
}

// ---------------------------------------------------------------------------
// 2. Local Ollama Streaming Runner
// ---------------------------------------------------------------------------
async function executeOllama({ agent, prompt, modelOverride, idleTimeoutMs = 180000, onChunk, abortController }) {
  const startTime = Date.now();
  const model = modelOverride || agent.modelConfig?.currentModel;
  const controller = abortController || new AbortController();
  let idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
  let stdout = '';
  try {
    const res = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true }),
    });
    if (!res.ok) {
      clearTimeout(idleTimer);
      return { ok: false, exitCode: res.status, stdout: '', stderr: await res.text(), durationMs: Date.now() - startTime };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          if (j.message?.content) {
            stdout += j.message.content;
            onChunk?.('stdout', j.message.content);
          }
        } catch {}
      }
    }
    clearTimeout(idleTimer);
    return { ok: true, exitCode: 0, stdout, stderr: '', durationMs: Date.now() - startTime };
  } catch (err) {
    clearTimeout(idleTimer);
    return { ok: false, exitCode: -1, stdout, stderr: err.message, durationMs: Date.now() - startTime };
  }
}

// ---------------------------------------------------------------------------
// 3. Unified Agent Executor (Local CLI + Remote API + Ollama + Simulator)
// ---------------------------------------------------------------------------
export function executeAgent({
  agent,
  prompt,
  systemPrompt = '',
  cwd,
  modelOverride = '',
  envOverrides = {},
  idleTimeoutMs = 360000,
  maxTimeoutMs = 1800000,
  onChunk,
  childSet,
  abortSet,
}) {
  if (agent.mode === 'ssh_remote') {
    return executeSshTask({ agent, prompt, cwd, idleTimeoutMs, maxTimeoutMs, onChunk, childSet });
  }

  if (agent.mode === 'remote_api') {
    const ctrl = new AbortController();
    abortSet?.add(ctrl);
    return executeRemoteApi({ agent, prompt, systemPrompt, modelOverride, idleTimeoutMs, onChunk, abortController: ctrl }).finally(() =>
      abortSet?.delete(ctrl)
    );
  }

  if (agent.mode === 'local_ollama') {
    const ctrl = new AbortController();
    abortSet?.add(ctrl);
    return executeOllama({ agent, prompt, modelOverride, idleTimeoutMs, onChunk, abortController: ctrl }).finally(() =>
      abortSet?.delete(ctrl)
    );
  }

  return new Promise((resolve) => {
    const startTime = Date.now();

    if (agent.id === 'simulator' || agent.mode === 'simulator') {
      const steps = [
        '🧠 [Thinking] 正在解析上游共享消息池与研究/工程上下文...',
        '🔍 [Thinking] 检查共享工作空间产物结构，推导核心论点与交付大纲...',
        '✨ [Thinking] 校验结论一致性并生成结构化交付报告...',
        `# 模拟交付成果摘要\n\n- **执行模式**：Sakura Simulator（零成本演练）\n- **共享工作空间**：\`${cwd}\`\n- **核心结论**：已完成当前节点的推演与结构化产出，所有要点已同步至共享消息池并交付给下游实体。\n\nVERDICT: PASS`,
      ];
      let idx = 0;
      const timer = setInterval(() => {
        if (idx < steps.length) {
          onChunk?.('stdout', steps[idx++] + '\n');
        } else {
          clearInterval(timer);
          resolve({ ok: true, exitCode: 0, stdout: steps.join('\n'), stderr: '', durationMs: Date.now() - startTime });
        }
      }, 420);
      return;
    }

    if (!agent.installed || !agent.executable) {
      return resolve({
        ok: false,
        exitCode: -1,
        stdout: '',
        stderr: `智能体 "${agent.name}" 未安装或不可用。`,
        durationMs: 0,
      });
    }

    const env = { ...process.env, ...envOverrides };
    const isWinCmd =
      process.platform === 'win32' &&
      (agent.executable.toLowerCase().endsWith('.cmd') || agent.executable.toLowerCase().endsWith('.bat'));

    let file = agent.executable;
    let args = [];
    let useStdin = true;

    if (agent.id === 'agy') {
      args = ['--dangerously-skip-permissions', '--effort', 'medium'];
      if (modelOverride) args.push('--model', modelOverride);
      args.push(`-p=${prompt}`);
      useStdin = false;
    } else if (agent.id === 'claude') {
      args = ['-p', '--dangerously-skip-permissions'];
      if (modelOverride) args.push('--model', modelOverride);
      useStdin = true;
    } else if (agent.id === 'codex') {
      const codexArgs = ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', cwd];
      if (modelOverride) codexArgs.push('-m', modelOverride);
      codexArgs.push('-');
      file = isWinCmd ? 'cmd.exe' : agent.executable;
      args = isWinCmd ? ['/c', agent.executable, ...codexArgs] : codexArgs;
      useStdin = true;
    } else if (agent.id === 'dsh') {
      const dshArgs = ['headless'];
      if (agent.bridgePatch && fs.existsSync(agent.bridgePatch)) {
        dshArgs.push('--patch', agent.bridgePatch);
      }
      if (agent._resumeSessionId) {
        dshArgs.push('--session-id', agent._resumeSessionId);
      }
      dshArgs.push('-');
      file = isWinCmd ? 'cmd.exe' : agent.executable;
      args = isWinCmd ? ['/c', agent.executable, ...dshArgs] : dshArgs;
      useStdin = true;
    } else if (agent.id === 'gemini') {
      const gArgs = ['-p', prompt];
      if (modelOverride) gArgs.unshift('-m', modelOverride);
      file = isWinCmd ? 'cmd.exe' : agent.executable;
      args = isWinCmd ? ['/c', agent.executable, ...gArgs] : gArgs;
      useStdin = false;
    } else if (agent.id === 'opencode') {
      const ocArgs = ['run', prompt];
      file = isWinCmd ? 'cmd.exe' : agent.executable;
      args = isWinCmd ? ['/c', agent.executable, ...ocArgs] : ocArgs;
      useStdin = false;
    } else if (agent.id === 'aider') {
      const aArgs = ['--yes-always', '--no-auto-commits', '--message', prompt];
      if (modelOverride) aArgs.unshift('--model', modelOverride);
      file = isWinCmd ? 'cmd.exe' : agent.executable;
      args = isWinCmd ? ['/c', agent.executable, ...aArgs] : aArgs;
      useStdin = false;
    } else {
      return resolve({ ok: false, exitCode: -1, stdout: '', stderr: `暂不支持此 CLI 适配器: ${agent.id}`, durationMs: 0 });
    }

    let child;
    try {
      child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, exitCode: -1, stdout: '', stderr: err.message, durationMs: Date.now() - startTime });
    }

    childSet?.add(child);
    let stdout = '';
    let stderr = '';
    let finished = false;
    let idleTimer = null;

    const terminateForTimeout = (reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      childSet?.delete(child);
      killProcessTree(child);
      resolve({
        ok: false,
        exitCode: 124,
        stdout,
        stderr: stderr + `\n[Timeout] ${reason}`,
        durationMs: Date.now() - startTime,
      });
    };

    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => terminateForTimeout(`连续 ${Math.round(idleTimeoutMs / 1000)}s 无新输出，已自动清理进程树。`),
        idleTimeoutMs
      );
    };

    const hardTimer = setTimeout(
      () => terminateForTimeout(`总运行时间超过上限 ${Math.round(maxTimeoutMs / 60000)} 分钟，已清理进程树。`),
      maxTimeoutMs
    );
    resetIdleTimer();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (finished) return;
      resetIdleTimer();
      stdout += d;
      onChunk?.('stdout', d);
    });
    child.stderr.on('data', (d) => {
      if (finished) return;
      resetIdleTimer();
      stderr += d;
      onChunk?.('stderr', d);
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      childSet?.delete(child);
      resolve({ ok: false, exitCode: -1, stdout, stderr: stderr + '\n' + err.message, durationMs: Date.now() - startTime });
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      childSet?.delete(child);

      // Automatic DSH 429 Quota Fallback & Session Continuation
      const isDshQuota429 =
        agent.id === 'dsh' &&
        code !== 0 &&
        /QUOTA:\s*429|quota_exceeded|被限流/i.test(`${stderr}\n${stdout}`) &&
        agent.fallbackBridgePatch &&
        fs.existsSync(agent.fallbackBridgePatch) &&
        !agent._usingFallback;

      if (isDshQuota429) {
        const latestSessId = findLatestDshSessionIdForCwd(cwd);
        onChunk?.(
          'stderr',
          `\n[SakuraFlow Auto-Heal] 检测到 DSH 默认模型触发 429 额度限流，已自动切换备用模型 (hy4std)${
            latestSessId ? ` 并从断点会话 ${latestSessId} 原地续跑` : ''
          }...\n`
        );
        const fallbackAgent = { ...agent, bridgePatch: agent.fallbackBridgePatch, _usingFallback: true, _resumeSessionId: latestSessId };
        executeAgent({
          agent: fallbackAgent,
          prompt: latestSessId
            ? 'Continue directly from where you were interrupted by the 429 rate limit. Do NOT redo completed work; finish any remaining step and output your final summary.'
            : prompt,
          systemPrompt,
          cwd,
          modelOverride,
          envOverrides,
          idleTimeoutMs,
          maxTimeoutMs,
          onChunk,
          childSet,
          abortSet,
        }).then(resolve);
        return;
      }

      resolve({ ok: code === 0, exitCode: code ?? -1, stdout, stderr, durationMs: Date.now() - startTime });
    });

    if (useStdin) {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

// ---------------------------------------------------------------------------
// 4. Authorized Live Self-Profiling Prompt (Generates Real Dynamic Agent Card)
// ---------------------------------------------------------------------------
export async function profileAgentLive({ agent, cwd, envOverrides = {} }) {
  const prompt = [
    'You are being inspected by SakuraFlow Studio to build your real capability card for the user.',
    'Do NOT write or edit any files. Reply with ONLY one valid JSON object (no markdown fences, no extra prose) in this exact schema:',
    '{',
    '  "reportedModel": "your actual model name or identifier",',
    '  "scores": { "planning": 0-100, "coding": 0-100, "research": 0-100, "review": 0-100, "speed": 0-100, "tooling": 0-100 },',
    '  "bestDomains": ["3-4 concise Chinese domain tags you excel at"],',
    '  "summary": "2 concise Chinese sentences explaining your core strengths and ideal role in a multi-agent workflow",',
    '  "watchouts": "1 concise Chinese sentence about limitations or best usage tip"',
    '}',
  ].join('\n');

  const res = await executeAgent({
    agent,
    prompt,
    cwd,
    envOverrides,
    idleTimeoutMs: 45000,
    maxTimeoutMs: 60000,
  });

  if (!res.ok) {
    const rawErr = (res.stderr || res.stdout || '探测失败').trim();
    let diagnosis = rawErr.slice(0, 320);
    if (/MISSING_CREDENTIAL|API_KEY|401|403|unauthorized/i.test(rawErr)) {
      diagnosis = `鉴权未通过或缺少凭据（请先在本地登录该软件，或注入对应 API Key）：${rawErr.slice(0, 200)}`;
    }
    return {
      ok: false,
      status: 'auth_or_error',
      verifiedAt: new Date().toISOString(),
      latencyMs: res.durationMs,
      error: diagnosis,
      scores: null,
      bestDomains: [],
      summary: `授权探测未通过：${diagnosis}`,
      watchouts: '请确认该智能体已在本地完成登录/配置，或改用远程 API Key 模式。',
    };
  }

  // Try parsing JSON from stdout (handling optional markdown code fences)
  let parsed = null;
  const text = (res.stdout || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {}
  }

  const clamp = (v, fb = 85) => Math.max(40, Math.min(100, Number(v) || fb));
  const speedScore = res.durationMs < 5000 ? 96 : res.durationMs < 12000 ? 88 : 78;

  return {
    ok: true,
    status: 'verified',
    verifiedAt: new Date().toISOString(),
    latencyMs: res.durationMs,
    reportedModel: parsed?.reportedModel || agent.modelConfig?.currentModel || agent.name,
    scores: {
      planning: clamp(parsed?.scores?.planning, 88),
      coding: clamp(parsed?.scores?.coding, 88),
      research: clamp(parsed?.scores?.research, 88),
      review: clamp(parsed?.scores?.review, 88),
      speed: clamp(parsed?.scores?.speed, speedScore),
      tooling: clamp(parsed?.scores?.tooling, agent.mode === 'local_cli' ? 92 : 76),
    },
    bestDomains:
      Array.isArray(parsed?.bestDomains) && parsed.bestDomains.length
        ? parsed.bestDomains.slice(0, 4)
        : ['任务规划与拆解', '专业内容生成', '逻辑校验与审查'],
    summary:
      parsed?.summary ||
      `已通过实机授权探测（耗时 ${(res.durationMs / 1000).toFixed(1)}s），可直接在画布上作为协作实体运行。`,
    watchouts:
      parsed?.watchouts ||
      (agent.mode === 'local_cli'
        ? '运行于本地 CLI 模式，直接读写共享工作空间并复用你的本机登录态。'
        : '运行于远程 API 流式模式，直接通过 Base URL + API Key 调度。'),
  };
}
