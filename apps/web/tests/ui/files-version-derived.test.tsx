/**
 * F44 -- the version list + derived-object drawer's client half (uc-22-4 R3.a/R3.b).
 *
 * The server/DB half (F44's api tests) proves the model: old versions are never overwritten,
 * old versions stay downloadable, and a derived rerun never touches the original. What has
 * to be true HERE, independently, is what a person actually sees when they click a version
 * number in the file browser:
 *
 *   1. every version is listed, newest first is NOT asserted here (the drawer's own choice)
 *      but EVERY version that exists renders its own row -- none silently dropped;
 *   2. exactly ONE row is marked "当前版本" -- never zero (which version IS current would be
 *      undecidable) and never more than one (two "current" versions is the exact confusion
 *      D-30 exists to prevent -- a reference has no unambiguous target to resolve to);
 *   3. 🔴 every row -- old or current -- carries a working download control and a copyable
 *      SHA-256, because "旧版仍可下载" (R3.a step 2) is a promise about EVERY row, not just
 *      the newest one;
 *   4. a human vs. an agent creator render DISTINGUISHABLY (V10's "agent 上传必须显示 agent
 *      名 + agent_run_id，不得显示成人"), not folded into one generic "由 X 创建" string;
 *   5. derived rows show their `derived_from` VERSION (not the artifact) and a non-empty
 *      generator identity (R3.b step 5);
 *   6. 🔴 the one exception, `embedding`, has NO download control (registered, never
 *      materialized -- R3.b step 4) -- asserted by absence, the same way F32's unsupported-
 *      preview test asserts a control's absence rather than only its presence elsewhere.
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { VersionDrawer } from "@/components/files/version-drawer";
import { FILES, type FileItem } from "@/lib/mock/files";

const noop = () => undefined;

function renderDrawer(file: FileItem) {
  return render(<VersionDrawer file={file} onClose={noop} onToast={noop} />);
}

/** `a-001`: three human versions + two derived (ocr, summary), all downloadable. */
const MULTI_VERSION_FILE = FILES.find((f) => f.id === "a-001")!;
/** `a-010`: agent-created versions (survey materialization) -- the V10 case. */
const AGENT_VERSION_FILE = FILES.find((f) => f.id === "a-010")!;

describe("version list -- every version renders its own row", () => {
  it("renders exactly one `files-version-row` per version, none dropped", () => {
    renderDrawer(MULTI_VERSION_FILE);
    const rows = screen.getAllByTestId("files-version-row");
    expect(rows).toHaveLength(MULTI_VERSION_FILE.versions!.length);
    expect(rows).toHaveLength(3);
  });

  it("🔴 exactly ONE row is the current version -- never zero, never more than one", () => {
    renderDrawer(MULTI_VERSION_FILE);
    const current = screen.getAllByTestId("files-version-current");
    expect(current).toHaveLength(1);

    // And it is the row whose data actually says `current: true` -- not merely "some row
    // somewhere has the badge", which a hardcoded "first row gets it" bug would also satisfy.
    const trueCurrent = MULTI_VERSION_FILE.versions!.find((v) => v.current)!;
    const badgeRow = current[0]!.closest('[data-testid="files-version-row"]')!;
    expect(within(badgeRow as HTMLElement).getByText(`v${trueCurrent.version}`)).toBeTruthy();
  });

  it("🔴 EVERY row -- old and current alike -- has a working download control and a copyable SHA-256", () => {
    renderDrawer(MULTI_VERSION_FILE);
    const rows = screen.getAllByTestId("files-version-row");
    for (const row of rows) {
      const download = within(row).getByTestId("files-version-download");
      expect(download.hasAttribute("disabled")).toBe(false);
      const copy = within(row).getByTestId("files-version-copy-sha");
      expect(copy.hasAttribute("disabled")).toBe(false);
      // The SHA is present in the row's own text, not just on the button -- 合规 needs to
      // read it, not merely trigger a copy they cannot verify.
      const sha = MULTI_VERSION_FILE.versions!.find((v) => `v${v.version}` === row.textContent!.match(/v\d+/)![0])!
        .sha256;
      expect(row.textContent).toContain(sha);
    }
  });

  it("non-current (旧) rows are NOT visually or functionally disabled -- 「旧版仍可下载」 is not a lie in the DOM", () => {
    renderDrawer(MULTI_VERSION_FILE);
    const rows = screen.getAllByTestId("files-version-row");
    const oldRows = rows.filter((r) => within(r).queryByTestId("files-version-current") === null);
    expect(oldRows.length).toBeGreaterThan(0); // the fixture actually has old versions
    for (const row of oldRows) {
      expect(within(row).getByTestId("files-version-download").hasAttribute("disabled")).toBe(false);
    }
  });
});

