#!/usr/bin/env node
/**
 * 反馈闭环「图片没传到 GitHub issue 里」的**实测探测器**——要有真的
 * `GITHUB_ISSUE_TOKEN` 才能跑。
 *
 * 背景：`FetchGithubIssueCreator.create()`（建 issue）只需要 **Issues: Write**，
 * 而 `FetchGithubIssueCreator.uploadImage()`（`infrastructure/feedback/github-issue-creator.ts`，
 * 2026-09-03 随反馈附件功能新增）走的是完全不同的第二条路径——Git Data API
 * （`git/refs` → `git/trees` → `git/commits`，惰性建 `feedback-attachments` 孤儿分支）
 * + Contents API（`PUT .../contents/<path>`），这条路径需要 **Contents: Write**。
 *
 * `docs/adr/ADR-108-feedback-github-issue-and-status-mail.md` 在这个图片功能存在
 * 之前写成（2026-08-31）：给 `GITHUB_ISSUE_TOKEN` 配最小权限——只要 Issues: Write，
 * "代码里没有第二条能打到 GitHub 的路径"。这句话在图片功能加进来之后已经不成立，
 * 但 ADR 的部署指引没有跟着更新——按那份指引配出来的 token（fine-grained PAT，
 * 只勾 Issues: Write）建 issue 完全正常，但 `uploadImage` 会在 Git Data / Contents
 * API 上稳定拿到 403，被 `triageFeedback` 的 best-effort 吞掉只记日志
 * （`traceId: "feedback-triage-attachment-image"`）——症状就是"issue 建出来了，
 * 但图片从来没有出现过"，且没有任何用户可见的报错。
 *
 * 这支脚本把"去实测这个 token 到底有没有 Contents: Write"变成一条命令，
 * 复现的是 `uploadImage` 真实会走的同一串请求（`ensureAttachmentsBranch` 的
 * 三步 + 一次 `PUT contents`），不是猜测。**会产生真实副作用**：成功时会在
 * `feedbackAttachmentsBranch` 分支上写一个 1x1 PNG 探测文件并立刻打印如何删除
 * 它——这与生产环境里 `uploadImage` 真实发生的写入是同一件事，不是额外风险。
 *
 * 用法（在配置了真 token 的环境）：
 *     GITHUB_ISSUE_TOKEN=ghp_xxx node apps/api/scripts/probe-github-issue-token.mjs
 *     # 可选：GITHUB_ISSUE_REPO_OWNER / GITHUB_ISSUE_REPO_NAME / GITHUB_ISSUE_ATTACHMENTS_BRANCH
 *     # 默认与 `github-issue-creator.ts` 的 `githubIssueConfig()` 完全一致。
 */

const TOKEN = process.env.GITHUB_ISSUE_TOKEN ?? "";
const OWNER = process.env.GITHUB_ISSUE_REPO_OWNER ?? "boardx";
const REPO = process.env.GITHUB_ISSUE_REPO_NAME ?? "workspacex";
const BRANCH = process.env.GITHUB_ISSUE_ATTACHMENTS_BRANCH ?? "feedback-attachments";
const PROBE_PATH = `${BRANCH}/_probe-token-${Date.now()}.png`;

/** 1x1 透明 PNG（base64）——同 `probe-vision-model.mjs` 的既有做法，最小合法字节。 */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function repoUrl() {
  return `https://api.github.com/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}`;
}
function headers() {
  return {
    authorization: `Bearer ${TOKEN}`,
    "user-agent": "workspacex-feedback-loop-probe",
    accept: "application/vnd.github+json",
    "content-type": "application/json",
  };
}

/** 输出一步的结果，非 2xx 时把上游 message 原样打出来，不猜测原因。 */
async function step(label, run) {
  let res;
  try {
    res = await run();
  } catch (e) {
    console.log(`✗ ${label}：网络/超时 —— ${String(e)}`);
    return null;
  }
  if (res.ok) {
    console.log(`✓ ${label}（HTTP ${res.status}）`);
    return res;
  }
  const body = await res.json().catch(() => ({}));
  console.log(`✗ ${label}（HTTP ${res.status}）—— ${body?.message ?? "(无 message)"}`);
  return null;
}

