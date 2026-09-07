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

The pinned runtime enables Playwright MCP's official `network` capability only so the adapter can install and immediately remove an exact, in-memory route for `https://preview.workspacex.invalid/workspace/web-artifact/*.html?viewport=desktop|mobile`. The MCP endpoint remains loopback-only, and the adapter allowlist does not expose route/unroute as canonical model tools. The HTML is read from the already owner-bound workspace, size/UTF-8/readback checked, and prefixed with a deny-by-default CSP. No preview DNS record or public hosting service is required.

## Verified local runtime (2026-09-07)

The browser image tested is official MCP v0.0.80, digest `dda1f7f9b812e22946635c8af7df9288b96d3b9e3f0f1b8576d6823e2031c1de`; its image entrypoint includes `--no-sandbox`, so compose explicitly replaces the entrypoint. Browser UID/GID are 1000. Squid 6.6-24.04_beta digest is `6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029`, run directly as its existing proxy UID/GID 13 with writable temporary PID/log directories.

`seccomp_profile.json` derives from [official Playwright v1.62.0](https://github.com/microsoft/playwright/blob/v1.62.0/utils/docker/seccomp_profile.json), following [official container guidance](https://playwright.dev/docs/docker). One additional allow entry permits `chroot` inside Chromium's unprivileged user namespace because `cap_drop: ALL` makes the upstream capability-conditional entry unavailable. No host capability, privileged mode, host IPC or disabled sandbox is used.

Docker did not publish a port on the internal-only browser network during actual acceptance. The separate ingress forwards only `/mcp` to the fixed browser service; it cannot act as a forward proxy. Only ingress exposes the host loopback port. The upstream Host is fixed to `localhost:8931`, matching the official exact Host-header comparison. No wildcard Host is accepted by the browser service.

Squid normalizes mapped IPv4 into IPv4 before destination ACL evaluation. A blanket `::ffff:0:0/96` ACL incorrectly denied ordinary public IPv4; private mapped addresses remain denied by the IPv4 ACL, verified with an actual CONNECT to `[::ffff:127.0.0.1]`. Evidence is in `docs/design/standard-capabilities/evidence/W10-real-browser/production-runtime/`. This is local acceptance of the production composition, not a deployed-service claim.
