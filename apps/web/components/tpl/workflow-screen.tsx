"use client";
import { canonicalBlueprintCopy, localizeBlueprintCopy } from "@/lib/i18n/blueprint-copy";

import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { ArrowRight, Save, ListTodo, Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL } from "@/lib/identity";
import { ApiError } from "@/lib/api-client";
import {
  getWorkflowOrchestration,
  type WorkflowOrchestrationOut,
} from "@/lib/live-workflow-orchestration";
import { SignoffFlag } from "./parts";
import { SaveAsOrgTemplateAction } from "./save-as-org-template-action";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * 工作流编排屏（F26，契约 `getWorkflowOrchestration`）。
 *
 * 2026-08-21（#1681）：此前本组件整屏吃 `@/lib/mock/tpl` 静态 mock，且没有 `projectId`
 * 参数——连「读哪个项目的编排」这个前提都不存在（发现于 #1666 勘探）。本次把 7a
 * 模板层 + 7b 环节×三角色矩阵改接真实 `getWorkflowOrchestration`（唯一的调用方
 * `tpl-app.tsx` 从 `?projectId=` 读取并下传，模式同 `tab-prep.tsx` 的 `projectId` prop）。
 *
 * ⚠ #1680（`getWorkflowOrchestration` 的 controller/infra）落这份代码时可能还没合并到
 *   main——那种情况下真实请求会拿到 404/`ApiError`，走下方 `depFailure` 分支，这是预期
 *   状态，不是本组件的 bug。
 *
 * ⚠ 7c「可切换的工作流模板库」**如实降级为空态说明**：`getWorkflowOrchestration`
 *   契约只回「当前套用的模板 + 编排矩阵」，不包含模板库列表——`templates` 契约里没有
 *   这条读路径，也不是 #1680 的范围。之前 `TEMPLATE_LIBRARY` 三条 mock 数据在这次改造
 *   里被移除，不编造一份看起来真实的目录。「换模板」（`switchWorkflowTemplate`）
 *   仍未接线（契约缺口 7c 的读路径没补齐，接了也没有真实目录可选，见下方
 *   `tpl-template-library` 区块）。
 *
 * 2026-08-21（#1666 收尾）：「另存为组织模板」（`tpl-wf-saveorg`）此前只
 * `onToast(...)`，不发任何网络请求——issue #1666 勘探报告的两处「假成功」缺陷之一。
 * #1680 落地 `saveAsOrgTemplate` 的 controller/infra 后，这里改接
 * `SaveAsOrgTemplateAction`（`components/tpl/save-as-org-template-action.tsx`，
 * 与 `tab-prep.tsx` 的 `project-prep-save-template` 共用同一份状态机与请求逻辑），
 * 成功后显示服务端真实返回的 `workflowTemplateId`，失败原样显示服务端 reasonCode。
 */
