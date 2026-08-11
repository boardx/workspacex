import { AppShell } from "@/components/shell/app-shell";
import { NewProjectFlow } from "@/components/project/new-project-flow";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * 新建项目向导（`/project/new`）—— PJ-01 从 mock 切到真实 `POST /projects`。
 *
 * 与 `/projects` 列表页同一形状（issue #353 定的）：服务端组件只解析 `?as=` 供
 * `AppShell` 画壳层装饰，真实登录态与 current-org 全部下沉到客户端 `NewProjectFlow`
 * （它读根级 SessionProvider 的 `currentOrgId`）。`?org=` 不再当作输入 ——
 * 组织身份由已签核的 current-org 决定，不能靠改 URL 参数换组织建项目。
 *
 * ⚠ 新建项目 = 建一场**工作坊**（四种项目角色）；研究项目 / 用户洞察是另两类容器，不在此建。
 */
export default function NewProjectPage({
  searchParams,
}: {
  searchParams: { as?: string };
}) {
  const previewRole = resolvePreviewRole(searchParams.as);
  return (
    <AppShell previewRole={previewRole}>
      <NewProjectFlow />
    </AppShell>
  );
}
