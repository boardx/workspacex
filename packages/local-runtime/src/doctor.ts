/**
 * Hardware / toolchain self-check. The installer promises "if your machine meets the
 * requirements it just works", so the requirements must be checked by code, not by a
 * paragraph in a README. Numbers come from PROP-LOCAL-WORKSPACE-001 §2.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { arch, platform, totalmem } from "node:os";
import { join } from "node:path";

export interface DoctorReport {
  readonly ok: boolean;
  readonly platform: string;
  readonly arch: string;
  readonly memoryGb: number;
  readonly freeDiskGb: number;
  readonly ollama: { found: boolean; path: string | null; version: string | null };
  readonly python: { venv: boolean };
  readonly findings: readonly string[];
}

export const MIN_MEMORY_GB = 8;
export const MIN_FREE_DISK_GB = 12;

export function findOllama(bundleBinDir?: string): string | null {
  const candidates = [
    bundleBinDir ? join(bundleBinDir, platform() === "win32" ? "ollama.exe" : "ollama") : null,
    "/usr/local/bin/ollama",
    "/opt/homebrew/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe") : null,
  ].filter((p): p is string => p !== null);
  for (const p of candidates) if (existsSync(p)) return p;
  try {
    const which = platform() === "win32" ? "where" : "which";
    const out = execFileSync(which, ["ollama"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const first = out.split(/\r?\n/)[0];
    if (first && existsSync(first)) return first;
  } catch {
    /* not on PATH */
  }
  return null;
}

export function runDoctor(opts: { dataDir: string; repoRoot: string; bundleBinDir?: string }): DoctorReport {
  const findings: string[] = [];
  const memoryGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
  if (memoryGb < MIN_MEMORY_GB) findings.push(`内存 ${memoryGb} GB 低于最低要求 ${MIN_MEMORY_GB} GB`);
  let freeDiskGb = 0;
  try {
    const probe = existsSync(opts.dataDir) ? opts.dataDir : opts.repoRoot;
    const fs = statfsSync(probe);
    freeDiskGb = Math.round(((fs.bavail * fs.bsize) / 1024 ** 3) * 10) / 10;
    if (freeDiskGb < MIN_FREE_DISK_GB) findings.push(`磁盘空闲 ${freeDiskGb} GB 低于最低要求 ${MIN_FREE_DISK_GB} GB`);
  } catch {
    findings.push("无法读取磁盘空闲空间");
  }
  const ollamaPath = findOllama(opts.bundleBinDir);
  let version: string | null = null;
  if (ollamaPath) {
    try {
      version = execFileSync(ollamaPath, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      version = null;
    }
  } else {
    findings.push("未找到 Ollama 二进制：聊天将没有模型可用（安装包应随附，开发环境请先安装 Ollama）");
  }
  const venv = existsSync(join(opts.repoRoot, "apps", "deep-agent-service", ".venv"));
  if (!venv) findings.push("deep-agent-service 的 Python 运行时（.venv）不存在：工具调用与 skill 执行不可用，运行 scripts/local-bundle/prepare-python.sh");
  return {
    ok: findings.every((f) => f.startsWith("未找到 Ollama") || f.startsWith("deep-agent-service")) ,
    platform: platform(),
    arch: arch(),
    memoryGb,
    freeDiskGb,
    ollama: { found: ollamaPath !== null, path: ollamaPath, version },
    python: { venv },
    findings,
  };
}
