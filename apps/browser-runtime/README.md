# W10 controlled browser runtime

This stack keeps the official Playwright MCP process on an `internal: true` Docker network. It has no public-network interface; its only egress peer is Squid, which resolves destinations and refuses loopback, private, link-local, metadata, mapped IPv4, NAT64, multicast, and reserved ranges. Chromium is forced through that proxy, including loopback, and the MCP endpoint is published on host loopback only.

Both digest variables are mandatory; compose itself constructs immutable `name@sha256:<digest>` references. Resolve and review the official `mcr.microsoft.com/playwright/mcp` image matching `@playwright/mcp@0.0.80`, and a maintained `ubuntu/squid` image, before deployment. There is deliberately no mutable-tag or unsafe default.

```sh
export BROWSER_RUNTIME_IMAGE_DIGEST='<reviewed-64-hex-manifest-digest>'
export BROWSER_EGRESS_PROXY_IMAGE_DIGEST='<reviewed-64-hex-manifest-digest>'
export BROWSER_UID=1000 BROWSER_GID=1000
docker compose -f apps/browser-runtime/docker-compose.browser.yml config
docker compose -f apps/browser-runtime/docker-compose.browser.yml up -d
```

Set `WORKSPACEX_BROWSER_MCP_ENDPOINT=http://127.0.0.1:58931/mcp` for the API composition. Do not add `browser_public` to `browser-runtime`, use `--shared-browser-context`, set `--allowed-hosts '*'`, or add a proxy bypass. If the host cannot run the browser with `--sandbox` and the non-root UID, deployment must fail rather than add `--no-sandbox`.
