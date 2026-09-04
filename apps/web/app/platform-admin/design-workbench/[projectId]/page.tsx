"use client";
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { DesignLoopProvider } from "@/lib/design-loop-store";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";

/**
 * UC-17.8 R4.4 —— PM 设计详情**全屏深色页**，脱离后台三栏骨架（不套 AppShell）。
 * 共享同一份 mock store（localStorage），所以从工作台/收件箱导航进来能读到刚建/深化的项目。
 */
export default function DesignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  return (
    <DesignLoopProvider>
      <DesignDetailScreen
        projectId={projectId ?? ""}
        onBack={() => router.push("/platform-admin/design-workbench")}
        onOpenInbox={() => router.push("/platform-admin/inbox")}
        onNextDesign={() => router.push("/platform-admin/design-workbench")}
      />
    </DesignLoopProvider>
  );
}
