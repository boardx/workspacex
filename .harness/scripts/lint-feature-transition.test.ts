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
import { reconstructedSquash, parseSquashReconstructions, prTransitionPairs, type SquashReconstruction } from "./lib/squash-integration-proof";
import { squashIntegrationOracle } from "./lint-feature-transition";

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

describe("squash 的完整树出处证明", () => {
  it("Git 查询失败时拒绝，且目标树与见证结果只查询一次", () => {
    const calls: string[] = [];
    const proves = squashIntegrationOracle((cmd) => {
      calls.push(cmd);
      return cmd.startsWith("log --format")
        ? { code: 0, out: "target-tree\n" }
        : { code: 1, out: "target-tree\n" };
    }, "head");
    expect(proves("witness", LOG_REL, "blob")).toBe(false);
    expect(proves("witness", LOG_REL, "blob")).toBe(false);
    expect(proves("other-witness", LOG_REL, "blob")).toBe(false);
    expect(calls.filter((cmd) => cmd.startsWith("log --format"))).toHaveLength(1);
    expect(calls.filter((cmd) => cmd.includes("witness.."))).toHaveLength(2);
  });

  it("目标历史查询失败，即使源查询有输出也拒绝", () => {
    const proves = squashIntegrationOracle((cmd) => cmd.startsWith("log --format")
      ? { code: 1, out: "same-tree\n" }
      : { code: 0, out: "same-tree\n" }, "missing-head");
    expect(proves("witness", LOG_REL, "blob")).toBe(false);
  });

  it("旧 blob 的证明不能缓存后借给新 blob 或不同日志路径", () => {
    const proves = squashIntegrationOracle((cmd) => {
      if (cmd.startsWith("log ")) return { code: 0, out: "source-tree\n" };
      return { code: 0, out: cmd.includes("different.verify.log") ? "other-blob\n" : "old-blob\n" };
    }, "head");
    expect(proves("witness", LOG_REL, "old-blob")).toBe(true);
    expect(proves("witness", LOG_REL, "new-blob")).toBe(false);
    expect(proves("witness", "evidence/different.verify.log", "old-blob")).toBe(false);
  });

  function squashFixture(): { base: string; head: string; witness: string } {
    const base = commit("base");
    git("checkout -q -b source");
    write("implementation.ts", "export const implemented = true;\n");
    const witness = commit("implementation under verification");
    writeAttestedLog("$ pnpm test\n[exit 0]\nall good");
    writeFeatures([verifiedPassing()]);
    commit("verified source");
    git("checkout -q main");
    git("merge --squash source");
    return { base, head: commit("squash source"), witness };
  }

  it("真 squash 保留完整源树，见证属于源历史 ⇒ 退 0", () => {
    const { base, head } = squashFixture();
    expect(runGate(base, head).code).toBe(0);
  });

  it("squash 后的后续 HEAD 仍能证明已集成 ⇒ 退 0", () => {
    const { base } = squashFixture();
    write("later.txt", "later change\n");
    const head = commit("downstream change");
    expect(runGate(base, head).code).toBe(0);
  });

  it("日志相同但源代码树不同，不是完整 squash ⇒ 退 1", () => {
    const { base } = squashFixture();
    // Remove the only integrated equivalent tree from target ancestry.
    git(`reset -q --soft ${base}`);
    write("implementation.ts", "export const implemented = false;\n");
    const head = commit("same evidence but different implementation");
    const r = runGate(base, head);
    expect(r.out).toContain("attestation_unverifiable");
    expect(r.code).toBe(1);
  });

  it("等价源树不属于日志见证的后代 ⇒ 退 1", () => {
    const { base } = squashFixture();
    git("checkout -q -b unrelated main");
    write("unrelated.txt", "foreign witness\n");
    const foreign = commit("unrelated witness");
    git("checkout -q main");
    // A valid fingerprint with a different witness cannot borrow source's proof.
    const original = readFileSync(join(repo, LOG_REL), "utf8");
    write(LOG_REL, original.replace(/commit=[0-9a-f]{40}/, `commit=${foreign}`));
    const head = commit("foreign attestation");
    const r = runGate(base, head);
    expect(r.out).toContain("attestation_unverifiable");
    expect(r.code).toBe(1);
  });

  it("无关见证的后代回退到共同 base，不能借用不含当前证据的旧等价树 ⇒ 退 1", () => {
    const base = commit("common base");
    git("checkout -q -b foreign");
    write("foreign.ts", "unrelated implementation\n");
    commit("foreign witness");
    writeAttestedLog("$ pnpm test\n[exit 0]\nforeign result");
    const foreignLog = readFileSync(join(repo, LOG_REL), "utf8");
    git("add -A");
    git(`read-tree --reset -u ${base}`);
    commit("foreign descendant restores common base tree");
    expect(git("rev-parse HEAD^{tree}")).toBe(git(`rev-parse ${base}^{tree}`));
    git("checkout -q main");
    write("implementation.ts", "different implementation\n");
    write(LOG_REL, foreignLog);
    writeFeatures([verifiedPassing()]);
    const head = commit("borrow foreign witness after its revert");
    const r = runGate(base, head);
    expect(r.out).toContain("attestation_unverifiable");
    expect(r.code).toBe(1);
  });

  it("squash 不能放行指纹被篡改的日志 ⇒ 退 1", () => {
    const { base } = squashFixture();
    write(LOG_REL, readFileSync(join(repo, LOG_REL), "utf8").replace("all good", "changed body"));
    const head = commit("tamper after squash");
    const r = runGate(base, head);
    expect(r.out).toContain("evidence_tampered");
    expect(r.code).toBe(1);
  });
});

