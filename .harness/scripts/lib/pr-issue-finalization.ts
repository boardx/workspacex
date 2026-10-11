// PR-only prospective finalization: never changes sync's main-only close predicate.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { REPO_ROOT } from "./paths";

export type PendingIssuePr = { number: number; head: string; base: string; closingIssues: readonly number[] };
type Environment = Readonly<Record<string, string | undefined>>;
type ReadLivePr = (repo: string, number: number) => unknown;
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function field(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((current, key) => object(current)?.[key], value);
}
const SHA = /^[0-9a-f]{40}$/;
function git(repo: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}
function ancestorStatus(repo: string, commit: string, ref: string): number | null {
  return spawnSync("git", ["merge-base", "--is-ancestor", commit, ref], { cwd: repo, timeout: 10_000, stdio: "ignore" }).status;
}
function readLivePr(repo: string, number: number): unknown {
  const [owner, name] = repo.split("/");
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number state merged headRefOid baseRefOid baseRefName repository{nameWithOwner} headRepository{nameWithOwner} closingIssuesReferences(first:100){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage}}}}}`;
  const result = spawnSync("gh", ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`], { encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return null;
  const response: unknown = JSON.parse(result.stdout);
  if (field(response, "errors") !== undefined) return null;
  return field(response, "data", "repository", "pullRequest");
}

/** Event claims alone cannot waive a strict finding; live GitHub + exact git facts must agree. */
export function readPendingIssuePr(
  env: Environment = process.env,
  repoRoot = REPO_ROOT,
  read: ReadLivePr = readLivePr,
): PendingIssuePr | null {
  if (env.GITHUB_EVENT_NAME !== "pull_request" || !env.GITHUB_EVENT_PATH) return null;
  try {
    const event: unknown = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    const repo = env.GITHUB_REPOSITORY;
    const number = field(event, "number");
    const head = field(event, "pull_request", "head", "sha");
    const base = field(event, "pull_request", "base", "sha");
    if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
      || !Number.isSafeInteger(number) || (number as number) <= 0
      || typeof head !== "string" || !SHA.test(head) || typeof base !== "string" || !SHA.test(base)
      || field(event, "pull_request", "number") !== number
      || field(event, "repository", "full_name") !== repo
      || field(event, "pull_request", "head", "repo", "full_name") !== repo
      || field(event, "pull_request", "base", "repo", "full_name") !== repo
      || field(event, "pull_request", "base", "ref") !== "main") return null;
    const live = read(repo, number as number);
    if (field(live, "number") !== number || field(live, "state") !== "OPEN" || field(live, "merged") !== false
      || field(live, "headRefOid") !== head || field(live, "baseRefOid") !== base || field(live, "baseRefName") !== "main"
      || field(live, "repository", "nameWithOwner") !== repo || field(live, "headRepository", "nameWithOwner") !== repo
      || field(live, "closingIssuesReferences", "pageInfo", "hasNextPage") !== false) return null;
    const nodes = field(live, "closingIssuesReferences", "nodes");
    if (!Array.isArray(nodes) || nodes.some((node) => !Number.isSafeInteger(field(node, "number"))
      || (field(node, "number") as number) <= 0 || typeof field(node, "repository", "nameWithOwner") !== "string")) return null;
    const checkout = git(repoRoot, ["rev-parse", "HEAD"]);
    if (checkout !== head) {
      const parents = git(repoRoot, ["show", "-s", "--format=%P", "HEAD"]);
      if (parents !== `${base} ${head}`) return null;
    }
    return { number: number as number, head, base, closingIssues: nodes.filter((node) => field(node, "repository", "nameWithOwner") === repo).map((node) => field(node, "number") as number) };
  } catch {
    return null; // malformed event, unavailable authority, or incomplete data remains strict.
  }
}

export function mayAwaitIssueFinalization(
  context: PendingIssuePr | null,
  issueNumber: number,
  evidenceCommit: string | null,
  repoRoot = REPO_ROOT,
  mainRef = "origin/main",
): boolean {
  if (!context || !evidenceCommit || !SHA.test(evidenceCommit) || !context.closingIssues.includes(issueNumber)) return false;
  // A missing main ref must not turn unknown integration into "not yet merged".
  if (!git(repoRoot, ["rev-parse", "--verify", `${mainRef}^{commit}`])) return false;
  return ancestorStatus(repoRoot, evidenceCommit, context.head) === 0
    && ancestorStatus(repoRoot, evidenceCommit, context.base) === 1
    && ancestorStatus(repoRoot, evidenceCommit, mainRef) === 1;
}
