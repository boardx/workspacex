"use client";

import type { AidtStep } from "../lib/project-aidt";

const STUDENT_INPUT_HINT: Record<AidtStep["id"], string> = {
  1: "先写你们的初始命题：想研究谁、什么场景、什么体验？",
  2: "先贴出你们自己拟的访谈问题初稿，再一起改进。",
  3: "先写用户画像与HMW（我们如何……）初稿，附上已有证据。",
  4: "围绕选定的HMW，先把你们自己脑暴的第一轮点子发来。",
  5: "先说明原型给谁用、什么形式，以及这次要表达或验证什么。",
  6: "先写测试问题，或带着真实反馈说说你们的反思。",
};

/** Teaching copy belongs to this host; composer/messages remain canonical Chat. */
export function AidtChatEmptyState({ step }: { step?: AidtStep } = {}): JSX.Element {
  return <div data-testid="copilotkit-v2-empty" className="flex min-h-full flex-col items-center justify-center gap-4 px-4 py-4 text-center sm:px-6">
    <div className="flex flex-col items-center gap-2" data-testid="aidt-chat-welcome">
      <p className="max-w-xl text-24 font-semibold tracking-tight text-card-foreground sm:text-30">先说说你们的想法</p>
      <p className="max-w-lg text-14 leading-relaxed text-muted-foreground">{step ? STUDENT_INPUT_HINT[step.id] : "从一次具体的观察或经历开始。"}</p>
    </div>
  </div>;
}
