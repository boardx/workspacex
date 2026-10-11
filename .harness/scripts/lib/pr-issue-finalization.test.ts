import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sh } from "./sh";
import { evidenceIntegration, evidenceLogRelPath } from "./evidence-integration";
import { checkIssueClosed } from "../doctor";
import { readPendingIssuePr, mayAwaitIssueFinalization } from "./pr-issue-finalization";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "pr-issue-finalization-"));
  dirs.push(repo);
  sh('git init -q && git config user.name Test && git config user.email test@example.com', repo);
  writeFileSync(join(repo, "main"), "base");
  sh('git add . && git commit -qm base && git branch origin-main && git switch -qc feature', repo);
  const base = sh("git rev-parse HEAD", repo).stdout.trim();
  writeFileSync(join(repo, "evidence"), "verified");
  sh('git add . && git commit -qm evidence', repo);
  const head = sh("git rev-parse HEAD", repo).stdout.trim();
  const event = { number: 42, repository: { full_name: "boardx/workspacex" }, pull_request: {
    number: 42, head: { sha: head, repo: { full_name: "boardx/workspacex" } },
    base: { sha: base, ref: "main", repo: { full_name: "boardx/workspacex" } },
  } };
  const live = { number: 42, state: "OPEN", merged: false, headRefOid: head, baseRefOid: base,
    baseRefName: "main", repository: { nameWithOwner: "boardx/workspacex" },
    headRepository: { nameWithOwner: "boardx/workspacex" },
    closingIssuesReferences: { nodes: [{ number: 87, repository: { nameWithOwner: "boardx/workspacex" } }], pageInfo: { hasNextPage: false } },
  };
  const eventPath = join(repo, "event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  const env = { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: "boardx/workspacex" };
  return { repo, base, head, event, live, eventPath, env };
}

