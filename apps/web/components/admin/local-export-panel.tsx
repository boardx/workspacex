"use client";
import * as React from "react";
import { ArrowUpFromLine, Eye, Lock, ShieldAlert, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LOCAL_EXPORT_PREVIEW_TTL_MS, localExportUnvettedNote, mockIdentity,
} from "@/lib/identity";
import {
  exportToOrganizationMock, previewExportMock,
} from "@/lib/generated/identity.mock";

/**
 * 「导出到正式组织」面板（F17）—— **隐私承诺的唯一豁口**，所以这一屏的责任不是让导出好按，
 * 是让人**看清自己在同意什么**。
 *
 * ## 三步，且第二步不能被跳过
 *
 *   ① 选择    从本地组织里挑出要离开本机的那几件
 *   ② 预览    逐项列出「会离开本机的内容」+「进去之后谁会看到」
 *   ③ 确认    只有拿着 ② 的令牌才能发起；令牌一次性、有有效期
 *
 * ⚠ 「确认导出」在没有预览之前是 **disabled** 而不是「点了报错」。
 *   报错读作「你操作错了」，禁用 + 说明读作「还差一步」——而这里差的那一步
 *   正是整个 feature 存在的理由。（`lint-dead-controls` 把显式 disabled 视为
 *   明确的设计而不是死控件，正是为这种情况。）
 *
 * ## 数据从哪来
 *
 * 形状与文案全部来自契约：`previewExportMock` / `exportToOrganizationMock` 由
 * `packages/contracts` 生成，来源标注取 `localExportUnvettedNote()`，
 * 有效期取 `LOCAL_EXPORT_PREVIEW_TTL_MS`。这一屏**一句都不自己拼**——
 * 「这条材料审没审过」在库里和屏幕上必须是同一个答案。
 */

/** 演示用的本地成果。⚠ 结构来自契约的 preview item，值在这里给（同 F16 的 DEMO_MODELS）。 */
const DEMO_ARTIFACTS = [
  { artifactId: "art-local-1", title: "客户访谈纪要（本机录制）" },
  { artifactId: "art-local-2", title: "竞品定价表 v3" },
  { artifactId: "art-local-3", title: "个人假设清单" },
];

type Step = "select" | "previewed" | "done";

export function LocalExportPanel() {
  const identity = mockIdentity("org-local", null);
  const [selected, setSelected] = React.useState<string[]>([DEMO_ARTIFACTS[0]!.artifactId]);
  const [step, setStep] = React.useState<Step>("select");

  const toggle = (id: string): void => {
    // 改选就作废预览：确认过的清单必须和实际发生的是同一份。
    setStep("select");
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const viewers = previewExportMock.items[0]?.willBeVisibleTo ?? [];
  const ttlMinutes = Math.round(LOCAL_EXPORT_PREVIEW_TTL_MS / 60000);

  return (
    <section className="flex flex-col gap-2" data-testid="local-export">
      <div className="flex items-center gap-1.5">
        <ArrowUpFromLine aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-14 font-semibold">导出到正式组织</h2>
        <Badge tone="outline">承诺的唯一豁口</Badge>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-3">
          <p className="text-12 text-muted-foreground" data-testid="local-export-intro">
            这是本地组织里唯一一条会让数据离开本机的路径。它只能由你<strong>手动</strong>发起一次——
            没有自动同步，没有后台上传，没有定时推送。导出是复制：本地的原件仍然留在本机。
            反过来把正式组织的数据导入本地组织是不可能的，产品里没有这个操作。
          </p>

          {/* ── ① 选择 ── */}
          <div className="flex flex-col" data-testid="local-export-select">
            {DEMO_ARTIFACTS.map((a) => {
              const on = selected.includes(a.artifactId);
              return (
                <label
                  key={a.artifactId}
                  data-testid={`local-export-item-${a.artifactId}`}
                  data-selected={on ? "true" : undefined}
                  className="flex cursor-pointer items-center gap-2 border-b border-border-subtle py-2 last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(a.artifactId)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-13">{a.title}</span>
                  <Lock aria-hidden className="h-3 w-3 text-muted-foreground" />
                  <code className="text-11 text-muted-foreground">本机</code>
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-testid="local-export-preview-btn"
              disabled={selected.length === 0}
              onClick={() => setStep("previewed")}
            >
              <Eye aria-hidden className="mr-1 h-3.5 w-3.5" />
              预览将离开本机的内容
            </Button>
            <Button
              data-testid="local-export-confirm-btn"
              // ⚠ 禁用而不是「点了报错」：差的这一步就是本 feature 的理由。
              disabled={step !== "previewed"}
              onClick={() => setStep("done")}
            >
              确认导出
            </Button>
            {step === "select" && (
              <span className="text-11 text-muted-foreground" data-testid="local-export-gate-hint">
                需要先预览并确认——预览有效期 {ttlMinutes} 分钟，且只能用一次。
              </span>
            )}
          </div>

          {/* ── ② 预览：逐项 + 谁会看到 ── */}
          {step !== "select" && (
            <div className="flex flex-col gap-2" data-testid="local-export-preview">
              <div className="flex items-center gap-1.5">
                <ShieldAlert aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-13 font-medium">以下内容会离开本机</span>
              </div>
              {DEMO_ARTIFACTS.filter((a) => selected.includes(a.artifactId)).map((a) => (
                <div
                  key={a.artifactId}
                  data-testid={`local-export-preview-${a.artifactId}`}
                  className="flex flex-col gap-1 rounded-md border border-border-subtle p-2"
                >
                  <span className="text-13">{a.title}</span>
                  {/* 「谁会看到」是这一屏的另一半。只列文件名的预览让人不知道自己在同意什么：
                      「导给公司」和「导给公司里这些人都能读」是两个不同的决定。 */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Users aria-hidden className="h-3 w-3 text-muted-foreground" />
                    <span className="text-11 text-muted-foreground">进入后可读：</span>
                    {viewers.map((v) => (
                      <Badge key={v.id} tone="outline">
                        {v.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-11 text-muted-foreground" data-testid="local-export-unvetted-note">
                {/* 契约函数生成，界面不自己拼。落库的、写进审计的、显示在这里的是同一句。 */}
                目标组织里的条目会带上这条标注：{localExportUnvettedNote(identity.displayName)}
              </p>
            </div>
          )}

          {/* ── ③ 结果：复制不是迁移，两侧留痕 ── */}
          {step === "done" && (
            <div className="flex flex-col gap-1" data-testid="local-export-result">
              <div className="flex items-center gap-1.5">
                <Badge tone="outline">已导出 {selected.length} 件</Badge>
                <span className="text-12">本地副本仍在本机——这是复制，不是迁移。</span>
              </div>
              <span className="text-11 text-muted-foreground" data-testid="local-export-trace">
                两侧各留一条审计记录：本地 {exportToOrganizationMock.localProvenanceEventId} ·
                目标 {exportToOrganizationMock.targetProvenanceEventId}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
