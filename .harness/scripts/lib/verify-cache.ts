// verify-cache.ts — 同一 SHA 验证结果复用凭证（ADR-106 batch-1/6，issue #1275）。
//
// 记录：commit SHA、验证类型、命令、退出码、完成时间、关键输入指纹。指纹覆盖
// "同一 SHA 但工作树有未提交改动"这类情况——只用 SHA 做 key 会把这类改动误判成
// "没变"，指纹里叠了 HEAD 差异（含未跟踪文件）+ lockfile 哈希，任何一处变了就是
// 不同指纹，旧记录不会被误命中。
//
// 存储：.harness/state/.cache/verify-credentials.jsonl（已 gitignore，运行时生成物，
// 不是权威——凭证只是"这份指纹在这个环境下跑过一次、结果是什么"的备忘，不代表
// "现在一定还是这个结果"，调用方决定信不信）。
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sh } from "./sh";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CACHE_DIR = join(ROOT, ".harness", "state", ".cache");
const CREDENTIALS_PATH = join(CACHE_DIR, "verify-credentials.jsonl");

export interface VerifyCredential {
  sha: string;
  fingerprint: string;
  verificationType: string;
  command: string;
  exitCode: number;
  completedAt: string;
}

// 复用仓库既有的 lib/sh.ts（bash -c 包一层），不再自己维护第二份 execFileSync
// 包装——两份形状相近的 shell 调用工具迟早会在行为细节上（quoting、cwd、错误
// 处理）悄悄分叉，见 AGENTS.md「同一事实不得声明在两处」。
function shTrimmed(cmd: string): string {
  const r = sh(cmd, ROOT);
  if (r.code !== 0) throw new Error(`command failed (${r.code}): ${cmd}\n${r.stderr}`);
  return r.stdout.trim();
}

function shOrEmpty(cmd: string): string {
  try {
    return shTrimmed(cmd);
  } catch {
    return "";
  }
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 当前 commit SHA（HEAD）。 */
export function currentSha(): string {
  return shTrimmed("git rev-parse HEAD");
}

/**
 * 关键输入指纹：HEAD 相对工作树的完整 diff（含 staged/unstaged）+ 未跟踪文件的
 * 路径与内容 + lockfile 哈希。任何一处变化都会让指纹变化，即使 SHA 没变——这是
 * "代码发生变化时旧结果必须自动失效"这条要求的机械实现，不是靠约定。
 */
export function computeFingerprint(sha: string): string {
  const diff = shOrEmpty("git diff HEAD --");
  const untrackedFiles = shOrEmpty("git ls-files --others --exclude-standard")
    .split("\n")
    .filter(Boolean)
    .sort();
  const untrackedContent = untrackedFiles
    .map((f) => {
      try {
        return `${f}:${sha256(readFileSync(join(ROOT, f)))}`;
      } catch {
        return `${f}:unreadable`; // 读不到（如提交过程中被删）也要计入指纹，不能悄悄跳过
      }
    })
    .join("\n");
  let lockfileHash = "no-lockfile";
  try {
    lockfileHash = sha256(readFileSync(join(ROOT, "pnpm-lock.yaml")));
  } catch {
    /* lockfile 不存在时用占位符，仍然是确定性输入 */
  }
  return sha256(`${sha}\n${diff}\n${untrackedContent}\n${lockfileHash}`);
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * 查找可复用的凭证：SHA + 指纹 + 验证类型全部一致才算命中。倒着扫（最新的记录
 * 优先），命中就返回，不用全量排序整份日志——这份日志会持续增长，倒序线性扫
 * 对当前规模足够，量级大了再换索引存储。
 */
export function lookupCredential(
  verificationType: string,
  sha: string,
  fingerprint: string,
): VerifyCredential | null {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  const lines = readFileSync(CREDENTIALS_PATH, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let record: VerifyCredential;
    try {
      record = JSON.parse(lines[i]!);
    } catch {
      continue; // 单行损坏不影响其它记录
    }
    if (
      record.verificationType === verificationType &&
      record.sha === sha &&
      record.fingerprint === fingerprint
    ) {
      return record;
    }
  }
  return null;
}

export function recordCredential(record: VerifyCredential): void {
  ensureCacheDir();
  appendFileSync(CREDENTIALS_PATH, `${JSON.stringify(record)}\n`);
}

export function credentialsPath(): string {
  return CREDENTIALS_PATH;
}

// 仅测试可见：列出全部记录（不倒序，不做命中逻辑）。
export function readAllCredentials(): VerifyCredential[] {
  if (!existsSync(CREDENTIALS_PATH)) return [];
  return readFileSync(CREDENTIALS_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as VerifyCredential);
}
