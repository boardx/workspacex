"""#3206：量一次「发现技能元数据」到底花什么。无 docker、无真实模型、无 DB。

uv run python scripts/measure_skill_metadata_cost.py
"""
import base64, hashlib, json, os, sys, time
from pathlib import Path

import httpx
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps/deep-agent-service/src"))
sys.path.insert(0, str(REPO / "apps/deep-agent-service/tests"))

from deep_agent_service.native_graph import create_native_graph
from deep_agent_service.skill_packages import package_mount_files
from deep_agent_service.sandbox_backend import HttpSessionSandbox
from native_sandbox_fixture import FakeAuthority
from test_native_graph import ScriptedModel


def build_corpus():
    """20 skills: the 16 real repo packages + 4 platform office packages (real SKILL.md bytes)."""
    pins = []
    for skill_md in sorted((REPO / "skills").rglob("SKILL.md")):
        d = skill_md.parent
        name = d.name
        files = []
        for f in sorted(d.rglob("*")):
            if f.is_file():
                b = f.read_bytes()
                files.append({"path": str(f.relative_to(d)), "contentBase64": base64.b64encode(b).decode(),
                              "mediaType": "text/plain", "digest": hashlib.sha256(b).hexdigest()})
        pins.append({"stable_name": name, "package": {"skillId": f"s-{name}", "versionId": "v1", "files": files}})
    # 平台官方四件套不在本仓 skills/ 下（正文由 apps/api/scripts/office-skill-packages.ts
    # 生成），这里用它逐字写死的同一段 frontmatter + 等长正文补足到人类看到的 20 个。
    description = "Create Office files with preinstalled libraries and perform explicitly limited edits."
    office = {name: f"---\nname: {name}\ndescription: {description}\n---\n\n" + "x" * 4000
              for name in ("pptx-create", "docx-create", "xlsx-create", "pdf-create")}
    for name, body in office.items():
        b = body.encode()
        pins.append({"stable_name": name, "package": {"skillId": f"skill-platform-{name}", "versionId": "v1", "files": [
            {"path": "SKILL.md", "contentBase64": base64.b64encode(b).decode(), "mediaType": "text/plain",
             "digest": hashlib.sha256(b).hexdigest()}]}})
    return pins


class CountingSandboxTransport(httpx.BaseTransport):
    """In-process stand-in for the sandbox HTTP service. Counts every round trip."""
    def __init__(self, files, mirror):
        self.mirror = mirror
        self.files = files          # abs path -> bytes
        self.requests = []          # (method, path, response_bytes)

    def handle_request(self, request):
        p = request.url.path
        if p.endswith("/files") and request.method == "GET":
            path = request.url.params["path"]
            content = self.files.get(path)
            body = ({"path": path, "contentBase64": base64.b64encode(content).decode(), "sizeBytes": len(content), "mediaType": "text/plain"}
                    if content is not None else {"path": path, "error": "not found"})
            out = json.dumps(body).encode()
        elif p.endswith("/executions"):
            cmd = json.loads(request.content)["command"]
            body = json.loads(request.content)
            out = json.dumps({"executionId": body["executionId"], "output": self._run(body["command"]),
                              "exitCode": 0, "truncated": False, "timedOut": False, "cancelled": False}).encode()
        else:
            out = b"{}"
        self.requests.append((request.method, p, len(out)))
        return httpx.Response(200, content=out)

    def _run(self, cmd):
        """Run the authentic upstream ls script, with only its base64 path argument rebased."""
        import re, subprocess

        def rebase(match):
            raw = base64.b64decode(match.group(1)).decode()
            return "base64.b64decode('%s')" % base64.b64encode((self.mirror + raw).encode()).decode()

        real = re.sub(r"base64\.b64decode\(\\?'([A-Za-z0-9+/=]+)\\?'\)", rebase, cmd)
        done = subprocess.run(["/bin/sh", "-c", real], capture_output=True, text=True)
        return done.stdout.replace(self.mirror, "")


