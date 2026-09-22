/**
 * lint-feature-transition 的端到端反证套件（#400）。
 *
 * lib/feature-transition.test.ts 判的是纯函数；这里判的是**真 git 仓库上的整条链**：
 * 两个 ref → `git show` 装配快照 → 判定 → 退出码。证据日志由**生产路径本身**
 * （`evidence-fingerprint.ts` 的 appendFingerprint）写出来，不是测试里手抄一份格式——
 * 手抄的话，格式一旦漂移，这套反证会继续绿着骗人。
 *
 * 最后一组是反向反证：把门指向真仓库的两个真 commit，必须退 0。
 * 一道永远红的门等于没有门。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "./lib/sh";
import { REPO_ROOT } from "./lib/paths";
import { appendFingerprint } from "./lib/evidence-fingerprint";

const PHASE_DIR = "phase-99-demo";
const FL = `phases/${PHASE_DIR}/feature_list.json`;
const LOG_REL = `phases/${PHASE_DIR}/sprints/sprint-01/evidence/F01.verify.log`;

let repo: string;

interface Feat {
  id: string;
  status: string;
  owner: string | null;
  sprint: string | null;
  evidence: string;
}

function write(rel: string, body: string): void {
  const p = join(repo, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body, "utf8");
}

function writeFeatures(features: Feat[]): void {
  write(FL, JSON.stringify({ phase: "99", features }, null, 2) + "\n");
}

function git(cmd: string): string {
  const r = sh(`git ${cmd}`, repo);
  if (r.code !== 0) throw new Error(`git ${cmd} 失败:\n${r.stdout}`);
  return r.stdout.trim();
}

function commit(message: string): string {
  git("add -A");
  git(`-c user.email=t@t -c user.name=t commit -q -m "${message}"`);
  return git("rev-parse HEAD");
}

/** 用**生产路径**写一份带合法尾行的证据日志（appendFingerprint 读 cwd 的 git HEAD）。 */
function writeAttestedLog(body: string): void {
  const cwd = process.cwd();
  try {
    process.chdir(repo);
    write(LOG_REL, appendFingerprint(body));
  } finally {
    process.chdir(cwd);
  }
}

/** verify --sprint 翻 passing 时对 feature_list 做的那两件事，原样复刻。 */
function verifiedPassing(at = "2026-09-21T00:00:00.000Z"): Feat {
  return { id: "F01", status: "passing", owner: "worker-a", sprint: "01", evidence: `evidence/F01.verify.log @ ${at}` };
}

const inProgress: Feat = { id: "F01", status: "in_progress", owner: "worker-a", sprint: "01", evidence: "" };

