import type { BackflowEntry } from "@/lib/live-projects";

/** Chinese remains owned by the accepted legacy metadata; English is a display-only projection. */
export const projectResultsBackflowEn: Record<BackflowEntry["badge"], string> = {
  draft: "Draft",
  live: "Live · follows source",
  pinned: "Pinned",
};

export const projectResultsZhCN = {
  "projectResults.destinations": "成果去向",
  "projectResults.audit": "审计与反馈",
  "projectResults.soon": "即将开放",
  "projectResults.conclusion": "项目结论",
  "projectResults.conclusionHelp": "结论正文和签字人会显示在这里。",
  "projectResults.hypotheses": "假设状态",
  "projectResults.hypothesesHelp": "已验证 / 待验证 / 已推翻各有多少条。",
  "projectResults.publish": "发布结论",
  "projectResults.publishHelp": "真正可用之前这里不放按钮，以免让人误以为已经发布。",
  "projectResults.decisions": "候选决策",
  "projectResults.decisionsHelp": "转写里待签署的决策会列在这里，签署前可以回听。",
  "projectResults.destinationsLoading": "读取回流列表中…",
  "projectResults.signIn": "登录后才能查看，请重新登录后再试。",
  "projectResults.destinationsEmpty": "暂无已回流的产出",
  "projectResults.auditLoading": "读取审计事件中…",
  "projectResults.auditEmpty": "本项目还没有审计事件，不生成示例条目",
  "projectResults.backflowMeta": "已回流到项目的产出",
  "projectResults.auditMeta": "仅本项目 · 不可删除",
  "projectResults.soonMeta": "还在路上，不会出现示例数据",
  "projectResults.destinationsError": "回流列表读取失败：",
  "projectResults.auditError": "审计事件读取失败：",
  "projectResults.version": "版本 {version}",
  "projectResults.unauthorized": "越权尝试",
  "projectResults.auditTotal": "共 {count} 条",
  "projectResults.actor": "操作者"
} as const;

export const projectResultsEn: Record<keyof typeof projectResultsZhCN, string> = {
  "projectResults.destinations": "Output destinations",
  "projectResults.audit": "Audit and feedback",
  "projectResults.soon": "Coming soon",
  "projectResults.conclusion": "Project conclusions",
  "projectResults.conclusionHelp": "Conclusion text and signatories will appear here.",
  "projectResults.hypotheses": "Hypothesis status",
  "projectResults.hypothesesHelp": "Counts of validated, unvalidated and refuted hypotheses.",
  "projectResults.publish": "Publish conclusions",
  "projectResults.publishHelp": "No publish button is shown until publishing is available, to avoid implying that a conclusion has been published.",
  "projectResults.decisions": "Candidate decisions",
  "projectResults.decisionsHelp": "Decisions awaiting signature from transcripts will appear here, with playback before signing.",
  "projectResults.destinationsLoading": "Loading backflow outputs…",
  "projectResults.signIn": "Sign in again to view this information.",
  "projectResults.destinationsEmpty": "No backflow outputs yet",
  "projectResults.auditLoading": "Loading audit events…",
  "projectResults.auditEmpty": "This project has no audit events yet. No sample entries are generated.",
  "projectResults.backflowMeta": "Outputs returned to this project",
  "projectResults.auditMeta": "This project only · immutable",
  "projectResults.soonMeta": "Not available yet; no sample data is shown",
  "projectResults.destinationsError": "Unable to load backflow outputs: ",
  "projectResults.auditError": "Unable to load audit events: ",
  "projectResults.version": "Version {version}",
  "projectResults.unauthorized": "Unauthorized attempt",
  "projectResults.auditTotal": "{count} events",
  "projectResults.actor": "Actor"
};
