"""③ 可调用 + ④ 产出可验证：每个原生工具**真的被调起来**，且它真的产出了对的东西。

## 这一层此前是空的

"能力可用性矩阵"把"能用"拆成四层：① 可发现 ② 可加载 ③ 可调用 ④ 产出可验证。
①② 有门控（`test_native_tool_admission.py`、`tool-risk-tier-names-are-real.test.ts`），
③④ 一直**没有跑过**，理由是"需要真实模型"。不需要：工具能不能被调起来、产出对不对，
和模型选谁无关——模型只负责决定**调不调**。这里用确定性替身把 ③④ 补上。

## ③ 的证据是什么（不是"它在清单里"）

每条用例把工具的 `coroutine` 真的 await 一次，`httpx.AsyncClient` 被换成
`MockTransport`。工具**自己的代码**跑到了它**自己的**端点，才会有一条请求被记下来：

* 记到 0 条 ⇒ 断言直接红。工具在参数校验阶段就 fail closed（本仓多次遇到）时，
  "没炸"看起来像通过——所以每条用例都断言 `len(seen) == 1`，而不是断言"没抛意外的异常"。
* 端点是**逐工具不同的**（`/standard-canvas/invoke` ≠ `/schedule/tools/invoke` ≠
  `/subtasks/spawn`）：路径本身就是"是这个工具跑的、不是别的工具跑的"的哨兵。

## ④ 的证据是什么（禁止用大小/存在性当判据）

真的把请求字节 `json.loads` 出来，逐字段核对**本轮**的哨兵值：
`toolCallId` 必须是本轮的 tool call id，`toolArgs` 必须逐字段等于本轮传进去的参数
（每个工具带一个只属于它的 `sent-<toolname>` 串），`toolName` 必须是它自己。
"请求发出去了"不算产出对——发错工具名、丢字段、把参数吞掉，都会在这里红。

## 反向：不确定的结果必须 fail closed

上游 503 时每个工具都必须给出**结构化**的失败（抛自己模块的异常，或返回明确的拒绝
正文），并且失败正文里不得出现内部密钥。这条和 ③ 用同一次调用取证。

## 覆盖是强制的

`test_every_constructed_tool_is_covered` 把台账的键与 `native_candidate_tools` 真的
构造出来的名字做全等比对。**新加一个工具却不写用例，这个文件当场红**——台账不是可选的
文档，是门控的一部分。三个人机交互工具（`confirm_task_intent` 等）没有 HTTP 派发面，
单独列名并单独断言，不是"跳过"。
"""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from deep_agent_service.native_factory import native_candidate_tools
from deep_agent_service.tools import build_tools
from test_native_graph import model
from test_native_tool_admission import ADMISSION

INTERNAL_KEY = "service-secret-must-not-leak"
CALL_ID = "tool-call-of-this-round"
BINDING = "11111111-2222-4333-8444-555555555555"
PAGE_REF = "page:" + "a" * 64
ELEMENT_REF = "element:" + "b" * 64
SENTINEL = "%SENTINEL%"

# 人机交互工具：它们的语义就是"停下来问人"，没有出站派发面，`interrupt_on` 恒为 True。
INTERRUPT_ONLY = {"confirm_task_intent", "fill_run_params", "choose_execution_option"}