export function WorkflowScreen({
  projectId, uiState, previewRole: _previewRole, onToast,
}: {
  /** 真实项目 id。`null` = 调用方还没有可用的项目上下文（如原型画廊未选中项目）。 */
  projectId: string | null;
  uiState: UiState;
  previewRole: ProjectRole | null;
  onToast: (m: string) => void;
}) {
 const { t: blueprintI18n } = useI18n();

  const [data, setData] = React.useState<WorkflowOrchestrationOut | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [errorInfo, setErrorInfo] = React.useState<OrchestrationErrorInfo | null>(null);

  // uiState 手动切换到非 default 是设计签核复核用的预览态（同屏内其余原型的既有约定，
  // `PreviewControls` 只在非生产环境渲染），那种情况下不发真实请求，避免预览态与真实
  // 加载态互相打架。
  const shouldFetchReal = uiState === "default" && projectId !== null;

  const load = React.useCallback(() => {
    if (projectId === null) return;
    setLoading(true);
    setErrorInfo(null);
    getWorkflowOrchestration(projectId)
      .then((out) => setData(out))
      .catch((e) => setErrorInfo(classifyOrchestrationError(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  React.useEffect(() => {
    if (shouldFetchReal) load();
  }, [shouldFetchReal, load]);

  const effectiveState: UiState =
    uiState !== "default"
      ? uiState
      : projectId === null
        ? "invalid"
        : loading
          ? "loading"
          : errorInfo !== null
            ? errorInfo.kind
            : "default";

  const roleKeys = React.useMemo(() => {
    if (data === null) return [];
    const known: ProjectRole[] = ["facilitator", "groupLead", "member", "observer"];
    const present = new Set(data.matrix.map((c) => c.roleKey));
    const ordered = known.filter((r) => present.has(r));
    const extra = [...present].filter((r) => !(known as string[]).includes(r));
    return [...ordered, ...extra];
  }, [data]);

  const cellFor = React.useCallback(
    (agendaSegmentId: string, roleKey: string) =>
      data?.matrix.find((c) => c.agendaSegmentId === agendaSegmentId && c.roleKey === roleKey) ?? null,
    [data],
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4" data-testid="tpl-workflow">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h1 className="text-20 font-bold tracking-tight">{blueprintI18n("blueprintFlow.workflowOrchestration")}</h1>
          <Badge tone="outline">{blueprintI18n("blueprintFlow.projectSettings")}</Badge>
        </div>
        <p className="text-12 text-muted-foreground">{blueprintI18n("blueprintFlow.changesAffectThisProjectOnlyLeavingTheAdminTemplateUnchanged")}</p>
      </header>

      <StateShell
        state={effectiveState}
        skeletonRows={6}
        emptyHint={blueprintI18n("blueprintFlow.noWorkflowTemplateAppliedYetChooseOneFromTheLibrary")}
        errors={{ projectId: blueprintI18n("blueprintFlow.missingProjectIdThisScreenHasNoRealProjectContextAnd") }}
        depFailure={{ what: localizeBlueprintCopy(blueprintI18n, errorInfo?.reason ?? blueprintI18n("blueprintFlow.theOrchestrationDataServiceIsUnavailable")), retry: load }}
        denial={{ layer: "project", reason: localizeBlueprintCopy(blueprintI18n, errorInfo?.reason ?? blueprintI18n("blueprintFlow.youHaveNoRoleInThisProject")) }}
        successMessage={blueprintI18n("blueprintFlow.savedAsAnOrganizationWorkflowTemplateAnIndependentProjectionWithout")}
      >
        {data !== null && (
          <>
            {/* 7a 模板层 —— 真实数据（getWorkflowOrchestration.template） */}
            <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-wf-template">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-13 font-medium">{data.template.name}</span>
                <Badge tone="primary">{blueprintI18n("blueprintFlow.applied")}</Badge>
                <Badge tone="outline" data-testid="tpl-wf-source">v{data.template.sourceVersion}</Badge>
              </div>
              {/* 议程环节链 —— 真实数据（getWorkflowOrchestration.segmentChain） */}
              <div className="flex flex-wrap items-center gap-1" data-testid="tpl-segment-chain">
                {data.segmentChain.map((s, i) => (
                  <React.Fragment key={s.agendaSegmentId}>
                    <Badge tone="neutral">{s.title}</Badge>
                    {i < data.segmentChain.length - 1 && <ChevronRight aria-hidden className="h-3 w-3 text-muted-foreground" />}
                  </React.Fragment>
                ))}
              </div>
              <p className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.afterApplyingAdjustDurationsSegmentsTemplateBindingsAndSkillsUnder")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.openProjectPreparationAgendaSubtabToRefine"))} data-testid="tpl-wf-refine"><ArrowRight aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.refineInAgenda")}</Button>
                <SaveAsOrgTemplateAction
                  // ⚠ `data !== null` 只在 `shouldFetchReal`（含 `projectId !== null`）成立时被
                  //   真实数据填充（见上方 `load()`），所以这里的 `projectId` 一定非空——
                  //   TS narrowing 跨不过外层这个渲染分支，显式非空断言 + 注释说明前提，
                  //   不是绕过类型检查。
                  projectId={projectId!}
                  testIdPrefix="tpl-wf-saveorg"
                  onSaved={(out) => onToast(canonicalBlueprintCopy("blueprintFlow.savedAsOrganizationTemplateValue1IdValue2AWorkflowTemplate", { value1: String(out.name), value2: String(out.workflowTemplateId) }))}
                  renderTrigger={(open, testId) => (
                    <Button size="sm" variant="outline" onClick={open} data-testid={testId}>
                      <Save aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.saveAsOrganizationTemplate")}</Button>
                  )}
                />
              </div>
            </section>

            {/* 7b 环节 × 角色矩阵 —— 真实数据（getWorkflowOrchestration.matrix），
                列集从矩阵里实际出现的 roleKey 派生（I-28：不硬编码列集）。 */}
            <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-matrix">
              <div className="flex items-center gap-2">
                <span className="text-13 font-semibold">{blueprintI18n("blueprintFlow.segmentOrchestrationEachRoleSResponsibilities")}</span>
                <Button size="xs" variant="outline" className="ml-auto" onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.openTasksToSeeTheTasksGeneratedFromTheseCells"))} data-testid="tpl-matrix-tasks"><ListTodo aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.viewTasks")}</Button>
              </div>
              <p className="text-11 font-medium text-primary">{blueprintI18n("blueprintFlow.configureOnceThreeViewsAndTaskListsAreGeneratedAutomatically")}</p>
              <div className="overflow-x-auto" data-allow-x-scroll="环节×角色矩阵，窄屏允许横向滚动看全">
                <Table className="w-full min-w-[720px] border-collapse text-11">
                  <TableHeader>
                    <TableRow className="border-b border-border text-left">
                      <TableHead className="px-2 py-1.5 font-medium">{blueprintI18n("blueprintFlow.segment2")}</TableHead>
                      {roleKeys.map((r) => <TableHead key={r} className="px-2 py-1.5 font-medium" data-testid="tpl-matrix-col">{localizeBlueprintCopy(blueprintI18n, roleLabel(r))}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.segmentChain.map((seg) => (
                      <TableRow key={seg.agendaSegmentId} className="border-b border-border/60 align-top" data-testid="tpl-matrix-row">
                        <TableCell className="px-2 py-2">
                          <div className="text-12 font-medium">{seg.title}</div>
                          {/* ⚠ 没有「绑定」字段（mock 曾有的 "25m · 模板 xxx" 不在契约里，
                              不编造）——这里显示的是契约真有的 addedBy/optional 两个字段。 */}
                          <div className="text-10 text-muted-foreground" data-testid="tpl-matrix-binding">
                            {seg.addedBy !== null ? blueprintI18n("blueprintFlow.addedAutomaticallyByValue1", { value1: String(seg.addedBy) }) : blueprintI18n("blueprintFlow.addedManually")}
                            {seg.optional ? blueprintI18n("blueprintFlow.optional2") : ""}
                          </div>
                        </TableCell>
                        {roleKeys.map((r) => {
                          const cell = cellFor(seg.agendaSegmentId, r);
                          return (
                            <TableCell key={r} className="px-2 py-2">
                              {cell === null ? (
                                <span className="text-10 text-muted-foreground">—</span>
                              ) : (
                                <span className="flex flex-col gap-0.5">
                                  <span className="rounded-sm bg-panel px-1.5 py-1 text-11" data-testid="tpl-matrix-cell">{cell.content}</span>
                                  {(cell.canvasTemplateId !== null || cell.skillIds.length > 0) && (
                                    <span className="text-9 text-muted-foreground">
                                      {cell.canvasTemplateId !== null ? blueprintI18n("blueprintFlow.bindCanvasTemplate") : ""}
                                      {cell.canvasTemplateId !== null && cell.skillIds.length > 0 ? " · " : ""}
                                      {cell.skillIds.length > 0 ? blueprintI18n("blueprintFlow.value1Skills", { value1: String(cell.skillIds.length) }) : ""}
                                    </span>
                                  )}
                                </span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="rounded-md bg-panel px-2.5 py-1.5 text-10 text-muted-foreground" data-testid="tpl-matrix-rule">{blueprintI18n("blueprintFlow.eachCellBecomesATaskForItsRoleSyncedTo")}</p>
            </section>

            {/* 7c 模板库 —— 契约缺口：getWorkflowOrchestration 不包含模板库列表，
                switchWorkflowTemplate 也不在本 issue 范围（#1680）。如实降级为空态说明，
                不展示编造的目录。 */}
            <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-template-library">
              <span className="text-13 font-semibold">{blueprintI18n("blueprintFlow.availableWorkflowTemplates")}</span>
              <SignoffFlag kind="confirmed-missing" title={blueprintI18n("blueprintFlow.templateLibraryReadPathIsNotModeledContractGap")} testid="tpl-library-gap">{blueprintI18n("blueprintFlow.getWorkflowOrchestrationReturnsOnlyTheCurrentTemplateAndMatrixWithoutA")}</SignoffFlag>
              <Button
                size="sm" variant="ghost" className="w-fit" disabled
                title={blueprintI18n("blueprintFlow.templateLibraryReadPathIsNotModeledUnavailable")}
                data-testid="tpl-library-blank"
              >
                <Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.startFromBlank")}</Button>
            </section>
          </>
        )}
      </StateShell>
    </div>
  );
}

function roleLabel(r: string): string {
  return (PROJECT_ROLE_LABEL as Record<string, string>)[r] ?? r;
}

interface OrchestrationErrorInfo {
  readonly kind: "denied" | "dep-failed";
  readonly reason: string;
}

/**
 * 后端真实信封原样回显——同 `tab-prep.tsx` 的 `describeXError` 纪律：只把契约
 * `getWorkflowOrchestration.err`（`NO_PROJECT_ROLE`/`DEPENDENCY_UNAVAILABLE`）里真有的码
 * 翻成人话，其余（含 #1680 未合并时的 404）原样带 reasonCode/HTTP status，不臆造。
 */
function classifyOrchestrationError(e: unknown): OrchestrationErrorInfo {
  if (e instanceof ApiError) {
    if (e.reasonCode === "NO_PROJECT_ROLE") {
      return { kind: "denied", reason: "你在这个项目里没有任何角色，看不到工作流编排。" };
    }
    if (e.reasonCode === "DEPENDENCY_UNAVAILABLE") {
      return { kind: "dep-failed", reason: "编排数据依赖的服务暂时不可用，请稍后重试。" };
    }
    return { kind: "dep-failed", reason: `${e.reasonCode ?? "无 reasonCode"}（HTTP ${e.status}）` };
  }
  if (e instanceof Error) return { kind: "dep-failed", reason: e.message };
  return { kind: "dep-failed", reason: "未知错误" };
}
