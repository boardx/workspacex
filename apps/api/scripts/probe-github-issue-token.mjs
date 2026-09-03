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
 * 这支脚本把"去实测这个 token 到底有没有 Issues: Write 与 Contents: Write"变成
 * 一条命令，复现的是 `create`/`uploadImage` 真实会走的同一串请求（建一个真 issue
 * 再关掉、`ensureAttachmentsBranch` 的三步 + 一次 `PUT contents`），不是猜测——
 * `GET /repos/{owner}/{repo}` 这种只读请求不需要任何写权限，测不出 Issues: Write
 * 有没有,所以这里**真的建一个 issue、验证成功后立刻关闭**,不是"读一下仓库信息
 * 就当作验证过建 issue 这条路径"。**会产生真实副作用**：成功时会建一个测试 issue
 * （随即关闭)、在 `feedbackAttachmentsBranch` 分支上写一个 1x1 PNG 探测文件（结束时
 * 自动删除,删除失败会明确报告,不是"打印一行手工命令、可能永远没人执行")——这与
 * 生产环境里 `create`/`uploadImage` 真实发生的写入是同一件事,不是额外风险。
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

function issuesUrl() {
  return `${repoUrl()}/issues`;
}
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

  // ① Issues: Write——**真的建一个 issue** 再立刻关闭,不是 `GET` 仓库信息那种
  //   只读请求(那测不出任何写权限,fine-grained token 完全可能只给 Contents:
  //   Write、不给 Issues: Write,却在只读检查下看起来"什么都正常")。
  const createIssueRes = await step("POST issues（真实建一个探测 issue）", () =>
    fetch(issuesUrl(), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title: "[probe] GITHUB_ISSUE_TOKEN 权限探测（自动关闭）",
        body: "由 `probe-github-issue-token.mjs` 创建，用于实测 Issues: Write，创建后立即关闭。",
      }),
    }),
  );
  let issuesWriteOk = false;
  if (createIssueRes) {
    const created = await createIssueRes.json().catch(() => ({}));
    const issueNumber = created?.number;
    if (typeof issueNumber === "number") {
      const closeRes = await step(`PATCH issues/${issueNumber}（关闭探测 issue）`, () =>
        fetch(`${issuesUrl()}/${issueNumber}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
        }),
      );
      issuesWriteOk = closeRes !== null;
      if (closeRes === null) {
        console.log(`  ⚠ 探测 issue #${issueNumber} 建出来了但关闭失败，请手动关闭：${created?.html_url ?? ""}`);
      }
    }
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

  let contentsWriteOk = false;
  let putBody = null;
  if (!branchReady) {
    console.log("\n✗ Contents: Write 探测失败：孤儿分支建不出来，多半是 Contents: Write（fine-grained PAT）或 repo（classic PAT）权限缺失。");
  } else {
    const putRes = await step(`PUT contents/${PROBE_PATH}（真实写一个探测文件）`, () =>
      fetch(`${repoUrl()}/contents/${PROBE_PATH.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ message: `probe: token permission check`, content: TINY_PNG, branch: BRANCH }),
      }),
    );
    if (putRes === null) {
      console.log("\n✗ Contents: Write 探测失败：分支建得出来，但写文件失败。");
    } else {
      putBody = await putRes.json().catch(() => ({}));
      contentsWriteOk = true;
    }
  }

  // 自动清理探测文件——不是打印一行手工命令指望有人执行，探测本身的写入
  // 到此已经派上用场（证明了 Contents: Write），继续留着只是垃圾。删除失败
  // 明确报告，不静默吞掉（同本仓一贯的 best-effort 纪律：吞可以，但不能哑）。
  if (contentsWriteOk && putBody?.content?.sha) {
    const deleteRes = await step(`DELETE contents/${PROBE_PATH}（清理探测文件）`, () =>
      fetch(`${repoUrl()}/contents/${PROBE_PATH.split("/").map(encodeURIComponent).join("/")}`, {
        method: "DELETE",
        headers: headers(),
        body: JSON.stringify({ message: "probe: cleanup", sha: putBody.content.sha, branch: BRANCH }),
      }),
    );
    if (deleteRes === null) {
      console.log(`  ⚠ 探测文件清理失败，请手动删除：${PROBE_PATH}（分支 ${BRANCH}）`);
    }
  }

  console.log("");
  console.log(`${issuesWriteOk ? "✓" : "✗"} Issues: Write（建 issue 这条路径）`);
  console.log(`${contentsWriteOk ? "✓" : "✗"} Contents: Write（推图片这条路径）`);
  if (!issuesWriteOk || !contentsWriteOk) {
    console.log(
      "\n修复：去 GitHub → Settings → Developer settings → 找到这个 token → 补上缺的那项权限" +
        `（对 ${OWNER}/${REPO}）；若是 classic PAT 且仓库公开，勾 public_repo 一次性覆盖两者。`,
    );
    process.exit(1);
  }
  console.log("\n✓ token 同时具备建 issue 与推图片两条路径都需要的权限。");
}

await main();
