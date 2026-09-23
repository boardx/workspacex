/**
 * 搬 7.5 GB 的时候要说清还要多久，而且不能把搬坏的当成搬好的（#3872 维度 2）。
 */
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyBlobVerified, digestFromBlobPath, etaSeconds, humanEta, humanBytes, sha256File } from "../src/model-import";
import { planImport, importModels } from "../src/model-bundle";

function tmp(): string { return mkdtempSync(join(tmpdir(), "wsx-mi-")); }
function sha(b: Buffer | string): string { return createHash("sha256").update(b).digest("hex"); }

/** 造一个最小但**形状真实**的 Ollama 模型库：manifest + 它引用的 blob。 */
function makeStore(root: string, ref: string, layers: Buffer[]): void {
  const [name, tag] = ref.split(":") as [string, string];
  const cfg = Buffer.from(`{"model":"${name}"}`);
  const all = [cfg, ...layers];
  mkdirSync(join(root, "blobs"), { recursive: true });
  for (const b of all) writeFileSync(join(root, "blobs", `sha256-${sha(b)}`), b);
  const man = {
    config: { digest: `sha256:${sha(cfg)}`, size: cfg.length },
    layers: layers.map((l) => ({ digest: `sha256:${sha(l)}`, size: l.length })),
  };
  const dir = join(root, "manifests", "registry.ollama.ai", "library", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, tag), JSON.stringify(man));
}

describe("剩余时间", () => {
  it("样本不足时返回 null，而不是编一个数字", () => {
    expect(etaSeconds(10, 1000, 200)).toBeNull();      // 不到 1 秒
    expect(etaSeconds(0, 1000, 5_000)).toBeNull();     // 一个字节都还没搬
    expect(humanEta(null)).toBe("正在估算");
  });

  it("有样本时按已测速率外推", () => {
    // 2 秒搬了 1000，还剩 3000 → 6 秒
    expect(etaSeconds(1000, 4000, 2000)).toBe(6);
  });

  it("搬完是 0，不是负数", () => {
    expect(etaSeconds(4000, 4000, 2000)).toBe(0);
    expect(humanEta(0)).toBe("就好");
  });

  it("人话：分和秒", () => {
    expect(humanEta(45)).toBe("还要约 45 秒");
    expect(humanEta(200)).toBe("还要约 3 分 20 秒");
    expect(humanBytes(7.5 * 1024 ** 3)).toBe("7.5 GB");
  });
});

describe("blob 的摘要就写在文件名里", () => {
  it("认得出来", () => {
    expect(digestFromBlobPath(`/x/blobs/sha256-${"a".repeat(64)}`)).toBe("a".repeat(64));
  });
  it("不是这个形状就说不知道，不瞎猜", () => {
    expect(digestFromBlobPath("/x/blobs/sha256-short")).toBeNull();
    expect(digestFromBlobPath("/x/manifests/qwen/4b")).toBeNull();
  });
});

