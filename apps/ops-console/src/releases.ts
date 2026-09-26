/**
 * 发布控制台（只读）。单一事实源：发布事实只存在于既有部署流水线里——
 * GitHub Releases（版本号）与部署 workflow 的运行记录（时间 / 环境 / 状态）。
 * 本模块每次请求现取现算，**不落任何存储**，也就不会有第二份会漂移的副本。
 *
 * 服务端令牌只以 secret 名 GITHUB_READ_TOKEN 出现；值不入库、不回显。
 */
export interface ReleaseRow {
  source: "release" | "deploy";
  version: string;
  environment: string;
  status: "success" | "failure" | "in_progress" | "cancelled" | "unknown" | "published" | "prerelease";
  at: string;
  revision: string | null;
  url: string;
}

type Gh = (path: string) => Promise<unknown>;

interface GhRun { head_sha: string; status: string; conclusion: string | null; created_at: string; html_url: string; run_number: number }
interface GhRelease { tag_name: string; prerelease: boolean; draft: boolean; published_at: string | null; html_url: string }

/** workflow 文件名 → 环境名。流水线本身就是环境的定义处，这里只是把文件名去掉前后缀。 */
export const environmentOf = (workflow: string) => workflow.replace(/^deploy-/, "").replace(/\.ya?ml$/, "");

export function runStatus(run: Pick<GhRun, "status" | "conclusion">): ReleaseRow["status"] {
  if (run.status !== "completed") return "in_progress";
  if (run.conclusion === "success" || run.conclusion === "failure" || run.conclusion === "cancelled") return run.conclusion;
  return "unknown";
}

export async function listReleases(gh: Gh, repo: string, workflows: string[]): Promise<ReleaseRow[]> {
  const rows: ReleaseRow[] = [];
  const releases = (await gh(`/repos/${repo}/releases?per_page=20`)) as GhRelease[];
  for (const r of releases) {
    if (r.draft || !r.published_at) continue;
    rows.push({ source: "release", version: r.tag_name, environment: "all", status: r.prerelease ? "prerelease" : "published", at: r.published_at, revision: null, url: r.html_url });
  }
  for (const wf of workflows) {
    const body = (await gh(`/repos/${repo}/actions/workflows/${encodeURIComponent(wf)}/runs?per_page=10`)) as { workflow_runs?: GhRun[] };
    for (const run of body.workflow_runs ?? []) {
      rows.push({ source: "deploy", version: `${run.head_sha.slice(0, 7)} (#${run.run_number})`, environment: environmentOf(wf), status: runStatus(run), at: run.created_at, revision: run.head_sha, url: run.html_url });
    }
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

export function githubClient(token: string): Gh {
  return async (path) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "workspacex-ops-console" },
    });
    if (!res.ok) throw new Error(`GITHUB_${res.status}`);
    return res.json();
  };
}
