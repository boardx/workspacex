# ECS preparation tools image, 2026-10-24

Observed through the user's existing Aliyun root Workbench terminal. No application
restart, traffic switch, production database write or main-cn ref update occurred.

The reviewed `deploy/aliyun/images/cn-shadow-tools.Dockerfile` bytes had SHA256
`ad4e9ed831439a5f8e9c70f5534cd20219b0727078651de96678a8bdfe24c265`.
Only those bytes were provided to `docker build -` (2.56 kB context); no checkout,
HOME, application configuration, credentials or data entered the build context.
Build used the existing protected canonical release lock, a cached immutable Node
base, legacy Docker builder, 1 CPU/1 GiB hard limits, force-remove and a 360-second
timeout. Docker 29.1.3 was observed; corresponding limit options were checked.

First attempt used the default Debian public mirror and timed out during signed
package index download (exit124). Its build container 339765840e22 no longer
existed after timeout; no application container was stopped. The retained private
log is `/var/lib/workspacex-cn/runtime/shadow-tools-ad4e9ed831439a5f-build.log`.

The second attempt supplied only the Dockerfile's existing APT_MIRROR build arg:
`http://mirrors.cloud.aliyuncs.com`. An actual InRelease GET returned200 first.
This is the ECS VPC mirror documented by
[Aliyun](https://developer.aliyun.com/mirror/debian/). Normal Debian package
signature verification stayed enabled; no trusted=yes or authentication bypass
was used. This attempt exited0. Private build log:
`/var/lib/workspacex-cn/runtime/shadow-tools-ad4e9ed831439a5f-aliyun-build.log`.

Built tag: `workspacex-cn-shadow-tools:ad4e9ed831439a5f-aliyun`.
Actual inspected immutable image:
`sha256:657a159054f1a890176d8c3476c09e9e4bebc0254a8b6f93a482aa7cb9a04f8e`.
Base image ID:
`sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96`.

Independent inspection proved Linux/amd64, exact base RootFS layer prefix,
no volumes, no added environment names, and nginx default entrypoint.
An initial manually transcribed image ID missed one character and correctly
failed inspection; verification was repeated by resolving the actual tag to its
immutable ID before testing it. Do not use the rejected transcription.

A separate actual container executed Node/Chromium/nginx version commands with
network=none, read-only rootfs, all capabilities dropped, no-new-privileges,
512MiB/.3CPU/512 PID bounds, temporary tmpfs and no mounts/ports/credentials.
Exit0: Node v22.23.1; Chromium156.0.8078.47 Debian12; nginx1.22.1.
The named check container `cn-tools-version-ad4e9ed831439a5f` was absent afterward.
Four original application containers remained running; healthz returned200.

This proves tooling build/identity/executable availability only. The canonical
Playwright runtime preflight still requires the installed exact tool checkout;
real candidate login/notifications, backup/restore and production acceptance
have not been claimed. No automatic preparation policy or trusted entry update
has yet been installed. Do not infer deployment readiness from this image.
