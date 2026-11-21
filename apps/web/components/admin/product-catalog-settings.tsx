"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminCatalogOperations as catalog } from "@repo/contracts/billing-pricing";
import type { z } from "zod";
import { apiRequest, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Product = z.infer<typeof catalog.update.out>;
type Catalog = z.infer<typeof catalog.list.out>;

export function ProductCatalogSettings({ kind }: { kind: Product["kind"] }) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const [market, setMarket] = useState<Product["market"]>("cn");
  const [data, setData] = useState<Catalog>();
  const [editing, setEditing] = useState<Product>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setMessage("");
    const path = `${catalog.list.path}?market=${market}`;
    void apiRequest(path, { signal: controller.signal }).then((raw) => {
      const value = catalog.list.out.parse(raw);
      if (!controller.signal.aborted) setData(value);
    }).catch(() => {
      if (!controller.signal.aborted) setMessage(zh ? "无法读取市场配置。" : "Market configuration could not be loaded.");
    });
    return () => controller.abort();
  }, [market, refresh, zh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const form = new FormData(event.currentTarget);
    const number = (name: string) => Number(form.get(name));
    setBusy(true);
    setMessage("");
    try {
      const body = catalog.update.in.parse({
        market: editing.market, sku: editing.sku, expectedRevision: editing.revision,
        values: {
          amountMinor: Math.round(number("price") * 100),
          baseCredits: number("base"), bonusCredits: number("bonus"), enabled: form.has("enabled"),
          teamTerms: editing.values.teamTerms ? {
            includedSeats: number("seats"),
            additionalSeatAmountMinor: Math.round(number("seatPrice") * 100),
            additionalSeatMonthlyCredits: number("seatCredits"),
          } : null,
        },
      });
      const product = catalog.update.out.parse(await apiRequest(catalog.update.path, { method: "PATCH", body }));
      setData((previous) => previous && {
        ...previous, items: previous.items.map((item) => item.sku === product.sku ? product : item),
      });
      setEditing(undefined);
      setMessage(zh ? "已保存。新报价立即使用更新后的配置。" : "Saved. New quotes use the updated settings.");
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 409
        ? (zh ? "配置已被修改，请刷新后重试。" : "Settings have changed. Refresh and try again.")
        : (zh ? "保存失败，请检查输入或重试。" : "Save failed. Check the inputs or try again."));
    } finally {
      setBusy(false);
    }
  }

  const fields: ReadonlyArray<readonly [string, string, number, number, boolean?]> = editing ? [
    ["price", `${zh ? "价格" : "Price"} (${editing.currency})`, editing.values.amountMinor / 100, 0.01],
    ["base", zh ? "基础积分" : "Base credits", editing.values.baseCredits, 1, editing.values.teamTerms !== null],
    ["bonus", zh ? "赠送积分" : "Bonus credits", editing.values.bonusCredits, 1, editing.values.teamTerms !== null],
    ...(editing.values.teamTerms ? [
      ["seats", zh ? "包含席位" : "Included seats", editing.values.teamTerms.includedSeats, 1, true],
      ["seatPrice", `${zh ? "额外席位价格" : "Additional seat price"} (${editing.currency})`, editing.values.teamTerms.additionalSeatAmountMinor / 100, 0.01],
      ["seatCredits", zh ? "额外席位每月积分" : "Monthly credits per additional seat", editing.values.teamTerms.additionalSeatMonthlyCredits, 1, true],
    ] as const : []),
  ] as const : [];

  return (
    <section className="space-y-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {(["cn", "us"] as const).map((option) => (
          <Button key={option} type="button" disabled={busy} aria-pressed={option === market}
            variant={option === market ? "secondary" : "ghost"}
            onClick={() => { setEditing(undefined); setMarket(option); }}>
            {option === "cn" ? (zh ? "中国市场" : "China") : (zh ? "美国市场" : "United States")}
          </Button>
        ))}
      </div>
      {!data && !message && <p role="status">{zh ? "正在读取配置…" : "Loading settings…"}</p>}
      {data && !data.writable && <p>{zh ? "当前部署尚未配置商品写入连接。" : "The catalog writer is unavailable in this deployment."}</p>}
      {data && (
        <ul className="divide-y divide-border">
          {data.items.filter((item) => item.kind === kind).map((item) => (
            <li key={item.sku} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span>
                <span className="block font-medium">{item.sku}</span>
                <span className="text-muted-foreground">
                  {new Intl.NumberFormat(locale, { style: "currency", currency: item.currency }).format(item.values.amountMinor / 100)}
                  {" · "}{item.values.baseCredits + item.values.bonusCredits} {zh ? "积分" : "credits"}
                  {" · "}{item.values.enabled ? (zh ? "已上架" : "Enabled") : (zh ? "已下架" : "Disabled")}
                </span>
              </span>
              <Button size="sm" variant="outline" disabled={!data.writable || busy} onClick={() => setEditing(item)}>
                {zh ? "编辑" : "Edit"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-auto border-l border-border bg-card p-6 shadow-lg">
          <form key={editing.sku} onSubmit={save} className="space-y-4">
            <h2 className="text-lg font-semibold">{zh ? "编辑商品" : "Edit product"} · {editing.sku}</h2>
            {fields.map(([name, label, value, step, fixed]) => (
              <label key={name} className="grid gap-1 text-sm">
                {label}
                <Input name={name} type="number" step={step} min={name === "bonus" ? 0 : step}
                  defaultValue={value} required readOnly={fixed} disabled={busy} />
              </label>
            ))}
            {editing.values.teamTerms && (
              <p className="text-sm text-muted-foreground">
                {zh ? "团队席位和积分额度由当前套餐规则固定。" : "Team seats and credits are fixed by the current plan policy."}
              </p>
            )}
            <label className="flex gap-2 text-sm">
              <input name="enabled" type="checkbox" defaultChecked={editing.values.enabled} disabled={busy} />
              {zh ? "上架" : "Enabled"}
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(undefined)}>{zh ? "取消" : "Cancel"}</Button>
              <Button type="submit" disabled={busy}>{zh ? "保存并生效" : "Save and apply"}</Button>
            </div>
            {message && <p role="status">{message}</p>}
          </form>
        </aside>
      )}
      {!editing && message && <p role="status">{message}</p>}
      {message && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(undefined); setRefresh((value) => value + 1); }}>
          {zh ? "刷新配置" : "Refresh settings"}
        </Button>
      )}
    </section>
  );
}
