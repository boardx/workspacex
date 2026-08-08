// workflow-event-doctor.test.ts — H3A-034 的真实 git IO 反证。
//
// `countContentChangeCommitsAfterFirst` 是 doctor 层唯一含真实 git 子进程调用
// 的函数（`git log --follow` + `git diff --quiet`）。这里用一次性临时 git 仓库
// （mkdtemp，测试结束 rmSync 清理）构造提交序列反证——绝不对本仓库真实 git
// 历史做任何写操作，同任务书要求"不要在测试里污染本仓库的真实 git 历史"。
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "./lib/sh";
import { countContentChangeCommitsAfterFirst } from "./workflow-event-doctor";

const tempDirs: string[] = [];

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "h3a034-append-only-"));
  tempDirs.push(dir);
  sh("git init -q", dir);
  sh('git config user.email "test@example.com"', dir);
  sh('git config user.name "H3A-034 Test"', dir);
  return dir;
}

function commitFile(repo: string, relPath: string, content: string, message: string): void {
  writeFileSync(join(repo, relPath), content, "utf8");
  const addResult = sh(`git add ${JSON.stringify(relPath)}`, repo);
  expect(addResult.code).toBe(0);
  const commitResult = sh(`git commit -q -m ${JSON.stringify(message)}`, repo);
  expect(commitResult.code).toBe(0);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("countContentChangeCommitsAfterFirst (H3A-034, 真实 git IO)", () => {
  it("文件从未被提交过 → 0 次变更", () => {
    const repo = makeTempRepo();
    expect(countContentChangeCommitsAfterFirst("EVT-never-committed.yaml", repo)).toBe(0);
  });

  it("文件只被提交过一次（首次新增，从未被改过）→ 0 次变更", () => {
    const repo = makeTempRepo();
    commitFile(repo, "EVT-1.yaml", "instance_id: EVT-1\nkind: progress\n", "add EVT-1");
    expect(countContentChangeCommitsAfterFirst("EVT-1.yaml", repo)).toBe(0);
  });

  it("文件在首次新增之后被真实改过一次 → 1 次变更（append-only 被违反）", () => {
    const repo = makeTempRepo();
    commitFile(repo, "EVT-2.yaml", "instance_id: EVT-2\nkind: progress\n", "add EVT-2");
    commitFile(repo, "EVT-2.yaml", "instance_id: EVT-2\nkind: progress\nblockers: [oops]\n", "rewrite EVT-2 history");
    expect(countContentChangeCommitsAfterFirst("EVT-2.yaml", repo)).toBe(1);
  });

  it("文件被真实改过三次 → 3 次变更", () => {
    const repo = makeTempRepo();
    commitFile(repo, "EVT-3.yaml", "v1\n", "add EVT-3");
    commitFile(repo, "EVT-3.yaml", "v2\n", "rewrite 1");
    commitFile(repo, "EVT-3.yaml", "v3\n", "rewrite 2");
    commitFile(repo, "EVT-3.yaml", "v4\n", "rewrite 3");
    expect(countContentChangeCommitsAfterFirst("EVT-3.yaml", repo)).toBe(3);
  });

  it("其它无关文件在这期间被提交、被改动 → 不影响目标文件的变更计数", () => {
    const repo = makeTempRepo();
    commitFile(repo, "EVT-4.yaml", "instance_id: EVT-4\n", "add EVT-4");
    commitFile(repo, "OTHER.yaml", "instance_id: OTHER\n", "add unrelated file");
    commitFile(repo, "OTHER.yaml", "instance_id: OTHER\nchanged: true\n", "modify unrelated file");
    expect(countContentChangeCommitsAfterFirst("EVT-4.yaml", repo)).toBe(0);
    expect(countContentChangeCommitsAfterFirst("OTHER.yaml", repo)).toBe(1);
  });
});
