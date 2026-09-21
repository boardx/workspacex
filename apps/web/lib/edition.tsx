/**
 * 版次在前端的读取口 —— 「这一份界面是本地版还是在线版」。
 *
 * ## 为什么是 server → context，而不是 `NEXT_PUBLIC_*`
 *
 * `NEXT_PUBLIC_*` 在 `next build` 时被**内联进产物**。桌面包今天用 `next dev` 起 web
 * （`packages/local-runtime/src/up.ts`），dev 下它会在请求时读环境变量，看起来能用；
 * 但同一份代码在 `next start`（预构建产物）下就会永远读到构建机上的值——也就是说这条
 * 路会在「本地版换成预构建启动」的那一天静默失效，而症状是界面回到在线版外观、能力矩阵
 * 也跟着错。所以这里走**服务端组件读 `process.env` + React context 下发**：两种启动
 * 方式下都是请求时求值。
 *
 * ⚠ 判定规则本身不在这里：`parseDeploymentEdition` 住在契约
 * （`@repo/contracts/deployment`），前后端读同一份。这个文件只负责「从哪读」与「怎么下发」。
 */
"use client";

import * as React from "react";
import {
  DEPLOYMENT_EDITION_LABEL, EDITION_CAPABILITIES, capabilitiesMissingIn,
  type DeploymentEditionValue,
} from "@repo/contracts/deployment";

interface EditionContextValue {
  readonly edition: DeploymentEditionValue;
  /** 在线正式系统的地址；`null` = 这份安装包没配（界面必须如实说，不许编）。 */
  readonly cloudUrl: string | null;
}

const EditionContext = React.createContext<EditionContextValue>({ edition: "cloud", cloudUrl: null });

export function EditionProvider(
  { edition, cloudUrl = null, children }:
  { edition: DeploymentEditionValue; cloudUrl?: string | null; children: React.ReactNode },
): React.ReactElement {
  const value = React.useMemo<EditionContextValue>(() => ({ edition, cloudUrl }), [edition, cloudUrl]);
  return <EditionContext.Provider value={value}>{children}</EditionContext.Provider>;
}

/**
 * 当前版次。Provider 缺席 ⇒ `cloud`，与 `parseDeploymentEdition` 的默认方向一致：
 * 认不出来就按「在线」处理，不给一份线上界面挂上本地版的承诺标识。
 */
export function useEdition(): DeploymentEditionValue {
  return React.useContext(EditionContext).edition;
}

export function useCloudUrl(): string | null {
  return React.useContext(EditionContext).cloudUrl;
}

export function useIsLocalEdition(): boolean {
  return useEdition() === "local";
}

/** 当前版次少掉的能力（界面「这里做不到什么」那一段的唯一来源）。 */
export function useMissingCapabilities(): ReturnType<typeof capabilitiesMissingIn> {
  const edition = useEdition();
  return React.useMemo(() => capabilitiesMissingIn(edition), [edition]);
}

export { DEPLOYMENT_EDITION_LABEL, EDITION_CAPABILITIES };
