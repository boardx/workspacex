"use client";
import * as React from "react";
import { Plus, Plug, Wrench, RefreshCw, ShieldAlert } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { McpRemoteDiscoverPanel } from "./mcp-remote-discover-panel";
import { AdminDrawer, KV, Toast } from "./panel";
import { EntityCatalog, tagOf, type CatalogTag } from "./entity-catalog";
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { UiState } from "@/lib/ui-state";
import {
  discoverRemoteMcpTools,
  listMcpServers,
  type DiscoveredMcpTool,
  type ListedMcpServer,
} from "@/lib/live-mcp-admin";
import { ApiError } from "@/lib/api-client";

/**
 * 后台「MCP 服务器」（`/admin/mcp`）。
 *
 * 2026-09-02（人类原话：「简化…MCP…参考画布模板的首页，简化为一个卡片的列表，通过一个
 * 侧边面板来展示当前的实体的内容，可以增加删除修改，并通过 tag 来过滤和搜索」）：
 * 这一屏此前是「真实发现面板 + 真实已发现清单 + 一条『以下为静态演示数据』的黄条 +
 * 六台 mock 服务器的卡片/列表 + 默认隔离开关 + 两套枚举的澄清 + 四个抽屉」七段式，
 * 人类截图里那条黄条就是最扎眼的东西。现在只剩**一个卡片网格，全部来自真实数据**：
 *
 * · 列表 = `listMcpServers`（issue #1928 落库的发现记录）；`lib/mock/admin` 的六台示例
 *   服务器与放行评审 / 撤销授权 / 默认隔离开关这些**零后端**的演示操作一起撤掉——
 *   `registerMcpServer` / `reviewMcpServer` / `reIsolateMcpServer` 仍未接线
 *   （`apps/api/src/application/mcp/ports.ts` 头注），一个点了不落库的按钮比没有它更糟。
 *   UC-21.2 放行评审的签核原型仍在 `/preview/agent-runtime?screen=mcp-policy`。
 * · 「新增」= 「连接服务器」抽屉里的 `McpRemoteDiscoverPanel`（issue #1852 真实链路：
 *   后端用官方 SDK 连出去、发现真实工具列表，成功即落库）。
 * · 「修改」= 面板里的「重新连接 / 更新端点」：同一个 `serverId` 再跑一次
 *   `discoverRemoteMcpTools`（用例按 serverId upsert，见 `discover-remote-mcp-tools.ts`），
 *   端点或鉴权 token 换了就在这里改；工具清单也随之刷新。
 * · 「删除」：契约里**没有**注销服务器的操作（`agentRuntime.operations` 里没有任何
 *   delete/unregister MCP server），面板里如实写明，不画一个假按钮。
 *
 * 端点原值与鉴权 token 只在「连接」那一次进入系统，列表只回 `endpointHint`（内网 / 外网，
 * I-6）——本屏仅组织管理员可见，不承载 maintainer 角色，因此显示它不在 I-6 的射程内
 * （`credential-endpoint-hidden.test.ts` 逐字断言这一点）。
 *
 * `AdminScreen` 外壳保留：`verify-ui-states.sh` 的七态矩阵仍以 `/admin/mcp?state=` 锚定。
 */

type ServersState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly rows: readonly ListedMcpServer[] }
  | { readonly status: "error"; readonly message: string };

const CONN_TONE: Record<ListedMcpServer["connectionStatus"], "primary" | "warning" | "danger" | "outline"> = {
  已连接: "primary",
  限流中: "warning",
  已隔离: "danger",
  不可达: "danger",
  凭据失效: "danger",
};
const REVIEW_TONE: Record<ListedMcpServer["reviewStatus"], "neutral" | "danger" | "warning"> = {
  已放行: "neutral",
  待安全评审: "danger",
  维持隔离: "danger",
  有条件放行: "warning",
  已到期待复核: "warning",
};

