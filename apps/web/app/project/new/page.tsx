import { AppShell } from "@/components/shell/app-shell";
import { NewProjectFlow } from "@/components/project/new-project-flow";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * 新建项目（`/project/new`）—— PJ-01 从 mock 切到真实 `POST /projects`。
 *
 * 与 `/projects` 列表页同一形状（issue #353 定的）：服务端组件只解析 `?as=` 供
 * `AppShell` 画壳层装饰，真实登录态与 current-org 全部下沉到客户端 `NewProjectFlow`
 * （它读根级 SessionProvider 的 `currentOrgId`）。`?org=` 不再当作输入 ——
 * 组织身份由已签核的 current-org 决定，不能靠改 URL 参数换组织建项目。
 *
 * #4615：默认建**通用项目**（一步：只填名称）；`?mode=workshop` 走工作坊模板向导。
 */
export default function NewProjectPage({
  searchParams,
}: {
  searchParams: { as?: string; mode?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  return (
    <AppShell previewRole={previewRole}>
      {/* ⚠ 在服务端就地解析 `?mode=`：`new-project-flow.tsx` 是 "use client" 模块，从服务端组件调它导出的
          普通函数拿到的是客户端引用而不是函数，调用会让整页渲染失败（#4627 真栈 e2e 实测）。 */}
      <NewProjectFlow mode={searchParams.mode === "workshop" ? "workshop" : "general"} />
    </AppShell>
  );
}
