"use client";

import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ResourceCard } from "@/components/ui/resource-card";
import { ROLE_CATEGORY_LABEL } from "@/lib/agent-directory";
import {
  agentDisplayNameByAvatar,
  enableOfficialRolePack,
  getOfficialRolePackOffer,
  upgradeOfficialRoleSelections,
  type EnableProgress,
  type OfficialRolePackOffer,
} from "@/lib/agent-directory";

/** Mounted inside an organization-keyed modal; only an explicit click imports the pack. */
export function OfficialDigitalHumanPanel({ onEnabled, layout = "list" }: { onEnabled: () => void; layout?: "list" | "cards" }) {
  const { session } = useSession();
  const currentSession = React.useRef(session);
  currentSession.current = session;
  const controller = React.useRef<AbortController | null>(null);
  const [offer, setOffer] = React.useState<OfficialRolePackOffer | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [enabling, setEnabling] = React.useState(false);
  const [progress, setProgress] = React.useState<EnableProgress | null>(null);
  const [completedAction, setCompletedAction] = React.useState<"enable" | "upgrade" | null>(null);
  const [selectedUpgrades, setSelectedUpgrades] = React.useState<string[]>([]);
  const [confirmUpgrade, setConfirmUpgrade] = React.useState(false);
  const upgradeAttempt = React.useRef<{ selection: string; key: string } | null>(null);
  const [tick, setTick] = React.useState(0);
  const alive = React.useRef(true);
  const busy = React.useRef(false);
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOfficialRolePackOffer().then(
      (value) => { if (!cancelled) { setOffer(value); setSelectedUpgrades([]); setConfirmUpgrade(false); } },
      () => { if (!cancelled) setError("官方数字人加载失败，请重试。"); },
    ).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  async function enable() {
    if (!offer?.canEnable || offer.pending.length === 0 || busy.current || !session) return;
    const startingSession = session;
    const abort = new AbortController();
    controller.current = abort;
    busy.current = true;
    setEnabling(true);
    setError(null);
    try {
      await enableOfficialRolePack(offer, (value) => { if (alive.current) setProgress(value); }, {
        orgId: startingSession.currentOrgId, sessionToken: startingSession.sessionToken, signal: abort.signal,
        isCurrent: () => alive.current && currentSession.current?.currentOrgId === startingSession.currentOrgId && currentSession.current?.sessionToken === startingSession.sessionToken,
      });
      if (!alive.current) return;
      setCompletedAction("enable");
      onEnabled();
      setTick((value) => value + 1);
    } catch {
      if (alive.current) setError("启用尚未完成，已完成的部分会保留。请重试继续启用。");
    } finally {
      busy.current = false;
      if (alive.current) { setEnabling(false); setProgress(null); }
    }
  }

  async function upgrade() {
    if (!offer?.canEnable || !session || busy.current || !confirmUpgrade) return;
    const selections = (offer.upgrades ?? []).filter((r) => selectedUpgrades.includes(r.agentId))
      .map(({agentId,expectedPublishedVersionId}) => ({agentId,expectedPublishedVersionId}));
    if (selections.length === 0) return;
    const selection = JSON.stringify({ packVersion: offer.packVersion, selections });
    if (upgradeAttempt.current?.selection !== selection) upgradeAttempt.current = { selection, key: `official-upgrade-${crypto.randomUUID()}` };
    const startingSession = session; const abort = new AbortController(); controller.current = abort;
    busy.current = true; setEnabling(true); setError(null);
    try {
      await upgradeOfficialRoleSelections(offer,selections,upgradeAttempt.current.key,{
        orgId: startingSession.currentOrgId, sessionToken: startingSession.sessionToken, signal: abort.signal,
        isCurrent: () => alive.current && currentSession.current?.currentOrgId === startingSession.currentOrgId && currentSession.current?.sessionToken === startingSession.sessionToken,
      });
      if (!alive.current) return;
      setCompletedAction("upgrade"); onEnabled(); setTick((v)=>v+1);
    } catch {
      if (alive.current) setError("升级未完成。角色可能已被修改，或当前版本已变化，请重新加载后核对。原有对话和版本保留。");
    } finally { busy.current=false; if (alive.current) setEnabling(false); }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="官方数字人">
      <p className="text-12 text-muted-foreground">启用官方数字人时，会同时准备所需的技能与工作流。启用后可在首页推荐中添加。</p>
      {layout === "cards" ? <p className="text-14 text-muted-foreground">启用按钮会为当前组织准备以下全部待启用角色及其依赖；成员仅可查看。启用不会增加数据访问或写入权限，也不代表工作流业务验收通过。</p> : null}
      {loading ? <p role="status">加载官方数字人…</p> : null}
      {error ? <div role="alert"><p>{error}</p>{!offer ? <Button type="button" onClick={() => setTick((value) => value + 1)}>重新加载</Button> : null}</div> : null}
      {completedAction ? <p role="status">{completedAction === "enable" ? "官方数字人已启用。" : "所选官方数字人已升级。"}</p> : null}
      {!loading && offer ? (
        <>
          {offer.pending.length === 0 ? <p>本组织已启用全部官方数字人。</p> : (
            layout === "cards" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="official-role-card-grid">
                {offer.pending.map((role) => {
                  const name = agentDisplayNameByAvatar(role.avatar?.key, role.name);
                  return <ResourceCard key={role.roleRef} title={name} ariaLabel={name} testId={`official-role-card-${role.roleRef}`}
                    className="shadow-none" headingLevel={2}
                    leading={<Avatar initials={name.slice(0, 1)} avatarKey={role.avatar?.key ?? null} tone="ai" className="h-16 w-16 text-20" />}
                    subtitle={role.roleCategory ? ROLE_CATEGORY_LABEL[role.roleCategory] : "官方数字人"}
                    badges={<Badge tone="neutral">待启用</Badge>}
                    description="启用后出现在本组织目录。具体执行能力仍需核对配置和验收结果。" />;
                })}
              </div>
            ) : (
            <ul className="flex flex-col gap-2">
              {offer.pending.map((role) => (
                <li key={role.roleRef} className="rounded-card border border-border bg-panel p-3">
                  {agentDisplayNameByAvatar(role.avatar?.key, role.name)} <span className="text-11 text-muted-foreground">待启用</span>
                </li>
              ))}
            </ul>
            )
          )}

          {(offer.upgrades ?? []).length > 0 ? <section aria-label="官方数字人升级" className="flex flex-col gap-2">
            <p>新版 {offer.packVersion} 增加角色工作背景、职责方法与技能绑定。请选择要升级的官方数字人；原有对话使用的版本会保留。</p>
            {(offer.upgrades ?? []).map((role) => <label key={role.agentId} className="rounded-card border border-border p-3">
              <input type="checkbox" checked={selectedUpgrades.includes(role.agentId)} disabled={!offer.canEnable || enabling}
                onChange={(event) => { setConfirmUpgrade(false); setSelectedUpgrades((items) => event.target.checked ? [...items,role.agentId] : items.filter((id)=>id!==role.agentId)); }} />
              {role.name}：{role.currentVersion === role.targetVersion ? `${role.targetVersion}（补齐已验证技能）` : `${role.currentVersion} → ${role.targetVersion}`}；可用技能 {role.readySkillCount}，待验证技能 {role.pendingSkillCount}
            </label>)}
            <p className="text-12 text-muted-foreground">待验证技能尚不能直接调用；升级不会增加数据访问或写入权限，也不会启用已停用角色。</p>
            {offer.canEnable ? <><label><input type="checkbox" checked={confirmUpgrade} disabled={enabling || selectedUpgrades.length===0} onChange={(e)=>setConfirmUpgrade(e.target.checked)} />确认仅升级所选角色的新对话背景与技能配置</label>
              <Button type="button" disabled={enabling || !confirmUpgrade || selectedUpgrades.length===0} onClick={()=>void upgrade()}>{enabling ? "正在升级…" : "升级所选官方数字人"}</Button>
              <Button type="button" disabled={enabling} onClick={()=>setTick((v)=>v+1)}>重新加载升级列表</Button></> : <p>请联系组织管理员升级。</p>}
          </section> : null}
          {offer.pending.length > 0 && offer.canEnable ? <Button type="button" disabled={enabling} onClick={() => void enable()}>{enabling ? progress?.label ?? "正在启用…" : "启用官方数字人"}</Button> : null}
          {!offer.canEnable && offer.pending.length > 0 ? <p>请联系组织管理员启用。</p> : null}
        </>
      ) : null}
    </section>
  );
}
