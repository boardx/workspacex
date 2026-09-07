# Session isolation opt-in

The existing compose file is unchanged. Sessions require the separate override and a Linux host that passes the bubblewrap probe. The default Docker seccomp profile refuses user namespaces with `cap_drop: ALL`; the service returns 503 there. There is no host or macOS execution fallback.

From `apps/skill-sandbox`:

```sh
docker compose -f docker-compose.sessions.yml -p wx-e003 build
docker compose -f docker-compose.sessions.yml -p wx-e003 run --rm \
  --volume "$PWD/tests/session-container.mjs:/session-test.mjs:ro" \
  --entrypoint node skill-sandbox-sessions /session-test.mjs
docker compose -f docker-compose.sessions.yml -p wx-e003 down --volumes
```

For a private gateway deployment, use the standalone sessions compose file (Compose 2.24.4+) and its separate `/run/sessions/skill-sandbox.sock` transport. This launches only `skill-sandbox-sessions`, with its own socket volume, and returns 404 for `/run`. The original service keeps its original seccomp policy, socket and `/run` behavior. Do not publish this service on a public network. Session creation is trusted gateway access; returned session bearer tokens must never be passed to the model or executed environment. Review supported host-kernel behavior before enabling this override in production.

`docker-seccomp.json` starts from Moby profiles commit `61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31`, Apache-2.0 (see MOBY-LICENSE). Original file SHA256: `536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`. Source: https://raw.githubusercontent.com/moby/profiles/61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31/seccomp/default.json . The only changes append allow rules for unshare, mount, umount2, pivot_root and clone. This is a fixed upstream baseline, not a claim of identity with a particular Docker binary's embedded profile.

The outer exceptions permit trusted bubblewrap setup. Before user code starts, bubblewrap's official `--seccomp FD` installs the immutable native-architecture BPF produced at image build through libseccomp. It denies unshare/setns/mount/umount2/pivot_root/chroot and every clone namespace flag. clone3 returns ENOSYS to preserve the normal libc clone fallback. Missing BPF or failed application causes the trusted probe to fail closed. No `/proc` is mounted. The second layer provides the nested-namespace prohibition, replacing bubblewrap's proc-dependent `--disable-userns` mechanism.

Only the session workspace is writable and its skills tree read-only. Runtime paths are read-only. No other session, control socket, service metadata, inherited environment or Docker socket is mounted. Container network-none, no-new-privileges, cap-drop ALL, non-root user, read-only rootfs and memory/CPU/PID limits remain mandatory. Shared service cgroup/tmpfs limits bound aggregate resources; they do not guarantee fairness between sessions. Session metadata and files are ephemeral: service restart invalidates tokens and tmpfs artifacts; durable artifacts must be downloaded to WorkspaceX storage before teardown.

The generated BPF is architecture-specific and built inside its target image. Rebuild for another architecture; do not copy compiled BPF between architectures. The generator currently uses native clone flags argument 0, as used on tested arm64 and x86_64; other syscall ABIs require review before support.
