"use client";

import * as React from "react";
import { Download } from "lucide-react";
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
import { importSkillStarterPack } from "@/lib/live-skill-starter-import";

type ResultState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "success"; readonly count: number; readonly refreshError?: string }
  | { readonly status: "error"; readonly message: string };

export function SkillStarterImportPanel({ onImported }: { onImported(): Promise<boolean> }) {
  const [open, setOpen] = React.useState(false);
  const [packId, setPackId] = React.useState("");
  const [packVersion, setPackVersion] = React.useState("");
  const [idempotencyKey, setIdempotencyKey] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ResultState>({ status: "idle" });
  const active = React.useRef(true);
  const requestGeneration = React.useRef(0);

  React.useEffect(() => () => {
    active.current = false;
    requestGeneration.current += 1;
  }, []);

  const changeCoordinate = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string,
  ) => {
    setter(value);
    setIdempotencyKey(null);
    setResult({ status: "idle" });
  };

  const submit = async () => {
    const trimmedPackId = packId.trim();
    const trimmedVersion = packVersion.trim();
    if (!trimmedPackId || !trimmedVersion) return;
    const requestKey = idempotencyKey ?? window.crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    const request = ++requestGeneration.current;
    setResult({ status: "submitting" });
    let imported;
    try {
      imported = await importSkillStarterPack({
        packId: trimmedPackId,
        packVersion: trimmedVersion,
        idempotencyKey: requestKey,
      });
    } catch (error) {
      if (!active.current || request !== requestGeneration.current) return;
      const message = error instanceof ApiError
        ? error.reasonCode ?? `HTTP ${error.status}`
        : error instanceof Error ? error.message : "未知错误";
      setResult({ status: "error", message });
      return;
    }
    if (!active.current || request !== requestGeneration.current) return;
    setResult({ status: "success", count: imported.skillIds.length });
    try {
      const refreshed = await onImported();
      if (!refreshed) {
        throw new Error("目录读取失败");
      }
    } catch (error) {
      if (!active.current || request !== requestGeneration.current) return;
      const message = error instanceof ApiError
        ? error.reasonCode ?? `HTTP ${error.status}`
        : error instanceof Error ? error.message : "未知错误";
      setResult({ status: "success", count: imported.skillIds.length, refreshError: message });
    }
  };

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          data-testid="skill-starter-import"
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          导入 starter pack
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>显式导入 Skill starter pack</CardTitle>
        <CardDescription>
          请输入管理员已核验的 pack 坐标。系统不会推荐、预选或在空目录时自动导入任何内容。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-12">
            <span>Pack ID</span>
            <Input
              value={packId}
              onChange={(event) => changeCoordinate(setPackId, event.target.value)}
              disabled={result.status === "submitting"}
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1 text-12">
            <span>Pack version</span>
            <Input
              value={packVersion}
              onChange={(event) => changeCoordinate(setPackVersion, event.target.value)}
              disabled={result.status === "submitting"}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-12 text-muted-foreground">
          确认后，服务端会先校验 pack 与每个文件的 digest，再以一个事务写入；名称冲突不会覆盖已有 Skill。
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={result.status === "submitting"}
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={!packId.trim() || !packVersion.trim() || result.status === "submitting"}
            data-testid="skill-starter-import-confirm"
          >
            {result.status === "submitting" ? "正在校验并导入…" : "确认导入"}
          </Button>
        </div>
        {result.status === "success" ? (
          <p data-testid="skill-starter-import-result" className="text-12 text-success">
            导入完成：新增 {result.count} 个 Skill。
            {result.refreshError ? ` 目录刷新失败（${result.refreshError}），请手动刷新。` : ""}
          </p>
        ) : null}
        {result.status === "error" ? (
          <p data-testid="skill-starter-import-result" className="text-12 text-destructive">
            导入失败：{result.message}。可使用同一请求重试。
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