describe("pending current PR issue finalization", () => {
  it("warns only the current closing issue without clearing other failures or allowing sync closure", () => {
    const f = fixture();
    const feature = { id: "F01", sprint: "01", status: "passing" } as Parameters<typeof checkIssueClosed>[1];
    const rel = evidenceLogRelPath("21", feature)!;
    mkdirSync(join(f.repo, rel, ".."), { recursive: true });
    writeFileSync(join(f.repo, rel), "[exit 0] verified");
    sh('git add . && git commit -qm verified', f.repo);
    const head = sh("git rev-parse HEAD", f.repo).stdout.trim();
    f.event.pull_request.head.sha = head;
    f.live.headRefOid = head;
    writeFileSync(f.eventPath, JSON.stringify(f.event));
    const context = readPendingIssuePr(f.env, f.repo, () => f.live);
    const issue = { number: 87, title: "F01", body: "<!-- harness-feature: 21/F01 -->", state: "OPEN" };
    const findings: Parameters<typeof checkIssueClosed>[3] = [{ level: "FAIL", phase: "21", msg: "independent failure" }];
    checkIssueClosed("21", feature, [issue], findings, "FAIL", context, f.repo, "origin-main");
    expect(findings.map((finding) => finding.level)).toEqual(["FAIL", "WARN"]);
    expect(findings[1]!.msg).toContain("PR #42");
    const other: typeof findings = [];
    checkIssueClosed("21", feature, [{ ...issue, number: 88 }], other, "FAIL", context, f.repo, "origin-main");
    expect(other[0]!.level).toBe("FAIL");
    const ordinary: typeof findings = [];
    checkIssueClosed("21", feature, [issue], ordinary, "FAIL", null, f.repo, "origin-main");
    expect(ordinary[0]!.level).toBe("FAIL");
    expect(evidenceIntegration("21", feature, f.repo, "origin-main").kind).toBe("not-on-main");
  });
  it("accepts exact head and exact two-parent synthetic merge", () => {
    const f = fixture();
    const context = readPendingIssuePr(f.env, f.repo, () => f.live);
    expect(context).not.toBeNull();
    expect(mayAwaitIssueFinalization(context, 87, f.head, f.repo, "origin-main")).toBe(true);
    sh('git switch -qc merge origin-main && git merge -q --no-ff feature -m merge', f.repo);
    expect(readPendingIssuePr(f.env, f.repo, () => f.live)).not.toBeNull();
  });
  it.each(["push", "workflow_dispatch", "merge_group", undefined])("never exempts %s", (eventName) => {
    const f = fixture();
    expect(readPendingIssuePr({ ...f.env, GITHUB_EVENT_NAME: eventName }, f.repo, () => f.live)).toBeNull();
  });
  it.each(["head", "base", "state", "merged", "fork", "target", "repo", "truncated", "missing"])("fails closed for %s", (kind) => {
    const f = fixture();
    const live = structuredClone(f.live);
    if (kind === "head") live.headRefOid = "a".repeat(40);
    if (kind === "base") live.baseRefOid = "b".repeat(40);
    if (kind === "state") live.state = "CLOSED";
    if (kind === "merged") live.merged = true;
    if (kind === "fork") live.headRepository.nameWithOwner = "other/repo";
    if (kind === "target") live.baseRefName = "develop";
    if (kind === "repo") live.repository.nameWithOwner = "other/repo";
    if (kind === "truncated") live.closingIssuesReferences.pageInfo.hasNextPage = true;
    expect(readPendingIssuePr(f.env, f.repo, () => kind === "missing" ? {} : live)).toBeNull();
  });
  it("rejects unavailable authority, malformed events and inconsistent event repository", () => {
    const f = fixture();
    expect(readPendingIssuePr(f.env, f.repo, () => { throw new Error("unreachable"); })).toBeNull();
    expect(readPendingIssuePr({ ...f.env, GITHUB_REPOSITORY: "other/repo" }, f.repo, () => f.live)).toBeNull();
    writeFileSync(f.eventPath, "{");
    expect(readPendingIssuePr(f.env, f.repo, () => f.live)).toBeNull();
  });
  it("rejects checkout beyond head, unrelated checkout and wrong merge parents", () => {
    const f = fixture();
    writeFileSync(join(f.repo, "extra"), "later");
    sh('git add . && git commit -qm later', f.repo);
    expect(readPendingIssuePr(f.env, f.repo, () => f.live)).toBeNull();
    sh('git switch -q origin-main', f.repo);
    expect(readPendingIssuePr(f.env, f.repo, () => f.live)).toBeNull();
    sh('git switch -qc wrong', f.repo);
    writeFileSync(join(f.repo, "base-extra"), "changed base");
    sh('git add . && git commit -qm base-extra && git merge -q --no-ff feature -m wrong', f.repo);
    expect(readPendingIssuePr(f.env, f.repo, () => f.live)).toBeNull();
  });
  it("only exempts the exact same-repo closing issue and unmerged head evidence", () => {
    const f = fixture();
    const context = readPendingIssuePr(f.env, f.repo, () => f.live);
    expect(mayAwaitIssueFinalization(context, 88, f.head, f.repo, "origin-main")).toBe(false);
    expect(mayAwaitIssueFinalization(context, 87, f.base, f.repo, "origin-main")).toBe(false);
    expect(mayAwaitIssueFinalization(context, 87, null, f.repo, "origin-main")).toBe(false);
    expect(mayAwaitIssueFinalization(context, 87, f.head, f.repo, "missing-main")).toBe(false);
    expect(mayAwaitIssueFinalization(null, 87, f.head, f.repo, "origin-main")).toBe(false);
    f.live.closingIssuesReferences.nodes[0]!.repository.nameWithOwner = "other/repo";
    expect(readPendingIssuePr(f.env, f.repo, () => f.live)?.closingIssues).toEqual([]);
    sh('git branch -f origin-main feature', f.repo);
    expect(mayAwaitIssueFinalization(context, 87, f.head, f.repo, "origin-main")).toBe(false);
  });
  it("does not hide already integrated evidence when origin/main is stale", () => {
    const f = fixture();
    f.event.pull_request.base.sha = f.head;
    f.live.baseRefOid = f.head;
    writeFileSync(f.eventPath, JSON.stringify(f.event));
    const context = readPendingIssuePr(f.env, f.repo, () => f.live);
    expect(context).not.toBeNull();
    expect(mayAwaitIssueFinalization(context, 87, f.head, f.repo, "origin-main")).toBe(false);
  });
  it("does not accept evidence made only in the synthetic merge", () => {
    const f = fixture();
    sh('git switch -qc merge origin-main && git merge -q --no-ff feature -m merge', f.repo);
    const context = readPendingIssuePr(f.env, f.repo, () => f.live);
    const merge = sh('git rev-parse HEAD', f.repo).stdout.trim();
    expect(mayAwaitIssueFinalization(context, 87, merge, f.repo, "origin-main")).toBe(false);
  });
});
