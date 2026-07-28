"use client";
import * as React from "react";
import { AdminHeader } from "./admin-header";
import { SampleConfigNotice } from "./sample-config-notice";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";

/**
 * 后台各模块共用的屏骨架 —— 统一承载七态（走 StateShell）。
 *
 * 为什么是客户端组件：StateShell 的 onCreate / retry 是函数 prop，
 * 服务端组件不能把函数传给客户端组件；把交互块下沉到这里的 "use client" 边界内。
 * 页面（服务端）只解析 state / role，把它当 prop 传进来。
 *
 * ⚠ 裁决 D-U12：页头常驻一条「示例组织配置」说明条（SampleConfigNotice）。所有后台模块
 *   共用此骨架，故标记条在这里放一次即覆盖全部页——不给每一行都加标记（会淹没信息）。
 */
export function AdminScreen({
  state, moduleLabel, title, intro, children,
  emptyHint, errors, depFailure, denialReason, successMessage,
}: {
  state: UiState;
  moduleLabel: string;
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
  emptyHint: string;
  errors?: Record<string, string>;
  depFailure?: string;
  denialReason: string;
  successMessage: string;
}) {
  return (
    <div className="flex flex-col gap-5 p-6">
      <AdminHeader moduleLabel={moduleLabel} />

      <div className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold tracking-tight">{title}</h1>
        <p className="text-13 text-muted-foreground">{intro}</p>
      </div>

      <SampleConfigNotice />

      <StatePreviewSwitcher current={state} />

      <StateShell
        state={state}
        emptyHint={emptyHint}
        onCreate={() => {}}
        errors={errors}
        depFailure={depFailure ? { what: depFailure, retry: () => {} } : undefined}
        denial={{ layer: "organization", reason: denialReason }}
        successMessage={successMessage}
        skeletonRows={5}
      >
        {children}
      </StateShell>
    </div>
  );
}
