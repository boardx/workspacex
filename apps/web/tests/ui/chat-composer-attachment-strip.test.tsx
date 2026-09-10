/**
 * issue #3373 —— composer 内联附件条（缩略图 + 点击放大预览）的判据。
 *
 * ## 这些断言刻意**不**做的事
 *
 * · 不判「有一个 `<img>` 元素」。`src` 指错文件、指向空串、或干脆是另一张图的
 *   `<img>` 全都能通过那种断言。这里判的是 **`src` 到底是哪一个 `File` 的字节**——
 *   `URL.createObjectURL` 在本文件里被替身成「每个 File 一个可逆的唯一 URL」，
 *   于是 `src` 反查得回 File，缩略图指错了就红。
 * · 不判「点击触发了 onClick」，也不判「预览容器存在」。判的是**预览打开的是哪一张**：
 *   `data-preview-local-id` + 预览大图的 `src` 必须同时指回被点的那一个附件。
 *   三张图里点第 2 张——这是「点了第 2 张却打开第 1 张」唯一抓得住的形状（只有一张时，
 *   任何错误的选中逻辑都会碰巧答对）。
 *
 * ⚠ 几何可见性（尺寸为 0 / 被 overflow 裁掉）**不在这里判**：jsdom 不做布局，
 *   `getBoundingClientRect` 恒返回 0，在这里写命中测试只会得到一个恒真或恒假的假门。
 *   那一维由真实浏览器里的 `copilotkit-v2-composer-attachment-thumbnails.spec.ts`
 *   用 `elementFromPoint` 命中测试钉住（chat-read 车道）。两处各判各的，不重复声明。
 */
import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/live-chat", async (original) => ({
  ...await original<typeof import("@/lib/live-chat")>(),
  uploadAttachment: upload,
}));

import {
  useChatAttachments, ChatComposerAttachmentStrip,
} from "@/components/chat/chat-composer-attachments";

/* ── `URL.createObjectURL` 替身：每个 File 一个唯一且**可逆**的 URL ───────────── */
const urlToFile = new Map<string, File>();
let urlSeq = 0;
const revoked: string[] = [];
beforeEach(() => {
  urlToFile.clear();
  revoked.length = 0;
  urlSeq = 0;
  upload.mockReset();
  URL.createObjectURL = vi.fn((blob: Blob) => {
    urlSeq += 1;
    const url = `blob:mock/${urlSeq}`;
    urlToFile.set(url, blob as File);
    return url;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); }) as unknown as typeof URL.revokeObjectURL;
});

/** src → 它到底是哪个文件。缩略图指错了这里就拿到别的文件名（或 undefined）。 */
function fileNameBehind(src: string | null): string | undefined {
  return src === null ? undefined : urlToFile.get(src)?.name;
}

function png(name: string): File {
  // 内容各不相同：即使实现把「同一个 blob URL」复用给所有图片也逃不掉。
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, name.charCodeAt(0)])], name, { type: "image/png" });
}
function pdf(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });
}

type Ctl = ReturnType<typeof useChatAttachments>;
let ctl: Ctl;

function Harness({ disabled, disabledReason, canRetry }: {
  disabled?: boolean; disabledReason?: string; canRetry?: boolean;
}) {
  ctl = useChatAttachments({ threadId: "thread-1", canWrite: true });
  return (
    <ChatComposerAttachmentStrip
      ctl={ctl} disabled={disabled} disabledReason={disabledReason} canRetry={canRetry}
    />
  );
}

async function pick(files: File[]): Promise<void> {
  await act(async () => { ctl.pickFiles(files); });
}

const uploaded = (id: string, f: File) => ({
  id, filename: f.name, mime: f.type, bytes: f.size, createdAt: "2026-01-01T00:00:00.000Z",
});

