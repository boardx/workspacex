"use client";

/**
 * 试运行抽屉 —— 人类 2026-08-26 的原话：「在编辑界面需要有一个试运行的按钮，
 * 用户输入数据需要可以渲染出来结果」。
 *
 * ## 输入的形状不是我编的，是模板自己声明的
 *
 * 文本框里那份 JSON 的键，逐个来自各分区的 `key`；列表分区是数组、文本分区是字符串。
 * 换句话说：**试运行喂进去的，正是运行时 AI 被要求吐出来的那个形状**。这让试运行能
 * 回答一个别的办法回答不了的问题——「模型按我这份 schema 吐回来，画布上装得下吗」。
 *
 * ⚠ 因此这里**不做**"智能容错"（不把 `{a:1}` 当 `{items:[1]}` 猜）。猜对了人类以为
 *   模板宽容，等真跑起来模型吐的同样形状却没人猜，画布就是空的。形状不对就当场说不对。
 *
 * ## 骨架按需生成，不缓存
 *
 * 「填充示例」每次点都从**当前** sections 重算。缓存一份会在人类改完 key 之后继续吐旧键名——
 * 而那份 JSON 看起来完全正常，只是渲染出来永远是空贴纸。
 */

import * as React from "react";
import type { SectionDraft } from "./template-editor-model";

/** 当前分区 → 一份能直接渲染出东西的 JSON 骨架。 */
export function buildDryRunSkeleton(sections: readonly SectionDraft[]): string {
  const obj: Record<string, unknown> = {};
  for (const s of sections) {
    if (!s.key) continue;
    if (s.type === "便利贴列表") {
      const n = Math.min(3, s.layout?.max ?? 3);
      obj[s.key] = Array.from({ length: n }, (_, i) => `${s.name || s.key} ${i + 1}`);
    } else {
      obj[s.key] = `${s.name || s.key} 的内容`;
    }
  }
  return JSON.stringify(obj, null, 2);
}

export type DryRunParse =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly message: string };

/**
 * 解析人类输入。**顶层必须是对象**——数组或裸字符串在这里没有可对应的分区键，
 * 与其渲染出一张空画布让人以为"模板不认这份数据"，不如直接说清楚它形状不对。
 */
export function parseDryRunInput(text: string): DryRunParse {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, message: "还没有输入数据" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, message: `不是合法的 JSON：${e instanceof Error ? e.message : String(e)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "顶层要是一个对象 { 字段名: 内容 }，不是数组或单值" };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
}

/**
 * 数据里有、模板里没有的键。
 *
 * 这是试运行最常撞的一种错，而它**完全无声**：多出来的键不会报错，只是那段内容
 * 在画布上不出现。人类看到的是"我明明填了却没显示"，查不出原因。
 */
export function unknownKeysOf(
  data: Readonly<Record<string, unknown>>,
  sections: readonly SectionDraft[],
): readonly string[] {
  const known = new Set(sections.map((s) => s.key).filter((k): k is string => Boolean(k)));
  return Object.keys(data).filter((k) => !known.has(k));
}

export function TemplateDryRunDrawer({
  sections, text, onTextChange, onRun, onClose,
}: {
  readonly sections: readonly SectionDraft[];
  readonly text: string;
  readonly onTextChange: (next: string) => void;
  readonly onRun: (data: Record<string, unknown> | null) => void;
  readonly onClose: () => void;
}) {
  const parsed = React.useMemo(() => parseDryRunInput(text), [text]);
  const unknown = parsed.ok ? unknownKeysOf(parsed.data, sections) : [];

  return (
    <aside
      className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card p-4"
      data-testid="tpladmin-editor-dryrun-drawer"
      aria-label="试运行"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-13 font-bold">试运行</h3>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="tpladmin-editor-dryrun-close"
        >
          关闭
        </button>
      </div>

      <p className="text-11 leading-relaxed text-muted-foreground">
        填一份数据，看它在 A1 纸上真正长什么样。这里的字段名就是运行时 AI 要吐出来的那些。
      </p>

      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
        className="h-[280px] w-full resize-none rounded-control border border-border bg-background p-2 font-mono text-11 leading-relaxed transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="tpladmin-editor-dryrun-input"
        aria-label="试运行数据"
      />

      {!parsed.ok && text.trim() !== "" && (
        <p className="text-11 text-destructive" data-testid="tpladmin-editor-dryrun-error">
          {parsed.message}
        </p>
      )}
      {unknown.length > 0 && (
        <p className="text-11 text-destructive" data-testid="tpladmin-editor-dryrun-unknown">
          {`这些字段模板里没有，画不出来：${unknown.join("、")}`}
        </p>
      )}

      <div className="mt-auto flex gap-2">
        <button
          type="button"
          onClick={() => onTextChange(buildDryRunSkeleton(sections))}
          className="rounded-control border border-border px-3 py-1.5 text-11 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="tpladmin-editor-dryrun-fill"
        >
          填充示例
        </button>
        <button
          type="button"
          disabled={!parsed.ok}
          onClick={() => onRun(parsed.ok ? parsed.data : null)}
          className="rounded-control bg-primary px-3 py-1.5 text-11 text-primary-foreground transition-colors duration-fast hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          data-testid="tpladmin-editor-dryrun-run"
        >
          渲染
        </button>
        <button
          type="button"
          onClick={() => onRun(null)}
          className="ml-auto rounded-control px-3 py-1.5 text-11 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="tpladmin-editor-dryrun-clear"
        >
          还原
        </button>
      </div>
    </aside>
  );
}
