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
 *
 * ⚠ #621：`SampleConfigNotice` 的语义是「后端真实存在，展示内容是组织自行配置的示例」，
 *   不适用于**整个没有后端**的模块（MCP / 模型 / 项目蓝本 / 成员 / 反馈 / 总览——见审计结论）。
 *   零后端的调用方必须传 `noticeOverride={<NoBackendNotice />}` 替换掉这条提示，
 *   而不是让两条语义矛盾的提示同时出现在同一页头。机械门控见
 *   `apps/web/scripts/lint-no-backend-badge.mjs`。
 *
 * ⚠ #1165：以上两条**穷举不了第三种屏**——**已经读真库的屏**。它既不是「示例组织配置」，
 *   也不是「零后端」，所以两条提示都不适用。F160 把成员配额屏的 `noticeOverride` 摘掉时
 *   撞上了这个缺口：摘掉之后落进 `??` 的默认分支，于是「型号、定价与条目为演示数据」
 *   这条讲模型定价的提示出现在了配额屏上。⇒ 加 `liveBacked` 作为显式的第三态。
 *   **不改默认行为**：不传它的屏（agent / canvas-template / capability-catalog /
 *   local-org / skill）一个字节不变。
 */
export function AdminScreen({
  state, moduleLabel, title, intro, children,
  emptyHint, errors, depFailure, denialReason, successMessage, noticeOverride, liveBacked,
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
  /** 传入即替换默认的 `<SampleConfigNotice />`（用于零后端模块渲染 `<NoBackendNotice />`）。 */
  noticeOverride?: React.ReactNode;
  /**
   * #1165 —— 这块屏**已经读真库**，两条屏级提示都不适用，一条都不渲染。
   *
   * ⚠ 它不是「把提示关掉」的开关，是一句关于这块屏的事实声明。屏内若仍有局部
   *   mock 区块（如成员配额屏的用量监控/限额策略两个 tab 曾经的状态），那条提示
   *   应当**贴着那个区块**渲染，而不是靠屏级提示笼统覆盖——按 tab 说实话，
   *   比在页头挂一条覆盖全屏的话诚实。
   */
  liveBacked?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5 p-6">
      <AdminHeader moduleLabel={moduleLabel} />

      <div className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold tracking-tight">{title}</h1>
        <p className="text-13 text-muted-foreground">{intro}</p>
      </div>

      {liveBacked ? null : (noticeOverride ?? <SampleConfigNotice />)}

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
