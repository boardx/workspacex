"use client";

import type { AidtStep } from "../lib/project-aidt";

const STUDENT_START: Record<AidtStep["id"], { hint: string; scaffold: string; outcome: string }> = {
  1: { hint: "先用一句原始命题，说说你们想研究的事。接着讨论为什么值得研究、想法从哪来。", scaffold: "原始命题：____\n选题理由：____\n来源（观察／听到抱怨／猜测，可多选）：____\n还不清楚：____", outcome: "学生重写的研究主题、选题理由与来源；确认方向仍不代表已验证。" },
  2: { hint: "先贴出你们自己拟的访谈问题初稿；已有真实材料，也可以直接从自己的发现继续。", scaffold: "想了解：____\n访谈问题初稿：____\n已有材料时：受访者代号 ____；原话与位置 ____；我的发现 ____", outcome: "采纳后的访谈清单、每位受访者一张人物发现卡；缺失材料明确保留。" },
  3: { hint: "先回看发现卡：什么与你们先前想法不同？暂无也可以，再继续画像与HMW。", scaffold: "原先想法：____\n意外发现＋材料位置，或“暂无”：____\n画像初稿：____（未知可留未知）\n我们如何帮助 ____ 改善 ____？", outcome: "意外发现或暂无、学生确认的画像与HMW，以及材料引用。" },
  4: { hint: "围绕选定的HMW，贴出你们自己的第一轮想法。一个点子一行，还粗糙也可以。", scaffold: "本轮HMW：____\n点子名｜做什么｜怎样帮助用户\n____｜____｜____", outcome: "至少三个不同点子的描述单、学生分类与原型选择；打印后可另存PDF。" },
  5: { hint: "先说清选中的点子，以及通过这次原型最想知道什么；再决定做成什么形式。", scaffold: "入选点子／描述单：____\n最想知道什么：____\n目前看法与依据：____\n原型形式与使用情境：____", outcome: "绑定验证问题与先前看法的静态原型版本，状态为待测试。" },
  6: { hint: "先核对被测版本与原验证问题。准备测试就贴问题初稿，测试过就从真实反馈与反思继续。", scaffold: "被测版本＋原验证问题：____\n测试问题初稿，或真实反馈与来源：____\n认识变化：____（可未改变／证据不足）\n下一步及理由：____（可尚未决定）", outcome: "测试前后认识与下一轮行动；回前四步无需先生成新原型。" },
};

/** Teaching copy belongs to this host; composer/messages remain canonical Chat. */
export function AidtChatEmptyState({ step }: { step?: AidtStep } = {}): JSX.Element {
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
