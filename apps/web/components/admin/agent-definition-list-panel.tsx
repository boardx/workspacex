"use client";

/**
 * #1915 —— `listAgents`（`GET /agents`）在前端的第一条真实读路径。
 *
 * 补的是这个真实缺口：`AgentDefinitionCreatePanel` 建 agent 能提交成功，但此前
 * 全仓没有任何组件调用过 `listAgents`（后端本身也从没挂过这条路由——见
 * `apps/api/src/application/agent/list-agents.ts` 头注）。建完的 agent 找不到、
 * 看不见，用户体感是"东西丢了"。
 *
 * ## 与 `CapabilityCatalogScreen(kind="agent")` 不是同一件事
 *
 * 那个屏读的是 F15 的 `capability_listings`（组织能力目录，走 `GET /capabilities`）；
 * 本组件读的是 F55 的 `agents` 表（执行侧 agent 定义，走 `GET /agents`）——两张表、
 * 两条契约操作。`lib/agent-definition.ts` 头注已经讲过这条边界，这里不重复。
 *
 * ## 刷新时机
 *
 * `refreshKey` 由外层（`AgentScreen`）在 `AgentDefinitionCreatePanel` 的 `onCreated`/
 * 发布成功回调里递增——本组件不自己监听"某个 agent 建成了"这类事件，避免建立
 * 一条组件间的隐式耦合；父组件的 state 变化触发一次真实的 `listAgents` 重新拉取，
 * 与其它"操作后 refetch"的既有列表（`CapabilityCatalogScreen`）同一个模式。
 */
import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import { listAgents, type AgentListRow } from "@/lib/agent-definition";

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.reasonCode ?? `HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly rows: readonly AgentListRow[] };

export function AgentDefinitionListPanel({
  prefix,
  refreshKey,
}: {
  readonly prefix: string;
  /** 变化即重新拉取——见文件头注「刷新时机」。 */
  readonly refreshKey: number;
}) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    const request = ++generation.current;
    setState({ status: "loading" });
    try {
      const rows = await listAgents();
      if (request !== generation.current) return;
      setState({ status: "ready", rows });
    } catch (error) {
      if (request !== generation.current) return;
      setState({ status: "error", message: describeError(error) });
    }
  }, []);

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <Card data-testid={`${prefix}-list-panel`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Agent 列表</CardTitle>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void load()}
          disabled={state.status === "loading"}
          data-testid={`${prefix}-list-refresh`}
        >
          <RefreshCw aria-hidden className="h-3 w-3" /> 刷新
        </Button>
      </CardHeader>
      <CardContent>
        {state.status === "loading" ? (
          <p className="text-12 text-muted-foreground" data-testid={`${prefix}-list-loading`}>
            加载中…
          </p>
        ) : state.status === "error" ? (
          <p className="text-12 text-destructive" data-testid={`${prefix}-list-error`}>
            {state.message}
          </p>
        ) : state.rows.length === 0 ? (
          <p className="text-12 text-muted-foreground" data-testid={`${prefix}-list-empty`}>
            还没有建过 Agent——用上面的「新建 / 导入 Agent」建一个。
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid={`${prefix}-list-rows`}>
            {state.rows.map((row) => (
              <li
                key={row.agentId}
                data-testid={`${prefix}-list-row-${row.agentId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-13 font-medium" data-testid={`${prefix}-list-row-name`}>
                    {row.name} <span className="text-muted-foreground">· {row.roleLabel || row.role}</span>
                  </span>
                  <span className="text-11 text-muted-foreground">
                    {row.initials} · {row.visibility} · {row.skillCount} 个 skill 挂载
                  </span>
                </div>
                <Badge data-testid={`${prefix}-list-row-state`}>{row.publishState}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