# name -> (端点路径后缀, 503 时的表现, 参数)。`%SENTINEL%` 在跑之前替换成 `sent-<name>`。
# "returns-refusal"：web 两件不抛异常，而是把结构化拒绝正文交回给模型（换一个来源继续），
# 这是它们的既定契约，不是漏抛——所以这里逐工具声明，而不是笼统地 try/except。
DISPATCH: dict[str, tuple[str, str, dict]] = {
    "spawn_async_task": ("/subtasks/spawn", "raises", {"description": SENTINEL, "idempotencyKey": SENTINEL}),
    "wx_artifact_download": ("/standard-artifact-download/invoke", "raises", {"artifactId": SENTINEL, "versionId": "v1", "purpose": "download"}),
    "wx_run_status": ("/standard-run-status/invoke", "raises", {"runId": SENTINEL}),
    "wx_run_cancel": ("/standard-run-cancel/invoke", "raises", {"runId": SENTINEL, "idempotencyKey": SENTINEL}),
    "wx_artifact_publish": ("/native-artifacts/stage", "raises", {"workspacePath": "/workspace/" + SENTINEL, "title": SENTINEL, "mediaType": "text/markdown", "idempotencyKey": SENTINEL}),
    "web_search": ("/standard-web/invoke", "returns-refusal", {"query": SENTINEL}),
    "fetch_url": ("/standard-web/invoke", "returns-refusal", {"url": "https://example.invalid/" + SENTINEL}),
    "browser_navigate": ("/standard-browser/invoke", "raises", {"url": "https://example.invalid/" + SENTINEL}),
    "browser_snapshot": ("/standard-browser/invoke", "raises", {"pageRef": PAGE_REF}),
    "browser_click": ("/standard-browser/invoke", "raises", {"pageRef": PAGE_REF, "elementRef": ELEMENT_REF}),
    "browser_fill_form": ("/standard-browser/invoke", "raises", {"pageRef": PAGE_REF, "fields": [{"ref": ELEMENT_REF, "value": SENTINEL}]}),
    "browser_take_screenshot": ("/standard-browser/invoke", "raises", {"pageRef": PAGE_REF}),
    "wx_memory_search": ("/memory/source-proof", "raises", {"query": SENTINEL}),
    "wx_memory_write": ("/memory/source-proof", "raises", {"text": SENTINEL, "sourceMessageId": SENTINEL, "idempotencyKey": "idem-key"}),
    "wx_memory_delete": ("/memory/source-proof", "raises", {"memoryId": BINDING, "expectedRevision": 1}),
    "wx_knowledge_search": ("/standard-context/invoke", "raises", {"query": SENTINEL}),
    "wx_knowledge_read": ("/standard-context/invoke", "raises", {"sourceId": SENTINEL, "versionId": "v1"}),
    "wx_project_list": ("/standard-context/invoke", "raises", {"query": SENTINEL}),
    "wx_project_read": ("/standard-context/invoke", "raises", {"projectId": SENTINEL}),
    "wx_canvas_read": ("/standard-canvas/invoke", "raises", {"canvasId": SENTINEL}),
    "wx_canvas_update": ("/standard-canvas/invoke", "raises", {"canvasId": SENTINEL, "expectedRevision": 1, "changes": {"kind": "replace-source", "markdown": SENTINEL}, "idempotencyKey": "idem-key"}),
    "wx_document_parse": ("/document/parse", "raises", {"workspacePath": "/inputs/" + SENTINEL}),
    "sql_db_list_tables": ("/sql/source/check", "raises", {"tool_input": ""}),
    "sql_db_schema": ("/sql/source/check", "raises", {"table_names": SENTINEL}),
    "sql_db_query": ("/sql/source/check", "raises", {"query": "select 1 -- " + SENTINEL}),
    "sql_db_query_checker": ("/sql/source/check", "raises", {"query": "select 1 -- " + SENTINEL}),
    "wx_schedule_create": ("/schedule/tools/invoke", "raises", {"instruction": SENTINEL, "timezone": "UTC", "idempotencyKey": BINDING, "trigger": "cron", "scheduleSpec": {"expression": "0 9 * * 1"}}),
    "wx_schedule_list": ("/schedule/tools/invoke", "raises", {}),
    "wx_schedule_cancel": ("/schedule/tools/invoke", "raises", {"scheduleId": BINDING}),
    "wx_image_generate": ("/image-generate", "raises", {"prompt": SENTINEL, "sizeProfile": "square", "idempotencyKey": "idem-key"}),
    "wx_audio_transcribe": ("/audio-transcribe", "raises", {"attachmentId": SENTINEL}),
    "wx_skill_create_draft": ("/skill-draft", "raises", {"stableName": "probe-skill", "name": SENTINEL, "description": SENTINEL,
                                                        "semanticVersion": "1.0.0", "files": [{"workspacePath": "/workspace/SKILL.md", "packagePath": "SKILL.md"}],
                                                        "inputSchema": {}, "outputSchema": {}, "dependencies": []}),
    # `wx_artifact_publish` 的线上正文没有 toolName 字段（端点本身唯一标识它）。
}
NO_TOOL_NAME_ON_THE_WIRE = {"wx_artifact_publish"}


