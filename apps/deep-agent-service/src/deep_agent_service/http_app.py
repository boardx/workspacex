"""ASGI entrypoint compatible with the WorkspaceX LangGraph HTTP client subset."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from deep_agent_service.self_hosted_runtime import Runtime, _jsonable, production_runtime

GRAPH_IDS = ("Deep Agent", "Guided Research")


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
        latest = await rt(request).ledger.latest_run(thread_id)
        # The HTTP state endpoint represents the latest run on this thread.
        # Recover its assistant from the durable ledger, including after restart.
        assistant = (latest or {}).get("assistant_id") or "Deep Agent"
        config = {"configurable": {"thread_id": thread_id}}
        graph = rt(request).graph_loader(assistant, config)
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
