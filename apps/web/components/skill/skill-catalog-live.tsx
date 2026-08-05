"use client";

import * as React from "react";
import { FileCode2, Plus, RefreshCw } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { currentOrganizationLabel } from "@/lib/org-display";
import {
  createSkillDraft,
  getSkillDetail,
  listSkills,
  reviewSkillVersion,
  runSecurityScan,
  submitSkillForReview,
  type CreateSkillDraftIn,
  type RunSecurityScanOut,
  type SkillDetail,
  type SkillListItem,
} from "@/lib/live-skill";

/**
 * #520 —— `/skill` 的 Skill 库屏，**接真实后端**（#459 / PR #518 的 `SkillController`）。
 *
 * 它只画后端**真的能给出**的东西：`SkillListItem` 的七个字段，加上 `getSkillDetail`
 * 返回的契约三件套与门禁结论。没有调用量、没有 token 额度、没有满意度百分比、
 * 没有待审核队列 —— 那些的后端本波次全部不存在，画出来就是第二份会漂移的假事实。
 * 七屏原型（含这些内容）仍在 `screen=library-prototype`，标着「原型 · mock」。
 *
 * ## 三处刻意的设计，都会被门控盯着
 *
 * ① **空态是真实空态**。`listSkills` 返回 `[]` 时这里显示「还没有」，**不生成示例 skill**
 *    （契约 A1/V10 逐字）。`skill-create-smoke.spec.ts` 第一条断言就是它。
 *
 * ② **失败态回显后端真实错误信封**：`reasonCode（HTTP <status>）`，不糊成「加载失败」。
 *    糊成一句话之后，权限、校验、重名三种失败在界面上就再也分不开了。
 *
 * ③ **创建成功后乐观地把这一行插进本地列表，不立刻重读服务端**。
 *    这不是偷懒，是为了让 e2e 的反证打在**刷新**这个接缝上：把创建请求换成一个
 *    形状合法但没落库的 201 之后，界面照样显示那一行，**只有刷新才露馅**。
 *    若这里改成「创建后立刻重读」，反证会红在刷新之前 —— 那样它考验的是
 *    「请求有没有到服务端」，根本没考验到持久化。理由同样写在那个 spec 的文件头。
 *    ⚠ 乐观插进去的内容不是编的：名称/职责/可见性是使用者刚填的，
 *      `skillId`/`status`/`source` 来自服务端 201 的响应体。
 *
 * ## 本屏**没有**的入口
 *
 * 停用（`POST /skills/:skillId/disable`）本波次必然被拒（无引用清单生产者，且状态机
 * 没有 `草稿 → 已停用` 这条边），所以这里不摆那个按钮 —— 摆一个注定失败的按钮，
 * 比没有按钮更糟。发布 / 试跑 / 审核同理：它们的用例没有 HTTP 边界。
 */

type LoadState =
  | { readonly orgId: string; readonly status: "loading" }
  | { readonly orgId: string; readonly status: "error"; readonly message: string }
  | { readonly orgId: string; readonly status: "ready"; readonly rows: readonly SkillListItem[] };

/** 契约 `DeclarativeContract` 的六个字段，一一对应表单项。⚠ 不多不少。 */
interface DraftForm {
  name: string;
  duty: string;
  promptTemplate: string;
  inputSchema: string;
  outputSchema: string;
  dataScope: string;
  readsRawTranscript: boolean;
  fallbackDeclaration: string;
  visibility: "org-wide" | "team-only";
  modelRef: string;
}

const EMPTY_FORM: DraftForm = {
  name: "",
  duty: "",
  promptTemplate: "",
  inputSchema: "",
  outputSchema: "",
  dataScope: "",
  readsRawTranscript: false,
  fallbackDeclaration: "",
  visibility: "org-wide",
  /**
   * ⚠ 服务端目前不校验 `modelRef` 的取值（`MODEL_UNAVAILABLE` 那条路径还没有生产者），
   *   但契约要求它非空。给一个可改的缺省值，而不是在提交时偷偷补一个 —— 后者会让
   *   使用者以为自己选过模型。
   */
  modelRef: "model-default",
};