describe("composer 内联附件条（#3373）", () => {
  it("图片出真实缩略图、且每张缩略图指向的是它自己那个文件；非图片退回类型图标+文件名", async () => {
    const a = png("a.png"); const b = png("b.png"); const doc = pdf("brief.pdf");
    upload.mockImplementation((_t: string, f: File) => Promise.resolve(uploaded(`srv-${f.name}`, f)));
    render(<Harness />);
    await pick([a, b, doc]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));

    const list = await screen.findByTestId("chat-attachment-list");
    const chips = within(list).getAllByRole("listitem");
    expect(chips).toHaveLength(3);

    // 两张图各有自己的缩略图，且 src 反查回来就是它自己那个 File。
    const [chipA, chipB, chipDoc] = chips;
    expect(chipA).toHaveAttribute("data-kind", "image");
    expect(chipB).toHaveAttribute("data-kind", "image");
    const imgA = within(chipA!).getByRole("img") as HTMLImageElement;
    const imgB = within(chipB!).getByRole("img") as HTMLImageElement;
    expect(fileNameBehind(imgA.getAttribute("src"))).toBe("a.png");
    expect(fileNameBehind(imgB.getAttribute("src"))).toBe("b.png");
    // 两张图不能共用同一个 URL（"所有缩略图都是第一张"这个形状）。
    expect(imgA.getAttribute("src")).not.toBe(imgB.getAttribute("src"));

    // 非图片：没有 <img>（无从生成缩略图，不假装有），退回类型图标 + 文件名。
    expect(within(chipDoc!).queryByRole("img")).toBeNull();
    expect(chipDoc).toHaveAttribute("data-kind", "pdf");
    expect(within(chipDoc!).getByText("brief.pdf")).toBeInTheDocument();
  });

  it("点第 2 张缩略图，放大预览打开的是第 2 张（不是第 1 张）", async () => {
    const a = png("a.png"); const b = png("b.png"); const c = png("c.png");
    upload.mockImplementation((_t: string, f: File) => Promise.resolve(uploaded(`srv-${f.name}`, f)));
    render(<Harness />);
    await pick([a, b, c]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));

    const chips = within(await screen.findByTestId("chat-attachment-list")).getAllByRole("listitem");
    const secondLocalId = chips[1]!.getAttribute("data-testid")!.replace("chat-attachment-chip-", "");

    // 预览此刻不存在——保证下面看到的不是一个一直开着的壳。
    expect(screen.queryByTestId("chat-attachment-draft-preview-body")).toBeNull();

    fireEvent.click(within(chips[1]!).getByRole("button", { name: /预览附件 b\.png/ }));

    const body = await screen.findByTestId("chat-attachment-draft-preview-body");
    // ① 打开的是哪一个附件（身份）
    expect(body).toHaveAttribute("data-preview-local-id", secondLocalId);
    expect(body).toHaveAttribute("data-preview-filename", "b.png");
    // ② 屏幕上那张大图的字节到底是谁的（内容）——身份对、图指错也要红
    const big = screen.getByTestId("chat-attachment-draft-preview-image") as HTMLImageElement;
    expect(fileNameBehind(big.getAttribute("src"))).toBe("b.png");
    expect(big.getAttribute("alt")).toBe("b.png");
  });

  it("预览可关闭：Esc 与「关闭」按钮各自都能关掉", async () => {
    const a = png("a.png");
    upload.mockImplementation((_t: string, f: File) => Promise.resolve(uploaded("srv-a", f)));
    render(<Harness />);
    await pick([a]);
    await waitFor(() => expect(upload).toHaveBeenCalled());
    const openBtn = () => screen.getByRole("button", { name: /预览附件 a\.png/ });

    fireEvent.click(openBtn());
    await screen.findByTestId("chat-attachment-draft-preview-body");
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("chat-attachment-draft-preview-body")).toBeNull());

    fireEvent.click(openBtn());
    await screen.findByTestId("chat-attachment-draft-preview-body");
    fireEvent.click(screen.getByTestId("chat-attachment-draft-preview-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("chat-attachment-draft-preview-body")).toBeNull());
  });

  it("上传失败的图片：仍看得见自己选的那张、重试真的再传一次、移除真的移除（没有点了没反应的东西）", async () => {
    const a = png("a.png");
    upload.mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce((_t: string, f: File) => Promise.resolve(uploaded("srv-a", f)));
    render(<Harness />);
    await pick([a]);
    const chip = await screen.findByTestId(/^chat-attachment-chip-/);
    await waitFor(() => expect(chip).toHaveAttribute("data-status", "error"));
    // 失败态也有真实缩略图（字节在本机，从来没依赖上传成功）
    expect(fileNameBehind(within(chip).getByRole("img").getAttribute("src"))).toBe("a.png");

    const localId = chip.getAttribute("data-testid")!.replace("chat-attachment-chip-", "");
    fireEvent.click(screen.getByTestId(`chat-attachment-retry-${localId}`));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(chip).toHaveAttribute("data-status", "uploaded"));

    fireEvent.click(screen.getByTestId(`chat-attachment-remove-${localId}`));
    await waitFor(() => expect(screen.queryByTestId("chat-attachment-list")).toBeNull());
  });

  it("移除正在预览的那张 → 预览跟着关闭（不会停在一张已不属于这条消息的图上）", async () => {
    const a = png("a.png"); const b = png("b.png");
    upload.mockImplementation((_t: string, f: File) => Promise.resolve(uploaded(`srv-${f.name}`, f)));
    render(<Harness />);
    await pick([a, b]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    const chips = within(await screen.findByTestId("chat-attachment-list")).getAllByRole("listitem");
    const secondLocalId = chips[1]!.getAttribute("data-testid")!.replace("chat-attachment-chip-", "");

    fireEvent.click(within(chips[1]!).getByRole("button", { name: /预览附件 b\.png/ }));
    expect(await screen.findByTestId("chat-attachment-draft-preview-body"))
      .toHaveAttribute("data-preview-local-id", secondLocalId);

    fireEvent.click(screen.getByTestId(`chat-attachment-remove-${secondLocalId}`));
    await waitFor(() => expect(screen.queryByTestId("chat-attachment-draft-preview-body")).toBeNull());
  });

  it("只读（归档）：附件条仍渲染、移除/重试禁用、并写出禁用理由（#3347 约定）", async () => {
    const a = png("a.png");
    upload.mockRejectedValue(new Error("boom"));
    render(<Harness disabled disabledReason="该对话已归档，这些附件不能再发送，只能移除。" canRetry={false} />);
    await pick([a]);
    const chip = await screen.findByTestId(/^chat-attachment-chip-/);
    await waitFor(() => expect(chip).toHaveAttribute("data-status", "error"));
    const localId = chip.getAttribute("data-testid")!.replace("chat-attachment-chip-", "");

    expect(screen.getByTestId("chat-attachment-list")).toHaveAttribute("data-disabled", "true");
    expect(screen.getByTestId(`chat-attachment-remove-${localId}`)).toBeDisabled();
    // canRetry=false ⇒ 不渲染一个点了不会重试的假重试键
    expect(screen.queryByTestId(`chat-attachment-retry-${localId}`)).toBeNull();
    expect(screen.getByTestId("chat-attachment-disabled-reason")).toHaveTextContent("该对话已归档");
  });
});
