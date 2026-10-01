"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  agentDisplayNameByAvatar,
  enableOfficialRolePack,
  getOfficialRolePackOffer,
  type EnableProgress,
  type OfficialRolePackOffer,
} from "@/lib/agent-directory";

/** Mounted inside an organization-keyed modal; only an explicit click imports the pack. */
export function OfficialDigitalHumanPanel({ onEnabled }: { onEnabled: () => void }) {
  const [offer, setOffer] = React.useState<OfficialRolePackOffer | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [enabling, setEnabling] = React.useState(false);
  const [progress, setProgress] = React.useState<EnableProgress | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const alive = React.useRef(true);
  const busy = React.useRef(false);
  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOfficialRolePackOffer().then(
      (value) => { if (!cancelled) setOffer(value); },
      () => { if (!cancelled) setError("官方数字人加载失败，请重试。"); },
    ).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  async function enable() {
    if (!offer?.canEnable || offer.pending.length === 0 || busy.current) return;
    busy.current = true;
    setEnabling(true);
    setError(null);
    try {
      await enableOfficialRolePack(offer, (value) => { if (alive.current) setProgress(value); });
      if (!alive.current) return;
      setEnabled(true);
      onEnabled();
      setTick((value) => value + 1);
    } catch {
      if (alive.current) setError("启用尚未完成，已完成的部分会保留。请重试继续启用。");
    } finally {
      busy.current = false;
      if (alive.current) { setEnabling(false); setProgress(null); }
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="官方数字人">
      <p className="text-12 text-muted-foreground">启用官方数字人时，会同时准备所需的技能与工作流。启用后可在首页推荐中添加。</p>
      {loading ? <p role="status">加载官方数字人…</p> : null}
      {error ? <div role="alert"><p>{error}</p>{!offer ? <Button type="button" onClick={() => setTick((value) => value + 1)}>重新加载</Button> : null}</div> : null}
      {enabled ? <p role="status">官方数字人已启用，目录已刷新。</p> : null}
      {!loading && offer ? (
        <>
          {offer.pending.length === 0 ? <p>本组织已启用全部官方数字人。</p> : (
            <ul className="flex flex-col gap-2">
              {offer.pending.map((role) => (
                <li key={role.roleRef} className="rounded-card border border-border bg-panel p-3">
                  {agentDisplayNameByAvatar(role.avatar?.key, role.name)} <span className="text-11 text-muted-foreground">待启用</span>
                </li>
              ))}
            </ul>
          )}
          {offer.pending.length > 0 && offer.canEnable ? <Button type="button" disabled={enabling} onClick={() => void enable()}>{enabling ? progress?.label ?? "正在启用…" : "启用官方数字人"}</Button> : null}
          {!offer.canEnable && offer.pending.length > 0 ? <p>请联系组织管理员启用。</p> : null}
        </>
      ) : null}
    </section>
  );
}