function runGate(base: string, head: string, repoDir = repo): { code: number; out: string } {
  const r = sh(
    `pnpm exec tsx .harness/scripts/cli.ts lint-feature-transition --base ${base} --head ${head} --repo ${repoDir}`,
    REPO_ROOT
  );
  return { code: r.code, out: r.stdout };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "feature-transition-"));
  git("init -q -b main");
  writeFeatures([inProgress]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("真仓库端到端", () => {
  it("合法迁移（真 appendFingerprint 产出的证据）⇒ 退 0", () => {
    const base = commit("base");
    writeAttestedLog("$ pnpm test\n[exit 0]\nall good");
    writeFeatures([verifiedPassing()]);
    const head = commit("verify F01");

    const r = runGate(base, head);
    expect(r.out).toContain("1 条 feature 迁移的出处均成立");
    expect(r.code).toBe(0);
  });

  it("手改 passing（status 翻了、evidence 写人话、没有日志）⇒ 退 1", () => {
    const base = commit("base");
    writeFeatures([{ ...inProgress, status: "passing", evidence: "本地跑过了，能用" }]);
    const head = commit("手改");

    const r = runGate(base, head);
    expect(r.out).toContain("direct_passing_edit");
    expect(r.code).toBe(1);
  });

  it("手改 passing 但借用一份合法旧日志（最终树三道门全绿）⇒ 退 1", () => {
    // 先让 F01 走完一次合法 verify，日志留在仓库里。
    writeAttestedLog("$ pnpm test\n[exit 0]\nall good");
    writeFeatures([verifiedPassing(), { ...inProgress, id: "F02", evidence: "" }]);
    const base = commit("F01 已 passing");

    // 再把 F02 手改成 passing，指针指向 F01 那份指纹完全合法的日志。
    writeFeatures([
      verifiedPassing(),
      { id: "F02", status: "passing", owner: "worker-a", sprint: "01", evidence: "evidence/F01.verify.log @ 2026-09-21T00:00:00.000Z" },
    ]);
    const head = commit("F02 蹭 F01 的证据");

    const r = runGate(base, head);
    expect(r.out).toContain("direct_passing_edit");
    expect(r.out).toContain("F02");
    expect(r.code).toBe(1);
  });

  it("复制一份别人的合法日志冒充自己的证据 ⇒ 退 1", () => {
    // 真仓库实测（2026-09-21）：同样的变异下 `pnpm harness doctor --phase 00`
    // 报 0 FAIL 并打印"✓ 审计链完整"。指纹只算正文、不含路径 ⇒ 复制品指纹天然合法。
    commit("init"); // 先有 commit，appendFingerprint 的尾行才拿得到真实 commit sha
    writeAttestedLog("$ pnpm test\n[exit 0]\nall good");
    writeFeatures([verifiedPassing(), { ...inProgress, id: "F02", evidence: "" }]);
    const base = commit("F01 已 passing");

    write(
      `phases/${PHASE_DIR}/sprints/sprint-01/evidence/F02.verify.log`,
      readFileSync(join(repo, LOG_REL), "utf8") // 逐字节复制 F01 的日志
    );
    writeFeatures([
      verifiedPassing(),
      { id: "F02", status: "passing", owner: "worker-a", sprint: "01", evidence: "evidence/F02.verify.log @ 2026-09-21T00:00:00.000Z" },
    ]);
    const head = commit("F02 复制 F01 的日志");

    const r = runGate(base, head);
    expect(r.out).toContain("evidence_duplicated");
    expect(r.out).toContain("F01.verify.log");
    expect(r.code).toBe(1);
  });

  it("改写日志正文 + 重算指纹（checkFingerprint 返回 ok）⇒ 仍然退 1", () => {
    writeAttestedLog("$ pnpm test\n[exit 1]\nFAILED");
    writeFeatures([verifiedPassing()]);
    const base = commit("F01 passing（证据里其实是红的）");

    // 只改正文、用生产路径重算尾行；status 与 evidence 指针一动不动。
    writeAttestedLog("$ pnpm test\n[exit 0]\nall good");
    const head = commit("把红的改成绿的");

    const r = runGate(base, head);
    expect(r.out).toContain("evidence_rewritten");
    expect(r.code).toBe(1);
  });

  it("只改正文、不重算尾行 ⇒ evidence_tampered", () => {
    writeAttestedLog("$ pnpm test\n[exit 1]\nFAILED");
    writeFeatures([verifiedPassing()]);
    const base = commit("F01 passing");

    const tampered = readFileSync(join(repo, LOG_REL), "utf8").replace("[exit 1]\nFAILED", "[exit 0]\nall good");
    write(LOG_REL, tampered);
    writeFeatures([verifiedPassing("2026-09-22T00:00:00.000Z")]); // 指针也刷了，避开 evidence_rewritten
    const head = commit("改正文忘了改尾行");

    const r = runGate(base, head);
    expect(r.out).toContain("evidence_tampered");
    expect(r.code).toBe(1);
  });

  it("passing 退回 in_progress ⇒ status_irreversible", () => {
    writeAttestedLog("$ pnpm test\n[exit 0]\nall good");
    writeFeatures([verifiedPassing()]);
    const base = commit("F01 passing");

    writeFeatures([inProgress]);
    const head = commit("退回去");

    const r = runGate(base, head);
    expect(r.out).toContain("status_irreversible");
    expect(r.code).toBe(1);
  });

  it("归档搬家（live → feature_list.archive.json）不算记录消失 ⇒ 退 0", () => {
    writeAttestedLog("$ pnpm test\n[exit 0]\nall good");
    writeFeatures([verifiedPassing()]);
    const base = commit("F01 passing");

    writeFeatures([]);
    write(`phases/${PHASE_DIR}/feature_list.archive.json`, JSON.stringify({ phase: "99", features: [verifiedPassing()] }, null, 2) + "\n");
    const head = commit("archive-passing");

    const r = runGate(base, head);
    expect(r.out).not.toContain("passing_record_removed");
    expect(r.code).toBe(0);
  });

  it("不碰 feature 的改动 ⇒ 判定为空转，退 0", () => {
    const base = commit("base");
    write("README.md", "hello\n");
    const head = commit("只改 README");

    const r = runGate(base, head);
    expect(r.out).toContain("没有 feature 状态迁移");
    expect(r.code).toBe(0);
  });
});

describe("反向反证：门不是永远红的", () => {
  it("真仓库 HEAD~1 → HEAD 必须退 0", () => {
    const head = sh("git rev-parse HEAD", REPO_ROOT).stdout.trim();
    const base = sh("git rev-parse HEAD~1", REPO_ROOT).stdout.trim();
    const r = runGate(base, head, REPO_ROOT);
    expect(r.out).not.toContain("[direct_passing_edit]");
    expect(r.code).toBe(0);
  });
});
