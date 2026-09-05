"use client";
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";

/**
 * Studio 独立入口的设计详情页——同底层 `DesignDetailScreen`（真栈，见
 * `/platform-admin/design-workbench/[projectId]/page.tsx` 头注），全屏深色页，
 * 不套 `AppShell`。返回/下一个都留在本路由 `/studio/design-workbench` 下，
 * 不跳回平台后台；跳转收件箱仍是唯一那个后台屏 `/platform-admin/inbox`——
 * 收件箱没有 Studio 独立入口，不重复建一个。
 */
export default function StudioDesignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  return (
    <DesignDetailScreen
      projectId={projectId ?? ""}
      onBack={() => router.push("/studio/design-workbench")}
      onOpenInbox={() => router.push("/platform-admin/inbox")}
      onNextDesign={() => router.push("/studio/design-workbench")}
    />
  );
}
