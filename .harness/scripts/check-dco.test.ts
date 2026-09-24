/**
 * DCO 检查的行为测试：在临时 git 仓库里造提交。
 * 反例：没签、签了别人的邮箱、范围为空；对照：签了且邮箱一致、merge 提交不查。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "check-dco.mjs");
const made: string[] = [];
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "dco-"));
  made.push(dir);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Ann");
  git("config", "user.email", "ann@example.com");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a"), "0");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  let n = 0;
  // 每个提交写一个新文件：分支之间互不冲突，merge 用例才测得到「merge 提交不查」本身
  const commit = (msg: string) => {
    writeFileSync(join(dir, `f${++n}`), String(n));
    git("add", "-A");
    git("commit", "-q", "-m", msg);
  };
  return { dir, git, commit, base: git("rev-parse", "HEAD") };
}
const check = (dir: string, range: string) => spawnSync("node", [SCRIPT, "--range", range], { cwd: dir, encoding: "utf8" });
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("check-dco", () => {
  it("真的被 CI 跑到：dco.yml 只对 fork PR 触发、调用本脚本、用 PR 的 base..head 作范围", () => {
    const wf = readFileSync(join(import.meta.dirname, "../../.github/workflows/dco.yml"), "utf8");
    expect(wf).toContain("github.event.pull_request.head.repo.full_name != github.repository");
    expect(wf).toContain("node .harness/scripts/check-dco.mjs");
    expect(wf).toContain("github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha");
    expect(wf).toMatch(/fetch-depth:\s*0/); // 浅克隆拿不到 base..head 之间的提交
  });

  it("对照组：签署邮箱与作者一致（大小写不敏感）⇒ 绿", () => {
    const r = repo();
    r.commit("feat: x\n\nSigned-off-by: Ann <ANN@example.com>");
    expect(check(r.dir, `${r.base}..HEAD`).status).toBe(0);
  });

  it("没有 Signed-off-by ⇒ 红", () => {
    const r = repo();
    r.commit("feat: x");
    const out = check(r.dir, `${r.base}..HEAD`);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("没有 Signed-off-by");
  });

  it("签的是别人的邮箱 ⇒ 红（替别人做 DCO 声明不算签）", () => {
    const r = repo();
    r.commit("feat: x\n\nSigned-off-by: Bob <bob@example.com>");
    expect(check(r.dir, `${r.base}..HEAD`).status).toBe(1);
  });

  it("多个提交里只要有一个没签就红", () => {
    const r = repo();
    r.commit("a\n\nSigned-off-by: Ann <ann@example.com>");
    r.commit("b");
    const out = check(r.dir, `${r.base}..HEAD`);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/非 merge 提交 2 个，未签署 1 个/);
  });

  it("merge 提交不查", () => {
    const r = repo();
    r.git("checkout", "-q", "-b", "side");
    r.commit("side\n\nSigned-off-by: Ann <ann@example.com>");
    r.git("checkout", "-q", "main");
    r.commit("main\n\nSigned-off-by: Ann <ann@example.com>");
    r.git("merge", "-q", "--no-ff", "-m", "Merge side（无签署）", "side");
    expect(check(r.dir, `${r.base}..HEAD`).status).toBe(0);
  });

  it("范围内 0 个提交 ⇒ 不许判绿（多半是范围算错了）", () => {
    const r = repo();
    const out = check(r.dir, "HEAD..HEAD");
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("不许判绿");
  });
});
