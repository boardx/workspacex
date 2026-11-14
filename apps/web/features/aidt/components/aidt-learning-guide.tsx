"use client";
import * as React from "react";
import type { AidtStep } from "@/features/aidt/lib/project-aidt";

const QUESTIONS: Record<number, readonly string[]> = {
  1: ["每个人观察到过什么具体困难？", "我们想帮助谁，在什么场景？", "哪些是事实，哪些还只是假设？"],
  2: ["我们真正不了解用户的什么？", "怎样提问，才不会暗示对方回答？", "获得同意后，怎样保留原话与来源？"],
  3: ["哪些真实证据支持这个发现？有没有反例？", "用户画像中哪些内容还没有证据？", "哪个‘我们如何能够…’问题值得本组选择？"],
  4: ["每个人先提出一个自己的点子。", "不同候选方向有什么不同？数量按课堂约定。", "本组按什么标准比较，而不是让 AI 替我们选？"],
  5: ["这次原型只想验证哪一个假设？", "不同制作方向中，哪种静态方案最适合低成本测试？", "测试者需要完成什么任务？"],
  6: ["我们实际观察到什么？原始记录在哪里？", "哪些是观察，哪些是我们的解释？", "下一假设是什么，应该回到哪一步？"],
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
  const template = `第${step.id}步 · ${step.title}\n本组选择：\n选择理由：\n真实证据与来源（没有则写缺口）：\n原假设 → 新假设：\n改变想法的依据：\n不同意见或尚未决定的内容：\n需要老师帮助的问题（定义/发散/证据/可行性）：\n下一步行动与返回步骤：`;
  async function copy() {
    try { await navigator.clipboard.writeText(template); setStatus("已复制模板。请填写后发送到本步共享对话；复制不代表已保存或全组确认。"); }
    catch { setStatus("未能复制。请手动选择下方模板，复制到聊天输入框；当前尚未保存。"); }
  }
  return <details className="mt-2" data-testid="aidt-decision-guide"><summary className="cursor-pointer">记录本组决定与不同意见</summary>
    <p className="my-2">先听取组员意见，由人作决定。将填写后的内容发送到本步共享对话，或使用原生产出物功能保留来源；AI 不代替全组确认；票数也不能代替证据和理由。</p><p className="my-2">共享 Chat 会显示发言身份，本页未启用匿名提交或小组投票。需要匿名收集时请先与老师确认工具及隐私范围。</p>
    <textarea aria-label="本组决定模板" className="min-h-40 w-full rounded-md border border-border bg-background p-2 text-12" readOnly value={template} />
    <button type="button" onClick={() => void copy()} className="mt-2 rounded-md border border-border px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring">复制模板</button>
    <p role="status" aria-live="polite" className="mt-1">{status}</p>
  </details>;
}
