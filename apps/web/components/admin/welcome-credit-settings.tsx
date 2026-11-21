"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminWelcomeCreditOperations as operations } from "@repo/contracts/billing-pricing";
import type { z } from "zod";
import { apiRequest, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WelcomeCreditSettings({ market }: { market: "cn" | "us" }) {
  const zh = useI18n().locale === "zh-CN";
  const [data, setData] = useState<z.infer<typeof operations.list.out>>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, reload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest(`${operations.list.path}?market=${market}`, { signal: controller.signal })
      .then(raw => {
        const value = operations.list.out.parse(raw);
        if (!controller.signal.aborted) setData(value);
      }).catch(() => {
        if (!controller.signal.aborted) setMessage(zh ? "欢迎积分规则加载失败。" : "Welcome credit settings could not be loaded.");
      });
    return () => controller.abort();
  }, [market, revision, zh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.writable || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const body = operations.update.in.parse({
        market, expectedRevision: data.policy.revision,
        credits: Number(form.get("credits")), validityDays: Number(form.get("days")),
      });
      const policy = operations.update.out.parse(await apiRequest(operations.update.path, { method: "PATCH", body }));
      setData({ policy, writable: data.writable });
      setMessage(zh ? "已保存。新账户使用新规则。" : "Saved. New accounts use the updated policy.");
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 409
        ? (zh ? "规则已被修改，请刷新后重试。" : "The policy changed. Refresh and try again.")
        : (zh ? "保存失败，请检查输入后重试。" : "Save failed. Check the inputs and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 border-b border-border pb-4">
      <h3 className="text-sm font-semibold">{zh ? "欢迎积分" : "Welcome credits"}</h3>
      {data ? (
        <form key={data.policy.revision} onSubmit={save} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1 text-sm">
            {zh ? "发放积分" : "Credits granted"}
            <Input name="credits" type="number" step={1} min={1} max={2147483647}
              required defaultValue={data.policy.credits} disabled={!data.writable || busy} />
          </label>
          <label className="grid gap-1 text-sm">
            {zh ? "有效期（天）" : "Validity (days)"}
            <Input name="days" type="number" step={1} min={1} max={3650}
              required defaultValue={data.policy.validityDays} disabled={!data.writable || busy} />
          </label>
          <Button type="submit" variant="outline" disabled={!data.writable || busy}>{zh ? "保存规则" : "Save policy"}</Button>
        </form>
      ) : !message && <p role="status">{zh ? "正在读取规则…" : "Loading policy…"}</p>}
      {message && (
        <div className="flex items-center gap-3">
          <p role="status" className="text-sm">{message}</p>
          <Button type="button" size="sm" variant="ghost" disabled={busy}
            onClick={() => { setData(undefined); setMessage(""); reload(value => value + 1); }}>
            {zh ? "刷新规则" : "Refresh policy"}
          </Button>
        </div>
      )}
    </section>
  );
}
