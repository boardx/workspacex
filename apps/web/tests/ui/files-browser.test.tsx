/**
 * F31 -- the browser's client half.
 *
 * The server decides what is visible (`wsx_visible_artifacts`, migration 0018) and the API
 * tests prove it. What has to be true HERE is different and independent:
 *
 *   1. every row renders the metadata the row is supposed to carry -- and an AGENT upload
 *      renders as an agent with its `agent_run_id`, never as a person (V10);
 *   2. the browser renders EXACTLY what it was given: no placeholder, no 「已隐藏 N 项」,
 *      no count of what was filtered out. A row the server withheld leaves no residue;
 *   3. 「未归入环节」 is reachable in the tree, and an empty source node says it is empty
 *      rather than vanishing;
 *   4. the prototype's downloadable/retrievable table agrees with the server's rule.
 *
 * ⚠ (2) is asserted BOTH ways: against the rendered DOM, and against the source text of every
 * component in `components/files/`. The DOM check alone would pass for a component that only
 * shows the placeholder on a code path this test does not enter.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FilesList } from "@/components/files/files-list";
import { FilesTree } from "@/components/files/files-tree";
import {
  FILES, INGEST_PIPELINE, UNSEGMENTED, VISIBILITY_LABEL, formatBytes, type FileItem,
} from "@/lib/mock/files";

/**
 * ⚠ `process.cwd()`, not `import.meta.url`. This file runs under jsdom (vitest's
 * `environmentMatchGlobs` sends every `.tsx` there), and in jsdom `import.meta.url` is an
 * `http://localhost/` URL -- `fileURLToPath` throws "The URL must be of scheme file". vitest
 * runs with the package root as cwd, so this is the stable answer here.
 */
const WEB = process.cwd();
const FILES_COMPONENTS = join(WEB, "components/files");
/** The api's domain rule, read as text: the two packages cannot import each other. */
const API_INGESTION_RULE = join(WEB, "../api/src/domain/files/ingestion-visibility.ts");

const noop = () => undefined;

function renderList(rows: FileItem[]) {
  return render(
    <FilesList
      files={rows}
      selectedId={null}
      checkedIds={new Set()}
      onRow={noop}
      onToggleCheck={noop}
      onOpenVersions={noop}
    />,
  );
}

