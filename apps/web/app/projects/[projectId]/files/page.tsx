import { FilesApp } from "@/components/files/files-app";
import { resolvePreviewRole } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveFilesScreen } from "@/lib/mock/files";

/**
 * 项目文件浏览器（22-files · UC-22.1 ~ 22.4）—— file-first 证据平面的用户界面。
 *
 * ⚠ 服务端组件：只解析 URL,把可序列化的 props 交给客户端 FilesApp。
 *    事件处理器一律下沉到 FilesApp 及其子组件（"use client"）。
 *    真实权限在服务端 NestJS Guard + PostgreSQL RLS；这里的视角/状态切换只是预览。
 *
 * ⚠ **issue #1316（安全修复）**：这里以前也用 `?org=` 查一个写死的 mock 组织表来兜底身份——
 *   与 `/projects/[projectId]` 同一根因，任何真实组织都会静默替换成写死的
 *   mock org。现在不再在这里组装身份：省略 `identity` 时 `FilesApp` → `AppShell` 落到
 *   `SessionProvider` 解析的真实会话身份，未登录会被重定向去 `/login`。
 */
export default function ProjectFilesPage({
  params,
  searchParams,
}: {
  params: { projectId: string };
  searchParams: { state?: string; as?: string; org?: string; screen?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const screen = resolveFilesScreen(searchParams.screen);

  return (
    <FilesApp
      previewRole={previewRole}
      uiState={uiState}
      screen={screen}
      qs={{ as: searchParams.as, org: searchParams.org }}
      projectId={params.projectId}
    />
  );
}
