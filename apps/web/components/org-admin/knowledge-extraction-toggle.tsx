"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
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
 * - `deploymentCapable`：整个部署此刻能不能抽取（配置了抽取用的模型 AND 平台管理员没有关掉
 *   部署级总闸，见契约注释）——部署级事实，这个开关改不了它。为假时（issue #4247）这里如实
 *   说明「部署没有开启」、把开关禁用，并把状态写成「未生效」，而不是摆一个看起来开着、
 *   点了也不起作用的开关。
 * - `orgEnabled`：本组织有没有打开——组织级、admin 可写（默认值见契约 `KgExtractionSetting` 注释）。
 *
 * ## 权限形状
 *
 * 读（`getKnowledgeExtractionSetting`）任何组织成员可调——这是「这个组织现在抽不抽」这件事
 * 本身，不是要隐藏的内容。写（`setKnowledgeExtractionSetting`）仅组织 admin，非 admin 调用
 * 收到真实的 403（`KG_NOT_ORG_ADMIN`），这里据此把开关禁用并说明原因，不是隐藏整个区块——
 * 至少让非 admin 看得到「现在开着还是关着」。
 */
export function KnowledgeExtractionToggleSection({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { t } = useI18n();
  const [state, setState] = React.useState<UiState>("loading");
  const [setting, setSetting] = React.useState<KnowledgeExtractionSettingOut | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<"denied" | "failed" | null>(null);

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
        ? "denied" : "failed");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3" data-testid="knowledge-extraction-toggle">
      <div className="flex items-center gap-2">
        <BrainCircuit aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-14 font-semibold">{t("orgProfile.extractionTitle")}</h2>
      </div>
      <p className="text-12 text-muted-foreground">
        {t("orgProfile.extractionHelp")}
      </p>
      <StateShell
        state={state}
        denial={{ layer: "organization", reason: t("orgProfile.extractionDenied") }}
        depFailure={{ what: t("orgProfile.extractionSetting"), retry: () => void load() }}
      >
        {setting ? (
          <div
            className={`flex items-center justify-between gap-3 rounded-control border p-3 ${setting.deploymentCapable ? "border-border" : "border-warning bg-warning-tint"}`}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-13 font-medium">{t("orgProfile.extractionLabel")}</span>
              {!setting.deploymentCapable ? (
                <span className="text-11 text-warning-tint-foreground" data-testid="knowledge-extraction-not-capable">
                  {t("orgProfile.extractionInactive")}
                </span>
              ) : !isAdmin ? (
                <span className="text-11 text-muted-foreground">
                  {t("orgProfile.extractionReadOnly")}
                </span>
              ) : null}
            </div>
            <Toggle
              id="knowledge-extraction-toggle-switch"
              label={t("orgProfile.extractionLabel")}
              checked={setting.orgEnabled}
              disabled={!setting.deploymentCapable || !isAdmin || busy}
              onCheckedChange={(v) => void toggle(v)}
            />
          </div>
        ) : null}
        {busy ? <p role="status" className="text-12 text-muted-foreground">{t("common.saving")}</p> : null}
        {error ? <p role="alert" className="text-12 text-destructive">{t(error === "denied" ? "orgProfile.extractionReadOnly" : "orgProfile.extractionSaveFailed")}</p> : null}
      </StateShell>
    </section>
  );
}
