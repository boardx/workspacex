ARG PYTHON_IMAGE=python:3.11-slim
FROM ${PYTHON_IMAGE}
ARG PYPI_INDEX_URL=https://pypi.org/simple
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock langgraph.json ./
COPY src ./src

# Export exact versions and hashes from the reviewed lock without its origin-bound
# artifact URLs, then let the configured PEP 503 index serve matching artifacts.
RUN uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file /tmp/requirements.lock \
 && uv venv --python /usr/local/bin/python /app/.venv \
 && uv pip install --python /app/.venv/bin/python --require-hashes --no-cache \
      --default-index "$PYPI_INDEX_URL" -r /tmp/requirements.lock \
 && rm -f /tmp/requirements.lock
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src"

# Required at container-start time (see `src/deep_agent_service/model.py`'s own doc
# comment): KERNEL_MODEL_BASE_URL, KERNEL_MODEL_API_KEY (same values as apps/api's copies,
# no new credential), KERNEL_DEEP_AGENT_MODEL_ID (defaults to a placeholder, see model.py).
#
# This ASGI service is reachable only on the deployment's private compose network.
EXPOSE 8000

CMD ["/app/.venv/bin/uvicorn", "deep_agent_service.http_app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
