"use client";

import * as React from "react";
import { BrainCircuit } from "lucide-react";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { Toggle } from "@/components/ui/toggle";
import { ApiError } from "@/lib/api-client";
import {
  getKnowledgeExtractionSetting, setKnowledgeExtractionSetting, type KnowledgeExtractionSettingOut,
} from "@/lib/live-org-admin";

/**
 * 「记忆抽取」区块（issue #4178）——挂在 `/org-admin/profile`（组织资料）下方，
 * `StandingToolGrantsSection` 之后。
 *
 * ## 它改的是什么
 *
 * 此前「要不要把对话内容抽取成可召回的记忆」是部署方在启动参数里定死的一次性开关
 * （`KG_EXTRACTION_ENABLED=1`），全库单例、只能从关到开、改不了也回不去——组织自己
 * 完全没有发言权。这里是组织 admin 能来回切换的真实入口。
 *
 * ## 两个布尔分别说什么（同 `getKnowledgeExtractionSetting` 契约注释）
 *
 * - `deploymentCapable`：这次部署有没有配置抽取用的模型——部署级事实，这个开关改不了它，
 *   没有能力时这里如实说明并把开关禁用，而不是让人以为点了就会生效。
 * - `orgEnabled`：本组织有没有打开——组织级、admin 可写、默认关。
 *
 * ## 权限形状
 *
 * 读（`getKnowledgeExtractionSetting`）任何组织成员可调——这是「这个组织现在抽不抽」这件事
 * 本身，不是要隐藏的内容。写（`setKnowledgeExtractionSetting`）仅组织 admin，非 admin 调用
 * 收到真实的 403（`KG_NOT_ORG_ADMIN`），这里据此把开关禁用并说明原因，不是隐藏整个区块——
 * 至少让非 admin 看得到「现在开着还是关着」。
 */
export function KnowledgeExtractionToggleSection({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [state, setState] = React.useState<UiState>("loading");
  const [setting, setSetting] = React.useState<KnowledgeExtractionSettingOut | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState("loading");
    try {
      setSetting(await getKnowledgeExtractionSetting());
      setState("default");
    } catch (cause) {
      setState(cause instanceof ApiError && cause.status === 403 ? "denied" : "dep-failed");
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSetting(await setKnowledgeExtractionSetting(next));
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403
        ? "只有组织管理员可以修改这项设置。"
        : "保存失败，请重试。");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3" data-testid="knowledge-extraction-toggle">
      <div className="flex items-center gap-2">
        <BrainCircuit aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-14 font-semibold">对话记忆</h2>
      </div>
      <p className="text-12 text-muted-foreground">
        打开后，本组织的对话内容会被整理成可在会话内召回的记忆；关闭后不再抽取新的对话内容，
        已经记下的仍可查看。默认关闭，新对话不会被默认抽取。
      </p>
      <StateShell
        state={state}
        denial={{ layer: "organization", reason: "只有组织管理员可以查看和修改记忆抽取设置。" }}
        depFailure={{ what: "记忆抽取设置", retry: () => void load() }}
      >
        {setting ? (
          <div className="flex items-center justify-between gap-3 rounded-control border border-border p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-13 font-medium">为本组织开启记忆抽取</span>
              {!setting.deploymentCapable ? (
                <span className="text-11 text-muted-foreground" data-testid="knowledge-extraction-not-capable">
                  这次部署还没有配置抽取用的模型，暂时无法开启。
                </span>
              ) : !isAdmin ? (
                <span className="text-11 text-muted-foreground">
                  只有组织管理员可以修改这项设置。
                </span>
              ) : null}
            </div>
            <Toggle
              id="knowledge-extraction-toggle-switch"
              label="为本组织开启记忆抽取"
              checked={setting.orgEnabled}
              disabled={!setting.deploymentCapable || !isAdmin || busy}
              onCheckedChange={(v) => void toggle(v)}
            />
          </div>
        ) : null}
        {error ? <p role="alert" className="text-12 text-destructive">{error}</p> : null}
      </StateShell>
    </section>
  );
}
