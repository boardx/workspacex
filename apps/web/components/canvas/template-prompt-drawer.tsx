"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { suggestCanvasTemplateSections } from "@/lib/live-canvas";
import { buildOutputSchemaText, type SectionDraft, type SectionFieldType } from "./template-editor-model";

/**
 * 第一步 · 提示词与字段（R3，2026-08-26）——`Design.pdf` §4.1「提示词抽屉为三栏浮层」。
 *
 * ① 角色与任务：多行文本，顾问只写这段人话。
 * ② 从提示词提取字段：解析提示词，给出候选字段列表，每条含 `{{token}}`、中文名、
 *    类型、以及**提取依据**。已存在的标「已在字段表」，其余可单条加入或「全部加入」。
 * ③ 输出结构（只读，自动生成）：键名来自字段表，列表型的条数上限取对应 block 的 max。
 *    **顾问永不手写 JSON。**
 *
 * ⚠ 第②栏的候选来自服务端 `suggestTemplateSections`（真实模型调用），不是前端编一份
 *   关键词表——那样"提取依据"就是假的。模型不可用时如实回显 reasonCode，不降级成
 *   一份编出来的候选（本仓「不得伪装成功」纪律）。
 */
export interface ExtractedField {
  readonly key: string;
  readonly name: string;
  readonly type: SectionFieldType;
  readonly why: string;
}

export function TemplatePromptDrawer({
  promptText, sections, editable, onPromptChange, onAddFields, onClose,
}: {
  readonly promptText: string;
  readonly sections: readonly SectionDraft[];
  readonly editable: boolean;
  readonly onPromptChange: (next: string) => void;
  readonly onAddFields: (fields: readonly ExtractedField[]) => void;
  readonly onClose: () => void;
}) {
  const [extracted, setExtracted] = React.useState<readonly ExtractedField[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const existingKeys = React.useMemo(() => new Set(sections.map((s) => s.key)), [sections]);

  async function extract(): Promise<void> {
    if (promptText.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const out = await suggestCanvasTemplateSections({ prompt: promptText.slice(0, 200) });
      setExtracted(out.sections.map((s, i) => ({
        key: keyFor(s.name, i),
        name: s.name,
        type: (s.type ?? "便利贴列表") as SectionFieldType,
        why: s.why ?? "模型未给出提取依据",
      })));
    } catch (e) {
      setError(e instanceof ApiError ? `${e.reasonCode ?? "无 reasonCode"}（HTTP ${e.status}）` : String(e));
    } finally {
      setBusy(false);
    }
  }

  const fresh = (extracted ?? []).filter((f) => !existingKeys.has(f.key));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" data-testid="tpladmin-editor-prompt-drawer">
      <div className="flex h-[640px] w-full max-w-[1080px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex flex-none items-center gap-3 border-b border-border px-5 py-3.5">
          <span className="text-14 font-bold">提示词 · 字段从这里来</span>
          <span className="text-11 text-muted-foreground">写清要 AI 干什么 → 提取字段 → 输出结构自动生成</span>
          <Button size="sm" variant="primary" className="ml-auto" onClick={onClose} data-testid="tpladmin-editor-prompt-done">完成</Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ① 角色与任务 */}
          <div className="flex w-[430px] flex-none flex-col gap-2.5 border-r border-border p-4">
            <span className="text-9 font-bold uppercase tracking-wider text-muted-foreground">角色与任务（顾问写这一段）</span>
            <textarea
              className="flex-1 resize-none rounded-card border border-border bg-background p-3 text-12 leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled"
              value={promptText}
              disabled={!editable}
              onChange={(e) => { onPromptChange(e.target.value); setExtracted(null); }}
              placeholder="你是工作坊引导师。基于访谈记录，为一位具体用户填写……"
              data-testid="tpladmin-editor-prompt-text"
            />
            <Button
              size="sm"
              variant="primary"
              disabled={!editable || busy || promptText.trim().length === 0}
              onClick={() => void extract()}
              data-testid="tpladmin-editor-prompt-extract"
            >
              {busy ? "正在提取…" : extracted ? "重新提取" : "从提示词提取字段"}
            </Button>
            {error && (
              <span className="text-10 text-destructive" role="alert" data-testid="tpladmin-editor-prompt-error">{error}</span>
            )}
          </div>

          {/* ② 读出来的字段 */}
          <div className="flex w-[330px] flex-none flex-col gap-2 border-r border-border p-4">
            <div className="flex items-center gap-2">
              <span className="text-9 font-bold uppercase tracking-wider text-muted-foreground">读出来的字段</span>
              {fresh.length > 0 && (
                <Button size="xs" variant="outline" className="ml-auto" onClick={() => onAddFields(fresh)} data-testid="tpladmin-editor-prompt-add-all">
                  全部加入
                </Button>
              )}
            </div>
            <span className="text-11 leading-relaxed text-muted-foreground" data-testid="tpladmin-editor-prompt-count">
              {extracted
                ? `提取到 ${extracted.length} 个字段，${fresh.length} 个是新的`
                : "点左边的按钮，从提示词里读出该有哪些字段"}
            </span>
            <div className="flex flex-1 flex-col gap-1.5 overflow-auto">
              {(extracted ?? []).map((f) => {
                const exists = existingKeys.has(f.key);
                return (
                  <div key={f.key} className="flex flex-col gap-1 rounded-card border border-border p-2" data-testid={`tpladmin-editor-prompt-field-${f.key}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-10 font-bold text-primary">{`{{${f.key}${f.type === "便利贴列表" ? "[]" : ""}}}`}</span>
                      <span className="text-11 font-semibold">{f.name}</span>
                      <Button
                        size="xs"
                        variant={exists ? "ghost" : "primary"}
                        className="ml-auto"
                        disabled={exists}
                        onClick={() => onAddFields([f])}
                        data-testid={`tpladmin-editor-prompt-add-${f.key}`}
                      >
                        {exists ? "已在字段表" : "＋ 加入"}
                      </Button>
                    </div>
                    {/* 「提取依据」——§4.1 点名要有，让顾问看得出这个字段是从哪句话读出来的。 */}
                    <span className="text-10 text-muted-foreground">{f.type} · {f.why}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ③ 输出结构（只读，自动生成） */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 bg-panel p-4">
            <span className="text-9 font-bold uppercase tracking-wider text-muted-foreground">输出结构（自动生成 · 只读）</span>
            <pre
              className="flex-1 overflow-auto whitespace-pre rounded-card border border-border bg-background p-3 font-mono text-11 leading-relaxed"
              data-testid="tpladmin-editor-prompt-schema"
            >
              {buildOutputSchemaText(sections)}
            </pre>
            <span className="text-10 leading-relaxed text-muted-foreground">
              输出结构由字段表 + 每个区块的显示设置推导（条数上限跟着「最多条数」走），顾问只写左边那段人话。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 中文分区名 → AI JSON 键名。
 *
 * ⚠ 模型返回的 `name` 是中文（提示词要求「与使用者同一种语言」），而 `key` 必须是
 *   小写英文+下划线（契约 `SectionDef.key` 的正则）。这里不做音译——音译不稳定且
 *   经常产出难读的串；用 `field_N` 这种明确的占位，让使用者在字段表里自己改成有意义
 *   的 key。已知取舍：自动生成的 key 不好看，但**稳定且合法**，比一个看起来聪明、
 *   偶尔产出非法字符的音译好。
 */
function keyFor(name: string, index: number): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return /^[a-z]/.test(ascii) && ascii.length >= 2 ? ascii.slice(0, 32) : `field_${index + 1}`;
}
