ARG PYTHON_IMAGE=python:3.11-slim
FROM ${PYTHON_IMAGE}
ARG PYPI_INDEX_URL=https://pypi.org/simple
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock langgraph.json ./
COPY src ./src

# Native adapters validate the tested upstream version. Use the same lock as CI
# and local verification instead of resolving a newer dependency at image build.
RUN UV_DEFAULT_INDEX="$PYPI_INDEX_URL" uv sync --frozen --no-dev --no-cache --python /usr/local/bin/python
ENV PATH="/app/.venv/bin:$PATH"

# Required at container-start time (see `src/deep_agent_service/model.py`'s own doc
# comment): KERNEL_MODEL_BASE_URL, KERNEL_MODEL_API_KEY (same values as apps/api's copies,
# no new credential), KERNEL_DEEP_AGENT_MODEL_ID (defaults to a placeholder, see model.py).
#
# This ASGI service is reachable only on the deployment's private compose network.
EXPOSE 8000

CMD ["/app/.venv/bin/uvicorn", "deep_agent_service.http_app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
