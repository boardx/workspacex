import { FileText, Users, Clock3, Target, CircleHelp, Lightbulb, CalendarDays, MapPin, LayoutGrid } from "lucide-react";

export function ResearchPrototypeTips({ topic = false }: { topic?: boolean }) {
  const rows = topic ? [
    [FileText, "研究主题", "建议明确行业、区域、对象和核心问题"],
    [Target, "研究目标", "说明你希望通过本研究解决什么问题"],
    [CalendarDays, "时间范围", "选择合适的时间范围，便于聚焦分析"],
    [MapPin, "研究区域", "可以是国家、地区或全球范围"],
    [LayoutGrid, "重点关注", "选择你最关心的维度（可多选），帮助我们更精准地规划研究内容"],
  ] as const : [
    [FileText, "研究目标", "希望解决的问题、预期的研究成果"],
    [Users, "研究区域 / 对象", "行业、地区、人群或具体研究对象"],
    [Clock3, "时间范围", "关注的时间段（例如：近 3 年、2020—2024 年等）"],
    [Target, "重点关注", "你最关心的维度（例如：市场规模、竞争格局、发展趋势等）"],
    [CircleHelp, "关键问题", "你希望从研究中获得的核心结论或答案"],
  ] as const;
  return <aside className="rounded-xl border border-border bg-card p-6 shadow-sm lg:p-7">
    <h2 className="flex items-center gap-3 text-[30px] font-bold"><Lightbulb className="size-8" aria-hidden />小提示</h2>
    <p className="mt-4 border-b border-border pb-5 text-lg leading-relaxed text-muted-foreground">{topic ? "清晰、具体的研究主题有助于 AI 生成更有针对性的研究计划。" : "提供越详细的背景信息，AI 生成的研究计划将越精准、越有针对性。"}</p>
    <h3 className="mb-4 mt-5 text-lg font-semibold">你可以从以下方面{topic ? "完善信息" : "描述"}：</h3>
    <div className="space-y-5">{rows.map(([Icon, title, description]) => <div key={title} className="flex gap-4"><span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-7" aria-hidden /></span><div><h4 className="text-[16px] font-semibold">{title}</h4><p className="mt-1 text-base leading-relaxed text-muted-foreground">{description}</p></div></div>)}</div>
    {!topic && <div className="mt-6 border-t border-border pt-4 text-sm leading-relaxed"><h3 className="font-semibold">输入方式支持：</h3><ul className="mt-2 list-inside list-disc text-muted-foreground"><li>直接输入文本描述</li><li>上传 PDF、Word、PPT、Excel、TXT 等文件</li><li>通过语音实时输入</li></ul><p className="mt-3 text-muted-foreground">AI 会自动提取关键信息，生成结构化的研究计划。</p></div>}
  </aside>;
}
