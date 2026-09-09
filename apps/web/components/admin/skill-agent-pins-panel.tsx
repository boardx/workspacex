"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listAgents, type AgentListRow } from "@/lib/agent-definition";
import { getAssetDirectory } from "@/lib/asset-directory";
import { getSkillFileSnapshot, type SkillSnapshot } from "@/lib/live-skill-files";
import { getAgentSkillPins, setAgentSkillPins, replaceSkillPins, type AgentSkillPins } from "@/lib/live-agent-skill-pins";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
const describe = (reason: unknown) => reason instanceof ApiError && reason.status === 409 ? "Agent 已有更新，未覆盖其他人的绑定。请重新读取，核对完整清单后再确认。" : reason instanceof Error ? reason.message : "请求失败，请重试。";
export function SkillAgentPinsPanel({ skillId }: { skillId: string }) {
  const [agents, setAgents] = useState<readonly AgentListRow[]>([]);
  const [agentId, setAgentId] = useState("");
  const [target, setTarget] = useState<SkillSnapshot | null>(null);
  const [current, setCurrent] = useState<AgentSkillPins | null>(null);
  const [previous, setPrevious] = useState<string[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [reloadTarget, setReloadTarget] = useState(0);
  const epoch = useRef(0), pending = useRef(false);
  useEffect(() => { setPrevious(null); }, [skillId]);
  useEffect(() => {
    let active = true; setTarget(null); setConfirmed(false); setError("");
    Promise.all([listAgents(), getAssetDirectory("skill", skillId).then(directory => {
      if (!directory.currentVersionId) throw new Error("该 Skill 没有可固定的已发布版本。");
      return getSkillFileSnapshot(skillId, directory.currentVersionId);
    })]).then(([rows, snapshot]) => { if (active) { setAgents(rows); setTarget(snapshot); } }).catch(reason => { if (active) setError(describe(reason)); });
    return () => { active = false; };
  }, [skillId, reloadTarget]);
  useEffect(() => {
    const attempt = ++epoch.current; pending.current = false; setCurrent(null); setConfirmed(false); setError(""); setNotice("");
    if (!agentId) { setBusy(false); return; }
    setBusy(true);
    getAgentSkillPins(agentId).then(value => { if (epoch.current === attempt) setCurrent(value); }).catch(reason => { if (epoch.current === attempt) setError(describe(reason)); }).finally(() => { if (epoch.current === attempt) setBusy(false); });
    return () => { epoch.current = attempt + 1; };
  }, [agentId, skillId, reload]);
  const apply = async (restore: boolean) => {
    if (!current || !target || !confirmed || pending.current || restore && previous === null) return;
    const replacements = restore ? previous! : [target.versionId];
    const requested = replaceSkillPins(current.pins, skillId, replacements);
    if (JSON.stringify(requested) === JSON.stringify(current.pins.map(pin => pin.versionId))) return;
    const before = current.pins.filter(pin => pin.skillId === skillId).map(pin => pin.versionId);
    const attempt = epoch.current; pending.current = true; setBusy(true); setError(""); setNotice(""); setConfirmed(false);
    let saved = false;
    try {
      const result = await setAgentSkillPins(agentId, current.publishedVersionId, requested);
      if (epoch.current !== attempt) return;
      saved = true; setPrevious(before); setCurrent(null);
      setNotice(`Agent 新版本 ${result.versionId} 已发布。正在重新读取真实固定清单。`);
      const refreshed = await getAgentSkillPins(agentId);
      if (epoch.current !== attempt) return;
      setCurrent(refreshed);
      setNotice(refreshed.publishedVersionId === result.versionId ? `已${restore ? "恢复" : "固定"}该 Skill 版本并发布 Agent ${result.versionId}；其他 Skill 绑定保留。新会话使用当前绑定，已有运行保留原快照。` : "写入已成功，但 Agent 随后又有更新。当前展示重新读取的最新清单，请重新审阅。");
    } catch (reason) {
      if (epoch.current === attempt) { setError(`${saved ? "写入已成功，但重新读取失败。请刷新确认；不要把读取失败当作写入失败。" : ""}${describe(reason)}`); if (reason instanceof ApiError && reason.status === 409) setCurrent(null); }
    } finally { if (epoch.current === attempt) { pending.current = false; setBusy(false); } }
  };
  const targetAlreadyPinned = !!target && !!current && current.pins.filter(pin => pin.skillId === skillId).length === 1 && current.pins.some(pin => pin.skillId === skillId && pin.versionId === target.versionId);
  return <main className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
    <Link className="text-13 text-primary" href={`/platform-admin/skill/${encodeURIComponent(skillId)}`}>返回 Skill 文件编辑</Link>
    <header><h1 className="text-24 font-semibold">固定 Skill 版本到 Agent</h1><p className="mt-2 text-13 text-muted-foreground">只替换当前 Skill 的绑定，保留其他 Skill 的版本与顺序。每次操作发布一个新的 Agent 版本。</p></header>
    {error && <p role="alert" className="whitespace-pre-wrap text-13 text-destructive">{error}</p>}{notice && <p role="status" className="text-13">{notice}</p>}
    <section className="space-y-3 rounded-container border border-border p-4"><h2 className="text-16 font-semibold">将要固定的已发布 Skill</h2><p className="break-all text-13" data-testid="pin-target-version">{target ? `${target.skillId} · ${target.semanticLabel} · ${target.versionId}` : "尚未读取目标版本"}</p><Button variant="outline" disabled={busy} onClick={() => { setConfirmed(false); setReloadTarget(value => value + 1); }}>读取最新 Skill 版本</Button></section>
    <label className="space-y-2 text-13">选择 Agent<select aria-label="选择 Agent" className="block w-full rounded-control border border-border bg-background p-2" value={agentId} disabled={busy} onChange={event => { setPrevious(null); setAgentId(event.target.value); }}><option value="">请选择</option>{agents.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name} · {agent.agentId}</option>)}</select></label>
    {agentId && <Button variant="outline" disabled={busy} onClick={() => { setConfirmed(false); setReload(value => value + 1); }}>重新读取 Agent 绑定</Button>}
    {current && <section className="space-y-3 rounded-container border border-border p-4" data-testid="current-agent-pins"><h2 className="text-16 font-semibold">完整固定清单</h2><p className="break-all text-12">Agent 版本 {current.publishedVersionId}</p>{current.pins.length ? <ol className="list-inside list-decimal space-y-2 text-13">{current.pins.map((pin, index) => <li key={`${index}-${pin.versionId}`} className="break-all">{pin.skillId} · {pin.versionId}{pin.skillId === skillId ? " · 本次目标 Skill" : " · 保留"}</li>)}</ol> : <p className="text-13">当前没有固定项，运行时自动加载全部已启用 Skill。固定后将仅加载完整固定清单中的 Skill。</p>}
      <label className="flex items-start gap-2 text-13"><input type="checkbox" checked={confirmed} disabled={busy || !target} onChange={event => setConfirmed(event.target.checked)} />我已核对目标版本与完整清单，确认发布新的 Agent 版本；已有运行不切换快照。</label>
      <Button variant="primary" disabled={busy || !target || !confirmed || targetAlreadyPinned} onClick={() => apply(false)}>固定所示 Skill 版本</Button>
      {previous !== null && <div className="space-y-2 border-t border-border pt-3"><p className="break-all text-12">本页上次变更前，该 Skill 固定项：{previous.length ? previous.join("、") : "无"}。恢复只更新本 Skill，其余项按当前清单保留；恢复后完整清单为空时恢复组织默认 Skill 选择（自动加载全部启用 Skill）。刷新页面后此快捷恢复记录不保留。</p><Button variant="outline" disabled={busy || !confirmed} onClick={() => apply(true)}>恢复本页上次 Skill 固定项</Button></div>}
    </section>}
  </main>;
}
