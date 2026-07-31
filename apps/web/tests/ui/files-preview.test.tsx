/**
 * F32 -- the preview panel's client half.
 *
 * The server decides WHICH previewer a version gets (`files.PreviewKind`, six values) and the
 * API tests prove that mapping. What has to be true HERE is different and independent:
 *
 *   1. all five previewers render, driven by the CONTRACT kind rather than by local data;
 *   2. 「不支持预览」 is a visible refusal -- the exact sentence the contract requires, a usable
 *      download button, and **neither a blank pane nor a spinner**;
 *   3. the panel has ONE switch over the preview kind, so the server's answer cannot be
 *      contradicted by a second read of `file.preview`;
 *   4. 🔴 D13 is pinned in both directions, so neither side can quietly move first.
 *
 * ## Why (2) is asserted against the source text as well as the DOM
 *
 * 「不显示空白或转圈」 is a claim about every path, not about the one this test entered. A
 * component that renders a spinner on a code path the test does not reach satisfies a DOM-only
 * assertion perfectly. So the panel's source is read and searched, the same technique
 * `files-browser.test.tsx` uses for 「已隐藏 N 项」.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { files as C } from "@repo/contracts";
import { FilePreview } from "@/components/files/file-preview";
import {
  TESTID_FOR_CONTRACT_KIND, UNRULED, UNSUPPORTED_PREVIEW_NOTICE, VIEW_FOR_CONTRACT_KIND,
  contractKindForView, type PreviewKind,
} from "@/lib/files/preview-kind";
import { FILES, type FileItem, type PreviewKindView } from "@/lib/mock/files";

/** jsdom has no `file://` `import.meta.url`; vitest runs with the package root as cwd. */
const WEB = process.cwd();
const PANEL_SRC = join(WEB, "components/files/file-preview.tsx");

const noop = () => undefined;

/** A healthy row: not quarantined, integrity ok, READY -- so nothing else blocks the pane. */
const HEALTHY: FileItem = (() => {
  const f = FILES.find((x) => x.ingest === "READY" && !x.quarantineNote && x.integrity !== "failed");
  if (!f) throw new Error("the prototype has no healthy file left to preview");
  return f;
})();

function renderPanel(kind?: PreviewKind, file: FileItem = HEALTHY) {
  return render(
    <FilePreview file={file} depFailed={false} onOpenVersions={noop} onDelete={noop} contractKind={kind} />,
  );
}