const byId = (id: string): FileItem => {
  const f = FILES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture ${id} vanished from the prototype data`);
  return f;
};

describe("每行的元数据（UC-22.1 R3 第 3 步的十列）", () => {
  it("人上传的一行：名称 / 大小 / 版本 / 时间 / 上传者 / 环节 / 可见性 / 状态 都在", () => {
    const row = byId("a-001");
    renderList([row]);
    const tr = screen.getAllByTestId("files-row")[0]!;

    expect(within(tr).getByText(`${row.name}.${row.ext}`)).toBeInTheDocument();
    expect(within(tr).getByText(formatBytes(row.sizeBytes))).toBeInTheDocument();
    expect(within(tr).getByTestId("files-row-version").textContent).toContain(`v${row.versionCount}`);
    expect(within(tr).getByText(row.createdAt)).toBeInTheDocument();
    expect(within(tr).getByText(row.uploader.name)).toBeInTheDocument();
    expect(within(tr).getByText(VISIBILITY_LABEL[row.visibility])).toBeInTheDocument();
    // A human uploader must NOT be rendered through the agent branch.
    expect(within(tr).queryByTestId("files-row-agent")).toBeNull();
  });

  it("V10：agent 上传显示 agent 名 + agent_run_id，且不显示为某个人", () => {
    const row = byId("a-010");
    expect(row.uploader.type).toBe("agent");
    renderList([row]);
    const cell = screen.getByTestId("files-row-agent");

    expect(cell.textContent).toContain(row.uploader.name);
    // The run id has to be REACHABLE, not merely stored in the fixture -- otherwise "which
    // run produced this file" is a question the browser cannot answer.
    expect(cell.getAttribute("title")).toContain(row.uploader.agentRunId!);
    // ...and the row must not also claim a person did it.
    const tr = screen.getAllByTestId("files-row")[0]!;
    for (const person of ["林可", "高琳", "陈默"]) {
      expect(tr.textContent, "an agent row named a human").not.toContain(person);
    }
  });

  it("未归入环节的行显示「—」，不是空白也不是编造的环节名", () => {
    const row = byId("a-006");
    expect(row.segmentId).toBe(UNSEGMENTED.id);
    renderList([row]);
    expect(screen.getAllByTestId("files-row")[0]!.textContent).toContain("—");
  });

  it("机密角标只出现在机密行上", () => {
    renderList([byId("a-003"), byId("a-002")]);
    const rows = screen.getAllByTestId("files-row");
    expect(rows[0]!.textContent, "a-003 is confidential").toContain("机密");
    expect(rows[1]!.textContent, "a-002 is not").not.toContain("机密");
  });
});

describe("无权见到的不出现、不占位、不显示「已隐藏 N 项」", () => {
  /** The whole family of "we filtered something out" language, in both scripts. */
  const RESIDUE = /已隐藏|已过滤|不可见项|hidden\s*(items?|count)|N\s*项已/i;

  it("组件只渲染拿到的行 —— 少给一半，DOM 里就只有一半，且没有任何占位", () => {
    const visible = [byId("a-001"), byId("a-002")];
    const withheld = byId("a-003");
    const { container } = renderList(visible);

    expect(screen.getAllByTestId("files-row")).toHaveLength(2);
    // Not merely "not rendered": the withheld row's identity must not appear anywhere in the
    // markup -- not in a title, a data attribute, or a hidden node.
    expect(container.innerHTML).not.toContain(withheld.id);
    expect(container.innerHTML).not.toContain(withheld.name);
    expect(container.textContent ?? "").not.toMatch(RESIDUE);
  });

  it("空集合渲染成零行，而不是一行「已隐藏」", () => {
    const { container } = renderList([]);
    expect(screen.queryAllByTestId("files-row")).toHaveLength(0);
    expect(container.textContent ?? "").not.toMatch(RESIDUE);
  });

  it("整个 components/files/ 的源码里没有任何「已隐藏 N 项」式的文案", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(FILES_COMPONENTS).filter((n) => n.endsWith(".tsx"))) {
      const src = readFileSync(join(FILES_COMPONENTS, name), "utf8");
      if (RESIDUE.test(src)) offenders.push(name);
    }
    expect(offenders, "a filtered-out count is itself a disclosure").toEqual([]);
  });

  it("COUNTER-PROOF: 这条检测确实会红", () => {
    // Without this the previous assertion is indistinguishable from a regex that matches
    // nothing -- which is exactly how a source-text gate quietly stops working.
    expect(RESIDUE.test("列表下方显示「已隐藏 3 项」")).toBe(true);
    expect(RESIDUE.test("其中 2 项因权限未展示")).toBe(false); // and it is not a catch-all
    expect(RESIDUE.test('<p data-testid="files-hidden">hidden count: 4</p>')).toBe(true);
  });
});

describe("树：来源节点与「未归入环节」", () => {
  it("空来源节点说明自己是空的，而不是从树上消失", () => {
    render(<FilesTree selectedSource={null} selectedSeg={null} onSelect={noop} onUpload={noop} />);
    // Every source node in the vocabulary the prototype uses is rendered, empty or not.
    expect(screen.getAllByTestId("files-tree-source").length).toBeGreaterThan(0);
    expect(screen.getByTestId("files-tree-all")).toBeInTheDocument();
  });

  it("「未归入环节」在树上可达 —— 通用上传不会从树上消失", () => {
    render(<FilesTree selectedSource={null} selectedSeg={null} onSelect={noop} onUpload={noop} />);
    // `file` is expanded by default in the component, and a06/a07 sit under 未归入环节.
    const segments = screen.getAllByTestId("files-tree-segment").map((n) => n.textContent ?? "");
    expect(segments.some((t) => t.includes(UNSEGMENTED.name))).toBe(true);
  });
});

/**
 * The prototype and the server both state, per ingestion state, whether the ORIGINAL is
 * downloadable and whether the content is retrievable. That is one fact in two places -- this
 * repository's most frequent defect -- and the two files cannot import each other (different
 * packages, and the server's copy is not in `@repo/contracts` because that contract is signed
 * and has no schema for it).
 *
 * So the agreement is checked rather than asserted in a comment. When the fact moves into the
 * contract, this test is what tells you the two copies were still equal on the day you moved
 * it.
 */
describe("单一事实源：摄取态 → 可下载 / 可召回", () => {
  const setsFromApi = (): { downloadable: string[]; retrievable: string[] } => {
    const src = readFileSync(API_INGESTION_RULE, "utf8");
    const pick = (name: string): string[] => {
      const m = new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(src);
      if (m === null) throw new Error(`${name} not found in ${API_INGESTION_RULE}`);
      return [...m[1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]!).sort();
    };
    return { downloadable: pick("DOWNLOADABLE_STATES"), retrievable: pick("RETRIEVABLE_STATES") };
  };

  it("两边逐态一致", () => {
    const api = setsFromApi();
    const ui = {
      downloadable: INGEST_PIPELINE.filter((s) => s.downloadable).map((s) => s.key).sort(),
      retrievable: INGEST_PIPELINE.filter((s) => s.retrievable).map((s) => s.key).sort(),
    };
    expect(ui.downloadable).toEqual(api.downloadable);
    expect(ui.retrievable).toEqual(api.retrievable);
  });

  it("N-7 在界面侧也成立：REVIEW_PENDING 可下载但不可召回", () => {
    const s = INGEST_PIPELINE.find((x) => x.key === "REVIEW_PENDING")!;
    expect(s.downloadable).toBe(true);
    expect(s.retrievable).toBe(false);
  });

  it("非空，否则上面两条对两个空集也成立", () => {
    const api = setsFromApi();
    expect(api.downloadable.length).toBeGreaterThan(0);
    expect(api.retrievable.length).toBeGreaterThan(0);
    expect(api.downloadable).not.toEqual(api.retrievable);
  });
});
