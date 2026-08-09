import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanForInstances } from "./template-scan";

/**
 * #728 —— `scanForInstances` 必须跳过**嵌套 checkout**（git worktree / 独立 clone），
 * 但**不得**因此放过同一棵树里的真实重复。
 *
 * ## 这条门为什么存在
 * 本仓的并行开发工作流（parallel-dev-workflow.md §5）就是在仓库根下开 worktree
 * （`.worktrees/*`、`wt-*`）。worktree 是整棵树的副本 ⇒ 每份模板实例被数两次 ⇒
 * 满屏 TPL-DUP-INSTANCE 假阳性 ⇒ **`verify:base` 对任何正在并行开发的人都跑不绿**。
 *
 * 实测（2026-08-08）：仓库根下有别的会话留下的 `wt-review/` 与 `wt-h3a-030/` 时，
 * `templates doctor` 报 2 条 TPL-DUP-INSTANCE，指的都是
 * 「`.harness/templates/examples/EVT-hmv2-e1-001.yaml` 与它自己的副本重复」。
 *
 * ## 为什么按 `.git` 判定而不是按目录名
 * 按名字加豁免（把 `.worktrees` 塞进 EXCLUDED_DIRS）挡不住随手起名的 `wt-review`。
 * `.git` 存在与否与命名无关：worktree 里它是写着 `gitdir: …` 的**文件**，
 * 独立 clone 里是目录，两种都算。
 */
describe("#728 scanForInstances 跳过嵌套 checkout", () => {
  let root: string;

  function writeInstance(relPath: string, instanceId: string): void {
    const full = join(root, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    // 字段照 `.harness/templates/examples/EVT-hmv2-e1-001.yaml` 的真实形状写，
    // 不是凭 instance_id 三个字段拼的——少一个必填字段，`validateInstanceMetadata`
    // 会把它整条丢进 validationFailures，`instances` 就是空数组，
    // 于是三条断言全部红在「扫不到」上，而不是红在它们各自要验的那件事上。
    writeFileSync(full, [
      "template_id: TPL-EVT-001",
      "template_version: 1",
      `instance_id: ${instanceId}`,
      "status: active",
      "scope:",
      "  project: workspacex",
      "  phase: null",
      "refs: []",
      "",
    ].join("\n"));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tpl-scan-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("嵌套 worktree 里的同名实例不被扫到（否则每份实例都会重复一次）", () => {
    writeInstance(".harness/templates/examples/EVT-a.yaml", "EVT-a");

    // 一个 git worktree：`.git` 是**文件**，内容是 `gitdir: …`
    const worktree = join(root, "wt-review");
    mkdirSync(join(worktree, ".harness/templates/examples"), { recursive: true });
    writeFileSync(join(worktree, ".git"), "gitdir: /somewhere/.git/worktrees/wt-review\n");
    writeInstance("wt-review/.harness/templates/examples/EVT-a.yaml", "EVT-a");

    const found = scanForInstances(root).instances.map((i) => i.instance_id);
    expect(found).toEqual(["EVT-a"]);
  });

  it("独立 clone（`.git` 是目录）同样跳过", () => {
    writeInstance(".harness/templates/examples/EVT-a.yaml", "EVT-a");
    const clone = join(root, "vendor-clone");
    mkdirSync(join(clone, ".git"), { recursive: true });
    writeInstance("vendor-clone/.harness/templates/examples/EVT-a.yaml", "EVT-a");

    expect(scanForInstances(root).instances.map((i) => i.instance_id)).toEqual(["EVT-a"]);
  });

  /**
   * ⛔ 反证：这条是上面两条的**代价上限**。跳过嵌套 checkout 换来的便利，不得
   * 以「真实重复也被放过」为代价 —— 同一棵树里两份不同文件用同一个 instance_id
   * 仍然必须都被扫到（重复判定本身在 template-doctor 里做，这里断言扫描面没缩水）。
   */
  it("同一棵树里的真实重复照样扫到两份（跳过不等于放过）", () => {
    writeInstance(".harness/templates/examples/EVT-a.yaml", "EVT-dup");
    writeInstance("phases/phase-01/EVT-a-copy.yaml", "EVT-dup");

    const found = scanForInstances(root).instances.map((i) => i.instance_id);
    expect(found).toHaveLength(2);
    expect(new Set(found)).toEqual(new Set(["EVT-dup"]));
  });
});
