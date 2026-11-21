import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { killProcessTree } from './runners.mjs';

export function createSshHostRecord(input) {
  return {
    id: input.id || `ssh_${crypto.randomBytes(3).toString('hex')}`,
    name: String(input.name || 'Remote GPU Server').trim(),
    shortName: String(input.shortName || 'GPU').trim().slice(0, 6).toUpperCase(),
    host: String(input.host || '').trim(),
    port: Number(input.port) || 22,
    username: String(input.username || 'root').trim(),
    identityFile: String(input.identityFile || '').trim(),
    remoteWorkdir: String(input.remoteWorkdir || '~/sakuraflow_workspace').trim(),
    runnerTemplate: String(input.runnerTemplate || 'python3').trim(), // e.g., "python3", "conda run -n ml python", "claude -p", "bash"
    accent: input.accent || '#7c3aed',
    createdAt: new Date().toISOString(),
  };
}

function buildSshBaseArgs(hostCfg, connectTimeoutSec = 10) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `ConnectTimeout=${connectTimeoutSec}`,
    '-p', String(hostCfg.port || 22),
  ];
  if (hostCfg.identityFile) {
    args.push('-i', hostCfg.identityFile);
  }
  args.push(`${hostCfg.username}@${hostCfg.host}`);
  return args;
}

// ---------------------------------------------------------------------------
// 1. Probe Remote Server (OS + GPU nvidia-smi + Python/Conda Environment)
// ---------------------------------------------------------------------------
export function probeSshHost(hostCfg, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    if (!hostCfg?.host || !hostCfg?.username) {
      return resolve({ ok: false, error: '缺少 SSH 主机地址或用户名', durationMs: 0 });
    }

    const remoteProbeCmd = [
      'echo "===OS==="',
      'uname -srm 2>/dev/null || ver',
      'echo "===GPU==="',
      'nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader 2>/dev/null || echo "NO_NVIDIA_SMI"',
      'echo "===ENV==="',
      'python3 --version 2>/dev/null || python --version 2>/dev/null || echo "NO_PYTHON"',
      'which conda 2>/dev/null || echo ""',
    ].join(' ; ');

    const args = [...buildSshBaseArgs(hostCfg, 8), remoteProbeCmd];
    let child;
    try {
      child = spawn('ssh', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, error: `无法启动本机 ssh 客户端: ${err.message}`, durationMs: Date.now() - startTime });
    }

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      killProcessTree(child);
      resolve({ ok: false, error: 'SSH 连接超时（请检查主机 IP、端口与免密密钥配置）', durationMs: Date.now() - startTime });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, durationMs: Date.now() - startTime });
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        return resolve({
          ok: false,
          exitCode: code,
          error: (stderr || stdout || `SSH exited with code ${code}`).trim().slice(0, 320),
          durationMs: Date.now() - startTime,
        });
      }

      const osPart = (stdout.split('===OS===')[1] || '').split('===GPU===')[0]?.trim() || 'Linux';
      const gpuPart = (stdout.split('===GPU===')[1] || '').split('===ENV===')[0]?.trim() || 'NO_NVIDIA_SMI';
      const envPart = (stdout.split('===ENV===')[1] || '').trim().split(/\r?\n/)[0] || '';

      const gpus =
        gpuPart && !gpuPart.includes('NO_NVIDIA_SMI')
          ? gpuPart.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
          : [];

      resolve({
        ok: true,
        exitCode: 0,
        osInfo: osPart,
        gpus,
        gpuSummary: gpus.length ? gpus.join(' | ') : 'CPU 节点 (未检测到 NVIDIA GPU)',
        pythonInfo: envPart,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 2. Execute Task / Script / Remote Agent over SSH
// ---------------------------------------------------------------------------
export function executeSshTask({
  agent,
  prompt,
  cwd,
  idleTimeoutMs = 360000,
  maxTimeoutMs = 1800000,
  onChunk,
  childSet,
}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const cfg = agent.sshConfig;
    if (!cfg?.host || !cfg?.username) {
      return resolve({ ok: false, exitCode: -1, stdout: '', stderr: '缺少 SSH 服务器配置', durationMs: 0 });
    }

    // Write prompt & context into local shared_workspace/ssh_task_prompt.md so user has full audit trail
    try {
      fs.writeFileSync(path.join(cwd, 'ssh_task_prompt.md'), prompt, 'utf8');
    } catch {}

    // Remote command: prepare remote workdir, inspect GPU/system status, and invoke configured remote runner (or bash/python/agent CLI) with prompt via stdin
    const remoteDir = cfg.remoteWorkdir || '~/sakuraflow_workspace';
    const runner = cfg.runnerTemplate || 'cat';
    const remoteScript = [
      `mkdir -p ${remoteDir}`,
      `cd ${remoteDir}`,
      `cat > task_prompt.md`,
      `echo "=== [SSH Remote Host: $(hostname) | Dir: $(pwd)] ==="`,
      `nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader 2>/dev/null || true`,
      runner === 'bash'
        ? `bash task_prompt.md`
        : runner.startsWith('python')
        ? `${runner} -c "import pathlib; print('已同步任务至远程算力节点:', pathlib.Path('task_prompt.md').resolve()); print(pathlib.Path('task_prompt.md').read_text()[:800])"`
        : `${runner} < task_prompt.md`,
    ].join(' && ');

    const args = [...buildSshBaseArgs(cfg, 12), remoteScript];
    let child;
    try {
      child = spawn('ssh', args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, exitCode: -1, stdout: '', stderr: err.message, durationMs: Date.now() - startTime });
    }

    childSet?.add(child);
    let stdout = '';
    let stderr = '';
    let finished = false;
    let idleTimer = null;

    const terminate = (reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      childSet?.delete(child);
      killProcessTree(child);
      resolve({ ok: false, exitCode: 124, stdout, stderr: stderr + `\n[SSH Timeout] ${reason}`, durationMs: Date.now() - startTime });
    };

    const bump = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => terminate(`SSH 远程任务连续 ${Math.round(idleTimeoutMs / 1000)}s 无输出`), idleTimeoutMs);
    };
    const hardTimer = setTimeout(() => terminate(`SSH 远程任务超过 ${Math.round(maxTimeoutMs / 60000)} 分钟上限`), maxTimeoutMs);
    bump();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (finished) return;
      bump();
      stdout += d;
      onChunk?.('stdout', d);
    });
    child.stderr.on('data', (d) => {
      if (finished) return;
      bump();
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
      resolve({ ok: code === 0, exitCode: code ?? -1, stdout, stderr, durationMs: Date.now() - startTime });
    });

    child.stdin.write(prompt, 'utf8');
    child.stdin.end();
  });
}
