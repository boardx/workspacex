"use client";

import * as React from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { importSkillFromUrl } from "@/lib/live-skill-admin";

/**
 * #881 F2 —— 从 URL 导入 skill 的界面入口。
 *
 * 后端 `POST /admin/skills/url-imports`（#595）**早就接好了**，但 `apps/web` 里一直
 * 零调用 ⇒ 用户在后台只能看到「导入 starter pack」，导不了任意 URL。
 * 与 `SkillStarterImportPanel` 并列，形状刻意保持一致（同一个心智：填参数 → 确认 → 如实报结果）。
 *
 * ## `idempotencyKey` 为什么由前端持有、且只在入参变化时重置
 *
 * 与 starter pack 面板逐字同一条纪律：同一个 key 重放 ⇒ 服务端回 `replayed: true`
 * 且**不重复落库**。若每次点击都换一个新 key，"点两次导入两份"就回来了。
 * ⛔ 因此不要把它挪进 `lib/live-skill-admin.ts` 里随机生成——那等于把幂等性关掉。
 *
 * ## 不在这里复述权限规则
 *
 * 非管理员由服务端拒（`import-skill-from-url.ts` 的 admin 判定是**第一动作**，
 * 且在 fetch 之前——否则非管理员能让服务端替他发出站请求，成了 SSRF 探测器）。
 * 这一层只把失败原样显示出来。
 */
type ResultState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | {
      readonly status: "success";
      readonly skillId: string;
      readonly fileCount: number;
      readonly replayed: boolean;
      readonly refreshError?: string;
    }
  | { readonly status: "error"; readonly message: string };

export function SkillUrlImportPanel({ onImported }: { onImported(): Promise<boolean> }) {
  const [open, setOpen] = React.useState(false);
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [idempotencyKey, setIdempotencyKey] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ResultState>({ status: "idle" });
  const active = React.useRef(true);
  const requestGeneration = React.useRef(0);

  React.useEffect(() => () => {
    active.current = false;
    requestGeneration.current += 1;
  }, []);

  /** 改了入参就换一次导入——旧 key 属于旧参数，复用它会把新参数的导入当成重放。 */
  const changeField = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string,
  ) => {
    setter(value);
    setIdempotencyKey(null);
    setResult({ status: "idle" });
  };

  const submit = async () => {
    const trimmedUrl = sourceUrl.trim();
    const trimmedName = name.trim();
    if (!trimmedUrl || !trimmedName) return;
    const requestKey = idempotencyKey ?? window.crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    const request = ++requestGeneration.current;
    setResult({ status: "submitting" });
    let imported;
    try {
      imported = await importSkillFromUrl({
        sourceUrl: trimmedUrl,
        name: trimmedName,
        idempotencyKey: requestKey,
      });
    } catch (failure) {
      if (!active.current || request !== requestGeneration.current) return;
      /**
       * ⚠ 如实显示服务端的 reasonCode，**不翻译成"导入失败，请重试"**。
       * `IMPORT_URL_NOT_ALLOWED`（SSRF 门）与 `IMPORT_NAME_CONFLICT`（重名）
       * 要用户做的事完全不同，糊成一句话等于把两种失败都变成不可行动的。
       */
      setResult({
        status: "error",
        message: failure instanceof ApiError
          ? `${failure.reasonCode ?? failure.message}`
          : failure instanceof Error ? failure.message : String(failure),
      });
      return;
    }
    if (!active.current || request !== requestGeneration.current) return;

    // 导入成功后刷新目录列表；刷新失败**不**冒充导入失败，两件事分开报。
    let refreshError: string | undefined;
    try {
      const refreshed = await onImported();
      if (!refreshed) refreshError = "目录列表未能自动刷新，请手动点「刷新」。";
    } catch {
      refreshError = "目录列表未能自动刷新，请手动点「刷新」。";
    }
    if (!active.current || request !== requestGeneration.current) return;
    setResult({
      status: "success",
      skillId: imported.skillId,
      fileCount: imported.filePaths.length,
      replayed: imported.replayed,
      ...(refreshError === undefined ? {} : { refreshError }),
    });
  };

  const submitting = result.status === "submitting";
  const canSubmit = sourceUrl.trim() !== "" && name.trim() !== "" && !submitting;

  return (
    <Card data-testid="skill-url-import-panel">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-13">从 URL 导入 Skill</CardTitle>
            <CardDescription className="text-11">
              服务端会抓取该地址并落成一个新 skill 版本；出站地址受 SSRF 门限制，失败会如实告诉你原因。
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid="skill-url-import-open"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Link2 aria-hidden className="h-3.5 w-3.5" />
            从 URL 导入
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent className="flex flex-col gap-2 pt-0">
          <label className="text-10 text-muted-foreground" htmlFor="skill-url-import-url">
            来源 URL（https）
          </label>
          <Input
            id="skill-url-import-url"
            data-testid="skill-url-import-url"
            value={sourceUrl}
            placeholder="https://example.com/some-skill"
            onChange={(e) => changeField(setSourceUrl, e.target.value)}
          />
          <label className="text-10 text-muted-foreground" htmlFor="skill-url-import-name">
            导入后的显示名
          </label>
          <Input
            id="skill-url-import-name"
            data-testid="skill-url-import-name"
            value={name}
            onChange={(e) => changeField(setName, e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              data-testid="skill-url-import-confirm"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {submitting ? "导入中…" : "确认导入"}
            </Button>
          </div>
          {result.status === "success" ? (
            <p data-testid="skill-url-import-result" className="text-12 text-success">
              {/* `replayed` 是服务端说的，不是这里猜的——重放与新导入必须让用户看得出区别。 */}
              {result.replayed
                ? `这次是重放：该 idempotencyKey 之前已导入过，未重复落库（${result.skillId}）`
                : `已导入 ${result.fileCount} 个文件（${result.skillId}）`}
              {result.refreshError ? `　${result.refreshError}` : ""}
            </p>
          ) : null}
          {result.status === "error" ? (
            <p data-testid="skill-url-import-result" className="text-12 text-destructive">
              导入失败：{result.message}
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
