"""ASGI entrypoint compatible with the WorkspaceX LangGraph HTTP client subset."""
from __future__ import annotations

import asyncio
import json
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any
from types import SimpleNamespace

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from deep_agent_service.self_hosted_runtime import GRAPH_IDS, NATIVE_SNAPSHOT_EVENT, Runtime, _jsonable, enter_graph, graph_config, is_native_config, production_runtime


def _wire(value: Any) -> Any: return _jsonable(value)


def create_app(runtime: Runtime | None = None) -> Starlette:
    selected = runtime

    @asynccontextmanager
    async def lifespan(app: Starlette):
        nonlocal selected
        selected = selected or production_runtime()
        app.state.runtime = selected
        await selected.start()
        try: yield
        finally: await selected.stop()

    def rt(request: Request) -> Runtime:
        return request.app.state.runtime

    async def thread_snapshot(request: Request, thread_id: str):
        runtime = rt(request)
        # A created thread has a real, canonical state before its first run: no
        # messages and no next node. Loading a graph here asks its checkpointer for
        # a checkpoint that cannot exist yet. The production checkpointer raises,
        # `state()` turns that into 404, and the API aborts the first native run
        # before it can submit `/runs`. Distinguish that known-empty state from an
        # unknown thread through the durable ledger; never turn arbitrary graph or
        # checkpoint failures on an existing run into an empty success.
        thread = await runtime.ledger.get_thread(thread_id)
        if thread is None:
            raise LookupError("THREAD_NOT_FOUND")
        latest = await runtime.ledger.latest_run(thread_id)
        if latest is None:
            return SimpleNamespace(values={"messages": []}, next=(), tasks=()), None
        # The HTTP state endpoint represents the latest run on this thread.
        # Recover its assistant from the durable ledger, including after restart.
        assistant = (latest or {}).get("assistant_id") or "Deep Agent"
        config = graph_config(thread_id, (latest or {}).get("config"))
        config["configurable"].pop("checkpoint_id", None)
        if latest and is_native_config(config):
            # A running graph already owns this native session. Recreating it for
            # polling verifies mounted files through another adapter and races
            # the tool's exclusive sandbox slot (SESSION_BUSY / HTTP 409).
            active = runtime.active_graph(latest["run_id"])
            if active is not None:
                return await active.aget_state(config), latest
            for event in reversed(await runtime.ledger.events(latest["run_id"])):
                if event["event"] == NATIVE_SNAPSHOT_EVENT:
                    saved = event["data"]
                    return SimpleNamespace(values=saved["values"], next=tuple(saved["next"]),
                        tasks=tuple(SimpleNamespace(**task) for task in saved["tasks"])), latest
            # Older runs predate the durable projection. Retain their existing
            # live-binding read path; never fabricate missing state/interrupts.
        async with AsyncExitStack() as stack:
            graph = await enter_graph(stack, runtime.graph_loader(assistant, config))
            return await graph.aget_state(config), latest

    async def health(_request: Request):
        return JSONResponse({"ok": True, "runtime": "workspacex-self-hosted"})

    async def assistants(request: Request):
        body = await request.json()
        graph_id = body.get("graph_id")
        matches = GRAPH_IDS if graph_id is None else tuple(item for item in GRAPH_IDS if item == graph_id)
        return JSONResponse([{"assistant_id": item, "graph_id": item} for item in matches])

    async def create_thread(request: Request):
        body = await request.json()
        thread_id = body.get("thread_id") or __import__("uuid").uuid4().hex
        try: await rt(request).ledger.create_thread(thread_id, body.get("if_exists", "reject"))
        except ValueError: return JSONResponse({"detail": "thread already exists"}, status_code=409)
        return JSONResponse({"thread_id": thread_id})

    async def read_thread(request: Request):
        thread_id = request.path_params["thread_id"]
        row = await rt(request).ledger.get_thread(thread_id)
        if row is None: return JSONResponse({"detail": "not found"}, status_code=404)
        try:
            snapshot, _latest = await thread_snapshot(request, thread_id)
            interrupts = {str(getattr(task, "id", index)): _wire(getattr(task, "interrupts", ()))
                for index, task in enumerate(getattr(snapshot, "tasks", ()) or ()) if getattr(task, "interrupts", ())}
            if interrupts: row = {**row, "status": "interrupted", "interrupts": interrupts}
        except Exception:
            pass
        return JSONResponse(_wire(row))

    async def create_run(request: Request):
        thread_id = request.path_params["thread_id"]
        if await rt(request).ledger.get_thread(thread_id) is None: return JSONResponse({"detail": "not found"}, status_code=404)
        body = await request.json()
        try: run_id = await rt(request).create_run(thread_id, body)
        except ValueError: return JSONResponse({"detail": "assistant not found"}, status_code=404)
        return JSONResponse({"run_id": run_id})

    async def read_run(request: Request):
        row = await rt(request).ledger.get_run(request.path_params["thread_id"], request.path_params["run_id"])
        return JSONResponse({k: _wire(v) for k, v in row.items()} if row else {"detail": "not found"}, status_code=200 if row else 404)

    async def state(request: Request):
        thread_id = request.path_params["thread_id"]
        try: snapshot, latest = await thread_snapshot(request, thread_id)
        except Exception: return JSONResponse({"detail": "not found"}, status_code=404)
        tasks = [{"id": getattr(task, "id", None), "interrupts": _wire(getattr(task, "interrupts", ())) } for task in (getattr(snapshot, "tasks", ()) or ())]
        return JSONResponse({"values": _wire(getattr(snapshot, "values", {})), "next": list(getattr(snapshot, "next", ()) or ()), "tasks": tasks,
            "metadata": {"run_id": latest["run_id"], "langgraph_run_id": latest["run_id"]} if latest else {}})

    async def cancel(request: Request):
        ok = await rt(request).cancel(request.path_params["thread_id"], request.path_params["run_id"])
        return JSONResponse({"ok": ok}, status_code=200 if ok else 404)

    async def stream(request: Request):
        run_id = request.path_params["run_id"]
        async def generate():
            sent = 0
            while True:
                rows = await rt(request).ledger.events(run_id)
                for row in rows[sent:]:
                    sent += 1
                    if row["event"] == NATIVE_SNAPSHOT_EVENT:
                        continue
                    yield f"id: {row['sequence']}\nevent: {row['event']}\ndata: {json.dumps(row['data'], ensure_ascii=False)}\n\n"
                run = await rt(request).ledger.get_run(request.path_params["thread_id"], run_id)
                if run is None or run["status"] in {"success", "error", "cancelled", "interrupted"}: break
                await asyncio.sleep(0.05)
        return StreamingResponse(generate(), media_type="text/event-stream")

    from deep_agent_service.retrieval_embeddings import app as retrieval_app
    routes = [
        Route("/healthz", health), Route("/assistants/search", assistants, methods=["POST"]),
        Route("/threads", create_thread, methods=["POST"]), Route("/threads/{thread_id}", read_thread),
        Route("/threads/{thread_id}/runs", create_run, methods=["POST"]),
        Route("/threads/{thread_id}/runs/{run_id}", read_run),
        Route("/threads/{thread_id}/runs/{run_id}/cancel", cancel, methods=["POST"]),
        Route("/threads/{thread_id}/runs/{run_id}/stream", stream), Route("/threads/{thread_id}/state", state),
    ]
    routes.extend(retrieval_app.routes)
    return Starlette(lifespan=lifespan, routes=routes)


app = create_app()