export function McpScreen({ state }: { state: UiState }) {
  const [servers, setServers] = React.useState<ServersState>({ status: "loading" });
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const generation = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const request = ++generation.current;
    setServers((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    try {
      const rows = await listMcpServers();
      if (request !== generation.current) return;
      setServers({ status: "ready", rows: [...rows] });
    } catch (failure) {
      if (request !== generation.current) return;
      const message = failure instanceof ApiError ? (failure.reasonCode ?? failure.message) : String(failure);
      setServers({ status: "error", message });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  const rows = React.useMemo(() => (servers.status === "ready" ? servers.rows : []), [servers]);
  const tagsOf = React.useCallback((r: ListedMcpServer): readonly CatalogTag[] => [
    tagOf(r.endpointHint),
    tagOf(r.authScope),
    tagOf(r.reviewStatus),
    tagOf(r.connectionStatus),
    ...(r.involvesCustomerData ? [{ key: "customer-data", label: "涉客户数据" }] : []),
    ...(r.isEgress ? [{ key: "egress", label: "出域" }] : []),
  ], []);
  const searchTextOf = React.useCallback(
    (r: ListedMcpServer) => [r.serverId, r.name, r.description].join(" "),
    [],
  );

  return (
    <AdminScreen
      state={state}
      hideOrgIdentity
      moduleLabel="MCP"
      title="MCP 服务器"
      liveBacked
      intro="连接远程 MCP 服务器、发现真实工具。授权范围回答「谁能通过 agent 调用这台服务器的工具」，与 Agent/Skill 页的可见性范围是两个维度；评审状态与授权范围正交。端点与鉴权 token 仅组织管理员可见。"
      emptyHint="还没有连接任何 MCP 服务器"
      errors={{ endpoint: "工具发现失败：端点握手成功但未返回工具清单；服务器保持已隔离，不放行" }}
      depFailure="工具发现与连接状态监测依赖 MCP 网关；网关不可达，无法确认工具数与连接状态。"
      denialReason="只有组织管理员能连接服务器、配置授权范围；能力维护者只读服务器名与工具清单，看不到端点与凭据。"
      successMessage="服务器『欧盟法规库』维持隔离；授权范围已设为全体成员，评审状态待安全评审"
    >
      <EntityCatalog<ListedMcpServer>
        prefix="admin-mcp"
        title="已连接的服务器"
        status={
          servers.status === "ready"
            ? { kind: "ready" }
            : servers.status === "error"
              ? { kind: "error", message: servers.message }
              : { kind: "loading" }
        }
        rows={rows}
        keyOf={(r) => r.serverId}
        searchTextOf={searchTextOf}
        tagsOf={tagsOf}
        cardTestId={(r) => `admin-mcp-card-${r.serverId}`}
        headerActions={
          <Button size="sm" variant="primary" onClick={() => setConnecting(true)} data-testid="admin-mcp-add">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            连接服务器
          </Button>
        }
        onRefresh={() => void refresh()}
        emptyState="本组织还没有连接过任何 MCP 服务器——用「连接服务器」填端点并发现工具，成功后会出现在这里。"
        searchPlaceholder="按服务器标识、名称或描述搜索…"
        renderCard={(r) => (
          <CardContent className="flex h-full flex-col gap-2 pt-4">
            <div className="flex items-start gap-2">
              <Plug aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-13 font-medium">{r.name || r.serverId}</span>
                <span className="font-mono text-10 text-muted-foreground">{r.serverId} · {r.endpointHint}</span>
              </div>
            </div>
            {r.description && <p className="line-clamp-2 text-11 text-muted-foreground">{r.description}</p>}
            <div className="flex flex-wrap items-center gap-1.5">
              {r.involvesCustomerData && <Badge tone="warning">涉客户数据</Badge>}
              <Badge tone="outline" data-testid={`admin-mcp-authscope-${r.serverId}`}>授权 · {r.authScope}</Badge>
              <Badge tone={REVIEW_TONE[r.reviewStatus]} data-testid={`admin-mcp-review-${r.serverId}`}>
                <ShieldAlert aria-hidden className="h-3 w-3" />
                评审 · {r.reviewStatus}
              </Badge>
              <Badge tone={CONN_TONE[r.connectionStatus]} data-testid={`admin-mcp-conn-${r.serverId}`}>{r.connectionStatus}</Badge>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-11 text-muted-foreground">
              <span className="flex items-center gap-1">
                <Wrench aria-hidden className="h-3 w-3" />
                {r.toolCount} 工具
              </span>
              {r.lastDiscoveredAt && (
                <span className="text-10" data-testid={`admin-mcp-discovered-server-${r.serverId}-time`}>
                  上次发现：{r.lastDiscoveredAt}
                </span>
              )}
            </div>
          </CardContent>
        )}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        detailWidth="lg"
        detailTitle={(r) => r.name || r.serverId}
        detailSubtitle={() => "端点与鉴权 token 仅组织管理员可见，列表只回内网 / 外网提示"}
        renderDetail={(r) => (
          <ServerDetail
            server={r}
            onRediscovered={(message) => {
              setToast(message);
              void refresh();
            }}
          />
        )}
      />

      {connecting && (
        <AdminDrawer
          testid="admin-mcp-panel"
          title="连接远程 MCP 服务器"
          subtitle="真实链路：后端用官方 SDK 连上去、调用 tools/list。发现成功即落库并出现在列表里。"
          onClose={() => setConnecting(false)}
          width="lg"
        >
          <McpRemoteDiscoverPanel
            onDiscovered={() => {
              setToast("已连接并发现工具，列表已刷新");
              void refresh();
            }}
          />
        </AdminDrawer>
      )}

      <Toast message={toast} testid="admin-mcp-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}

/* ───────────────────────── 面板 ───────────────────────── */

type RediscoverState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "success"; readonly tools: readonly DiscoveredMcpTool[]; readonly added: number; readonly removed: number }
  | { readonly status: "error"; readonly reasonCode: string; readonly message: string };

const SIDE_EFFECT_TONE: Record<DiscoveredMcpTool["sideEffect"], "primary" | "warning" | "danger"> = {
  只读: "primary",
  对外发送: "warning",
  写入外部: "danger",
};

/**
 * 面板：`listMcpServers` 回来的字段一字不添，加一块「重新连接 / 更新端点」——这是这条契约
 * 上唯一真实的「修改」路径。契约不回端点原值，输入框因此是空的，改端点要整个重填。
 */
function ServerDetail({
  server: row,
  onRediscovered,
}: {
  server: ListedMcpServer;
  onRediscovered: (message: string) => void;
}) {
  const [server, setServer] = React.useState({ endpoint: "", authToken: "" });
  const [result, setResult] = React.useState<RediscoverState>({ status: "idle" });
  React.useEffect(() => {
    setServer({ endpoint: "", authToken: "" });
    setResult({ status: "idle" });
  }, [row.serverId]);
  const submitting = result.status === "submitting";
  const canSubmit = server.endpoint.trim() !== "" && !submitting;
  const id = `admin-mcp-detail-${row.serverId}`;

  const submit = async () => {
    setResult({ status: "submitting" });
    try {
      const out = await discoverRemoteMcpTools({
        serverId: row.serverId,
        endpoint: server.endpoint.trim(),
        authToken: server.authToken.trim() === "" ? null : server.authToken.trim(),
      });
      setResult({ status: "success", tools: out.tools, added: out.added.length, removed: out.removed.length });
      onRediscovered(`已重新连接「${row.name || row.serverId}」，发现 ${out.tools.length} 个工具`);
    } catch (failure) {
      const reasonCode = failure instanceof ApiError ? (failure.reasonCode ?? `http_${failure.status}`) : "UNKNOWN";
      const message = failure instanceof Error ? failure.message : String(failure);
      setResult({ status: "error", reasonCode, message });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col divide-y divide-border-subtle">
        <KV k="服务器标识" v={<span className="font-mono text-11">{row.serverId}</span>} />
        <KV k="描述" v={row.description} />
        <KV k="端点" v={`${row.endpointHint}（列表不回端点原值，见 I-6）`} />
        <KV k="授权范围" v={row.authScope} />
        <KV k="评审状态" v={row.reviewStatus} />
        <KV k="连接状态" v={row.connectionStatus} />
        <KV k="隔离期截止" v={row.quarantineUntil ?? "不在隔离期"} />
        <KV k="涉客户数据" v={row.involvesCustomerData ? "是（受出域红线约束）" : "否"} />
        <KV k="出域" v={row.isEgress ? "是" : "否"} />
        <KV k="工具数" v={`${row.toolCount} 个`} />
        <KV k="上次发现" v={row.lastDiscoveredAt ?? "从未发现过"} />
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3" data-testid={`${id}-rediscover`}>
        <span className="text-10 uppercase tracking-wide text-muted-foreground">重新连接 / 更新端点</span>
        <p className="text-11 text-muted-foreground">
          用同一个服务器标识再连一次：换端点、换鉴权 token、或只是刷新工具清单，都走这里。
          仅 HTTP/SSE 远程连接，出站地址受 SSRF 门限制，失败会如实告诉你原因。
        </p>
        <label className="flex flex-col gap-1 text-11" htmlFor={`${id}-endpoint`}>
          <span className="text-muted-foreground">远程端点 URL（https）</span>
          <Input
            id={`${id}-endpoint`}
            placeholder="https://mcp.example.com/sse"
            value={server.endpoint}
            onChange={(e) => setServer((s) => ({ ...s, endpoint: e.target.value }))}
            disabled={submitting}
            data-testid={`${id}-endpoint`}
          />
        </label>
        <label className="flex flex-col gap-1 text-11" htmlFor={`${id}-auth-token`}>
          <span className="text-muted-foreground">鉴权 Token（可选）</span>
          <Input
            id={`${id}-auth-token`}
            type="password"
            placeholder="Bearer token"
            value={server.authToken}
            onChange={(e) => setServer((s) => ({ ...s, authToken: e.target.value }))}
            disabled={submitting}
            data-testid={`${id}-auth-token`}
          />
        </label>
        <div>
          <Button size="sm" variant="primary" disabled={!canSubmit} onClick={() => void submit()} data-testid={`${id}-submit`}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            {submitting ? "连接中…" : "重新连接并发现工具"}
          </Button>
        </div>
        {result.status === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5" data-testid={`${id}-error`}>
            <ShieldAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-11 font-medium text-destructive">{result.reasonCode}</span>
              <span className="text-10 text-muted-foreground">{result.message}</span>
            </div>
          </div>
        )}
        {result.status === "success" && (
          <div className="flex flex-col gap-1.5" data-testid={`${id}-tools`}>
            <p className="text-11 text-muted-foreground">
              发现 {result.tools.length} 个真实工具
              {result.added > 0 ? `，新增 ${result.added} 个` : ""}
              {result.removed > 0 ? `，${result.removed} 个已不存在` : ""}
            </p>
            {result.tools.map((tool) => (
              <div key={tool.fullName} className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-card p-2.5" data-testid="admin-mcp-tool-row">
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
      </div>

      <p className="text-10 text-muted-foreground">
        契约里没有注销服务器的操作，也没有把授权范围 / 放行评审接到后端的路由
        （`registerMcpServer` / `reviewMcpServer` / `reIsolateMcpServer` 仍未接线）——
        这里不画会假装生效的按钮。放行评审的签核原型见「智能体运行时」预览屏。
      </p>
    </div>
  );
}
