"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  getPlatformExtractionSetting, setPlatformExtractionSetting,
  type PlatformExtractionErrorCode, type PlatformExtractionSettingOut,
} from "@/lib/live-platform-extraction-setting";

/**
 * issue #4247 —— 平台后台「运营状态」屏里的「记忆抽取（整个部署）」面板。
 *
 * PR #4200 把部署级抽取开关从启动参数搬进了库（`kg_extraction_state`），但一直没有 UI：
 * 平台管理员只能直接敲 `PUT /platform/knowledge-graph/extraction-setting`。这块面板是它的入口。
 *
 * ## 两个字段（同契约 `KgDeploymentExtractionSetting` 注释）
 *
 * - `providerConfigured`：部署有没有配置抽取用的模型——启动参数，这里**只读**；为假时如实说明
 *   「开关打开也不会抽取」，不让人以为点了就生效。
 * - `enabled`：部署开关现值——平台管理员可来回切换。乐观更新，失败回滚并把原因摆出来。
 *
 * ## 权限形状
 *
 * 读写都要求平台运营准入（`PlatformOperatorGuard`）。403 `NOT_PLATFORM_SUPERUSER` 不是失败态，
 * 是「你不是这个身份」——渲染成一句说明、**不画开关**（同 `platform-members-screen.tsx` 的处置）。
 * 写的时候才收到 403（准入刚被撤销）也一样：回滚后整块切到无权限态，不留一个点了没用的开关。
 */

/** 契约错误码 → 人话（闭集，契约新增码漏配编译不过）。 */
const ERROR_TEXT: Record<PlatformExtractionErrorCode, string> = {
  NOT_PLATFORM_SUPERUSER: "这项设置仅平台运维（平台超管白名单，或被超管指定的平台管理员）可用——你当前的账号不是。",
};

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.reasonCode === "NOT_PLATFORM_SUPERUSER" || err.status === 403);
}

function failureText(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && code in ERROR_TEXT) return ERROR_TEXT[code as PlatformExtractionErrorCode];
    return httpFailureText(err.status);
  }
  if (err instanceof TypeError) return "连不上服务器，检查一下网络再试";
  return "出了点问题，稍后再试一次";
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; out: PlatformExtractionSettingOut }
  | { kind: "forbidden" }
  | { kind: "failed"; message: string };

export function PlatformExtractionSettingPanel() {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      setLoad({ kind: "ready", out: await getPlatformExtractionSetting() });
    } catch (err) {
      setLoad(isForbidden(err) ? { kind: "forbidden" } : { kind: "failed", message: failureText(err) });
    }
  }, []);

  React.useEffect(() => { void reload(); }, [reload]);

  const toggle = async (next: boolean) => {
    if (saving || load.kind !== "ready") return;
    const previous = load.out;
    setSaving(true);
    setSaveError(null);
    // 乐观更新：先把开关拨过去；失败回滚到点之前的值。
    setLoad({ kind: "ready", out: { ...previous, enabled: next } });
    try {
      setLoad({ kind: "ready", out: await setPlatformExtractionSetting(next) });
    } catch (err) {
      if (isForbidden(err)) {
        setLoad({ kind: "forbidden" });
      } else {
        setLoad({ kind: "ready", out: previous });
        setSaveError(`没保存成功，仍是${previous.enabled ? "开启" : "关闭"}：${failureText(err)}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-testid="admin-platform-extraction">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">记忆抽取（整个部署）</h3>
        <p className="text-11 text-muted-foreground">
          决定这个部署要不要把对话内容整理成可在会话内召回的记忆。这是部署级总闸：关掉后所有组织都不再抽取新的对话内容，
          已经记下的仍可查看；打开后，各组织管理员仍可在组织后台单独关闭本组织的抽取。
        </p>
      </div>
      {load.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground" data-testid="admin-platform-extraction-loading">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />加载中……
        </p>
      )}
      {load.kind === "forbidden" && (
        <p className="text-12 text-muted-foreground" data-testid="admin-platform-extraction-forbidden">
          {ERROR_TEXT.NOT_PLATFORM_SUPERUSER}
        </p>
      )}
      {load.kind === "failed" && (
        <div className="flex flex-wrap items-center gap-2" data-testid="admin-platform-extraction-failed">
          <p className="text-12 text-destructive">读取记忆抽取设置失败：{load.message}</p>
          <Button size="sm" variant="secondary" onClick={() => void reload()} data-testid="admin-platform-extraction-retry">
            重试
          </Button>
        </div>
      )}
      {load.kind === "ready" && (
        <>
          <div
            className={`flex flex-col gap-0.5 rounded-md border p-3 ${load.out.providerConfigured ? "border-border bg-card" : "border-warning bg-warning-tint"}`}
            data-testid={`admin-platform-extraction-provider-${load.out.providerConfigured ? "configured" : "missing"}`}
          >
            <p className="text-12 font-medium text-card-foreground">
              抽取模型：{load.out.providerConfigured ? "已配置" : "未配置"}
            </p>
            <p className="text-11 text-muted-foreground">
              {load.out.providerConfigured
                ? "这个部署配置了抽取用的模型（启动参数，这里只读）。"
                : "这个部署没有配置抽取用的模型（启动参数，这里改不了）——即使打开下面的开关，也不会抽取任何对话。"}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Toggle
              checked={load.out.enabled}
              label="为整个部署开启记忆抽取"
              disabled={saving}
              onCheckedChange={(v) => void toggle(v)}
              data-testid="admin-platform-extraction-toggle"
              className="mt-0.5"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-12 font-medium text-card-foreground">
                为整个部署开启记忆抽取
                <span className="ml-1.5 text-11 font-normal text-muted-foreground" data-testid="admin-platform-extraction-state">
                  {load.out.enabled ? "已开启" : "已关闭"}
                </span>
                {saving && <Loader2 aria-hidden className="ml-1.5 inline h-3 w-3 animate-spin" />}
              </p>
              <p className="text-11 text-muted-foreground">
                {load.out.enabled && load.out.providerConfigured
                  ? "生效中：各组织按自己的开关抽取新的对话内容。"
                  : "未生效：这个部署现在不抽取任何对话。"}
              </p>
              {saveError !== null && (
                <p role="alert" className="text-11 text-destructive" data-testid="admin-platform-extraction-save-failed">
                  {saveError}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
