# Locked Deep Agent image build

2026-09-07. The previous Dockerfile used `pip install -e .`, resolving floating ranges instead of the tested uv.lock. Native compatibility must not silently run a different upstream version in the image.

The Dockerfile now copies uv.lock and uses official uv 0.12.5 with `uv sync --frozen --no-dev --no-cache --python /usr/local/bin/python`. The installed virtual environment is the image command PATH. No model credentials or network service were used for validation.

`docker build -t workspacex-deep-agent:standard-lock .` from apps/deep-agent-service exited 0. Resolved uv image: `sha256:e85be844203885286c60ffad8a858d48afb6c5a5c237ca0e67f12e74b8f174b1`. Built image manifest list: `sha256:3b21da3dcdebd4900fe428d202c733bb0044f66be6e30f2e449018c3a0422641`. Build used Python 3.11.15, installed 107 packages and the project.

A `docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true` with Python entrypoint imported native_graph and read installed distribution versions; exit 0:

```text
{'deepagents': '0.7.6', 'langchain': '1.3.15', 'langgraph': '1.2.11', 'langgraph-api': '0.12.4'}
```

This image validates dependency-lock consumption and module import only. Its source snapshot predates the subsequent grep compatibility fix; it is not the final deployment image, production startup evidence, or real-model verification. The validation container used --rm; no persistent service was started.