describe("advanced-base complete-tree reconstruction",()=>{
 const query=(cmd:string)=>{const r=sh("git "+cmd,repo);return {code:r.code,out:r.stdout};};
 function fixture(){
  const base=commit("common base");git("checkout -q -b verified");
  write("implementation.ts","export const implemented=true;\n");const witness=commit("implementation witness");
  writeAttestedLog("$ pnpm test\n[exit 0]\nall good");writeFeatures([verifiedPassing()]);const source=commit("verified source");
  git("checkout -q main");write("diagnostic.ts","independent advanced-main change\n");const parent=commit("advance main");
  git("merge --squash verified");const squash=commit("integrate on advanced main");
  const proof:SquashReconstruction={source,squash,parent},blob=git("rev-parse "+source+":"+LOG_REL);
  return {base,witness,source,parent,squash,proof,blob};
 }
 it("advanced base preserves complete rebuilt tree and exact log",()=>{
  const f=fixture();expect(git("rev-parse "+f.source+"^{tree}")).not.toBe(git("rev-parse "+f.squash+"^{tree}"));
  expect(reconstructedSquash(query,f.squash,f.witness,LOG_REL,f.blob,[f.proof])).toBe(true);
 });
 it("target history may advance again",()=>{
  const f=fixture();write("later.txt","later\n");const head=commit("later target");
  expect(reconstructedSquash(query,head,f.witness,LOG_REL,f.blob,[f.proof])).toBe(true);
 });
 it("wrong source with identical log cannot borrow partial tree matching",()=>{
  const f=fixture();git("checkout -q verified");write("implementation.ts","export const implemented=false;\n");const source=commit("wrong source");
  git("checkout -q main");expect(reconstructedSquash(query,f.squash,f.witness,LOG_REL,f.blob,[{...f.proof,source}])).toBe(false);
 });
 it("altered blob and different evidence path reject",()=>{
  const f=fixture();
  expect(reconstructedSquash(query,f.squash,f.witness,LOG_REL,"f".repeat(40),[f.proof])).toBe(false);
  expect(reconstructedSquash(query,f.squash,f.witness,LOG_REL.replace("F01","F02"),f.blob,[f.proof])).toBe(false);
 });
 it("missing witness or source parent target and mismatched parent reject",()=>{
  const f=fixture(),missing="f".repeat(40);
  expect(reconstructedSquash(query,f.squash,missing,LOG_REL,f.blob,[f.proof])).toBe(false);
  for(const key of ["source","parent","squash"] as const)
   expect(reconstructedSquash(query,f.squash,f.witness,LOG_REL,f.blob,[{...f.proof,[key]:missing}])).toBe(false);
  expect(reconstructedSquash(query,f.squash,f.witness,LOG_REL,f.blob,[{...f.proof,parent:f.base}])).toBe(false);
 });
 it("foreign witness and squash outside target history reject",()=>{
  const f=fixture();git("checkout -q -b foreign "+f.base);write("foreign.txt","foreign\n");const foreign=commit("foreign");
  expect(reconstructedSquash(query,f.squash,foreign,LOG_REL,f.blob,[f.proof])).toBe(false);
  expect(reconstructedSquash(query,foreign,f.witness,LOG_REL,f.blob,[f.proof])).toBe(false);
 });
 it("Git errors and uncertain output reject even with expected tree",()=>{
  const f=fixture(),tree=git("rev-parse "+f.squash+"^{tree}");
  for(const result of [{code:1,out:tree},{code:0,out:tree+"\nCONFLICT"}]){
   const failed=(cmd:string)=>cmd.startsWith("merge-tree ")?result:query(cmd);
   expect(reconstructedSquash(failed,f.squash,f.witness,LOG_REL,f.blob,[f.proof])).toBe(false);
  }
 });
 it("strict candidate manifest supports real CLI without replacing original log",()=>{
  const f=fixture();expect(reconstructedSquash(query,f.squash,f.witness,LOG_REL,f.blob,[])).toBe(false);
  write(".harness/config/squash-integration-proofs.json",JSON.stringify({version:1,proofs:[f.proof]}));
  const head=commit("record immutable inputs");expect(runGate(f.base,head).code).toBe(0);
  for(const bad of [{version:2,proofs:[f.proof]},{version:1,proofs:[{...f.proof,source:"main"}]},
   {version:1,proofs:[{...f.proof,waive:true}]}])expect(()=>parseSquashReconstructions(JSON.stringify(bad))).toThrow("SQUASH_PROOF_CONFIG");
 });
 it("PR source and advancing main remain separate audited deltas",()=>{
  const f=fixture();git("checkout -q -b pr "+f.base);write("pr.txt","requested change\n");const source=commit("PR source");
  git("checkout -q main");git('merge --no-ff pr -m "synthetic integration"');const head=git("rev-parse HEAD");
  expect(prTransitionPairs(query,f.base,source,head)).toEqual([[f.base,source],[f.base,f.squash],[f.squash,head]]);
  expect(()=>prTransitionPairs(query,f.base,f.parent,head)).toThrow("PR_TRANSITION_PARENTS");
  expect(()=>prTransitionPairs(query,f.base,source,source)).toThrow("PR_TRANSITION_PARENTS");
  const r=sh(`pnpm exec tsx .harness/scripts/cli.ts lint-feature-transition --base ${f.base} --pr-source ${source} --head ${head} --repo ${repo}`,REPO_ROOT);
  expect(r.code).toBe(1);expect(r.stdout).toContain("attestation_unverifiable");
 });
 it("actual conflict cannot prove an arbitrary partial integration",()=>{
  commit("base");write("shared.txt","base\n");commit("common");
  git("checkout -q -b conflicting");write("shared.txt","source\n");const witness=commit("source witness");
  writeAttestedLog("$ pnpm test\n[exit 0]\nall good");writeFeatures([verifiedPassing()]);const source=commit("source log");
  git("checkout -q main");write("shared.txt","target\n");const parent=commit("target conflict");
  write(LOG_REL,git("show "+source+":"+LOG_REL)+"\n");writeFeatures([verifiedPassing()]);
  const squash=commit("arbitrary integration"),blob=git("rev-parse "+squash+":"+LOG_REL);
  expect(query("merge-tree --write-tree --no-messages "+parent+" "+source).code).not.toBe(0);
  expect(reconstructedSquash(query,squash,witness,LOG_REL,blob,[{source,squash,parent}])).toBe(false);
 });
});

