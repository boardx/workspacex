"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, MessageSquareWarning } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { UiState } from "@/lib/ui-state";
import { ScreenHead, RoleGate } from "./skill-shared";
import type { SkillView } from "@/lib/mock/skill";

/**
 * Skill · 改进反馈 —— **已降级为一个指向后台反馈屏的入口**（D1，2026-08-15 人类裁决）。
 *
 * ## 这块屏之前是什么，为什么不再是
 *
 * 它曾经用 `FEEDBACK_AGGS` / `FEEDBACK_LOOP` / `PROPOSAL_DIFF` 三个 mock 常量，
 * 画「改进建议 + 闭环度量 + 提案 diff」——而后台的旧 `admin/feedback-screen.tsx`
 * （B3.6 已删除，功能并入 `/platform-admin/inbox`）用另外三个 mock 常量画**同一件事**。
 * 「同一事实声明在两处」的界面版：两块屏迟早会不一致，且不一致时没有任何东西会报。
 *
 * 人类裁决（`docs/proposals/PROP-FEEDBACK-LOOP-E2E-001.md` §4 D1）：
 * **后台屏是唯一入口**，本屏降级为一个链接——与 F160 对「组织成员」屏的处置同型。
 *
 * ## 为什么整块删掉而不是留一个「只看本 skill」的过滤视图
 *
 * 那正是 D1 的第二个选项，人类没有选它。留下来的话，两块屏的口径差异
 * （全组织 vs 本 skill）需要一道机械门控守着才不会漂移，而那道门控守的是
 * 一件本来就不必存在的复杂度。
 *
 * ⚠ 本屏**不再引用 `@/lib/mock/skill` 的三个反馈常量**。那三个常量若在别处也无人引用，
 *   删除它们是另一件事（会动到 mock 文件的其他消费者），不在本次改动范围内——
 *   但这里不再制造对它们的新引用。
 */
export function SkillFeedback({ state: _state, view }: { state: UiState; view: SkillView }) {
  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title="Skill 改进反馈与版本触发" uc="UC-3.6 R3 · F68">
        采集侧（对 AI 消息点 👍/👎、在对话里对某个 Skill 提反馈）已经在 `/chat` 里；
        处置侧（分诊、改进建议、版本触发）统一在后台的「反馈与迭代」一块屏上。
      </ScreenHead>

      <RoleGate view={view} allow={["maintainer", "reviewer", "facilitator", "groupLead", "member"]} what="改进反馈处置">
        <Card data-testid="skill-fb-moved">
          <CardContent className="flex flex-col items-start gap-3 pt-4">
            <div className="flex items-center gap-2">
              <MessageSquareWarning aria-hidden className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-13 font-semibold">反馈的处置在后台，只有那一处</h2>
            </div>
            <p className="text-12 text-muted-foreground">
              这里过去有一份和后台重复的看板（改进建议 / 闭环度量 / 提案 diff），两边都是示例数据、
              且迟早会不一致。2026-08-15 的裁决是收敛成一处：后台的「反馈与迭代」屏读的是真实数据，
              左列是对产品提的，右列是在对话里对某个 Agent / Skill 提的。
            </p>
            <Button asChild size="sm" variant="outline" data-testid="skill-fb-open-admin">
              <Link href="/platform-admin/feedback">
                打开「反馈与迭代」
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </RoleGate>
    </div>
  );
}
