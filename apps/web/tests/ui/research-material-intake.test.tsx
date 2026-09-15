/**
 * 材料录入 —— 盯的是**「不承诺做不到的事」**（评分卡 U4）。
 *
 * 这一维最容易只在文档里达标：代码里写了拒绝分支，但 `accept` 仍然是 `audio/*`，
 * 于是用户照样选得中一个必被拒的 m4a。所以这里有一条断言直接比对
 * `accept` 属性与白名单——它不测行为，它测**承诺与能力是否一致**。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chatFileUpload as U, researchWorkflow as C } from "@repo/contracts";

const addResearchMaterials = vi.fn();
vi.mock("@/lib/live-research-workflow", async () => {
  const actual = await vi.importActual<typeof import("@/lib/live-research-workflow")>(
    "@/lib/live-research-workflow",
  );
  return { ...actual, addResearchMaterials: (...a: unknown[]) => addResearchMaterials(...a) };
});

const { ResearchMaterialIntake, intakeFiles, checkUrl } = await import(
  "@/components/agent/research-material-intake"
);

const THREAD = "11111111-1111-4111-8111-111111111111";

function session(phase: C.ResearchPhaseName = "collecting", materials: unknown[] = []) {
  return {
    threadId: THREAD, phase,
    lineage: { materialBatchId: null, fieldSchemeVersion: 0, logicVersion: 0, publishedGraphVersion: 0 },
    materials, verifyDueAt: null, updatedAt: "2026-09-16T00:00:00.000Z",
  } as never;
}

/** File.size 是只读 getter，要造一个"很大的文件"只能给足字节。 */
const file = (name: string, type: string, size = 1) =>
  new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  addResearchMaterials.mockClear();
  addResearchMaterials.mockResolvedValue(session());
});
afterEach(cleanup);

describe("承诺与能力一致（U4 的要害）", () => {
  it("文件选择器的 accept **逐项等于**服务端白名单——不多承诺一种类型", () => {
    render(<ResearchMaterialIntake session={session()} onChange={() => {}} />);
    const accept = screen.getByTestId("research-intake-file").getAttribute("accept") ?? "";
    expect(accept.split(",").sort()).toEqual([...U.ATTACHMENT_MIME_ALLOWLIST].sort());
  });

  it("accept 里没有通配（`audio/*` 会让人选中一个必被拒的 m4a）", () => {
    render(<ResearchMaterialIntake session={session()} onChange={() => {}} />);
    expect(screen.getByTestId("research-intake-file").getAttribute("accept")).not.toContain("*");
  });

  it("明说 Agent 不会自己上网找材料（静默不做的承诺比明说不做更伤）", () => {
    render(<ResearchMaterialIntake session={session()} onChange={() => {}} />);
    expect(screen.getByTestId("research-intake-no-autosearch")).toHaveTextContent("不会自己上网找材料");
  });

  it("支持清单里写明录音只收 WAV / MP3", () => {
    render(<ResearchMaterialIntake session={session()} onChange={() => {}} />);
    expect(screen.getByTestId("research-intake-supported")).toHaveTextContent("WAV / MP3");
  });
});

describe("intakeFiles：在上传之前就说清楚", () => {
  it("白名单内的收下", () => {
    const r = intakeFiles([file("a.pdf", "application/pdf")]);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it("m4a 被单独点名，并给出可执行的下一步（不是一句「格式不支持」）", () => {
    const r = intakeFiles([file("录音.m4a", "audio/mp4")]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]!.why).toContain("转成 WAV 或 MP3");
  });

  it("其他不支持的类型也逐个点名，带上它到底是什么类型", () => {
    const r = intakeFiles([file("x.exe", "application/x-msdownload")]);
    expect(r.rejected[0]!.name).toBe("x.exe");
    expect(r.rejected[0]!.why).toContain("application/x-msdownload");
  });

  it("超过单文件上限时说清上限是多少 MB", () => {
    const big = file("big.pdf", "application/pdf", U.ATTACHMENT_LIMITS.maxBytesPerFile + 1);
    expect(intakeFiles([big]).rejected[0]!.why).toContain("25 MB");
  });

  it("超过数量上限时把多出来的逐个点名，而不是整批静默丢弃", () => {
    const many = Array.from({ length: U.ATTACHMENT_LIMITS.maxAttachmentsPerMessage + 2 }, (_, i) =>
      file(`f${i}.pdf`, "application/pdf"),
    );
    const r = intakeFiles(many);
    expect(r.accepted).toHaveLength(U.ATTACHMENT_LIMITS.maxAttachmentsPerMessage);
    expect(r.rejected).toHaveLength(2);
  });
});

describe("checkUrl", () => {
  it.each([
    ["", "还没填链接"],
    ["example.com", "要带 https://"],
    ["javascript:alert(1)", "只支持 http / https"],
  ])("输入 %s ⇒ 当场说清原因", (input, why) => {
    const r = checkUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain(why);
  });

  it("正常的 https 链接通过", () => {
    expect(checkUrl("https://example.gov.cn/a")).toEqual({ ok: true, url: "https://example.gov.cn/a" });
  });
});

describe("交互", () => {
  it("加入链接：非法时不发请求，只在界面上说原因", () => {
    render(<ResearchMaterialIntake session={session()} onChange={() => {}} />);
    fireEvent.change(screen.getByTestId("research-intake-url"), { target: { value: "example.com" } });
    fireEvent.click(screen.getByTestId("research-intake-url-add"));

    expect(addResearchMaterials).not.toHaveBeenCalled();
    expect(screen.getByTestId("research-intake-url-why")).toHaveTextContent("要带 https://");
  });

  it("合法链接真的登记进去", async () => {
    render(<ResearchMaterialIntake session={session()} onChange={() => {}} />);
    fireEvent.change(screen.getByTestId("research-intake-url"), { target: { value: "https://a.cn/b" } });
    fireEvent.click(screen.getByTestId("research-intake-url-add"));

    await waitFor(() =>
      expect(addResearchMaterials).toHaveBeenCalledWith(THREAD, [{ source: "url", label: "https://a.cn/b" }]),
    );
  });
});

describe("出现时机", () => {
  it.each(["empty", "collecting", "materials_review"] as const)("阶段 %s 可以录入", (phase) => {
    render(<ResearchMaterialIntake session={session(phase)} onChange={() => {}} />);
    expect(screen.getByTestId("research-intake")).toBeInTheDocument();
  });

  it.each(C.RESEARCH_PHASES.filter((p) => !["empty", "collecting", "materials_review"].includes(p)))(
    "阶段 %s 不再录入（这批材料没过门①，混进结论依据会让血缘对不上）",
    (phase) => {
      render(<ResearchMaterialIntake session={session(phase)} onChange={() => {}} />);
      expect(screen.queryByTestId("research-intake")).toBeNull();
    },
  );
});
