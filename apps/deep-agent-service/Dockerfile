FROM python:3.11-slim
WORKDIR /app

# issue #2880 —— 按 uv.lock 安装，不再 `pip install -e .`：后者解析出 langgraph-api 0.10.3
# （EOL），与本地/测试锁定的 0.12.4 两套运行时；本地绿 ≠ 线上跑的是同一份代码。
COPY pyproject.toml uv.lock langgraph.json ./
COPY src ./src
RUN pip install --no-cache-dir uv==0.12.5 \
 && uv sync --frozen --no-dev \
 && rm -rf /root/.cache

EXPOSE 2024

# issue #2880（2026-09-07 devapp docker logs 取证）：
# · `--no-reload`：生产不监视文件。运行时自己往 `.langgraph_api/` 写持久化，被 dev 的
#   watchfiles 当成代码改动每 10s 触发一次重载，在跑的 run 被反复打断。
# · `--n-jobs-per-worker 10`：默认 1 ⇒ `Worker stats max=1`，一个慢/卡的 run 让后面所有
#   run 排队（实测 n_pending=5、最长等待 2638s），用户侧表现为全站「模型正在思考…」。
# · 仍是 `langgraph dev`（in-memory 运行时 + 可选 Postgres 检查点）——换 `langgraph up`
#   需要许可证/控制面，不在本 issue 范围。
CMD ["/app/.venv/bin/langgraph", "dev", "--host", "0.0.0.0", "--port", "2024", \
     "--allow-blocking", "--no-browser", "--no-reload", "--n-jobs-per-worker", "10"]
