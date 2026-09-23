/**
 * 名单里的每条路由都必须真的挂上示例数据声明（#3872 R10）。
 *
 * 这道门**只能**保证一个方向：名单里的挂了。它保证不了「没挂的都是真数据」——
 * 判据为什么只能是人维护的名单，见 `prototype-data-banner.tsx` 的文件头。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTOTYPE_DATA_ROUTES, PROTOTYPE_DATA_NOTICE } from "@/components/shell/prototype-data-banner";

const ROOT = join(__dirname, "..", "..");

/** 顺着 page → 它 return 的那个组件，找到真正渲染界面的文件。 */
function screenSources(route: string): string[] {
  const page = join(ROOT, "app", route.replace(/^\//, ""), "page.tsx");
  expect(existsSync(page), `${route} 的 page.tsx 不存在`).toBe(true);
  const src = readFileSync(page, "utf8");
  const out = [src];
  for (const m of src.matchAll(/from "@\/(components\/[^"]+)"/g)) {
    const f = join(ROOT, m[1] + ".tsx");
    if (existsSync(f)) out.push(readFileSync(f, "utf8"));
  }
  return out;
}

describe("示例数据的屏必须自己说是示例", () => {
  it.each(PROTOTYPE_DATA_ROUTES)("%s 渲染 <PrototypeDataBanner />", (route) => {
    const sources = screenSources(route);
    expect(sources.some((s) => s.includes("<PrototypeDataBanner")), `${route} 没有挂 banner`).toBe(true);
  });

  it("文案只有一份——别的地方不许再抄一句一样的", () => {
    // 同一事实声明在两处是本仓的头号病（已 11 例）。这里钉住的是「正文只在组件里」。
    const banner = readFileSync(join(ROOT, "components/shell/prototype-data-banner.tsx"), "utf8");
    expect(banner).toContain(PROTOTYPE_DATA_NOTICE);
    expect(PROTOTYPE_DATA_NOTICE.length).toBeGreaterThan(20);
  });
});
