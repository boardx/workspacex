"use client";

import * as React from "react";
import { Plug, ShieldAlert, Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import {
  discoverRemoteMcpTools,
  type DiscoveredMcpTool,
  type DiscoverRemoteMcpToolsOut,
} from "@/lib/live-mcp-admin";

/**
 * issue #1849 —— MCP 后台第一条真实链路：填一个远程 MCP HTTP/SSE 服务器端点
 * （+ 可选鉴权 token）→ 提交 → 后端用官方 SDK 真的连上去、发现真实工具列表 → 展示。
 *
 * ⚠ 这不是完整的服务器注册流程——`registerMcpServer`（隔离期/评审状态/授权范围）
 *   仍未接线（见 `application/mcp/ports.ts` 头注），本面板只做"连接 + 发现"这一步，
 *   与下方仍是静态演示数据的服务器清单/放行评审是两件不同的事，不假装合并成一件。
 * ⚠ 只做 HTTP/SSE remote transport——没有起本地命令行 MCP server 这回事，
 *   端点必须是一个 `https://` URL（服务端会再校验一次，前端这里不重复判定规则）。
 */
type Result =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "success"; readonly out: DiscoverRemoteMcpToolsOut }
  | { readonly status: "error"; readonly reasonCode: string; readonly message: string };

const SIDE_EFFECT_TONE: Record<DiscoveredMcpTool["sideEffect"], "primary" | "warning" | "danger"> = {
  只读: "primary",
  对外发送: "warning",
  写入外部: "danger",
};

export function McpRemoteDiscoverPanel() {
  const [serverId, setServerId] = React.useState("");
  const [endpoint, setEndpoint] = React.useState("");
  const [authToken, setAuthToken] = React.useState("");
  const [result, setResult] = React.useState<Result>({ status: "idle" });

  const submitting = result.status === "submitting";
  const canSubmit = serverId.trim() !== "" && endpoint.trim() !== "" && !submitting;

  const submit = async () => {
    setResult({ status: "submitting" });
    try {
      const out = await discoverRemoteMcpTools({
        serverId: serverId.trim(),
        endpoint: endpoint.trim(),
        authToken: authToken.trim() === "" ? null : authToken.trim(),
      });
      setResult({ status: "success", out });
    } catch (failure) {
      // ⚠ 如实显示服务端的 reasonCode，不翻译成「连接失败，请重试」——
      //   `MCP_ENDPOINT_HOST_NOT_PUBLIC`（SSRF 门）与 `MCP_SERVER_UNREACHABLE`
      //   （握手失败）与 `REQUEST_TIMEOUT`（10s 内没答完）要用户做的事完全不同。
      const reasonCode = failure instanceof ApiError ? (failure.reasonCode ?? `http_${failure.status}`) : "UNKNOWN";
      const message = failure instanceof Error ? failure.message : String(failure);
      setResult({ status: "error", reasonCode, message });
    }
  };

  return (
    <Card data-testid="admin-mcp-remote-discover-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Plug aria-hidden className="h-4 w-4 text-primary" />
          <div className="flex flex-col gap-0.5">
            <CardTitle className="text-13">连接远程 MCP 服务器（真实链路）</CardTitle>
            <CardDescription className="text-11">
              填一个远程 MCP 服务器的 HTTP/SSE 端点，后端用官方 SDK 真的连上去、调用
              tools/list，拿到真实工具列表——不是示例数据。出站地址受 SSRF 门限制，
              失败会如实告诉你原因。仅 HTTP/SSE 远程连接，不执行本地命令行。
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-11" htmlFor="mcp-remote-server-id">
            <span className="text-muted-foreground">服务器标识</span>
            <Input
              id="mcp-remote-server-id"
              placeholder="如 crm"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              disabled={submitting}
              data-testid="admin-mcp-remote-server-id"
            />
          </label>
          <label className="flex flex-col gap-1 text-11 sm:col-span-1" htmlFor="mcp-remote-endpoint">
            <span className="text-muted-foreground">远程端点 URL（https）</span>
            <Input
              id="mcp-remote-endpoint"
              placeholder="https://mcp.example.com/sse"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              disabled={submitting}
              data-testid="admin-mcp-remote-endpoint"
            />
          </label>
          <label className="flex flex-col gap-1 text-11" htmlFor="mcp-remote-auth-token">
            <span className="text-muted-foreground">鉴权 Token（可选）</span>
            <Input
              id="mcp-remote-auth-token"
              type="password"
              placeholder="Bearer token"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              disabled={submitting}
              data-testid="admin-mcp-remote-auth-token"
            />
          </label>
        </div>

        <div>
          <Button
            size="sm"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
            data-testid="admin-mcp-remote-discover-submit"
          >
            {submitting ? "连接中…" : "连接并发现工具"}
          </Button>
        </div>

        {result.status === "error" && (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5"
            data-testid="admin-mcp-remote-discover-error"
          >
            <ShieldAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-11 font-medium text-destructive">{result.reasonCode}</span>
              <span className="text-10 text-muted-foreground">{result.message}</span>
            </div>
          </div>
        )}

        {result.status === "success" && (
          <div className="flex flex-col gap-1.5" data-testid="admin-mcp-remote-discover-tools">
            <p className="text-11 text-muted-foreground">
              发现 {result.out.tools.length} 个真实工具
              {result.out.added.length > 0 ? `，新增 ${result.out.added.length} 个` : ""}
              {result.out.removed.length > 0 ? `，${result.out.removed.length} 个已不存在` : ""}
            </p>
            {result.out.tools.map((tool) => (
              <div
                key={tool.fullName}
                className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-panel p-2.5"
                data-testid="admin-mcp-remote-discover-tool-row"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Wrench aria-hidden className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono text-12 font-medium">{tool.fullName}</span>
                  <Badge tone={SIDE_EFFECT_TONE[tool.sideEffect]}>{tool.sideEffect}</Badge>
                  <Badge tone="outline">{tool.authScope}</Badge>
                </div>
                <p className="font-mono text-10 text-muted-foreground">{tool.signature}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
