import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { resolvePreviewRole } from "@/lib/identity";
import { NAV_SEGMENTS, FILES_NAV } from "@/lib/navigation";

export default function HomePage({
  searchParams,
}: { searchParams: { as?: string } }) {
  const previewRole = resolvePreviewRole(searchParams.as);
  const entries = [...NAV_SEGMENTS.flatMap((s) => s.items), FILES_NAV];

  return (
    <AppShell previewRole={previewRole}>
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-24 font-semibold tracking-tight">前端内核已就绪</h1>
          <p className="text-13 text-muted-foreground">
            这是 UC-0.4 交付的骨架：三栏布局、五段语义导航、组织切换器与两层角色条、
            七态共享外壳、以及两个机械门控（对比度 + 设计 lint）。业务屏在此之上填充。
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>组件与状态样板</CardTitle>
            <CardDescription>
              七种必现状态与全部 UI 原语的活文档，是 ui-prototyper 画新屏时的组件目录。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/kitchen-sink"
              data-testid="home-kitchen-sink-link"
              className="text-13 font-medium text-primary underline-offset-4 transition-all duration-200 hover:underline"
            >
              打开样板页 →
            </Link>
          </CardContent>
        </Card>

        <section className="flex flex-col gap-2">
          <h2 className="text-14 font-semibold">导航入口与其对应的 UC</h2>
          <p className="text-12 text-muted-foreground">
            结构取自原型图标栏实测（分组、顺序、间距规律）。每个入口标注它承载哪些用例，供 sign-off 回溯。
          </p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {entries.map((item) => (
              <li
                key={item.key}
                data-testid={`home-entry-${item.key}`}
                className="flex items-center gap-3 rounded-md border border-border-subtle bg-panel px-3 py-2 transition-all duration-200 hover:bg-muted"
              >
                <item.icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="w-16 shrink-0 text-13 font-medium">{item.label}</span>
                <span className="flex flex-wrap gap-1">
                  {item.ucRefs.map((r) => (
                    <Badge key={r} tone="outline" className="font-mono">{r}</Badge>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
