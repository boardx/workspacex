"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Sample = {
  id: string;
  module: string;
  label: string;
  scope: string;
  value: string | { credits: number; days: number };
  numeric?: boolean;
  integer?: boolean;
};

const samples: Sample[] = [
  { id: "rate", module: "积分", label: "积分扣费倍率", scope: "中国市场", value: "1.00" },
  { id: "welcome", module: "积分", label: "欢迎积分", scope: "平台", value: { credits: 1000, days: 30 } },
  { id: "preflight", module: "积分", label: "积分预检", scope: "平台", value: "已开启" },
  { id: "wechat", module: "支付渠道", label: "微信新购", scope: "中国市场", value: "已开启" },
  { id: "personal-month-cn", module: "订阅与套餐", label: "个人订阅月费（CNY）", scope: "中国市场", value: "199", numeric: true },
  { id: "personal-year-cn", module: "订阅与套餐", label: "个人订阅年费（CNY）", scope: "中国市场", value: "1990", numeric: true },
  { id: "team-month-cn", module: "订阅与套餐", label: "团队订阅月费（CNY）", scope: "中国市场", value: "999", numeric: true },
  { id: "team-year-cn", module: "订阅与套餐", label: "团队订阅年费（CNY）", scope: "中国市场", value: "9990", numeric: true },
  { id: "seat-month-cn", module: "订阅与套餐", label: "额外席位月费（CNY）", scope: "中国市场", value: "149", numeric: true },
  { id: "seat-year-cn", module: "订阅与套餐", label: "额外席位年费（CNY）", scope: "中国市场", value: "1490", numeric: true },
  { id: "personal-credits-cn", module: "订阅与套餐", label: "个人订阅每月积分", scope: "中国市场", value: "20000", numeric: true, integer: true },
  { id: "team-credits-cn", module: "订阅与套餐", label: "团队订阅每月积分", scope: "中国市场", value: "100000", numeric: true, integer: true },
  { id: "included-seats-cn", module: "订阅与套餐", label: "团队订阅包含席位", scope: "中国市场", value: "5", numeric: true, integer: true },
  { id: "extra-seat-credits-cn", module: "订阅与套餐", label: "额外席位每月积分", scope: "中国市场", value: "15000", numeric: true, integer: true },
  { id: "pack-small-cn", module: "积分", label: "10,000 积分包（CNY）", scope: "中国市场", value: "129", numeric: true },
  { id: "pack-medium-cn", module: "积分", label: "50,000 积分包（CNY）", scope: "中国市场", value: "599", numeric: true },
  { id: "pack-large-cn", module: "积分", label: "200,000 积分包（CNY）", scope: "中国市场", value: "2199", numeric: true },
  { id: "personal-month-us", module: "订阅与套餐", label: "个人订阅月费（USD）", scope: "美国市场", value: "29", numeric: true },
  { id: "personal-year-us", module: "订阅与套餐", label: "个人订阅年费（USD）", scope: "美国市场", value: "290", numeric: true },
  { id: "team-month-us", module: "订阅与套餐", label: "团队订阅月费（USD）", scope: "美国市场", value: "149", numeric: true },
  { id: "team-year-us", module: "订阅与套餐", label: "团队订阅年费（USD）", scope: "美国市场", value: "1490", numeric: true },
  { id: "seat-month-us", module: "订阅与套餐", label: "额外席位月费（USD）", scope: "美国市场", value: "25", numeric: true },
  { id: "seat-year-us", module: "订阅与套餐", label: "额外席位年费（USD）", scope: "美国市场", value: "250", numeric: true },
  { id: "personal-credits-us", module: "订阅与套餐", label: "个人订阅每月积分", scope: "美国市场", value: "20000", numeric: true, integer: true },
  { id: "team-credits-us", module: "订阅与套餐", label: "团队订阅每月积分", scope: "美国市场", value: "100000", numeric: true, integer: true },
  { id: "included-seats-us", module: "订阅与套餐", label: "团队订阅包含席位", scope: "美国市场", value: "5", numeric: true, integer: true },
  { id: "extra-seat-credits-us", module: "订阅与套餐", label: "额外席位每月积分", scope: "美国市场", value: "15000", numeric: true, integer: true },
  { id: "pack-small-us", module: "积分", label: "10,000 积分包（USD）", scope: "美国市场", value: "19", numeric: true },
  { id: "pack-medium-us", module: "积分", label: "50,000 积分包（USD）", scope: "美国市场", value: "89", numeric: true },
  { id: "pack-large-us", module: "积分", label: "200,000 积分包（USD）", scope: "美国市场", value: "329", numeric: true },
  { id: "stripe", module: "支付渠道", label: "Stripe 新购", scope: "美国市场", value: "已开启" },
  { id: "title", module: "聊天", label: "自动标题模型", scope: "平台默认", value: "" },
  { id: "trial", module: "Agent 与 Skill", label: "Skill 试跑模型", scope: "平台默认", value: "" },
  { id: "research", module: "研究", label: "引导研究模型", scope: "平台默认", value: "" },
  { id: "asr", module: "录音与转录", label: "低置信度阈值", scope: "平台默认", value: "0.80" },
  { id: "workflow", module: "Workflow", label: "发布状态", scope: "平台", value: "已发布" },
  { id: "interview", module: "访谈", label: "数字访谈模型", scope: "平台默认", value: "" },
  { id: "survey", module: "问卷", label: "问卷生成模型", scope: "平台默认", value: "" },
  { id: "canvas", module: "画布", label: "模板生成模型", scope: "平台默认", value: "" },
  { id: "project", module: "项目", label: "项目 AI 设置", scope: "示例项目", value: "继承组织设置" },
  { id: "knowledge", module: "知识图谱与检索", label: "抽取模型", scope: "平台默认", value: "" },
  { id: "feedback", module: "反馈", label: "反馈结构化模型", scope: "平台默认", value: "" },
  { id: "diagnostics", module: "运行诊断", label: "错误日志摘要模型", scope: "平台默认", value: "" },
  { id: "home", module: "组织首页", label: "首页主题", scope: "示例组织", value: "默认主题" },
  { id: "quota", module: "平台能力与治理", label: "AI 配额总开关", scope: "平台", value: "已开启" },
  { id: "model", module: "AI 基础配置", label: "平台默认模型", scope: "平台", value: "示例模型" },
  { id: "retention", module: "数据治理", label: "默认文件保留策略", scope: "平台默认", value: "30 天" },
];

