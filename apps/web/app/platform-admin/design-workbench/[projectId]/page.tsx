"use client";
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";

/**
 * UC-17.8 R4.4 —— PM 设计详情**全屏深色页**，脱离后台三栏骨架（不套 AppShell）。
 *
 * UC-17.8 B4.5 —— 不挂任何原型 Provider：`DesignDetailScreen` 真栈化后自己直接
 * 打 `designWorkbench` 契约的 API（`lib/live-design-workbench.ts`）；原型 mock store 已于 B6.1 删除。
 */
export default function DesignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  return (
    <DesignDetailScreen
      projectId={projectId ?? ""}
      onBack={() => router.push("/platform-admin/design-workbench")}
      onOpenInbox={() => router.push("/platform-admin/inbox")}
      onNextDesign={() => router.push("/platform-admin/design-workbench")}
    />
  );
}
