"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import interviewStarter from "../../../../../skills/aidt-methods/aidt-empathize/starter.json";
import starter from "../../../../../skills/aidt-methods-candidates/1.4.1/aidt-understand/starter.json";
import type { AidtStep } from "../lib/project-aidt";

const STUDENT_START: Partial<Record<AidtStep["id"], { hint: string; scaffold: string; outcome: string }>> = {
  2: { hint: "先贴出你们自己拟的访谈问题初稿；已有真实材料，也可以直接从自己的发现继续。", scaffold: "想了解：____\n访谈问题初稿：____\n已有材料时：受访者代号 ____；原话与位置 ____；我的发现 ____", outcome: "采纳后的访谈清单、每位受访者一张人物发现卡；缺失材料明确保留。" },
  3: { hint: "先回看发现卡：什么与你们先前想法不同？暂无也可以，再继续画像与HMW。", scaffold: "原先想法：____\n意外发现＋材料位置，或“暂无”：____\n画像初稿：____（未知可留未知）\n我们如何帮助 ____ 改善 ____？", outcome: "意外发现或暂无、学生确认的画像与HMW，以及材料引用。" },
  4: { hint: "围绕选定的HMW，贴出你们自己的第一轮想法。一个点子一行，还粗糙也可以。", scaffold: "本轮HMW：____\n点子名｜做什么｜怎样帮助用户\n____｜____｜____", outcome: "至少三个不同点子的描述单、学生分类与原型选择；打印后可另存PDF。" },
  5: { hint: "通过这次制作原型，你最想知道什么？说说你目前的看法和依据，再决定做成什么形式。", scaffold: "入选点子／描述单：____\n最想知道什么：____\n目前看法与依据：____\n原型形式与使用情境：____", outcome: "绑定验证问题与先前看法的静态原型版本，状态为待测试。" },
  6: { hint: "先核对被测版本与原验证问题。准备测试就贴问题初稿，测试过就从真实反馈与反思继续。", scaffold: "被测版本＋原验证问题：____\n测试问题初稿，或真实反馈与来源：____\n认识变化：____（可未改变／证据不足）\n下一步及理由：____（可尚未决定）", outcome: "测试前后认识与下一轮行动；回前四步无需先生成新原型。" },
};

/** Teaching copy belongs to this host; composer/messages remain canonical Chat. */
export function AidtChatEmptyState({ step, offerInitial, interviewPhase }: { interviewPhase?: keyof typeof interviewStarter; step?: AidtStep; offerInitial?: (text: string) => ComposerOfferResult } = {}): JSX.Element {
  const [status, setStatus] = useState("");
  if (step?.id === 2 && interviewPhase) return <div data-testid="copilotkit-v2-empty" className="mx-auto w-full max-w-3xl px-4 py-6">
    <p className="text-14 leading-relaxed" data-testid="aidt-chat-welcome">{interviewStarter[interviewPhase]}</p>
  </div>;
  if (step?.id === 1) return <div data-testid="copilotkit-v2-empty" className="flex min-h-full flex-col items-center justify-center gap-4 px-5 py-6">
    <div className="space-y-2 text-center" data-testid="aidt-chat-welcome">
      <h2 className="text-24 font-semibold tracking-tight sm:text-30">{starter.heading}</h2>
      <p className="text-14 text-muted-foreground">{starter.intro}</p>
    </div>
    <dl className="space-y-2 rounded-container bg-muted px-4 py-3 text-13" data-testid="aidt-input-scaffold">
      {starter.prompts.map(prompt => <div key={prompt.label} className="flex flex-wrap gap-x-2">
        <dt className="font-semibold">{prompt.label}</dt><dd>{prompt.hint}</dd>
      </div>)}
    </dl>
    {offerInitial && <Button type="button" variant="outline" onClick={() => {
      const result = offerInitial(starter.draftTemplate);
      setStatus(result === "accepted" ? "提纲已放入输入框。填写后可发送。" : result === "occupied" ? "保留了你正在输入的内容。" : "输入框正在准备，请稍后再试。");
    }}>填入回答提纲</Button>}
    <p role="status" className="text-12 text-muted-foreground empty:hidden">{status}</p>
  </div>;
  const start = step ? STUDENT_START[step.id] : null;
  return <div data-testid="copilotkit-v2-empty" className="flex min-h-full flex-col items-center justify-center gap-4 px-4 py-4 text-center sm:px-6">
    <div className="flex flex-col items-center gap-2" data-testid="aidt-chat-welcome">
      <p className="max-w-xl text-24 font-semibold tracking-tight text-card-foreground sm:text-30">先说说你们的想法</p>
      <p className="max-w-lg text-14 leading-relaxed text-muted-foreground">{start?.hint ?? "从一次具体的观察或经历开始。"}</p>
    </div>
    {start && <details className="w-full max-w-lg text-left text-13 text-muted-foreground">
      <summary className="cursor-pointer text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">不知道怎么开始？</summary>
      <p className="mt-4">按当前进度填已有内容，不确定可如实写下；不用一次填完。</p>
      <p data-testid="aidt-input-scaffold" className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-3">{start.scaffold}</p>
      <p data-testid="aidt-step-deliverable" className="mt-3">本步带走：{start.outcome}</p>
    </details>}
  </div>;
}