describe("上传新版本 -- the action that adds a version without touching any existing one", () => {
  it("clicking it reveals the upload dropzone, and it names the NEXT version number", () => {
    renderDrawer(MULTI_VERSION_FILE);
    expect(screen.queryByTestId("files-version-upload-dropzone")).toBeNull();
    fireEvent.click(screen.getByTestId("files-version-upload-new"));
    const dropzone = screen.getByTestId("files-version-upload-dropzone");
    expect(dropzone).not.toBeNull();
    // "will be appended as v{n+1}" -- not v{n} (which would misdescribe a NEW version as a
    // replacement of the current one) and not silent about which number it will get.
    expect(dropzone.textContent).toContain(`v${MULTI_VERSION_FILE.versionCount + 1}`);
  });
});

describe("V10 -- agent creator renders distinguishably from a human, never as one", () => {
  it("an agent-created version shows the agent's name (not folded into a person's)", () => {
    renderDrawer(AGENT_VERSION_FILE);
    const rows = screen.getAllByTestId("files-version-row");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Every version of this fixture was created by the same materializer agent.
      expect(row.textContent).toContain("物化器 · survey");
    }
  });
});

describe("派生物 (derived files) -- child rows under the original, never merged into it", () => {
  it("renders one `files-derived-row` per derived entry, each naming its source VERSION and a non-empty generator", () => {
    renderDrawer(MULTI_VERSION_FILE);
    const rows = screen.getAllByTestId("files-derived-row");
    expect(rows).toHaveLength(MULTI_VERSION_FILE.derived!.length);
    for (const row of rows) {
      // "derived_from v{N}" -- a VERSION reference, never a bare artifact reference.
      expect(row.textContent).toMatch(/derived_from v\d+/);
    }
    // The fixture's own generator identities are non-empty and show up verbatim.
    for (const d of MULTI_VERSION_FILE.derived!) {
      expect(rows.some((r) => r.textContent!.includes(d.generatorModel))).toBe(true);
      expect(rows.some((r) => r.textContent!.includes(d.generatorVersion))).toBe(true);
    }
  });

  it("every materialized derivative has a working download control", () => {
    renderDrawer(MULTI_VERSION_FILE);
    const rows = screen.getAllByTestId("files-derived-row");
    // `a-001`'s derived entries are all `downloadable: true` in the fixture.
    expect(MULTI_VERSION_FILE.derived!.every((d) => d.downloadable)).toBe(true);
    for (const row of rows) {
      const dl = within(row).getByTestId("files-derived-download");
      expect(dl.hasAttribute("disabled")).toBe(false);
    }
  });

  it("🔴 an embedding (registered but never materialized) has NO download control at all", () => {
    // Constructed rather than found in the fixture: the shared `FILES` array happens to have
    // no `kind: "embedding"` sample, and the property under test -- "no download button" -- is
    // an ABSENCE, so it must be checked on a row that is actually rendered, not merely assumed
    // true because no positive case was seen.
    const withEmbedding: FileItem = {
      ...MULTI_VERSION_FILE,
      derived: [
        {
          name: "客户 RFP.embedding",
          kind: "embedding",
          sizeBytes: 0,
          derivedFromVersion: 3,
          generatorModel: "text-embedding-3",
          generatorVersion: "2026-05",
          downloadable: false,
        },
      ],
    };
    renderDrawer(withEmbedding);
    const row = screen.getByTestId("files-derived-row");
    // No download button anywhere in this row -- the contract's "materialized: false" case.
    expect(within(row).queryByTestId("files-derived-download")).toBeNull();
    // And the pane is not silently empty about it either -- "只登记不物化" is the sentence
    // the component ships for exactly this case.
    expect(row.textContent).toContain("只登记不物化");
  });
});