export function SkillCatalogLive() {
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;

  if (orgId === null) {
    // 未登录不是错误态：这条路径的身份来自 `POST /auth/login` 存下的会话，
    // 没有会话时后端会 401，界面先说清楚要先登录，而不是发一个注定 401 的请求。
    return (
      <div
        data-testid="skill-catalog-signed-out"
        className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
      >
        Skill 库需要先登录：真实权限由服务端裁决，这里不做本地投影。
      </div>
    );
  }

  // #596：身份未就绪时给加载态文案，不把 orgId 当组织名传下去（下游还单独渲染了组织 ID）。
  return <Catalog orgId={orgId} orgName={currentOrganizationLabel(identity?.org.name)} />;
}

function Catalog({ orgId, orgName }: { orgId: string; orgName: string }) {
  const generation = React.useRef(0);
  const currentOrgId = React.useRef(orgId);
  currentOrgId.current = orgId;
  const [state, setState] = React.useState<LoadState>({ orgId, status: "loading" });
  const [creating, setCreating] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<SkillDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (currentOrgId.current !== orgId) return;
    const request = ++generation.current;
    setState({ orgId, status: "loading" });
    try {
      const rows = await listSkills(orgId);
      // 换组织后到达的旧响应不得覆盖新组织的真实请求（同 `capability-catalog-screen.tsx`）。
      if (request !== generation.current || currentOrgId.current !== orgId) return;
      setState({ orgId, status: "ready", rows });
    } catch (error) {
      if (request !== generation.current || currentOrgId.current !== orgId) return;
      setState({ orgId, status: "error", message: describeError(error) });
    }
  }, [orgId]);

  React.useEffect(() => {
    // 换组织 = 上一组织的提示与详情全部作废：它们说的是另一个组织发生过的事。
    setCreating(false);
    setNotice(null);
    setDetail(null);
    setDetailError(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  // 渲染期就按组织收口：effect 在 paint 之后才跑，只靠它会让新组织短暂继承旧组织的行。
  const visibleState: LoadState =
    state.orgId === orgId ? state : { orgId, status: "loading" };
  const rows = visibleState.status === "ready" ? visibleState.rows : [];

  async function openDetail(skillId: string) {
    setDetailError(null);
    try {
      setDetail(await getSkillDetail(skillId));
    } catch (error) {
      setDetail(null);
      setDetailError(describeError(error));
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="skill-catalog-live">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-16 font-semibold tracking-tight">Skill 库</h1>
            <Badge tone="outline">真实数据</Badge>
          </div>
          <span className="font-mono text-10 text-muted-foreground">
            {orgName} · 组织 ID {orgId}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={visibleState.status === "loading"}
            data-testid="skill-catalog-refresh"
          >
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            {visibleState.status === "loading" ? "加载中…" : "刷新"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setNotice(null);
              setCreating((v) => !v);
            }}
            data-testid="skill-create-open"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建 skill
          </Button>
        </div>
      </header>

      <p className="text-12 text-muted-foreground">
        skill 是一份声明式契约（提示词模板 ＋ 输入输出 schema ＋ 数据范围声明）。新建出来的是
        <strong className="text-foreground">草稿</strong>：要变成「已启用」，得先过安全扫描（自动），
        再由<strong className="text-foreground">另一位</strong>方法论审核人批准 —— 打开「查看契约」
        里的门禁面板走这两步。这里<strong className="text-foreground">没有</strong>「启用」按钮：
        没有第二个评审人，就没有「已启用」。
      </p>

      {creating ? (
        <CreatePanel
          orgId={orgId}
          onCancel={() => setCreating(false)}
          onCreated={(row, message) => {
            // ⚠ 乐观插入，**不重读**。理由见文件头第 ③ 条。
            setState((prev) =>
              prev.orgId === orgId && prev.status === "ready"
                ? { ...prev, rows: [row, ...prev.rows] }
                : prev,
            );
            setNotice(message);
            setCreating(false);
          }}
        />
      ) : null}

      {notice ? (
        <p data-testid="skill-catalog-notice" className="text-12 text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {visibleState.status === "loading" ? (
        <div
          data-testid="skill-catalog-loading"
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          正在读取当前组织的 Skill 库…
        </div>
      ) : null}

      {visibleState.status === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p data-testid="skill-catalog-error" className="text-12 text-destructive">
            Skill 库读取失败：{visibleState.message}
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()} data-testid="skill-catalog-retry">
            重试
          </Button>
        </div>
      ) : null}

      {visibleState.status === "ready" && rows.length === 0 ? (
        <div
          data-testid="skill-catalog-empty"
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          当前组织还没有任何 skill。这里就是真实空态 —— 不会替你生成示例 skill。
        </div>
      ) : null}

      {visibleState.status === "ready" && rows.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="skill-catalog-list">
          {rows.map((row) => (
            <Card key={row.skillId}>
              <CardContent className="flex flex-wrap items-center gap-3 pt-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-13 font-medium">{row.name}</span>
                    <Badge tone="outline">{row.source}</Badge>
                    <Badge tone={row.status === "已启用" ? "primary" : "neutral"}>{row.status}</Badge>
                    <Badge tone="outline">
                      {row.visibility === "org-wide" ? "组织可见" : "仅本团队"}
                    </Badge>
                  </div>
                  <p className="truncate text-11 text-muted-foreground">{row.duty}</p>
                  <p className="text-10 text-muted-foreground">
                    满意度{" "}
                    {/* ⚠ null ⟺ 样本不足。契约逐字：不得为了填满界面而给一个 0%。 */}
                    {row.satisfaction === null ? "样本不足" : `${Math.round(row.satisfaction * 100)}%`}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void openDetail(row.skillId)}
                  data-testid="skill-catalog-detail"
                >
                  查看契约
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {detailError ? (
        <p data-testid="skill-detail-error" className="text-12 text-destructive">
          详情读取失败：{detailError}
        </p>
      ) : null}

      {detail ? (
        <DetailPanel
          detail={detail}
          onClose={() => setDetail(null)}
          onStatusChanged={(skillId, status) => {
            /**
             * ⚠ **乐观更新，不重读服务端** —— 与创建那条（文件头第 ③ 条）同一个理由，
             *   而这里更要紧：#552 的反证要打在**刷新**这个接缝上。把状态落库那一步
             *   摘掉之后，界面收到的 200 与真实成功一模一样，这一行会照常显示成
             *   「已启用」；只有 `page.reload()` 之后才露馅。
             *   若这里改成「审核后立刻重读列表」，反证会红在刷新**之前**——
             *   那样它考验的是「请求有没有到服务端」，根本没考验到落库。
             */
            setState((prev) =>
              prev.orgId === orgId && prev.status === "ready"
                ? {
                    ...prev,
                    rows: prev.rows.map((r) => (r.skillId === skillId ? { ...r, status } : r)),
                  }
                : prev,
            );
          }}
        />
      ) : null}
    </div>
  );
}

/* ── 新建面板：契约三件套，字段与 `createSkillDraft.in` 一一对应 ─────────── */

function CreatePanel({
  orgId,
  onCancel,
  onCreated,
}: {
  orgId: string;
  onCancel: () => void;
  onCreated: (row: SkillListItem, message: string) => void;
}) {
  const [form, setForm] = React.useState<DraftForm>(EMPTY_FORM);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function set<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    const input: CreateSkillDraftIn = {
      orgId,
      name: form.name,
      duty: form.duty,
      contract: {
        promptTemplate: form.promptTemplate,
        inputSchema: form.inputSchema,
        outputSchema: form.outputSchema,
        // 逗号分隔 → 数组；空串就是**空范围**，不是 `[""]`。
        dataScope: form.dataScope.split(",").map((s) => s.trim()).filter((s) => s !== ""),
        readsRawTranscript: form.readsRawTranscript,
        fallbackDeclaration: form.fallbackDeclaration,
      },
      visibility: form.visibility,
      modelRef: form.modelRef,
      // ⚠ 这里**没有** `source`：它由服务端按入口打标；写它 ⇒ `SOURCE_TAG_IMMUTABLE`。
    };
    try {
      const created = await createSkillDraft(input);
      onCreated(
        {
          skillId: created.skillId,
          name: form.name,
          duty: form.duty,
          // 服务端分配的三个字段，来自 201 的响应体，不是这里编的。
          source: created.source,
          status: created.status,
          visibility: form.visibility,
          currentVersionId: created.versionId,
          // 契约：null ⟺ 样本不足。新建的 skill 一次调用都没有过。
          satisfaction: null,
        },
        `已创建草稿「${form.name}」（skillId ${created.skillId}）`,
      );
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-primary/30" data-testid="skill-create-panel">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-13 font-semibold">
            <FileCode2 aria-hidden className="h-4 w-4" /> 新建 skill · 声明式契约
          </h2>
          <span className="text-9 text-muted-foreground">
            来源标记由服务端按入口自动打标（自建），提交人不可改写
          </span>
        </div>

        <Field id="skill-create-name" label="名称">
          <Input
            id="skill-create-name"
            data-testid="skill-create-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field id="skill-create-duty" label="职责（这个 skill 负责什么）">
          <Input
            id="skill-create-duty"
            data-testid="skill-create-duty"
            value={form.duty}
            onChange={(e) => set("duty", e.target.value)}
          />
        </Field>
        <Field id="skill-create-prompt" label="提示词模板（可带变量）">
          <Textarea
            id="skill-create-prompt"
            data-testid="skill-create-prompt"
            rows={3}
            value={form.promptTemplate}
            onChange={(e) => set("promptTemplate", e.target.value)}
          />
        </Field>
        <Field id="skill-create-input-schema" label="输入 schema（JSON Schema 文本）">
          <Textarea
            id="skill-create-input-schema"
            data-testid="skill-create-input-schema"
            rows={2}
            value={form.inputSchema}
            onChange={(e) => set("inputSchema", e.target.value)}
          />
        </Field>
        <Field id="skill-create-output-schema" label="输出 schema（JSON Schema 文本）">
          <Textarea
            id="skill-create-output-schema"
            data-testid="skill-create-output-schema"
            rows={2}
            value={form.outputSchema}
            onChange={(e) => set("outputSchema", e.target.value)}
          />
        </Field>
        <Field
          id="skill-create-data-scope"
          label="数据范围声明（逗号分隔；上界＝提交人自身权限，服务端判定）"
        >
          <Input
            id="skill-create-data-scope"
            data-testid="skill-create-data-scope"
            value={form.dataScope}
            onChange={(e) => set("dataScope", e.target.value)}
          />
        </Field>
        <Checkbox
          data-testid="skill-create-reads-raw-transcript"
          label="声明读取原始转写"
          description="需单独授权；未授权时服务端直接判校验失败，不进待审核队列"
          checked={form.readsRawTranscript}
          onChange={(e) => set("readsRawTranscript", e.target.checked)}
        />
        <Field id="skill-create-fallback" label="兜底声明（拿不到东西时怎么办）">
          <Input
            id="skill-create-fallback"
            data-testid="skill-create-fallback"
            value={form.fallbackDeclaration}
            onChange={(e) => set("fallbackDeclaration", e.target.value)}
          />
        </Field>
        <Field id="skill-create-model" label="模型引用">
          <Input
            id="skill-create-model"
            data-testid="skill-create-model"
            value={form.modelRef}
            onChange={(e) => set("modelRef", e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-11 text-muted-foreground">可见性</span>
          {(["org-wide", "team-only"] as const).map((v) => (
            <Button
              key={v}
              size="xs"
              variant={form.visibility === v ? "primary" : "outline"}
              onClick={() => set("visibility", v)}
              data-testid={`skill-create-visibility-${v}`}
            >
              {v === "org-wide" ? "组织可见" : "仅本团队"}
            </Button>
          ))}
        </div>

        {error ? (
          <p role="alert" data-testid="skill-create-error" className="text-11 text-destructive">
            提交被拒绝：{error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={submitting}
            onClick={() => void submit()}
            data-testid="skill-create-submit"
          >
            {submitting ? "提交中…" : "提交"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid="skill-create-cancel">
            取消
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/* ── 只读详情：`GET /skills/:skillId` 的返回，一字不添 ──────────────────── */

function DetailPanel({
  detail,
  onClose,
  onStatusChanged,
}: {
  detail: SkillDetail;
  onClose: () => void;
  onStatusChanged: (skillId: string, status: SkillListItem["status"]) => void;
}) {
  const { skill, contract, gateResults } = detail;
  return (
    <Card data-testid="skill-detail-panel">
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-13 font-semibold">{skill.name} · 只读契约</h2>
          <Button size="xs" variant="ghost" onClick={onClose} data-testid="skill-detail-close">
            关闭
          </Button>
        </div>
        <Block label="提示词模板" body={contract.promptTemplate} />
        <Block label="输入 schema" body={contract.inputSchema} />
        <Block label="输出 schema" body={contract.outputSchema} />
        <Block
          label="数据范围声明"
          body={contract.dataScope.length === 0 ? "（未声明任何数据范围）" : contract.dataScope.join("、")}
        />
        <Block label="兜底声明" body={contract.fallbackDeclaration} />

        <div className="flex flex-wrap items-center gap-2 text-11">
          <span className="text-muted-foreground">双重门禁</span>
          <Badge tone={gateResults.securityScan === null ? "outline" : "primary"}>
            {/* null = 还没扫过，是真实空态，不是「通过」。 */}
            安全扫描 {gateResults.securityScan ?? "未执行"}
          </Badge>
          <Badge tone={gateResults.methodologyReviewPassed ? "primary" : "outline"}>
            方法论审核 {gateResults.methodologyReviewPassed ? "已通过" : "未通过"}
          </Badge>
        </div>

        {detail.latestTrialRun === null ? (
          <p data-testid="skill-detail-trialrun-empty" className="text-11 text-muted-foreground">
            最近一次试跑：还没有跑过。这是真实空态，不是失败 —— 试跑用例仍然没有 HTTP 边界。
          </p>
        ) : (
          <Block label="最近一次试跑输出" body={detail.latestTrialRun.output} />
        )}

        <GatePanel detail={detail} onStatusChanged={onStatusChanged} />
      </CardContent>
    </Card>
  );
}

/* ── #552：双重门禁的操作面 ──────────────────────────────────────────── */

/**
 * 扫描 / 提交 / 审核三个动作。
 *
 * ## ⚠ 四个按钮**永远都在**，不按身份藏
 *
 * 「我是不是方法论审核人」是**服务端**的裁决（`skill_reviewer_functions` ＋
 * `domain/skill/review-authorization.ts`）。在这里按身份把「批准」藏起来，
 * 等于把 I-5 那条规则复述第二遍 —— 而它与服务端那份必然有一天不一致，
 * 到那天界面会把一个仍然会被拒的操作显示成不可用，或者更糟，反过来。
 * ⇒ 按钮一直在，越权点下去看到的是**后端真实的错误信封**
 * （`REVIEWER_FUNCTION_MISMATCH（HTTP 403）`），那是使用者真正需要知道的事。
 *
 * ## ⚠ 这里没有「启用」按钮
 *
 * `已启用` 只由「批准」这一次调用在服务端产生。摆一个「启用」按钮就是
 * `SKILLS_FORBIDDEN_ROUTES` 说的那条绕过路径在界面上的样子。
 */
function GatePanel({
  detail,
  onStatusChanged,
}: {
  detail: SkillDetail;
  onStatusChanged: (skillId: string, status: SkillListItem["status"]) => void;
}) {
  /**
   * ⚠ 取的是 `detail.currentVersionId`（**本响应正文所属的那一版**），
   *   不是 `detail.skill.currentVersionId`（＝生效版本，草稿期恒 null）。
   *   两者是两个不同的事实，服务端注释里写了为什么它们各占一处
   *   （`skill.controller.ts` 的 `getSkillDetail` 分支）。
   */
  const versionId = detail.currentVersionId;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [scan, setScan] = React.useState<RunSecurityScanOut | null>(null);
  const [reason, setReason] = React.useState("契约正文与数据范围声明已复核，符合方法论要求");
  const [acked, setAcked] = React.useState<readonly string[]>([]);

  async function act(what: string, run: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await run();
      if (message !== null) setNotice(message);
    } catch (caught) {
      setError(`${what}被拒绝：${describeError(caught)}`);
    } finally {
      setBusy(false);
    }
  }

  if (versionId === null) {
    // 契约允许它为 null；真出现时说明这个 skill 连一版声明都没有，那不是门禁能处理的事。
    return (
      <p data-testid="skill-gate-no-version" className="text-11 text-muted-foreground">
        这个 skill 还没有任何版本，门禁无从开始。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3" data-testid="skill-gate-panel">
      <span className="text-10 uppercase tracking-wide text-muted-foreground">
        双重门禁 · 版本 {versionId}
      </span>
      <p className="text-11 text-muted-foreground">
        安全扫描（自动）与方法论审核（人工）是<strong className="text-foreground">并列</strong>的两道门，
        不是「先提交再补扫描」。「已启用」只由另一位方法论审核人的批准产生 —— 这里没有、也不会有
        「启用」按钮。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          data-testid="skill-gate-scan"
          onClick={() =>
            void act("安全扫描", async () => {
              const result = await runSecurityScan(versionId);
              setScan(result);
              return `安全扫描结论：${result.verdict}（风险项 ${result.findings.length} 条）`;
            })
          }
        >
          安全扫描
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          data-testid="skill-gate-submit"
          onClick={() =>
            void act("提交评审", async () => {
              // `expectedVersion` ＝ 调用方以为这一版此刻处于什么状态（乐观并发）。
              // 草稿屏上它只可能是「草稿」；不匹配时服务端返回 SKILL_VERSION_CHANGED。
              const out = await submitSkillForReview(versionId, "草稿");
              onStatusChanged(detail.skill.skillId, out.status);
              return `已提交人工门禁：${out.status}`;
            })
          }
        >
          提交评审
        </Button>
        <Button
          size="xs"
          variant="primary"
          disabled={busy}
          data-testid="skill-gate-approve"
          onClick={() =>
            void act("批准", async () => {
              const out = await reviewSkillVersion({
                versionId,
                decision: "approve",
                reason,
                riskAcks: acked,
              });
              onStatusChanged(detail.skill.skillId, out.skillStatus);
              return `方法论审核通过：${out.skillStatus}（评审记录 ${out.reviewRecordId}）`;
            })
          }
        >
          批准
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          data-testid="skill-gate-reject"
          onClick={() =>
            void act("退回", async () => {
              const out = await reviewSkillVersion({
                versionId,
                decision: "reject",
                reason,
                riskAcks: acked,
              });
              onStatusChanged(detail.skill.skillId, out.skillStatus);
              return `已退回：${out.skillStatus}`;
            })
          }
        >
          退回
        </Button>
      </div>

      <Field id="skill-gate-reason" label="审核理由（留痕，必填）">
        <Input
          id="skill-gate-reason"
          data-testid="skill-gate-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>

      {/* `risk-pending-confirm` 的风险项**逐条**确认；未确认满时服务端判 GATE_NOT_PASSED。 */}
      {scan !== null && scan.findings.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-testid="skill-gate-findings">
          {scan.findings.map((f) => (
            <Checkbox
              key={f.riskItemId}
              data-testid="skill-gate-ack"
              label={`${f.kind}：${f.detail}`}
              checked={acked.includes(f.riskItemId)}
              onChange={(e) =>
                setAcked((prev) =>
                  e.target.checked
                    ? [...prev, f.riskItemId]
                    : prev.filter((id) => id !== f.riskItemId),
                )
              }
            />
          ))}
        </div>
      ) : null}

      {notice ? (
        <p data-testid="skill-gate-notice" className="text-11 text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="skill-gate-error" className="text-11 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-3">
      <span className="text-10 uppercase tracking-wide text-muted-foreground">{label}</span>
      <pre className="whitespace-pre-wrap font-mono text-11 text-foreground">{body}</pre>
    </div>
  );
}

/**
 * 后端**真实**失败信封，不糊成一句「失败了」。
 *
 * ⚠ `reasonCode` 与 HTTP 状态**都要**。只有 reasonCode 时，一个被
 * `all-exceptions.filter.ts` 白名单剥掉码的 409（比如 `SKILL_NAME_CONFLICT`，
 * 见 `skill.controller.ts:344-352`）会显示成空；只有状态码时，422 底下的六种
 * 校验失败又分不开。两者一起才定位得了。
 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  }
  if (error instanceof Error) return error.message;
  return "未知错误";
}