def main():
    pins = build_corpus()
    mount = package_mount_files(pins)
    files = {f["path"]: base64.b64decode(f["contentBase64"]) for f in mount}
    import tempfile
    mirror = tempfile.mkdtemp()
    for path, content in files.items():
        target = Path(mirror) / path.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    transport = CountingSandboxTransport(files, mirror)
    client = httpx.Client(transport=transport, base_url="http://sandbox")
    adapter = HttpSessionSandbox("00000000-0000-4000-8000-000000000001", "a" * 64, client)

    print(f"skills                     : {len(pins)}")
    print(f"mounted package files      : {len(mount)}  ({sum(len(v) for v in files.values())} bytes)")

    t0 = time.perf_counter()
    facts = []
    model = ScriptedModel(messages=iter([AIMessage(content="done"), AIMessage(content="done")]))
    graph = create_native_graph(model, sandbox=adapter, pinned_skills=pins, tool_authority=FakeAuthority(),
                                interrupt_on={}, checkpointer=InMemorySaver())
    build_ms = (time.perf_counter() - t0) * 1000
    build_reqs = len(transport.requests)
    print(f"\n[graph construction] {build_ms:.1f} ms, {build_reqs} sandbox round trips, "
          f"{sum(r[2] for r in transport.requests)} bytes returned")

    cfg = {"configurable": {"thread_id": "t1", "disable_task_auto_classify": True}}
    for turn in (1, 2):
        mark = len(transport.requests)
        t = time.perf_counter()
        emitted = []
        for mode, chunk in graph.stream({"messages": [{"role": "user", "content": "总结这个网页: https://example.com"}]},
                                        config=cfg, stream_mode=["custom", "values"]):
            if mode == "custom" and isinstance(chunk, dict) and chunk.get("type") == "skill_activity":
                emitted.append(chunk["fact"])
            if mode == "values":
                last = chunk
        ms = (time.perf_counter() - t) * 1000
        reqs = transport.requests[mark:]
        stages = {}
        for f in emitted:
            stages[f["stage"]] = stages.get(f["stage"], 0) + 1
        print(f"\n[turn {turn}] {ms:.1f} ms total, {len(reqs)} sandbox round trips "
              f"({sum(r[2] for r in reqs)} bytes), skill_activity events={len(emitted)} {stages}")
        facts.append(emitted)

    print(f"\nturn2 re-reported turn1's identical facts : "
          f"{[f['factId'] for f in facts[1]] == [f['factId'] for f in facts[0]] and bool(facts[1])} "
          f"(#3206 修复前 True/20 条，修复后 False/0 条)")

    # isolated cost of metadata_discovered itself
    from deep_agent_service import native_skill_activity as act
    reporter = act.NativeSkillActivity(pins)
    entries = [{"path": f"/skills/{p['stable_name']}/SKILL.md", "name": p["stable_name"]} for p in pins]
    sink = []
    orig = act.get_stream_writer
    act.get_stream_writer = lambda: sink.append
    per = []
    for _ in range(50):
        sink.clear()
        t = time.perf_counter()
        reporter.metadata_discovered(entries)
        per.append((time.perf_counter() - t) * 1000)
    act.get_stream_writer = orig
    per.sort()
    print(f"metadata_discovered({len(pins)} skills) median {per[len(per)//2]:.3f} ms "
          f"=> {per[len(per)//2]/len(pins)*1000:.1f} us per event; 0 network, 0 DB, 0 model tokens")

    # prompt cost: what the skills list actually injects each turn
    from deepagents.middleware.skills import SkillsMiddleware
    from deepagents.backends import StateBackend
    mw = SkillsMiddleware(backend=StateBackend(), sources=["/skills/"])
    meta = []
    for p in pins:
        md = files[f"/skills/{p['stable_name']}/SKILL.md"].decode()
        fm = md.split("---")[1]
        desc = next((l.split(":", 1)[1].strip() for l in fm.splitlines() if l.startswith("description:")), "")
        meta.append({"name": p["stable_name"], "description": desc, "path": f"/skills/{p['stable_name']}/SKILL.md", "allowed_tools": []})
    listing = mw._format_skills_list(meta)
    print(f"skills list injected into system prompt every turn: {len(listing)} chars "
          f"(~{len(listing)//4} tokens, {len(meta)} entries)")


main()
