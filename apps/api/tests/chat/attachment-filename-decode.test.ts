/**
 * #1718 · `decodeMultipartFilename` 的字符类里混进了一个裸 NUL 字节。
 *
 * 两层反证，缺一不可：
 *
 * ① **源文件字节层**——本仓已经栽过一次「肃然无声的坏」：`chat-attachment.controller.ts`
 *    第 128 行的正则 `/[^ -ÿ]/`，那个本该是空格 U+0020 的下界实际是 U+0000。行为上没人
 *    看得出区别，但 git 的二进制判定就是「前 8000 字节内出现 NUL」——该 NUL 落在 offset
 *    7719，于是 git 从此把整个文件当二进制：`git diff` 只吐 `Bin 15455 bytes`，blame 逐行
 *    失效，`git grep` 连函数名都搜不到（`git grep -I -c decodeMultipartFilename HEAD --
 *    <file>` 返回 1/无输出）。**一个看不见的字节让一整个文件退出了 code review。**
 *    所以这里盯的不是"正则写对没有"，而是**源文件里不许有不可见控制字符**——这是那个
 *    症状的唯一机械前提，比断言正则文本长什么样稳。
 *
 * ② **行为层**——修完之后下界从 0x00 变成 0x20，这是一处真实的语义变化，不能靠"反正
 *    差不多"放过去。带 C0 控制字符的文件名现在原样返回，而不是拿去做一次必然乱码的
 *    latin1→utf8 重解。连同 mojibake 复原、纯 ASCII no-op 一起钉死。
 *
 * 本文件是纯单测：只读源码 + 调纯函数，不连库、不起 Nest、不碰 multipart。
 * 走真实 multipart 上传的中文文件名 e2e 在 `attachment-upload.test.ts`（需真 PG）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeMultipartFilename } from "../../src/interface/controllers/chat-attachment.controller";

const CONTROLLER_PATH = fileURLToPath(
  new URL("../../src/interface/controllers/chat-attachment.controller.ts", import.meta.url),
);

describe("#1718 decodeMultipartFilename 源文件卫生", () => {
  it("反证：源文件里没有裸 NUL 字节——有一个 git 就把整份文件当二进制，diff/blame/grep 全失效", () => {
    const bytes = readFileSync(CONTROLLER_PATH);
    const offsets: number[] = [];
    for (let i = 0; i < bytes.length; i += 1) if (bytes[i] === 0x00) offsets.push(i);
    // 失败时直接报 offset：定位一个不可见字节，没有比字节位移更有用的线索。
    expect(offsets, `NUL 字节出现在 offset ${offsets.join(", ")}`).toEqual([]);
  });

  it("反证：源文件里没有任何不可见 C0 控制字符（\\t / \\n 除外）", () => {
    const text = readFileSync(CONTROLLER_PATH, "utf8");
    const found = [...text].flatMap((ch, i) => {
      const code = ch.codePointAt(0)!;
      const isControl = code < 0x20 || code === 0x7f;
      if (!isControl || ch === "\n" || ch === "\t") return [];
      return [`U+${code.toString(16).padStart(4, "0")}@${i}`];
    });
    expect(found, `不可见控制字符：${found.join(", ")}`).toEqual([]);
  });
});

describe("#1718 decodeMultipartFilename 行为", () => {
  it("mojibake 复原：busboy 按 latin1 解出的中文名还原成 UTF-8", () => {
    const real = "截屏 2026-08-09 风险核算模板.png";
    // busboy 干的事：把 UTF-8 字节逐个当 latin1 码位。这里如实重放，不是硬编码一串乱码。
    const asBusboySeesIt = Buffer.from(real, "utf8").toString("latin1");
    expect(asBusboySeesIt).toContain("æ"); // 前提：它确实是 mojibake
    expect(decodeMultipartFilename(asBusboySeesIt)).toBe(real);
  });

  it("纯 ASCII 文件名是 no-op", () => {
    expect(decodeMultipartFilename("brief.pdf")).toBe("brief.pdf");
  });

  it("已经是正确 UTF-8（含 > 0xFF 字符）的名字原样返回，绝不二次解码", () => {
    const real = "风险核算模板.docx";
    expect(decodeMultipartFilename(real)).toBe(real);
  });

  it("反证：含 C0 控制字符的名字原样返回，而不是被拿去做一次必然乱码的重解", () => {
    // 下界若是 NUL（修复前），这串整体落在 [\u0000-ÿ] 内 → 走 latin1→utf8 重解；
    // 0xE6 0x01 不是合法 UTF-8 序列，结果是一串 U+FFFD，把名字毁掉。
    // 下界是空格（修复后）→ 命中 `[^ -ÿ]` → 原样返回。
    const withControl = "æ\u0001æ.png";
    expect(decodeMultipartFilename(withControl)).toBe(withControl);
    expect(decodeMultipartFilename(withControl)).not.toContain("�");
  });
});
