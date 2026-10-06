/** Narrow documented capability, not a guess from an OpenAI-compatible provider name.
 * https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output
 * The supported-model list includes Qwen3.8-Max; Singapore is explicitly unsupported.
 * Keep unknown models, regions and endpoint paths on the existing legacy flag path. */
export function supportsStrictResponseSchema(baseUrl: string, modelId: string): boolean {
  if (modelId !== "qwen3.8-max") return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && (!url.port || url.port === "443")
      && url.hostname.endsWith(".cn-beijing.maas.aliyuncs.com")
      && url.pathname.replace(/\/$/, "") === "/compatible-mode/v1";
  } catch { return false; }
}