describe("the five previewers, driven by the contract kind", () => {
  it("every contract kind renders its own pane", () => {
    for (const kind of C.PreviewKind.options) {
      const { unmount } = renderPanel(kind);
      expect(
        screen.queryByTestId(TESTID_FOR_CONTRACT_KIND[kind]),
        `contract kind "${kind}" rendered no pane`,
      ).not.toBeNull();
      unmount();
    }
  });

  it("NON-VACUITY: the six panes are six DIFFERENT testids", () => {
    // A map that pointed every kind at one testid would satisfy the loop above completely.
    const ids = Object.values(TESTID_FOR_CONTRACT_KIND);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it("🔴 the SERVER's kind wins over the local `file.preview`", () => {
    // The row's own data says `pdf`; the server says `audio`. If the panel read `file.preview`
    // anywhere in the switch, this would render the PDF pane -- a screen that disagrees with
    // the backend while looking entirely normal.
    const pdfRow = FILES.find((f) => f.preview === "pdf" && f.ingest === "READY" && !f.quarantineNote && f.integrity !== "failed")!;
    renderPanel("audio", pdfRow);
    expect(screen.queryByTestId("files-preview-audio")).not.toBeNull();
    expect(screen.queryByTestId("files-preview-pdf")).toBeNull();
  });

  it("...and with no server kind the panel still works off local data", () => {
    // The other half. Without it, a panel that ignored `file.preview` entirely would pass.
    const jsonlRow = FILES.find((f) => f.preview === "jsonl" && f.ingest === "READY")!;
    renderPanel(undefined, jsonlRow);
    expect(screen.queryByTestId("files-preview-jsonl")).not.toBeNull();
  });
});

describe("🔴 unsupported: a visible refusal, never a blank and never a spinner", () => {
  it("shows the contract's exact sentence and a usable download button", () => {
    renderPanel("unsupported");
    const pane = screen.getByTestId("files-preview-unsupported");
    // Verbatim from the contract and from `user_visible_behavior`.
    expect(pane.textContent).toContain(UNSUPPORTED_PREVIEW_NOTICE);
    expect(UNSUPPORTED_PREVIEW_NOTICE).toBe("此类型不支持预览，请下载查看");

    const download = screen.getByTestId("files-preview-download");
    // 「并给下载按钮」 -- present AND not disabled. A greyed-out button is the dead end the
    // refusal exists to avoid.
    expect(download.hasAttribute("disabled")).toBe(false);
  });

  it("the pane is not empty, and there is no spinner ANYWHERE in the panel's source", () => {
    renderPanel("unsupported");
    const pane = screen.getByTestId("files-preview-unsupported");
    expect(pane.textContent?.trim().length ?? 0).toBeGreaterThan(10);

    // The source-text half. A spinner on a path this test never enters is still a spinner.
    // 「转圈是一种谎称『马上就好』的失败态」 -- the contract's own wording.
    const src = readFileSync(PANEL_SRC, "utf8");
    expect(src, "the preview panel ships a spinner").not.toMatch(/animate-spin|Spinner|Loader2|role="progressbar"/);
  });

  it("`files-preview-none` is the EMPTY-SELECTION state, not the refusal", () => {
    /**
     * ⚠ Reported, not silently reconciled.
     *
     * `feature_list.json`'s notes list the F32 anchors as
     * 「files-preview-pdf / image / audio / text / jsonl / NONE / download」 -- i.e. it reads
     * `files-preview-none` as the 「不支持预览」 anchor. It is not: the prototype (and
     * `contracts/files/ui.md`, which the note is derived from) uses `files-preview-none` for
     * 「还没选文件」 and `files-preview-unsupported` for the refusal. `ui.md`'s testid list
     * declares the former and omits the latter.
     *
     * Both testids are real and both render. This test states which is which so that a later
     * reader does not "fix" the anchor list by renaming a live testid.
     */
    render(<FilePreview file={null} depFailed={false} onOpenVersions={noop} onDelete={noop} />);
    const none = screen.getByTestId("files-preview-none");
    expect(none.textContent).not.toContain(UNSUPPORTED_PREVIEW_NOTICE);
    expect(screen.queryByTestId("files-preview-unsupported")).toBeNull();
  });
});

describe("🔴 D13 -- contract SIX values vs view EIGHT, pinned in both directions", () => {
  it("the two vocabularies are still unequal, and the gap is exactly `markdown` + `csv`", () => {
    const contract = [...C.PreviewKind.options].sort();
    const view: PreviewKindView[] =
      ["pdf", "image", "audio", "text", "markdown", "jsonl", "csv", "unsupported"];
    expect(contract).toEqual(["audio", "image", "jsonl", "pdf", "text", "unsupported"]);
    expect(view.filter((v) => !(contract as string[]).includes(v)).sort()).toEqual(["csv", "markdown"]);
  });

  it("forward (contract -> pane) is TOTAL: none of the six is unrenderable", () => {
    for (const k of C.PreviewKind.options) {
      expect(VIEW_FOR_CONTRACT_KIND[k], k).toBeDefined();
    }
  });

  it("backward (view -> contract) is LOSSY, and `csv` is the value that is UNRULED", () => {
    // markdown collapses into `text` -- the only representable answer that does not contradict
    // the authoritative feature_list's 「文本Markdown」.
    expect(contractKindForView("markdown")).toBe("text");
    // 🔴 csv has no contract home. The server can never answer `csv`, so a .csv file arrives
    // as `unsupported` and this panel shows the refusal -- while `files-preview-csv` exists
    // right here and renders a table. Same file, two definitions, two different screens.
    expect(contractKindForView("csv")).toBe(UNRULED);
    // ...and the csv pane really is still in the component, so the divergence is not
    // theoretical.
    const src = readFileSync(PANEL_SRC, "utf8");
    expect(src).toContain("files-preview-csv");
  });

  it("this file does not resolve D13 -- if someone does, this goes red and points at them", () => {
    // Adding `csv` to the contract, or deleting the view's pane, both change one of these.
    expect(C.PreviewKind.options as readonly string[]).not.toContain("csv");
    expect(C.PreviewKind.options as readonly string[]).not.toContain("markdown");
  });
});

describe("the panel has ONE switch over the preview kind", () => {
  it("the source reads the kind from its parameter, not from `file.preview`, inside the switch", () => {
    const src = readFileSync(PANEL_SRC, "utf8");
    // One `switch` over the kind. Two would be two decisions that can disagree, and the
    // symptom is a heading that contradicts the pane below it.
    expect(src.match(/switch \(view\)/g) ?? []).toHaveLength(1);
    expect(src, "`file.preview` is read inside PreviewBody -- that is a second source")
      .not.toMatch(/switch \(file\.preview\)/);
  });
});
