// coord-config — 把 wrangler.toml `[vars]` 里的**非敏感**协作面配置暴露给前端（#479）。
//
// 存在的唯一理由：消灭第二事实源。此前 `components/portal/tabs/join-tab.tsx` 自己
// 硬编码了一份 gateway URL 和仓库名，两份都是从旧模板仓抄来的错值——门户因此给人类
// 复制出 `export COORD_GATEWAY_URL=https://coord-gateway…`（空的那个网关）和
// `export COORD_REPO=boardx/boardx-dev-template`（旧模板仓），照着接入的 agent 会连到
// 一个没有本仓数据的协调平面。
//
// 只回 `[vars]` 里的明文配置，**永不回任何 Pages 加密 secret**
// （COORD_API_TOKEN / COORD_GATEWAY_ADMIN_TOKEN / GITHUB_TOKEN 等一律不出现在这里）。
// 未配置时如实回 null，由前端诚实降级——不给默认值，默认值正是这次事故的成因。
import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export interface CoordConfig {
  coordGatewayUrl: string | null;
  repo: string | null;
  appSlug: string | null;
}

export async function GET(): Promise<NextResponse<CoordConfig>> {
  return NextResponse.json({
    coordGatewayUrl: process.env["COORD_GATEWAY_URL"] ?? null,
    repo: process.env["GITHUB_REPO"] ?? null,
    appSlug: process.env["GITHUB_APP_SLUG"] ?? null,
  });
}
