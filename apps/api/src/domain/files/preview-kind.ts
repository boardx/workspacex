/**
 * F32 -- which of the five previewers a version gets, decided from its MIME type.
 *
 * Innermost layer: no I/O, no HTTP, no PostgreSQL. It is a total function from a MIME string
 * onto the SIGNED `files.PreviewKind`, and it is a separate file from the use case precisely
 * so that the mapping can be driven exhaustively without a database.
 *
 * ## The five previewers are the contract's five, and nothing here widens them
 *
 * `files.PreviewKind` is `pdf | image | audio | text | jsonl | unsupported`. The
 * `feature_list.json` entry for F32 names the same five plus the refusal:
 * 「PDF / 图片 / 音频 / 文本Markdown / JSONL」. Those two agree, and this file adds no sixth.
 *
 * ## 🔴 D13 -- the contract has SIX values and the prototype view type has EIGHT
 *
 * `apps/web/lib/contract-divergences.ts` D13 registers it: the view side
 * (`apps/web/lib/mock/files.ts` `FileItem["preview"]`) additionally has `markdown` and `csv`,
 * and `contracts/files/ui.md` even declares a `files-preview-csv` testid. The divergence note
 * says exactly what is at stake -- 「同一个 .md 文件在两套定义下用户看到的东西不同」 -- and
 * asks whether those two need their own previewers.
 *
 * **This file does not answer that question, and it does not extend the enum.** What it does
 * is spell out what the SIGNED six values force, so that the consequence is visible instead of
 * accidental:
 *
 *   * `text/markdown` -> `text`. Forced, not chosen: the contract has no `markdown` member, so
 *     the only two representable answers are `text` and `unsupported`, and the AUTHORITATIVE
 *     `feature_list.json` says verbatim that the fourth previewer is 「文本Markdown」 -- a .md
 *     file previews. Answering `unsupported` here would contradict the feature this file is
 *     implementing.
 *   * `text/csv` -> `unsupported`. Also forced: the contract has no `csv` member and the five
 *     previewers in `user_visible_behavior` do not include CSV. So under the contract a .csv
 *     file shows 「此类型不支持预览，请下载查看」 while the prototype renders it as a table.
 *     ⚠ **That is D13's user-visible difference, live.** It is reported, not smoothed over,
 *     and `tests/files/preview-five-types.test.ts` pins it so it cannot silently flip either
 *     way before the ruling lands.
 *
 * ⇒ D13 still needs the human ruling. What it decides is whether the view's `csv` pane is
 *   deleted or the SIGNED `PreviewKind` gains a seventh value; the code below is the
 *   contract-faithful branch in the meantime, not a vote.
 *
 * ## Why the default is `unsupported` + `isolated-attachment` and not "best effort"
 *
 * `PreviewRenderMode` exists for one reason (contract, verbatim): an unknown type is served
 * `Content-Disposition: attachment` from an ISOLATED domain and is never rendered inline on the
 * main origin -- XSS, SVG script injection, inline HTML. A mapping that guessed "it's probably
 * text, show it" would be the vulnerability. So the fall-through is closed, and
 * `image/svg+xml` is called out explicitly below because it is the one MIME that would
 * otherwise be swept up by the `image/` prefix and rendered inline.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";

export type PreviewKind = z.infer<typeof C.PreviewKind>;
export type PreviewRenderMode = z.infer<typeof C.PreviewRenderMode>;

export interface PreviewDecision {
  readonly kind: PreviewKind;
  readonly renderMode: PreviewRenderMode;
  /** Can a citation point INTO this preview (page number, timecode, line)? */
  readonly anchorSupport: boolean;
}

/**
 * Exact MIME matches, checked before any prefix rule.
 *
 * ⚠ `image/svg+xml` is here and it maps to `unsupported`. An SVG is an image by MIME and a
 * script host by capability; the `image/` prefix below would hand it to the inline image
 * previewer, which is precisely the 「防 SVG 脚本注入」 case the contract names. Being an
 * exact match, it wins over the prefix -- and `preview-five-types.test.ts` asserts that
 * ordering rather than trusting the reader to notice it.
 */
const EXACT: Readonly<Record<string, PreviewKind>> = {
  "application/pdf": "pdf",
  "image/svg+xml": "unsupported",

  // JSONL -- the conversation/transcript shape, rendered as one row per line.
  "application/jsonl": "jsonl",
  "application/x-ndjson": "jsonl",
  "application/x-jsonlines": "jsonl",

  // See the header: forced by the six-value enum, registered as D13.
  "text/markdown": "text",
  "text/csv": "unsupported",

  "application/json": "text",
};

/** Prefix rules, applied only after `EXACT` misses. */
const PREFIXES: readonly (readonly [string, PreviewKind])[] = [
  ["image/", "image"],
  ["audio/", "audio"],
  ["text/", "text"],
];

/**
 * Anchor support per kind -- 「可召回」 is per previewer, not per file.
 *
 * pdf = page number, audio = timecode, jsonl = message id. Those three are the anchors
 * `uc-22-1` names. `image` and `text` have no locator the citation layer can address today,
 * and claiming otherwise would make `anchorSupport: true` a promise nothing keeps.
 */
const ANCHORABLE: ReadonlySet<PreviewKind> = new Set<PreviewKind>(["pdf", "audio", "jsonl"]);

/**
 * Normalise a MIME header value: `text/plain; charset=utf-8` is `text/plain`.
 *
 * Done here rather than at every call site, because a parameterised MIME arriving unnormalised
 * would fall through to `unsupported` -- a refusal screen for an ordinary .txt file, caused by
 * a semicolon.
 */
function baseType(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

export function decidePreview(mime: string): PreviewDecision {
  const base = baseType(mime);
  const exact = EXACT[base];
  const kind: PreviewKind =
    exact ?? PREFIXES.find(([p]) => base.startsWith(p))?.[1] ?? "unsupported";

  return {
    kind,
    // The whole point of the mode: anything we will not render is served as a download from
    // an isolated origin. There is no third branch and no "inline if it looks safe".
    renderMode: kind === "unsupported" ? "isolated-attachment" : "inline",
    anchorSupport: ANCHORABLE.has(kind),
  };
}

/**
 * The five previewers, as data.
 *
 * Derived from the contract enum by removing the refusal, so it cannot drift from
 * `PreviewKind`: add a seventh contract value and this grows with it.
 */
export const PREVIEWABLE_KINDS: readonly PreviewKind[] = C.PreviewKind.options.filter(
  (k): k is PreviewKind => k !== "unsupported",
);
