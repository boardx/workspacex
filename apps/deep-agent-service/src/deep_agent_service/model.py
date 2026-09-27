"""Model configuration for this service (#739).

## Why this reads the SAME `KERNEL_MODEL_*` env vars the TS side reads

The human's own instruction for this migration: "复用同一把模型 API key
（`KERNEL_MODEL_API_KEY`，阿里云百炼，OpenAI 兼容），不需要新申请凭据." This process is a
separate container from `apps/api`, so it needs its OWN copy of these values injected at
container-start time (same names, same values, no new secret) -- it cannot reach into the
Node process's environment. `KERNEL_MODEL_BASE_URL`/`KERNEL_MODEL_API_KEY` are read here
with the identical names `configured-model-provider.ts`'s `readModelProviderConfig` uses,
so whoever wires the deployment env only has one pair of values to keep in sync, not two.

`KERNEL_DEEP_AGENT_MODEL_ID` is new and specific to this service (the TS side has no
single global "model id" env var either -- see `pg-default-agent-repository.ts`'s own
`KERNEL_DEFAULT_AGENT_MODEL_ID` comment for why that value is a per-agent, not a
per-deployment, fact). The default below is a placeholder, not a verified working model
id for any specific deployment -- whoever stands this service up for real MUST set
`KERNEL_DEEP_AGENT_MODEL_ID` to a model this deployment's Bailian account actually has
access to; nothing here has been run against a live endpoint (#739 could not install
`deepagents` in this environment -- Python 3.9 sandbox vs. the package's `>=3.11`
requirement -- see the PR description for what WAS and was not verified).

## `enable_thinking: false` for Qwen3 hybrid-thinking models (#2700)

⚠ 2026-09 devapp 实测：deep-agent 主聊天路径下一句简单问候（"你好"）卡 90+ 秒才回。
根因与 #2504（`configured-model-provider.ts` 那次修复）**同形但不同代码路径**：这个
服务用 `ChatOpenAI`（`langchain-openai`），`build_chat_model()` 之前没有设置
`streaming=True`，`ChatOpenAI` 默认 `stream=False`（实测 `_get_invocation_params()`
确认，见 `#2700` PR 描述）——`deepagents`/LangGraph 节点对模型的调用是
`ainvoke()`（`graph.py`/`harness.py` 头注反复强调的"异步 runtime"说的是 LangGraph
graph 这一层的 `ainvoke`/`astream`，不是这里每次模型调用是否走 SSE；此文件从未把
`streaming=True` 传给 `ChatOpenAI`，所以打给百炼的每次请求都是 `stream: false`）。
Qwen3 系混合思考模型（`qwen-plus`/`qwen3.x-plus`）缺省开启深度思考，非流式调用要等
整段隐藏 reasoning + 正文都生成完才返回——与 #2504 的根因逐字相同，只是那次是
`apps/api` 里 pptx skill 这条路径命中，这次是 deep-agent 主聊天（每一句话，不分
任务大小）命中。

修法与 #2504 相同：非流式请求体里显式带 `enable_thinking: false`，通过
`langchain-openai` 的 `extra_body` 透传给底层 HTTP 请求（`ChatOpenAI` 把
`extra_body` 里的键原样合并进发给 OpenAI 兼容 endpoint 的 JSON body，绕开
`langchain-openai` 自己不认识的厂商专有字段这层限制，与 undici 版 `postCompletions`
往 `body` 里塞一个字段是同一件事，只是走的 SDK 不同）。

⚠ **判断逻辑必须与 `configured-model-provider.ts` 保持一致**（同一份"什么时候该关
thinking"的语义，写成了两份不能互相 import 的代码——TS 在 `apps/api`，这里是独立
Python 进程，见本文件头注）：同样的双维门控，同样的默认值来源，同样的
`KERNEL_MODEL_THINKING_DISABLE_IDS` / `KERNEL_MODEL_BAILIAN_EXTENSIONS` 环境变量名
（不是新造一套 Python 专属的名字——运维只需要在两个容器里注入相同的值，与
`KERNEL_MODEL_BASE_URL`/`KERNEL_MODEL_API_KEY` 同一纪律）：
  1. **model 维度** —— `KERNEL_MODEL_THINKING_DISABLE_IDS`（逗号分隔，默认
     `qwen-plus,qwen3.7-plus,qwen3.8-max`，与 `configured-model-provider.ts` 的
     `readThinkingDisableModelIds` 默认值逐字相同）里是否包含这次实际使用的
     `model_id`；
  2. **endpoint 维度** —— `KERNEL_MODEL_BAILIAN_EXTENSIONS`（`"1"`/`"0"` 显式覆盖，
     未设置时按 `base_url` 的 hostname 是否严格等于 `dashscope.aliyuncs.com` /
     `www.dashscope.aliyuncs.com` 自动判定，解析失败 fail closed 为 `False`）——与
     TS 版 `isBailianBaseUrl` 同一判据、同一"严格 hostname 比较，不用子串匹配"的
     纪律（TS 那边 #2640 独立复审踩过子串匹配的坑，这里从一开始就按最终版写）。
两维都为真才在 `extra_body` 里带这个字段；任一维不满足 ⇒ 完全不带，请求体与本次
修复之前逐字节相同（同一纪律：未知能力不裸猜，见 `configured-model-provider.ts` 里
`thinkingDisableModelIds` / `bailianExtensionsEnabled` 各自头注，此处不复述）。

流式路径（这个文件目前从未启用 `streaming=True`）不在本次修复范围内，与 TS 版
"只在 `stream` 为 false 时关"是同一个决定。
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit

from langchain_openai import ChatOpenAI

DEFAULT_MODEL_ID = "qwen-plus"

# 2026-09-25 devapp 实测（人类原话「model call limit how it comes?」+「解决这个 bug」，
# 三次同一个失败：`web-artifact` 技能的「隔离浏览器验收」步骤失败，界面上说
# 「有一次工具调用始终没有返回结果……多半是它执行的脚本卡住或失败了」）。
#
# 真因不在浏览器验收脚本本身，在更上游一层：`ChatOpenAI` 构造时**从没传过
# `request_timeout`**（`langchain_openai.ChatOpenAI.request_timeout` 默认 `None`）。
# 本文件之外**每一处**打外部网络的地方都有显式、有界的超时（`standard_web_tools.py`
# / `native_factory.py` / `retrieval_embeddings.py` … 逐个 grep 过，唯独模型客户端
# 这一处没有）。DashScope 对长生成（`web-artifact` 要吐一整份自包含 HTML/CSS/JS，
# 比普通问答长得多）偶尔会在连接建立后迟迟不吐首字节——`stream_chunk_timeout`
# （库默认 120s）只挡「流已经开始、中途卡住」，挡不住「连接建立了但第一个字节
# 一直不来」这一种。
#
# 后果：`_focused_call` 里的 `model.stream()` 可以挂到没有上限，唯一能兜住它的是
# TS 侧的外层 `KERNEL_DEEP_AGENT_TIMEOUT_MS`（默认 300s）——那个超时触发时
# `call_skill` 这次工具调用还没关闭，`execute-run.ts` 的结构性判据（"这一轮终止时
# 还有已开未闭的工具调用"）据实分类成 `tool_call_unresolved`，如实说"卡住了"，
# 但代价是每次卡住都要吃满 5 分钟、还挡不住重试把 25 次模型调用配额耗光
# （另一张截图：`Model call limits exceeded: run limit (25/25)`——这两张截图
# 是同一条因果链的两端）。
#
# 修法：给模型客户端自己一个**比外层超时更短**的界——卡住时几十秒内在
# `_focused_call` 内部就失败，`call_skill` 现有的 `except Exception` 分支立刻把
# 它翻译成"技能「X」执行失败"回给编排模型，模型可以马上决定重试或换路，而不是
# 让整条 run 静默挂五分钟。默认 180s：比 `stream_chunk_timeout` 的 120s 宽松
# （首字节前的等待天然比"两个 token 之间"更容易长），又明显短于外层 300s——
# 留给外层判据兜底剩余的类别（比如网络彻底断开）。
MODEL_REQUEST_TIMEOUT_ENV = "KERNEL_DEEP_AGENT_MODEL_REQUEST_TIMEOUT_MS"
DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 180_000


def _model_request_timeout_seconds(env: "os._Environ[str]" = os.environ) -> float:
    raw = (env.get(MODEL_REQUEST_TIMEOUT_ENV) or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw) / 1000
    return DEFAULT_MODEL_REQUEST_TIMEOUT_MS / 1000

# #2700 —— 与 `configured-model-provider.ts` 的 `readThinkingDisableModelIds` 默认值
# 逐字相同，见本文件头注「判断逻辑必须与 configured-model-provider.ts 保持一致」。
# 2026-09-06 人类反馈「task 工具处理时间很长，把 thinking 关掉」：devapp 实测跑的是
# `qwen3.8-max`（`.harness/state/deepagent-eval/2026-08-23-3d327c13/.../01-sse-stream.txt`
# 里 140 条 `"model_name":"qwen3.8-max"`），不在此前的默认集合里，于是 thinking 一直
# 开着——百炼文档：qwen3.5/3.6/3.7/3.8 系列是混合思考模型，`enable_thinking` **默认 true**
# （https://help.aliyun.com/zh/model-studio/deep-thinking）。把它补进默认集合。
_DEFAULT_THINKING_DISABLE_MODEL_IDS = "qwen-plus,qwen3.7-plus,qwen3.8-max"

# 与 `configured-model-provider.ts` 的 `isBailianBaseUrl` 判据相同的真实百炼 host。
_BAILIAN_HOSTNAMES = frozenset({"dashscope.aliyuncs.com", "www.dashscope.aliyuncs.com"})
#: 百炼独享/私有实例的固定域（`llm-<实例 id>.<region>.maas.aliyuncs.com`）。
_BAILIAN_MAAS_SUFFIX = ".maas.aliyuncs.com"


class DeepAgentModelConfigError(RuntimeError):
    """Raised when this process cannot build a model client from its environment."""


def _is_bailian_base_url(base_url: str) -> bool:
    """严格按 hostname 比较，不用子串匹配——与 `configured-model-provider.ts` 的
    `isBailianBaseUrl` 同一判据（该函数头注记着为什么子串匹配不安全）。解析失败
    （`base_url` 不是合法 URL）fail closed 为 `False`。"""
    try:
        hostname = urlsplit(base_url).hostname or ""
    except ValueError:
        return False
    if hostname in _BAILIAN_HOSTNAMES:
        return True
    # 2026-09-07 devapp 实测：百炼独享实例是
    # `https://llm-<实例 id>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，
    # hostname 不含 dashscope，此前判 False ⇒ enable_thinking 从未关掉。按 host 段
    # 后缀匹配（不是子串），与 `configured-model-provider.ts` 的 `isBailianBaseUrl`
    # 逐字同一判据——两处改动必须同步，见该函数头注。
    return hostname.endswith(_BAILIAN_MAAS_SUFFIX)


def _thinking_disable_model_ids(env: "os._Environ[str]") -> frozenset[str]:
    raw = env.get("KERNEL_MODEL_THINKING_DISABLE_IDS") or _DEFAULT_THINKING_DISABLE_MODEL_IDS
    return frozenset(v.strip() for v in raw.split(",") if v.strip() != "")


def _bailian_extensions_enabled(env: "os._Environ[str]", base_url: str) -> bool:
    override = env.get("KERNEL_MODEL_BAILIAN_EXTENSIONS")
    if override == "1":
        return True
    if override == "0":
        return False
    return _is_bailian_base_url(base_url)


def build_chat_model() -> ChatOpenAI:
    base_url = (os.environ.get("KERNEL_MODEL_BASE_URL") or "").strip().rstrip("/")
    api_key = os.environ.get("KERNEL_MODEL_API_KEY") or ""
    model_id = (os.environ.get("KERNEL_DEEP_AGENT_MODEL_ID") or "").strip() or DEFAULT_MODEL_ID

    if base_url == "" or api_key == "":
        # Fail loudly at graph-build time, not silently at first tool call -- the same
        # "fail closed, never fabricate a call" discipline `ModelCallError` enforces on
        # the TS side (`ports.ts`'s own doc comment).
        raise DeepAgentModelConfigError(
            "KERNEL_MODEL_BASE_URL and KERNEL_MODEL_API_KEY must both be set for this "
            "deployment; deep-agent-service does not fall back to a different provider."
        )

    extra_body: dict[str, object] = {}
    if (
        model_id in _thinking_disable_model_ids(os.environ)
        and _bailian_extensions_enabled(os.environ, base_url)
    ):
        # #2700 -- see module docstring "enable_thinking: false for Qwen3 hybrid-thinking
        # models" for why, and why this mirrors `configured-model-provider.ts`'s two-axis gate.
        extra_body["enable_thinking"] = False

    # KERNEL_MODEL_REASONING_EFFORT (OpenAI-style `reasoning_effort`): WorkspaceX Local sets
    # `none` -- on Ollama >= 0.34 that is the only field that switches Qwen3.5 thinking off
    # (`think:false` on /v1 is ignored; measured 2026-09-17: 72 s / 6.5k reasoning chars -> 1.2 s / 0).
    # Mirrors configured-model-provider.ts; unset = not sent.
    reasoning_effort = (os.environ.get("KERNEL_MODEL_REASONING_EFFORT") or "").strip()
    if reasoning_effort:
        extra_body["reasoning_effort"] = reasoning_effort

    return ChatOpenAI(
        base_url=base_url,
        api_key=api_key,
        model=model_id,
        request_timeout=_model_request_timeout_seconds(),
        **({"extra_body": extra_body} if extra_body else {}),
    )