describe("拷 blob", () => {
  it("内容对得上就落地", async () => {
    const d = tmp();
    const body = Buffer.from("hello-model-bytes");
    const src = join(d, `sha256-${sha(body)}`);
    writeFileSync(src, body);
    const dst = join(d, "out", `sha256-${sha(body)}`);
    expect(await copyBlobVerified(src, dst)).toBe(true);
    expect(readFileSync(dst)).toEqual(body);
    rmSync(d, { recursive: true, force: true });
  });

  it("**内容与文件名里的摘要对不上就拒收**——这正是只比大小看不出来的那种坏", async () => {
    const d = tmp();
    const real = Buffer.from("AAAAAAAAAA");
    const fake = Buffer.from("BBBBBBBBBB");          // 长度一样，内容不同
    expect(real.length).toBe(fake.length);
    const src = join(d, `sha256-${sha(real)}`);       // 名字说它是 real
    writeFileSync(src, fake);                         // 内容却是 fake
    const dst = join(d, "out", `sha256-${sha(real)}`);
    await expect(copyBlobVerified(src, dst)).rejects.toThrow(/校验不通过/);
    expect(existsSync(dst), "坏的不许落地").toBe(false);
    expect(existsSync(`${dst}.part`), "半成品也不许留下").toBe(false);
    rmSync(d, { recursive: true, force: true });
  });

  it("**搬到一半时目标路径上不能有东西**——这才是 `.part` + 改名换来的东西", async () => {
    const d = tmp();
    // 够大，保证分成多块读，`onBytes` 会在中途被调用
    const body = Buffer.alloc(3_000_000, 5);
    const src = join(d, `sha256-${sha(body)}`);
    writeFileSync(src, body);
    const dst = join(d, "out", `sha256-${sha(body)}`);

    const midway: boolean[] = [];
    let bytes = 0;
    await copyBlobVerified(src, dst, {
      onBytes: (n) => {
        bytes += n;
        if (bytes < body.length) midway.push(existsSync(dst));   // 还没搬完的那些时刻
      },
    });

    expect(midway.length, "样本太少，这条没真的检查到中途").toBeGreaterThan(0);
    expect(midway.some(Boolean), "搬到一半时 dst 就出现了：一次硬杀会留下一个残缺 blob").toBe(false);
    expect(existsSync(dst), "搬完之后要在").toBe(true);
    // 收尾不留半成品
    expect(existsSync(`${dst}.part`)).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });

  it("已经在了就不重搬", async () => {
    const d = tmp();
    const body = Buffer.from("xyz");
    const src = join(d, `sha256-${sha(body)}`);
    writeFileSync(src, body);
    const dst = join(d, "out", `sha256-${sha(body)}`);
    expect(await copyBlobVerified(src, dst)).toBe(true);
    expect(await copyBlobVerified(src, dst)).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });

  it("verifyExisting 打开时，已在但内容坏掉的会被换掉", async () => {
    const d = tmp();
    const body = Buffer.from("good-bytes");
    const src = join(d, `sha256-${sha(body)}`);
    writeFileSync(src, body);
    const dst = join(d, "out", `sha256-${sha(body)}`);
    mkdirSync(join(d, "out"), { recursive: true });
    writeFileSync(dst, Buffer.from("BAD!-bytes"));    // 同样长度的坏内容
    expect(statSync(dst).size).toBe(body.length);
    expect(await copyBlobVerified(src, dst, { verifyExisting: true })).toBe(true);
    expect(readFileSync(dst)).toEqual(body);
    rmSync(d, { recursive: true, force: true });
  });
});

describe("整体导入", () => {
  it("先数清楚要搬多少字节——百分比因此是确定的", () => {
    const b = tmp(); const s = tmp();
    const layers = [Buffer.alloc(5000, 1), Buffer.alloc(3000, 2)];
    makeStore(b, "qwen3.5:4b", layers);
    const plan = planImport(b, s);
    expect(plan.models).toEqual(["qwen3.5:4b"]);
    expect(plan.items.length).toBe(3);                          // config + 两层
    expect(plan.bytesTotal).toBe(8000 + plan.items.find((i) => i.size < 100)!.size);
    rmSync(b, { recursive: true, force: true }); rmSync(s, { recursive: true, force: true });
  });

  it("进度按字节单调递增，最后一条正好是 100%", async () => {
    const b = tmp(); const s = tmp();
    makeStore(b, "qwen3.5:4b", [Buffer.alloc(200_000, 7), Buffer.alloc(50_000, 9)]);
    const seen: number[] = [];
    const r = await importModels(b, s, { onProgress: (p) => seen.push(p.bytesDone) });
    expect(r.imported).toEqual(["qwen3.5:4b"]);
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen[seen.length - 1]).toBe(planTotal(b, tmp()));
    rmSync(b, { recursive: true, force: true }); rmSync(s, { recursive: true, force: true });
  });

  it("第二次启动什么都不搬", async () => {
    const b = tmp(); const s = tmp();
    makeStore(b, "qwen3.5:4b", [Buffer.alloc(1000, 3)]);
    await importModels(b, s);
    const again = await importModels(b, s);
    expect(again.imported).toEqual([]);
    expect(again.skipped).toEqual(["qwen3.5:4b"]);
    rmSync(b, { recursive: true, force: true }); rmSync(s, { recursive: true, force: true });
  });

  it("搬进去的字节与源逐字相同（sha256 比对，不是比大小）", async () => {
    const b = tmp(); const s = tmp();
    const layer = Buffer.alloc(120_000, 42);
    makeStore(b, "qwen3.5:4b", [layer]);
    await importModels(b, s);
    const name = `sha256-${sha(layer)}`;
    expect(await sha256File(join(s, "blobs", name))).toBe(sha(layer));
    rmSync(b, { recursive: true, force: true }); rmSync(s, { recursive: true, force: true });
  });
});

function planTotal(bundle: string, emptyStore: string): number {
  return planImport(bundle, emptyStore).bytesTotal;
}
