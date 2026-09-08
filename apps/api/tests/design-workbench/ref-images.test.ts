/**
 * 迭代 13（delta `design-chat-inputs` §1）—— V51 / V55。
 *
 * 类型**按字节判**不信 Content-Type；上限（单张 4MB、每项目 3 张）；
 * 元信息**不含字节**；喂给模型时只取属于这个项目的那几张。
 */
import { describe, expect, it, vi } from "vitest";
import { designWorkbench as C } from "@repo/contracts";
import {
  RefImageRejectedError,
  deleteRefImage,
  loadRefImageBytes,
  uploadRefImage,
  type RefImageRow,
} from "../../src/application/design-workbench/ref-images";

/** 真 PNG / JPEG / WebP 的 magic bytes——嗅探认的是这些，不是扩展名也不是声明。 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

function harness(rows: RefImageRow[] = []) {
  const objects = new Map<string, Uint8Array>();
  const store = {
    putOnce: vi.fn(async (k: string, b: Uint8Array) => { objects.set(k, b); }),
    get: vi.fn(async (k: string) => objects.get(k) ?? null),
    head: vi.fn(async () => null),
  };
  const inserted: unknown[] = [];
  const refImages = {
    listByProject: vi.fn(async () => rows),
    insert: vi.fn(async (r: RefImageRow & { projectId: string }) => { inserted.push(r); rows.push(r); }),
    remove: vi.fn(async () => true),
  };
  const projects = {
    get: vi.fn(async () => ({ id: "p1", ownerId: "u1" })),
  };
  return { deps: { store, refImages, projects } as never, store, refImages, inserted, objects, rows };
}

const upload = (h: ReturnType<typeof harness>, over: Partial<Parameters<typeof uploadRefImage>[1]> = {}) =>
  uploadRefImage(h.deps, {
    orgId: "org1" as never, projectId: "p1", ownerId: "u1",
    name: "参考.png", declaredContentType: "image/png", bytes: PNG, ...over,
  });

describe("V51 参考图按字节判类型，不信 Content-Type", () => {
  it("真 PNG / JPEG 收；声明 png 实为 zip ⇒ 拒", async () => {
    await expect(upload(harness())).resolves.toMatchObject({ image: { mime: "image/png" } });
    await expect(upload(harness(), { declaredContentType: "image/jpeg", bytes: JPEG })).resolves.toMatchObject({ image: { mime: "image/jpeg" } });
    // ⭐ 反证锚点：实现若信 Content-Type，这条通过——那正是"改个扩展名就能传任意文件"。
    await expect(upload(harness(), { bytes: ZIP })).rejects.toMatchObject({ reason: "TYPE" });
  });

  it("类型不在闭集（gif / pdf / 文本）⇒ 拒，且不写任何对象", async () => {
    const h = harness();
    await expect(upload(h, { declaredContentType: "image/gif" })).rejects.toBeInstanceOf(RefImageRejectedError);
    expect(h.store.putOnce).not.toHaveBeenCalled();
  });

  it("超过单张上限 ⇒ 拒（4MB）", async () => {
    const big = new Uint8Array(C.PROTOTYPE_REF_IMAGE_MAX_BYTES + 1);
    big.set(PNG.slice(0, 8));
    await expect(upload(harness(), { bytes: big })).rejects.toMatchObject({ reason: "SIZE" });
  });

  it("已满 3 张 ⇒ 第 4 张拒；判定顺序是 类型 → 大小 → 张数（坏类型不该多查一次库）", async () => {
    const full = Array.from({ length: C.PROTOTYPE_MAX_REF_IMAGES }, (_, i) => ({
      id: `r${i}`, name: `n${i}`, objectKey: `k${i}`, mime: "image/png" as const, size: 10, createdAt: "2026-09-08T00:00:00.000Z",
    }));
    const h = harness([...full]);
    await expect(upload(h)).rejects.toMatchObject({ reason: "TOO_MANY" });

    const bad = harness([...full]);
    await expect(upload(bad, { bytes: ZIP })).rejects.toMatchObject({ reason: "TYPE" });
    expect(bad.refImages.listByProject).not.toHaveBeenCalled();
  });

  it("先写字节再写元信息——反过来会留下指向不存在对象的行", async () => {
    const h = harness();
    const order: string[] = [];
    h.store.putOnce.mockImplementation(async () => { order.push("bytes"); });
    h.refImages.insert.mockImplementation(async () => { order.push("meta"); });
    await upload(h);
    // ⭐ 反证锚点：调换顺序 ⇒ 这条红。界面显示有这张图、点开是空的，比孤儿对象糟得多。
    expect(order).toEqual(["bytes", "meta"]);
  });
});

describe("V55 元信息不含字节；喂模型时只取本项目的那几张", () => {
  it("返回的 image 只有 id/name/size/mime/createdAt，没有 bytes 也没有 objectKey", async () => {
    const { image } = await upload(harness());
    expect(Object.keys(image).sort()).toEqual(["createdAt", "id", "mime", "name", "size"]);
    expect(C.RefImage.safeParse(image).success).toBe(true);
  });

  it("loadRefImageBytes 只取点名且属于本项目的；不属于的 id 直接忽略", async () => {
    const h = harness();
    const a = await upload(h, { name: "a.png" });
    const b = await upload(h, { name: "b.png" });
    const got = await loadRefImageBytes(h.deps, "p1", [a.image.id, "别人家的-id", b.image.id]);
    expect(got.map((x) => x.filename)).toEqual(["a.png", "b.png"]);
    expect(got[0]!.bytes).toEqual(PNG);
  });

  it("对象被删了（字节读不到）⇒ 跳过那一张，不让整轮对话作废", async () => {
    const h = harness();
    const a = await upload(h, { name: "a.png" });
    h.objects.clear();
    await expect(loadRefImageBytes(h.deps, "p1", [a.image.id])).resolves.toEqual([]);
  });

  it("没点名任何图 ⇒ 一次库都不查", async () => {
    const h = harness();
    await expect(loadRefImageBytes(h.deps, "p1", [])).resolves.toEqual([]);
    expect(h.refImages.listByProject).not.toHaveBeenCalled();
  });

  /*
   * ⚠ 「重复删同一张不报错」这条我写过一版，但它是**为了错误的理由通过的**：
   * 断言是 `rejects.toBeDefined()`，而它抛错的真实原因是我给的 deps 不完整
   * （`loadProjectView` 需要更多东西），不是我声称在测的那件事。删掉了——
   * 一条为错误理由通过的断言比没有更糟，它会让人以为这件事有人守着。
   * 真要测它，得把 `loadProjectView` 那一圈依赖补齐，那属于 project-lifecycle 那组
   * 需要数据库的用例（本机无 Docker，交 CI）。登记在此，不假装覆盖了。
   */
});
