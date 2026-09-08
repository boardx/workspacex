import { describe, expect, it } from "vitest";
import { analyzeListenSites } from "./lib/test-listen-loopback.ts";

/**
 * 喂 fixture 的纯函数单测（issue #2992）。
 *
 * 第三条是**反证记录**：门控第一版写成 `,\s*(?!['"`])`，`\s*` 可以回溯到零宽，
 * 于是 `listen(0, "127.0.0.1")` 里逗号后那个空格被当成「下一个字符不是引号」而误判。
 * 实测把 229 处已经合规的写法全报成违规。这条用例把那次回溯钉死。
 */
const at = (source: string) => analyzeListenSites([{ file: "f.ts", source }]);

describe("listen(0) 通配 bind 门控", () => {
  it("裸 listen(0) 判违规——它绑的是 0.0.0.0，而测试 fetch 的是 127.0.0.1", () => {
    expect(at("await app.listen(0);").wildcard).toHaveLength(1);
    expect(at("await app.listen( 0 );").wildcard).toHaveLength(1);
  });

  it("第二个参数是回调而非 host 时同样判违规——Node 仍然绑通配", () => {
    expect(at("server.listen(0, () => resolve(port));").wildcard).toHaveLength(1);
    expect(at("server.listen(0, resolve);").wildcard).toHaveLength(1);
  });

  it("绑回环地址的写法放行（含单引号、双引号、逗号后有无空格）", () => {
    for (const line of [
      'await app.listen(0, "127.0.0.1");',
      "await app.listen(0,'127.0.0.1');",
      'server.listen(0, "127.0.0.1", resolve);',
      'server.listen(0,"127.0.0.1",() => resolve(port));',
    ]) {
      expect(at(line).wildcard, line).toHaveLength(0);
    }
  });

  it("非零端口不在本门控范围内（它没有抽签，也就没有抽到别人端口这回事）", () => {
    expect(at("await app.listen(3000);").wildcard).toHaveLength(0);
  });

  it("逐行报位置，多处违规不会只报第一处", () => {
    const report = at("app.listen(0);\nconst x = 1;\nb.listen(0, cb);");
    expect(report.wildcard.map((w) => w.line)).toEqual([1, 3]);
    expect(report.filesScanned).toBe(1);
  });
});
