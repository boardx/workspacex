"use client";
import { useState } from "react";
import Link from "next/link";
import { GithubSourceConnection, GithubSourceConnectionTransaction, operations, sourceConnectionExchanges } from "@repo/contracts/skill-source-connections";
import { Button } from "@/components/ui/button";

type Transaction = ReturnType<typeof GithubSourceConnectionTransaction.parse>;
type Connection = ReturnType<typeof GithubSourceConnection.parse>;
const repositories = [{ repositoryId: "demo-research", fullName: "example/private-research", contentsPermission: "read" as const }, { repositoryId: "demo-skills", fullName: "example/team-skills", contentsPermission: "read" as const }];
const transactionBase = (t: Transaction) => ({ transactionId: t.transactionId, transactionRevision: t.transactionRevision + 1, expiresAt: t.expiresAt, returnTarget: t.returnTarget, reconnect: t.reconnect });
const state = "demo-state".repeat(4);
export function SourceConnectionsPreview() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [granted, setGranted] = useState<string[]>([]);
  const [target, setTarget] = useState<"import" | "upstream" | "connections">("import");
  const [notice, setNotice] = useState("");
  const active = transaction?.status === "pending" || transaction?.status === "select-repositories";
  const begin = () => {
    const request = operations.beginGithubSourceConnection.in.parse({ returnTarget: target === "upstream" ? { kind: target, skillId: "demo-skill", draftId: "demo-draft" } : { kind: target }, reconnect: connection ? { connectionId: connection.connectionId, expectedRevision: connection.revision } : null });
    const response = operations.beginGithubSourceConnection.out.parse({ ...request, transactionId: "demo-transaction", transactionRevision: 1, expiresAt: "2026-12-31T00:00:00Z", status: "pending", authorizationUrl: `https://github.com/login/oauth/authorize?client_id=demo&state=${state}&code_challenge_method=S256&code_challenge=${"a".repeat(43)}` });
    sourceConnectionExchanges.beginGithubSourceConnection.parse({ request, response });
    setTransaction(response); setSelection([]); setNotice("演示授权已开始。下一步只模拟回调，不会打开 GitHub。");
  };
  const callback = (reason?: "AUTHORIZATION_DENIED" | "AUTHORIZATION_EXPIRED") => {
    if (transaction?.status !== "pending") return;
    const response = operations.acceptGithubSourceCallback.out.parse({ ...transactionBase(transaction), ...(reason ? { status: "failed", reason } : { status: "select-repositories", repositorySelectionRevision: 1 }) });
    sourceConnectionExchanges.acceptGithubSourceCallback.parse({ request: { state, code: "demo-code" }, stored: { state, consumed: false, transaction }, response });
    if (response.status === "select-repositories") sourceConnectionExchanges.listSourceTransactionRepositories.parse({ request: { transactionId: response.transactionId, cursor: null }, response: { transactionId: response.transactionId, items: repositories, nextCursor: null, selectionRevision: response.repositorySelectionRevision } });
    setTransaction(response); setNotice(reason ? `${reason === "AUTHORIZATION_DENIED" ? "已拒绝授权" : "授权已过期"}。可以重新开始；原连接与已有草稿保持原样。` : "模拟回调成功。请明确选择允许读取的仓库；默认不选择任何仓库。");
  };
  const confirm = () => {
    if (transaction?.status !== "select-repositories" || !selection.length) return;
    const request = operations.confirmSourceRepositories.in.parse({ transactionId: transaction.transactionId, expectedTransactionRevision: transaction.transactionRevision, expectedSelectionRevision: transaction.repositorySelectionRevision, repositoryIds: selection });
    const response = operations.confirmSourceRepositories.out.parse({ ...transactionBase(transaction), status: "completed", repositoryIds: selection, selectionRevision: transaction.repositorySelectionRevision, connection: { connectionId: transaction.reconnect?.connectionId ?? "demo-personal-connection", revision: transaction.reconnect ? transaction.reconnect.expectedRevision + 1 : 1, provider: "github", scope: "personal", displayName: "我的 GitHub 来源（演示）", status: "active", updatedAt: "2026-09-10T00:00:00Z" } });
    sourceConnectionExchanges.confirmSourceRepositories.parse({ request, stored: transaction, response });
    if (response.status !== "completed") return;
    setTransaction(response); setConnection(response.connection); setGranted(response.repositoryIds); setNotice("所选仓库已加入个人演示连接。尚未读取源码或修改草稿。");
  };
  const cancel = () => {
    if (!transaction || !active) return;
    const response = operations.cancelSourceConnectionTransaction.out.parse({ ...transactionBase(transaction), status: "cancelled" });
    sourceConnectionExchanges.cancelSourceConnectionTransaction.parse({ request: { transactionId: transaction.transactionId, expectedTransactionRevision: transaction.transactionRevision }, stored: transaction, response });
    setTransaction(response); setSelection([]); setNotice("已取消。原连接与已有草稿保持原样；可重新开始。");
  };
  const revoke = () => {
    if (!connection || active) return;
    const response = operations.revokeSourceConnection.out.parse({ ...connection, revision: connection.revision + 1, status: "revoked" });
    sourceConnectionExchanges.revokeSourceConnection.parse({ request: { connectionId: connection.connectionId, expectedRevision: connection.revision }, response });
    setConnection(response); setTransaction(null); setGranted([]); setNotice("演示连接已撤销。后续读取不可用，已有草稿内容保持原样。");
  };
  const returnTarget = transaction?.returnTarget.kind ?? target;
  return <main className="min-h-screen bg-background p-6 text-background-foreground"><div className="mx-auto max-w-4xl space-y-5">
    <Link href="/preview/ai-capability-studio/import" className="text-13 text-primary">返回导入向导示例</Link>
    <header><h1 className="text-28 font-semibold">连接私有来源</h1><p className="mt-2 text-13 text-muted-foreground">独立演示 · 不调用真实授权或生产 API，不持久化。刷新页面会重置全部演示状态。</p></header>
    <section className="space-y-3 rounded-container border border-border bg-card p-5"><h2 className="text-16 font-semibold">个人 GitHub 连接</h2><p className="text-12">连接仅供本人读取明确选择的仓库，不自动授予组织其他成员。取消、失败或撤销均不修改已有草稿。</p>
      {connection ? <div data-testid="source-current-connection" className="space-y-2 text-13"><p>{connection.displayName} · {connection.status === "active" ? "可读取" : "已撤销"}</p><p>{connection.connectionId} · 版本 {connection.revision}</p>{granted.length > 0 && <ul>{repositories.filter(repo => granted.includes(repo.repositoryId)).map(repo => <li key={repo.repositoryId}>{repo.fullName} · 只读</li>)}</ul>}<Button variant="outline" disabled={active || connection.status === "revoked"} onClick={revoke}>撤销演示连接</Button></div> : <p className="text-13">还没有来源连接。先完成演示授权，再选择仓库。</p>}
      <fieldset disabled={active} className="space-y-2"><legend className="text-13">完成后返回</legend>{([["import", "导入向导"], ["upstream", "草稿来源修复"], ["connections", "连接管理"]] as const).map(([value, label]) => <label key={value} className="flex gap-2 text-12"><input type="radio" name="source-return" value={value} checked={target === value} onChange={() => { setTarget(value); setTransaction(null); }} />{label}</label>)}</fieldset>
      <Button variant="primary" disabled={active} onClick={begin}>{connection ? "重新授权（演示）" : "开始连接（演示）"}</Button>
    </section>
    {transaction?.status === "pending" && <section className="space-y-3 rounded-container border border-border p-5"><h2 className="text-16 font-semibold">等待模拟授权回调</h2><p className="text-12">以下按钮模拟外部授权结果，不会访问 GitHub。</p><div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => callback()}>模拟授权成功回调</Button><Button variant="outline" onClick={() => callback("AUTHORIZATION_DENIED")}>模拟拒绝授权</Button><Button variant="outline" onClick={() => callback("AUTHORIZATION_EXPIRED")}>模拟授权过期</Button></div></section>}
    {transaction?.status === "select-repositories" && <section className="space-y-3 rounded-container border border-border p-5"><h2 className="text-16 font-semibold">选择允许读取的仓库</h2><fieldset className="space-y-2"><legend className="mb-2 text-12">仅所选仓库会加入本次连接；重新授权以本次选择替换原清单。</legend>{repositories.map(repo => <label key={repo.repositoryId} className="flex gap-2 text-13"><input type="checkbox" checked={selection.includes(repo.repositoryId)} onChange={event => setSelection(ids => event.target.checked ? [...ids, repo.repositoryId] : ids.filter(id => id !== repo.repositoryId))} />{repo.fullName} · 只读</label>)}</fieldset><Button variant="primary" disabled={!selection.length} onClick={confirm}>确认所选仓库（演示）</Button></section>}
    {active && <Button variant="outline" onClick={cancel}>取消本次授权</Button>}
    <p role="status" className="text-13">{notice}</p>
    {transaction && !active && <Link className="text-13 text-primary" href={returnTarget === "import" ? "/preview/ai-capability-studio/import" : returnTarget === "upstream" ? "/preview/ai-capability-studio/workbench" : "/preview/ai-capability-studio/connections"}>返回{returnTarget === "import" ? "导入向导" : returnTarget === "upstream" ? "草稿来源修复示例" : "连接管理"}（独立示例，不传递演示连接）</Link>}
  </div></main>;
}