def constructed_tools():
    chat = model()
    return {tool.name: tool for tool in native_candidate_tools(chat, build_tools(chat, interactions_only=True))}


def runtime():
    return SimpleNamespace(tool_call_id=CALL_ID, config={"configurable": {
        "native_runtime": {"bindingId": BINDING},
        "wsx_memory_scope": {"orgId": "org", "userId": "user"},
        "run_control_callback": {"base_url": "http://gateway", "key": INTERNAL_KEY,
                                 "org_id": "org", "run_id": "run", "attempt_id": "run:0", "lease_epoch": 2}}})


def test_every_constructed_tool_is_covered():
    """台账必须覆盖真的构造出来的每一个工具——新工具漏写用例，这里红。"""
    names = set(constructed_tools())
    assert names, "no tools constructed at all"
    assert sorted(names) == sorted(set(DISPATCH) | INTERRUPT_ONLY), (
        f"no dispatch case={sorted(names - set(DISPATCH) - INTERRUPT_ONLY)} "
        f"case for a tool nobody constructs={sorted((set(DISPATCH) | INTERRUPT_ONLY) - names)}")


def test_interrupt_only_tools_have_no_dispatch_surface():
    """三个交互工具不出站，它们的"可调用"就是"必定停下来问人"——准入表里恒为 True。"""
    tools = constructed_tools()
    for name in sorted(INTERRUPT_ONLY):
        assert name in tools
        assert ADMISSION["interruptOn"][name] is True


@pytest.mark.parametrize("name", sorted(DISPATCH))
def test_tool_really_dispatches_with_this_rounds_sentinel(monkeypatch, name):
    endpoint, outcome, template = DISPATCH[name]
    sentinel = f"sent-{name}"
    args = json.loads(json.dumps(template).replace(SENTINEL, sentinel))
    tool = constructed_tools()[name]

    seen: list[httpx.Request] = []

    def handle(request):
        seen.append(request)
        return httpx.Response(503, stream=httpx.ByteStream(b"{}"))

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handle), **kw))

    failure = ""
    if outcome == "raises":
        with pytest.raises(Exception) as caught:
            asyncio.run(tool.coroutine(runtime=runtime(), **args))
        # 结构化失败：模块自己的异常类型，不是 KeyError/TypeError 之类的裸崩。
        assert type(caught.value).__name__.endswith("Error")
        assert type(caught.value) not in (KeyError, TypeError, ValueError, AttributeError)
        failure = str(caught.value)
    else:
        returned = asyncio.run(tool.coroutine(runtime=runtime(), **args))
        failure = str(getattr(returned, "content", returned))
        assert failure.strip(), "an unknown upstream outcome must not come back as empty content"
    assert INTERNAL_KEY not in failure

    # ③ 它真的跑了：请求记到了，且落在它自己的端点上。
    assert len(seen) == 1, f"{name} never reached its endpoint (recorded {len(seen)} requests)"
    assert seen[0].url.path.endswith(endpoint), seen[0].url.path

    # ④ 产出的正文逐字段是对的——解析真实字节，核对本轮哨兵，不看长度、不看存在性。
    body = json.loads(seen[0].content)
    assert body["toolCallId"] == CALL_ID
    assert body["toolArgs"] == args, f"{name} did not put this round's arguments on the wire: {body['toolArgs']}"
    if name in NO_TOOL_NAME_ON_THE_WIRE:
        assert "toolName" not in body
    else:
        assert body["toolName"] == name
    if sentinel in json.dumps(args):
        assert sentinel in seen[0].content.decode()
