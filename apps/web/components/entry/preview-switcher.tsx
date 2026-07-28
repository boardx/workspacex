import { Button } from "@/components/ui/button";

/**
 * 进场页的**次级预览切换器**（业务视角 / 场景），与七态的 `StatePreviewSwitcher` 并列。
 *
 * ⚠ 与身份投影同理：这是 sign-off 的预览手段，**不是权限实现**。真实权限在服务端。
 *    生产构建不渲染（与 `StatePreviewSwitcher` 一致，避免把切换器带上线）。
 *    用锚点而非按钮：切换即整页导航，SSR 出来的 HTML 里 testid 可被 verification 锚定。
 */
export function EntryPreviewSwitcher({
  label,
  param,
  options,
  current,
  testid,
}: {
  label: string;
  param: string;
  options: { id: string; label: string }[];
  current: string;
  testid: string;
}) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div
      data-testid={testid}
      className="flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-panel p-1"
    >
      <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">{label}</span>
      {options.map((o) => (
        <Button
          key={o.id}
          asChild
          size="xs"
          variant={o.id === current ? "primary" : "ghost"}
          data-testid={`${testid}-${o.id}`}
        >
          <a href={`?${param}=${o.id}`}>{o.label}</a>
        </Button>
      ))}
    </div>
  );
}