async function main() {
  if (TOKEN === "") {
    console.error("GITHUB_ISSUE_TOKEN 未设置——本脚本必须用真 token 跑，没有 token 时不做任何猜测性输出。");
    process.exit(2);
  }
  console.log(`仓库：${OWNER}/${REPO}，附件分支：${BRANCH}\n`);

  // ① 建 issue 需要的权限面——只读检查，不产生副作用。
  const repoRes = await step("GET 仓库信息（建 issue 这条路径依赖的最基本读权限）", () =>
    fetch(repoUrl(), { headers: headers() }),
  );
  if (repoRes) {
    const scopes = repoRes.headers.get("x-oauth-scopes");
    if (scopes !== null) console.log(`  classic PAT scopes：${scopes || "(空)"}`);
  }

  // ② 图片上传真实会走的路径——Git Data API 三步 + Contents API 一次 PUT。
  //    与 `ensureAttachmentsBranch` / `uploadImage` 用**同一串**请求，不是简化版。
  console.log("");
  const refRes = await step(`GET git/ref/heads/${BRANCH}（分支是否已存在）`, () =>
    fetch(`${repoUrl()}/git/ref/heads/${encodeURIComponent(BRANCH)}`, { headers: headers() }),
  );
  let branchReady = refRes !== null;
  if (!branchReady) {
    const treeRes = await step("POST git/trees（惰性建孤儿分支·第一步）", () =>
      fetch(`${repoUrl()}/git/trees`, { method: "POST", headers: headers(), body: JSON.stringify({ tree: [] }) }),
    );
    const treeBody = treeRes ? await treeRes.json().catch(() => ({})) : null;
    if (treeBody?.sha) {
      const commitRes = await step("POST git/commits（惰性建孤儿分支·第二步）", () =>
        fetch(`${repoUrl()}/git/commits`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ message: "probe: orphan branch init", tree: treeBody.sha, parents: [] }),
        }),
      );
      const commitBody = commitRes ? await commitRes.json().catch(() => ({})) : null;
      if (commitBody?.sha) {
        const createRefRes = await step("POST git/refs（惰性建孤儿分支·第三步）", () =>
          fetch(`${repoUrl()}/git/refs`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commitBody.sha }),
          }),
        );
        branchReady = createRefRes !== null;
      }
    }
  }

  if (!branchReady) {
    console.log("\n结论：分支建不出来，多半是 Contents: Write（fine-grained PAT）或 repo（classic PAT）权限缺失。");
    console.log(
      "修复：去 GitHub → Settings → Developer settings → 找到这个 token → 补上对" +
        ` ${OWNER}/${REPO} 的 Contents: Write（fine-grained）；若是 classic PAT 且仓库公开，勾 public_repo 即可覆盖。`,
    );
    process.exit(1);
  }

  const putRes = await step(`PUT contents/${PROBE_PATH}（真实写一个探测文件）`, () =>
    fetch(`${repoUrl()}/contents/${PROBE_PATH.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ message: `probe: token permission check`, content: TINY_PNG, branch: BRANCH }),
    }),
  );
  if (putRes === null) {
    console.log("\n结论：分支建得出来，但写文件失败——同上，缺 Contents: Write。");
    process.exit(1);
  }
  const putBody = await putRes.json().catch(() => ({}));
  console.log(`\n✓ token 同时具备建 issue 与推图片两条路径都需要的权限。`);
  console.log(`探测文件的 raw URL：${putBody?.content?.download_url ?? "(未知)"}`);
  console.log(
    `清理（可选，探测文件不影响功能，但建议删掉）：` +
      `DELETE ${repoUrl()}/contents/${PROBE_PATH}，body 带 { message, sha: "${putBody?.content?.sha ?? "?"}", branch: "${BRANCH}" }`,
  );
}

await main();
