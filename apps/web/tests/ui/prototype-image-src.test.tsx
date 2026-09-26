/**
 * 深度 S10（#3988）—— 占位图换成用户上传的真图：画布画这张图、属性面板选了就生效、
 * 导出的 React 代码与 .pptx 都带着它。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
const fileToImageSrc = vi.fn();
vi.mock("@/lib/prototype-image-upload", () => ({ fileToImageSrc: (...a: unknown[]) => fileToImageSrc(...a) }));

import * as React from "react";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { PrototypeInspector } from "@/components/design-loop/prototype-inspector";
import { buildPrototypeReactTsx } from "@/lib/prototype-react-export";
import { buildPrototypePptx } from "@/lib/prototype-pptx-export";
import type { DesignProject, PrototypeNode } from "@/lib/live-design-workbench";

afterEach(() => { cleanup(); apiRequest.mockReset(); fileToImageSrc.mockReset(); });

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const image = (src?: string): PrototypeNode => ({ id: "img", type: "image", props: { alt: "商品主图", ...(src === undefined ? {} : { src }) } });
const title: PrototypeNode = { id: "t", type: "text", props: { content: "标题" } };

function project(img: PrototypeNode): DesignProject {
  return {
    id: "p1", name: "Shop", template: "mobile", theme: "light", accent: "blue",
    tokens: { brand: null, font: "sans", radius: "default", density: "default" }, tags: [], refImages: [], share: null,
    problem: "", criteria: [], frames: ["首页"], frameNotes: [], frameLinks: [],
    prototype: [{ id: "root", type: "stack", children: [img, title] }] as never,
    pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
    chat: [], ownerId: "u1", ownerName: "我", createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
  } as DesignProject;
}

describe("画布与导出物", () => {
  it("有 src ⇒ 画布上是这张图（alt 给读屏器），没有 ⇒ 仍是占位", () => {
    // ⭐ 反证锚点：画布不读 `src` ⇒ 这条红——上传了图，画布上还是灰块。
    const { rerender } = render(<PrototypeCanvas label="首页" root={image(PNG)} />);
    const img = screen.getByRole("img", { name: "商品主图" }) as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe(PNG);
    rerender(<PrototypeCanvas label="首页" root={image()} />);
    expect(document.querySelector('[data-proto="image"] img')).toBeNull();
  });

  it("导出的 React 代码里是 <img src=data:…>；.pptx 里是一张真图片（ppt/media）", async () => {
    const tsx = buildPrototypeReactTsx(project(image(PNG)));
    expect(tsx).toContain(`<img src={${JSON.stringify(PNG)}} alt={"商品主图"}`);
    const buf = Buffer.from(await buildPrototypePptx(project(image(PNG))));
    const names: string[] = [];
    let eocd = buf.length - 22;
    while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    let p = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
      const n = buf.readUInt16LE(p + 28);
      names.push(buf.subarray(p + 46, p + 46 + n).toString("utf8"));
      p += 46 + n + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    }
    expect(names.some((n) => /^ppt\/media\/image[^/]*\.png$/.test(n))).toBe(true);
  });
});

describe("属性面板：换图", () => {
  const renderInspector = (node: PrototypeNode, onSaved = vi.fn()) => {
    const pj = project(node);
    const utils = render(<PrototypeInspector projectId="p1" node={node} path={[pj.prototype[0]!, node]} prototype={pj.prototype} onSaved={onSaved} onDeleted={vi.fn()} />);
    return { ...utils, onSaved, pj };
  };

  it("选一张图 ⇒ 立刻发 setProps {src}（不等「应用」）；「移除」⇒ setProps {src: null}", async () => {
    fileToImageSrc.mockResolvedValue(PNG);
    apiRequest.mockResolvedValue({ project: project(image(PNG)) });
    const { onSaved, rerender, pj } = renderInspector(image());
    fireEvent.change(screen.getByTestId("design-inspector-image-file"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(apiRequest.mock.calls[0]![1]).toMatchObject({ method: "POST", body: { ops: [{ op: "setProps", id: "img", props: { src: PNG } }] } });

    rerender(<PrototypeInspector projectId="p1" node={image(PNG)} path={[pj.prototype[0]!, image(PNG)]} prototype={pj.prototype} onSaved={onSaved} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByTestId("design-inspector-image-clear"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
    expect(apiRequest.mock.calls[1]![1]).toMatchObject({ body: { ops: [{ op: "setProps", id: "img", props: { src: null } }] } });
  });

  it("图不进草稿：同一节点刷新后（带着图），改说明再「应用」只发 alt，不会顺手把图删掉", async () => {
    apiRequest.mockResolvedValue({ project: project(image(PNG)) });
    const { rerender, pj } = renderInspector(image());
    fireEvent.change(screen.getByTestId("design-inspector-alt"), { target: { value: "新说明" } });
    // 服务端刷新：同一个节点，对象换新、带着图（例如另一处刚上传完）。
    rerender(<PrototypeInspector projectId="p1" node={image(PNG)} path={[pj.prototype[0]!, image(PNG)]} prototype={pj.prototype} onSaved={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("design-inspector-alt"), { key: "Enter" });
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    expect(apiRequest.mock.calls[0]![1]).toMatchObject({ body: { ops: [{ op: "setProps", id: "img", props: { alt: "新说明" } }] } });
    expect(JSON.stringify(apiRequest.mock.calls[0]![1])).not.toContain('"src"');
  });

  it("读不了 / 太大 ⇒ 说出来，不发请求", async () => {
    fileToImageSrc.mockRejectedValue(new Error("这张图压缩之后还是太大，放不进原型。"));
    renderInspector(image());
    fireEvent.change(screen.getByTestId("design-inspector-image-file"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    expect((await screen.findByRole("alert")).textContent).toContain("太大");
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
