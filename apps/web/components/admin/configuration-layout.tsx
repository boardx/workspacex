"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export const configurationGroups = {
  system: ["平台能力与治理", "AI 基础配置", "数据治理"],
  module: ["订阅与套餐", "积分", "支付渠道", "聊天", "Agent 与 Skill", "研究", "访谈", "问卷", "画布", "项目", "知识图谱与检索", "录音与转录", "Workflow", "反馈", "运行诊断", "组织首页"],
} as const;

const english: Record<(typeof configurationGroups)[ConfigurationCategory][number], string> = {
  "平台能力与治理": "Platform governance", "AI 基础配置": "AI defaults", "数据治理": "Data governance",
  "订阅与套餐": "Subscriptions", "积分": "Credits", "支付渠道": "Payment channels", "聊天": "Chat",
  "Agent 与 Skill": "Agents and skills", "研究": "Research", "访谈": "Interviews", "问卷": "Surveys",
  "画布": "Canvas", "项目": "Projects", "知识图谱与检索": "Knowledge graph and retrieval",
  "录音与转录": "Recording and transcription", Workflow: "Workflow", "反馈": "Feedback",
  "运行诊断": "Diagnostics", "组织首页": "Organization home",
};

export type ConfigurationCategory = keyof typeof configurationGroups;

export function ConfigurationLayout({
  category, group, onCategory, onGroup, chinese, children,
}: {
  category: ConfigurationCategory;
  group: string;
  onCategory: (category: ConfigurationCategory) => void;
  onGroup: (group: string) => void;
  chinese: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex gap-2 border-b border-border pb-3" aria-label={chinese ? "配置类型" : "Configuration type"} role="group">
        {(["system", "module"] as const).map((key) => (
          <Button key={key} data-testid={`configuration-${key}`} type="button" aria-pressed={category === key}
            variant={category === key ? "secondary" : "ghost"} onClick={() => onCategory(key)}>
            {key === "system" ? (chinese ? "系统配置" : "System settings") : (chinese ? "模块配置" : "Module settings")}
          </Button>
        ))}
      </div>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label={chinese ? "配置分组" : "Configuration groups"} className="flex flex-wrap gap-1 rounded-control border border-border bg-card p-2 lg:flex-col">
          {configurationGroups[category].map((name, index) => (
            <Button key={name} data-testid={`configuration-group-${index}`} type="button"
              className="h-auto justify-start whitespace-normal py-2 text-left" aria-pressed={group === name}
              variant={group === name ? "secondary" : "ghost"} onClick={() => onGroup(name)}>
              {chinese ? name : english[name]}
            </Button>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
