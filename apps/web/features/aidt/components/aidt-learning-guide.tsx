"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AidtStep } from "@/features/aidt/lib/project-aidt";

const QUESTIONS: Record<number, readonly string[]> = {
  1: ["先写自己的初始命题：为什么这是一个值得研究的问题？", "问题来自亲自观察、听到抱怨，还是某种猜测？不清楚也可以如实记录。", "再讨论帮助谁、在哪个场景，由本组重写研究主题。"],
  2: ["最初的选题理由与猜测中，我们真正还不了解什么？", "先写自己的访谈问题：怎样问具体经历，而不暗示答案？", "获得同意后，怎样保留原话与来源，并先写自己的发现？"],
  3: ["访谈中，哪些发现与之前的想法不同或让你意外？关联材料，暂无也可以。", "先填画像初稿：哪些有依据，哪些未知？保留矛盾和例外。", "经过教师引导，哪个‘我们如何能够…’问题值得本组选择？"],
  4: ["每个人先提出自己的点子，再选择一种方法继续发散。", "哪些最容易实现、最具突破性、最有趣？可多标签，由学生说明理由。", "分类与投票分开；至少整理三个不同点子的描述单，再选择原型方向。"],
  5: ["通过这次制作原型，你最想知道什么？先记录自己的看法与依据。", "哪种静态方案能帮助观察这个问题？哪些真实行为还不能证明？", "确认问题后再生成；选定版本，连同原问题和先前看法交给测试。"],
  6: ["围绕同一验证问题实际观察到什么？被测版本与原始记录在哪里？", "测试之后，你对这个问题的认识有什么变化？暂未改变或证据不足也可记录。", "从之前五步的哪一步重新入手，为什么、具体做什么？也可先记录尚未决定。"],
};

export function AidtLearningStart({ step }: { step: AidtStep }) {
  return <section className="mx-auto w-full max-w-2xl space-y-2 px-4 py-3 text-left" data-testid="aidt-learning-start">
    <h2 className="text-16 font-semibold md:text-20">本组先想一想</h2>
    <p className="text-13 text-muted-foreground">先安静地独立思考，再轮流分享；私人经历可以跳过。</p>
    <ol className="list-decimal space-y-2 pl-5 text-14">{QUESTIONS[step.id]?.map((question) => <li key={question}>{question}</li>)}</ol>
    <p className="text-12 text-muted-foreground">在下方输入本组已有的想法。AI 负责追问和提供选项，由你们决定。</p>
  </section>;
}

export function AidtEvidenceGuide() {
  return <aside className="rounded-md border border-border bg-muted/30 p-3 text-12" aria-label="真实证据与隐私" data-testid="aidt-evidence-guide">
    <p className="font-medium">只使用真实、获准分享的研究材料</p>
    <p className="mt-1">记录来源、时间、原话和背景；把观察与解释分开。照片和转录应去除不必要的姓名、联系方式等个人信息。</p>
    <p className="mt-1">AI 模拟采访、生成的图片和假设都不能充当真实采访或测试证据。缺少材料就保留缺口。</p>
    <p className="mt-1">Chat 语音输入只是消息草稿；个人录音由原服务按录音所有者控制，关联小组不代表组员都能读取。真实项目访谈的同意采集入口仍未集成。</p>
  </aside>;
}

export function AidtDecisionGuide({ step }: { step: AidtStep }) {
  const [status, setStatus] = React.useState("");
  const stageReflection: Record<number, string> = {
    1: "选题为什么值得研究：\n问题来源（观察／抱怨／猜测，可多选）：\n来源描述与不确定之处：",
    2: "希望核实的最初判断：\n学生发现与原始材料引用：",
    3: "先前想法与意外发现（可填暂无）：\n对应发现卡与访谈位置：",
    4: "学生分类及理由（容易实现／突破性／有趣，可多标签）：\n分类与投票选择分别记录：",
    5: "本轮最想验证的问题：\n测试前看法与依据：\n原型版本及能／不能验证的范围：",
    6: "原验证问题与被测版本：\n测试前认识 → 测试后认识（可未改变／证据不足）：\n认识变化的依据与未解问题：\n优先返回：1理解问题／2共情用户／3综合定义／4创意发散／5原型制作／尚未决定\n返回理由及下一轮具体行动：\n回前四步或未决定时保留旧原型，不强制生成新版：",
  };
  const template = `第${step.id}步 · ${step.title}\n本组选择：\n选择理由：\n真实证据与来源（没有则写缺口）：\n${stageReflection[step.id] ?? ""}\n原假设 → 新假设：\n改变想法的依据：\n不同意见或尚未决定的内容：\n需要老师帮助的问题（定义/发散/证据/可行性）：\n下一步行动与返回步骤：`;
  async function copy() {
    try { await navigator.clipboard.writeText(template); setStatus("已复制模板。请填写后发送到本步共享对话；复制不代表已保存或全组确认。"); }
    catch { setStatus("未能复制。请手动选择下方模板，复制到聊天输入框；当前尚未保存。"); }
  }
  return <details className="mt-2" data-testid="aidt-decision-guide"><summary className="cursor-pointer">记录本组决定与不同意见</summary>
    <p className="my-2">先听取组员意见，由人作决定。将填写后的内容发送到本步共享对话，或使用原生产出物功能保留来源；AI 不代替全组确认；票数也不能代替证据和理由。</p><p className="my-2">共享 Chat 会显示发言身份，本页未启用匿名提交或小组投票。需要匿名收集时请先与老师确认工具及隐私范围。</p>
    <Textarea aria-label="本组决定模板" className="min-h-40 text-12" readOnly value={template} />
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()} className="mt-2">复制模板</Button>
    <p role="status" aria-live="polite" className="mt-1">{status}</p>
  </details>;
}