describe("final CLI missing and unreachable witnesses fail closed",()=>{
 it("valid fingerprint with missing commit must exit1 rather than warning",()=>{
  const base=commit("base");
  writeAttestedLog("$ pnpm test\n[exit 0]\nall good");writeFeatures([verifiedPassing()]);
  write(LOG_REL,readFileSync(join(repo,LOG_REL),"utf8").replace(/commit=[a-f0-9]{40}/,"commit="+"f".repeat(40)));
  const head=commit("missing witness");
  const r=runGate(base,head);expect(r.code).toBe(1);expect(r.out).toContain("attestation_unverifiable");
 });
 it("existing but unreachable original witness cannot be borrowed",()=>{
  const base=commit("base");
  const witness=git("-c user.name=t -c user.email=t@t commit-tree HEAD^{tree} -p HEAD -m unreachable");
  expect(sh("git cat-file -e "+witness+"^{commit}",repo).code).toBe(0);
  writeAttestedLog("$ pnpm test\n[exit 0]\nall good");writeFeatures([verifiedPassing()]);
  write(LOG_REL,readFileSync(join(repo,LOG_REL),"utf8").replace(/commit=[a-f0-9]{40}/,"commit="+witness));
  const head=commit("borrow unreachable witness");
  const r=runGate(base,head);expect(r.code).toBe(1);expect(r.out).toContain("attestation_unverifiable");
 });
 it("PR based before event-base remains valid when actual main contains that base",()=>{
  const base=commit("base");git("checkout -q -b pr");
  write("pr.txt","PR change\n");const source=commit("PR source");
  git("checkout -q main");write("main.txt","new main change\n");const eventBase=commit("main advances after PR branched");
  git('merge --no-ff pr -m "synthetic integration"');const head=git("rev-parse HEAD");
  const query=(cmd:string)=>{const r=sh("git "+cmd,repo);return {code:r.code,out:r.stdout};};
  expect(prTransitionPairs(query,eventBase,source,head)).toEqual([[base,source],[eventBase,eventBase],[eventBase,head]]);
  const r=sh(`pnpm exec tsx .harness/scripts/cli.ts lint-feature-transition --base ${eventBase} --pr-source ${source} --head ${head} --repo ${repo}`,REPO_ROOT);
  expect(r.code).toBe(0);expect(base).not.toBe(eventBase);
 });
});

describe("all three PR migration deltas retain their own rejection",()=>{
 it.each(["source","main","integration"] as const)("rejects illegal passing introduced only in %s",where=>{
  const base=commit("base");
  const invalid=()=>writeFeatures([inProgress,{...verifiedPassing(),id:"F02",evidence:"manual completion without a log"}]);
  git("checkout -q -b pr");write("pr.txt","source\n");if(where==="source")invalid();const source=commit("PR source");
  git("checkout -q main");write("main.txt","advanced main\n");if(where==="main")invalid();commit("main advance");
  git('merge --no-ff pr -m "synthetic integration"');
  if(where==="integration"){invalid();git("add -A");git('-c user.email=t@t -c user.name=t commit --amend -q -m "invalid integration"');}
  const head=git("rev-parse HEAD");
  const r=sh(`pnpm exec tsx .harness/scripts/cli.ts lint-feature-transition --base ${base} --pr-source ${source} --head ${head} --repo ${repo}`,REPO_ROOT);
  expect(r.code).toBe(1);expect(r.stdout).toContain("direct_passing_edit");expect(r.stdout).toContain("F02");
 });
});
