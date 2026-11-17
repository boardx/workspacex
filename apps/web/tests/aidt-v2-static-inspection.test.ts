import { expect, it } from "vitest";
import { inspectAidtStoredHtml } from "../e2e/support/aidt-v2-static-inspection";
it("distinguishes actual visible mapping from a hidden code or comment example", () => {
  const actual = inspectAidtStoredHtml('<h1>取餐分区</h1><p>根据号码找到窗口</p><button>查看分区</button><!-- 示例2→B分区 -->');
  expect(actual.numberZoneExamplePresent).toBe(false); expect(actual.scriptedOrLinked).toBe(false);
  const v2 = inspectAidtStoredHtml('<h1>示例2→B分区</h1><p>合成设计内容，非实测</p><button>先看分区</button>');
  expect(inspectAidtStoredHtml("<div>号码2</div><div>B取餐区</div>").mappingAmbiguous).toBe(true);
  expect(v2.numberZoneExamplePresent).toBe(true); expect(v2.realUserTestConducted).toBe(false);
});
it("does not claim a button is static if any script, event, native goto or stored link exists", () => {
  for (const html of ['<button onclick="go()">查看</button>', '<script>go()</script>', '<button data-goto="next">下一步</button>']) expect(inspectAidtStoredHtml(html).scriptedOrLinked).toBe(true);
  expect(inspectAidtStoredHtml('<button>下一步</button>', 1).scriptedOrLinked).toBe(true);
});
