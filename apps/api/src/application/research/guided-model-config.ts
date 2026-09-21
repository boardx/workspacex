/**
 * Guided Research 用哪个模型 —— **唯一事实源**（docs/research/guided-runtime.md 的语义）。
 *
 * ## 为什么这一份必须是唯一的
 *
 * 在 2026-09-21 之前，同一个问题在这条链路上有**两种**答案：报告模型与 checkpoint
 * 生成器读这个函数（可配，最终回退 `KERNEL_MODEL_ID`），而 outline / direction / skill
 * 三个生成器各自写死 `const ... = "qwen3.7-plus"`，只有 provider 可配。两边自洽，直到
 * 部署把 `KERNEL_MODEL_ID` 指向别的模型——那时同一次引导式研究里，大纲和报告会由**不同的
 * 模型**产出，而没有任何东西会报错。
 *
 * 这条漂移对本地形态是**致命**而不是别扭的：WorkspaceX Local 的模型池里只有
 * `qwen3.5:4b`（Ollama），写死的 `qwen3.7-plus` 在那里根本不存在，三个生成器必然 404。
 * 同理适用于云端的 personal-local 组织——它的承诺就是只走本机/自托管端点。
 *
 * ⚠ 终端回退值仍是 `qwen3.7-plus`：一个什么都没配的部署，行为与改动前逐字一致。
 */
export function guidedModelConfig() {
  return {
    provider: process.env.KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER ?? process.env.KERNEL_MODEL_PROVIDER ?? "",
    id: process.env.KERNEL_GUIDED_RESEARCH_MODEL_ID ?? process.env.KERNEL_MODEL_ID ?? "qwen3.7-plus",
  };
}
