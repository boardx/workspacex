/**
 * issue #2318 —— `buildAguiUrl` 两态分支的单测:锁死"落到 apiBaseUrl 分支时必须带
 * path prefix"这条,防止同源代理（`playwright.fullstack-smoke.config.ts` 的
 * `NEXT_PUBLIC_API_PATH_PREFIX` 拓扑）再次被绕开、请求打回 Next 自己拿到字面 404。
 */
import { describe, expect, it } from "vitest";
import { buildAguiUrl } from "../lib/copilotkit-v2-agui-url";

describe("buildAguiUrl", () => {
  it("APP_API_PORT 有值：直连内网回环，不带 prefix（这本身就是 apps/api 的真实 origin）", () => {
    expect(
      buildAguiUrl("/copilotkit/agui?agentId=a", {
        internalPort: "3200",
        apiBaseUrl: "http://127.0.0.1:8080",
        pathPrefix: "/__fullstack_api",
      }),
    ).toBe("http://127.0.0.1:3200/copilotkit/agui?agentId=a");
  });

  it("APP_API_PORT 缺失、配了同源代理 prefix：必须带上 prefix（#2318 根因场景）", () => {
    expect(
      buildAguiUrl("/copilotkit/agui?agentId=a", {
        internalPort: undefined,
        apiBaseUrl: "http://127.0.0.1:4100",
        pathPrefix: "/__fullstack_api",
      }),
    ).toBe("http://127.0.0.1:4100/__fullstack_api/copilotkit/agui?agentId=a");
  });

  it("APP_API_PORT 缺失、没配 prefix（普通本地 dev，apiBaseUrl 就是真实 API 源）：行为不变", () => {
    expect(
      buildAguiUrl("/copilotkit/agui", {
        internalPort: undefined,
        apiBaseUrl: "http://localhost:3200",
        pathPrefix: undefined,
      }),
    ).toBe("http://localhost:3200/copilotkit/agui");
  });

  it("prefix 带结尾斜杠时去重，不产出双斜杠", () => {
    expect(
      buildAguiUrl("/copilotkit/agui", {
        internalPort: undefined,
        apiBaseUrl: "http://127.0.0.1:4100",
        pathPrefix: "/__fullstack_api/",
      }),
    ).toBe("http://127.0.0.1:4100/__fullstack_api/copilotkit/agui");
  });

  it("internalPort 是空白字符串时按缺失处理，落到 apiBaseUrl 分支", () => {
    expect(
      buildAguiUrl("/copilotkit/agui", {
        internalPort: "   ",
        apiBaseUrl: "http://127.0.0.1:4100",
        pathPrefix: "/__fullstack_api",
      }),
    ).toBe("http://127.0.0.1:4100/__fullstack_api/copilotkit/agui");
  });
});
