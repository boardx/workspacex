/**
 * Hardware / toolchain self-check. The installer promises "if your machine meets the
 * requirements it just works", so the requirements must be checked by code, not by a
 * paragraph in a README. Numbers come from PROP-LOCAL-WORKSPACE-001 §2.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { arch, platform, totalmem } from "node:os";
import { join } from "node:path";
import { capabilityNotices, localCapabilities, type CapabilityStatus } from "./capabilities";
import { DEFAULT_ASR_MODEL } from "./config";

export interface DoctorReport {
  /**
   * 这台机器能不能跑起来。
   *
   * ⚠ 只由**硬件**判定（内存 / 磁盘）。此前它是
   *   `findings.every(f => f.startsWith("未找到 Ollama") || ...)`——判据是文案本身，
   *   改一句提示语就会改变程序会不会拒绝启动。能补的东西（模型 / 运行时 / 转写模型）
   *   缺了不是不能跑，是少几条能力，那件事由 `capabilities` 如实说。
   */
  readonly ok: boolean;
  readonly platform: string;
  readonly arch: string;
  readonly memoryGb: number;
  readonly freeDiskGb: number;
  readonly ollama: { found: boolean; path: string | null; version: string | null };
  readonly python: { venv: boolean };
  readonly asrModel: boolean;
  /** 本次自检下每条能力的实际状态（capabilities.ts 是唯一事实源）。 */
  readonly capabilities: readonly CapabilityStatus[];
  /** 面向用户的几行话，逐条对应一个不可用的能力。 */
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
  const blocking: string[] = [];
  const memoryGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
  if (memoryGb < MIN_MEMORY_GB) blocking.push(`内存 ${memoryGb} GB 低于最低要求 ${MIN_MEMORY_GB} GB`);
  let freeDiskGb = 0;
  try {
    const probe = existsSync(opts.dataDir) ? opts.dataDir : opts.repoRoot;
    const fs = statfsSync(probe);
    freeDiskGb = Math.round(((fs.bavail * fs.bsize) / 1024 ** 3) * 10) / 10;
    if (freeDiskGb < MIN_FREE_DISK_GB) blocking.push(`磁盘空闲 ${freeDiskGb} GB 低于最低要求 ${MIN_FREE_DISK_GB} GB`);
  } catch {
    blocking.push("无法读取磁盘空闲空间");
  }
  const ollamaPath = findOllama(opts.bundleBinDir);
  let version: string | null = null;
  if (ollamaPath !== null) {
    try {
      version = execFileSync(ollamaPath, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      version = null;
    }
  }
  const capabilities = localCapabilities(
    { repoRoot: opts.repoRoot, dataDir: opts.dataDir },
    { ollama: ollamaPath !== null },
  );
  const byId = (id: string): boolean => capabilities.find((c) => c.id === id)?.available ?? false;
  return {
    ok: blocking.length === 0,
    platform: platform(),
    arch: arch(),
    memoryGb,
    freeDiskGb,
    ollama: { found: ollamaPath !== null, path: ollamaPath, version },
    python: { venv: byId("tools-and-skills") },
    asrModel: byId("live-transcription"),
    capabilities,
    findings: [...blocking, ...capabilityNotices(capabilities)],
  };
}
