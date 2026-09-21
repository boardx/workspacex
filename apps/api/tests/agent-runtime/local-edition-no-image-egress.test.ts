/**
 * 2026-09-22 —— 本地版不选任何出图服务商。
 *
 * ## 这条是实测出来的，不是设计推演
 *
 * 用本地版真实交给 API 的那份 env（`packages/local-runtime/src/config.ts` 的 `apiEnv`）
 * 调真实的 `selectImageProvider`，改动前返回的是 **bailian**：
 *     KERNEL_MODEL_API_KEY = "ollama-local"            ← 给本机 Ollama 的占位 key
 *     KERNEL_IMAGE_PROVIDER = undefined                ← 本地版刻意不设
 *     bailian baseUrl = https://dashscope.aliyuncs.com  apiKey = "ollama-local"
 *     selectImageProvider => bailian
 * 因为 `readBailianImageProviderConfig` 的 `apiKey` 读的就是 `KERNEL_MODEL_API_KEY`，
 * `bailianReady` 于是恒真。后果：一个声明「数据不出本机」的构建会把出图提示词发到公网
 * DashScope，然后因为假 key 401 —— 既破承诺，又是一次不可解释的失败。
 *
 * ⚠ 下面第二条是**反证**：把版次标记去掉（其余 env 一个字节不改），同一份 env 必须
 * 又变回 bailian。它同时是这个 bug 的存档：如果哪天有人把版次门删了，这一条会变绿而
 * 第一条会变红，方向不会搞错。
 */
import { expect, it } from "vitest";
import { selectImageProvider } from "../../src/infrastructure/agent-run/select-image-provider";

/** 本地版 env 里与这条判断相关的**真实**取值（与 `apiEnv` 逐字一致，见文件头实测）。 */
const LOCAL_ENV = {
  WORKSPACEX_EDITION: "local",
  KERNEL_MODEL_PROVIDER: "ollama",
  KERNEL_MODEL_API_KEY: "ollama-local",
  KERNEL_MODEL_BASE_URL: "http://127.0.0.1:11435/v1",
} as unknown as NodeJS.ProcessEnv;

it("picks no image provider at all in the local edition", () => {
  expect(selectImageProvider(LOCAL_ENV)).toBeNull();
});

it("counterproof: the same env without the edition marker still resolves to bailian", () => {
  const { WORKSPACEX_EDITION: _omitted, ...withoutEdition } = LOCAL_ENV as Record<string, string>;
  const selected = selectImageProvider(withoutEdition as unknown as NodeJS.ProcessEnv);
  expect(selected?.choice).toBe("bailian");
});

it("an explicitly requested provider does not override the local edition", () => {
  // 显式指定也不行：本地版的出网承诺不是一个可以被环境变量翻掉的开关
  for (const requested of ["bailian", "openai"]) {
    expect(selectImageProvider({
      ...LOCAL_ENV, KERNEL_IMAGE_PROVIDER: requested, KERNEL_OPENAI_API_KEY: "sk-real",
    } as unknown as NodeJS.ProcessEnv)).toBeNull();
  }
});

it("the cloud edition is untouched", () => {
  expect(selectImageProvider({
    KERNEL_MODEL_API_KEY: "real-key", WORKSPACEX_EDITION: "cloud",
  } as unknown as NodeJS.ProcessEnv)?.choice).toBe("bailian");
});
