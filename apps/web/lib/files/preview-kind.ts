/**
 * F32 (web) -- the ONE place the contract's `PreviewKind` meets the preview panel.
 *
 * The server answers `files.PreviewKind` (six values). The prototype panel switches on
 * `PreviewKindView` (eight). This file is the single crossing between them, so that the
 * difference lives in one readable place instead of being re-improvised at each call site.
 *
 * ## 🔴 D13 is NOT resolved here
 *
 * `apps/web/lib/contract-divergences.ts` D13: the view has `markdown` and `csv`, the contract
 * has neither, and 「同一个 .md 文件在两套定义下用户看到的东西不同」. This file makes the
 * difference EXECUTABLE rather than settling it:
 *
 *   * forward (contract -> view) is TOTAL and safe: every one of the six has a pane.
 *   * backward (view -> contract) is LOSSY, and `UNRULED` is a real value in its range.
 *     `csv` has no contract home -- the server can never answer `csv`, so a .csv file arrives
 *     as `unsupported` and the panel shows 「此类型不支持预览，请下载查看」 while the prototype's
 *     own `files-preview-csv` pane renders it as a table. That is the divergence, live.
 *
 * `markdown` maps to `text` and that is not a ruling either: the contract has no `markdown`
 * member and the AUTHORITATIVE `feature_list.json` names 「文本Markdown」 as the fourth
 * previewer, so `text` is the only representable answer that does not contradict the feature.
 *
 * ⇒ The human ruling still has to decide whether the view's `csv` pane is deleted or the
 *   SIGNED `PreviewKind` gains a seventh value. `tests/ui/files-preview.test.tsx` pins both
 *   directions so neither can quietly change first.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import type { PreviewKindView } from "@/lib/mock/files";

export type PreviewKind = z.infer<typeof C.PreviewKind>;

/**
 * Contract kind -> the pane the panel renders. Total over the six.
 *
 * `unsupported` deliberately maps to the view's `unsupported`, NOT to `text`: 「不支持预览」 has
 * to be a visible refusal with a download button, and rendering it as an empty text pane is the
 * 「空白或转圈」 the contract forbids by name.
 */
export const VIEW_FOR_CONTRACT_KIND: Readonly<Record<PreviewKind, PreviewKindView>> = {
  pdf: "pdf",
  image: "image",
  audio: "audio",
  text: "text",
  jsonl: "jsonl",
  unsupported: "unsupported",
};

/** The testid each contract kind is expected to render. Read by the panel's test. */
export const TESTID_FOR_CONTRACT_KIND: Readonly<Record<PreviewKind, string>> = {
  pdf: "files-preview-pdf",
  image: "files-preview-image",
  audio: "files-preview-audio",
  text: "files-preview-text",
  jsonl: "files-preview-jsonl",
  unsupported: "files-preview-unsupported",
};

/** ⚠ A view value with no contract home. Not a bug in this file -- see the header. */
export const UNRULED = "UNRULED" as const;

/**
 * View kind -> contract kind, or `UNRULED` when the contract cannot express it.
 *
 * The lossy direction. It exists so that the gap is a value a test can assert on, rather than a
 * `default:` branch somebody quietly widens.
 */
export function contractKindForView(view: PreviewKindView): PreviewKind | typeof UNRULED {
  switch (view) {
    case "pdf": case "image": case "audio": case "text": case "jsonl": case "unsupported":
      return view;
    // See the header: the only representable answer that does not contradict feature_list.
    case "markdown":
      return "text";
    // 🔴 D13, unruled. The contract has no `csv`, so the server answers `unsupported` for a
    // .csv while this app has a table pane for it. Returning "unsupported" here would erase
    // the divergence in the one place it is currently visible.
    case "csv":
      return UNRULED;
  }
}

/**
 * The refusal sentence, verbatim from the contract and the feature's `user_visible_behavior`:
 * 「此类型不支持预览，请下载查看」.
 *
 * A constant rather than a string in JSX, because it is the exact text two documents require
 * and the failure mode of an inline copy is that it drifts into something reasonable-sounding
 * that no longer matches what was signed.
 */
export const UNSUPPORTED_PREVIEW_NOTICE = "此类型不支持预览，请下载查看";
