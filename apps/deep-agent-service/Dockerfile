# deep-agent-service (#739) -- same shape as the existing open_deep_research deployment
# (`python:3.11-slim`, `langgraph dev`). See #738's investigation for
# why this is a standalone service rather than a chat-completion-shaped provider.
#
# ⚠ #738 core current, NOT this PR's invention: `.harness/scripts/vm/deploy.sh` does not
# auto-build/run the open_deep_research container today -- it is started by hand on the VM
# (see `deep-research-model-provider.ts`'s own header comment). This Dockerfile is written
# so a human can build and run it the same way; it is NOT wired into `deploy.sh`'s automated
# path, and this PR does not claim it is.
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock langgraph.json ./
COPY src ./src

# Native adapters validate the tested upstream version. Use the same lock as CI
# and local verification instead of resolving a newer dependency at image build.
RUN uv sync --frozen --no-dev --no-cache --python /usr/local/bin/python
ENV PATH="/app/.venv/bin:$PATH"

# Required at container-start time (see `src/deep_agent_service/model.py`'s own doc
# comment): KERNEL_MODEL_BASE_URL, KERNEL_MODEL_API_KEY (same values as apps/api's copies,
# no new credential), KERNEL_DEEP_AGENT_MODEL_ID (defaults to a placeholder, see model.py).
#
# Bound to 127.0.0.1 on the VM host side via `-p 127.0.0.1:<port>:2024`, same discipline the
# open_deep_research container already uses -- this service has no auth of its own.
EXPOSE 2024

CMD ["langgraph", "dev", "--host", "0.0.0.0", "--port", "2024", "--allow-blocking", "--no-browser"]