const groups = {
  system: ["平台能力与治理", "AI 基础配置", "数据治理"],
  module: ["订阅与套餐", "积分", "支付渠道", "聊天", "Agent 与 Skill", "研究", "访谈", "问卷", "画布", "项目", "知识图谱与检索", "录音与转录", "Workflow", "反馈", "运行诊断", "组织首页"],
} as const;

export function ConfigurationPreview() {
  const [category, setCategory] = useState<keyof typeof groups>("module");
  const [group, setGroup] = useState<string>("积分");
  const [rows, setRows] = useState(samples);
  const [selection, setSelection] = useState<(typeof samples)[number] | null>(null);
  const [draft, setDraft] = useState("");
  const [days, setDays] = useState("");
  const [message, setMessage] = useState("");

  const inheritableModels = new Set(["title", "trial", "research", "interview", "survey", "canvas", "knowledge", "feedback", "diagnostics"]);
  const defaultModel = rows.find((row) => row.id === "model")?.value;
  const inheritsModel = selection !== null && inheritableModels.has(selection.id);
  const isNumber = selection?.numeric === true;
  const allowsDecimal = selection?.id === "rate" || (selection?.numeric === true && !selection.integer);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || (!inheritsModel && !draft.trim())) return;
    let value: (typeof samples)[number]["value"] = draft.trim();
    if (typeof selection.value !== "string") {
      const credits = Number(draft);
      const validityDays = Number(days);
      if (!Number.isSafeInteger(credits) || credits < 1 || !Number.isSafeInteger(validityDays) || validityDays < 1) return;
      value = { credits, days: validityDays };
    }
    setRows((current) => current.map((row) =>
      row.id === selection.id ? { ...row, value } : row,
    ));
    setSelection(null);
    setMessage("示例配置已更新");
  }

  return (
    <section className="flex min-w-0 flex-col gap-5 p-6 text-foreground">
      <header>
        <h1 className="text-2xl font-semibold">配置管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">使用示例数据预览查看和编辑流程。</p>
      </header>
      <div className="flex gap-2 border-b border-border pb-3" aria-label="配置类型" role="group">
        {(["system", "module"] as const).map((key) => (
          <Button key={key} data-testid={`configuration-${key}`} type="button"
            aria-pressed={category === key} variant={category === key ? "secondary" : "ghost"}
            onClick={() => { setCategory(key); setGroup(groups[key][0]); setSelection(null); }}>
            {key === "system" ? "系统配置" : "模块配置"}
          </Button>
        ))}
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="配置分组" className="flex flex-wrap gap-1 rounded-control border border-border bg-card p-2 lg:flex-col">
          {groups[category].map((name, index) => (
            <Button key={name} data-testid={`configuration-group-${index}`} type="button"
              className="justify-start" aria-pressed={group === name} variant={group === name ? "secondary" : "ghost"}
              onClick={() => { setGroup(name); setSelection(null); }}>
              {name}
            </Button>
          ))}
        </nav>
        <div className="min-w-0 overflow-x-auto rounded-control border border-border bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{group}</caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="p-3">配置项</th>
                <th scope="col" className="p-3">作用范围</th>
                <th scope="col" className="p-3">当前生效值</th>
                <th scope="col" className="p-3"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((row) => row.module === group).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <th scope="row" className="p-3 font-medium">{row.label}</th>
                  <td className="p-3">{row.scope}</td>
                  <td className="p-3">{typeof row.value === "string" ? row.value || String(defaultModel ?? "") : `${row.value.credits.toLocaleString("zh-CN")} 积分 · ${row.value.days} 天`}{row.id === "rate" ? "×" : ""}
                    {inheritableModels.has(row.id) && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {row.value === "" ? "使用平台默认" : "使用模块配置"}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <Button data-testid={`configuration-edit-${row.id}`} size="sm" variant="ghost"
                      aria-label={`编辑${row.label}`} onClick={() => { setSelection(row); setDraft(typeof row.value === "string" ? row.value : String(row.value.credits)); setDays(typeof row.value === "string" ? "" : String(row.value.days)); setMessage(""); }}>
                      编辑
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {selection && (
        <aside aria-labelledby="configuration-editor-title"
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-card text-card-foreground shadow-lg">
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-5 p-6">
            <h2 id="configuration-editor-title" className="text-lg font-semibold">编辑{selection.label}</h2>
            <p className="text-sm text-muted-foreground">作用范围 · {selection.scope}</p>
            <label className="grid gap-2 text-sm">
              {typeof selection.value === "string" ? selection.label : "发放积分（积分）"}
              <Input data-testid="configuration-value" required={!inheritsModel} value={draft}
                placeholder={inheritsModel ? `留空使用平台默认：${defaultModel}` : undefined}
                type={selection.id === "rate" || isNumber || typeof selection.value !== "string" ? "number" : "text"}
                min={allowsDecimal ? "0.01" : isNumber || typeof selection.value !== "string" ? 1 : undefined} step={allowsDecimal ? "0.01" : 1}
                onChange={(event) => setDraft(event.target.value)} />
            </label>
            {inheritsModel && (
              <p className="text-sm text-muted-foreground">留空保存会恢复平台默认；填写模型后优先生效。</p>
            )}
            {typeof selection.value !== "string" && (
              <label className="grid gap-2 text-sm">
                有效期（天）
                <Input data-testid="configuration-validity-days" type="number" required min={1} step={1}
                  value={days} onChange={(event) => setDays(event.target.value)} />
              </label>
            )}
            <p className="rounded-control bg-muted p-3 text-sm">
              {selection.id === "rate" ? "保存后对新请求生效，已开始的请求沿用原倍率。" : "此预览中的修改仅在当前页面生效。"}
            </p>
            <div className="mt-auto flex justify-end gap-2 border-t border-border pt-4">
              <Button data-testid="configuration-cancel" type="button" variant="outline" onClick={() => setSelection(null)}>取消</Button>
              <Button data-testid="configuration-save" type="submit">保存并生效</Button>
            </div>
          </form>
        </aside>
      )}
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
    </section>
  );
}
