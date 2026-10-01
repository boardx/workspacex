# GitHub skill import credential (#3182)

The API reads `WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN` from its server environment.
Use a dedicated read-only token for the public repository contents the service imports;
do not reuse an administrator, deployment or developer `GH_TOKEN`/`GITHUB_TOKEN`.
Anonymous imports remain supported when this optional setting is absent.
Store it in the deployment's protected environment file or CI secret binding, never
in an import URL, client request, command argument, source control or diagnostic log.
This patch does not provision or rotate a token. CI smoke must explicitly bind the
server setting if authenticated public imports are required.

The credential is sent only on an initial HTTPS request to `api.github.com` on
its default port. Redirects never receive it, even when redirected back to the API.
Literal URL policy and socket-time resolved-address checks still apply on every hop.

A GitHub 429, or a 403 with exhausted quota/retry-after, is a retryable upstream
failure. Only one retry is allowed per import, and only when the advertised wait
is at most two seconds. Longer or missing waits fail immediately. The public
`IMPORT_FETCH_FAILED` code stays compatible; the internal error distinguishes
rate limits and carries the advertised delay. No error response body, URL or token
is logged. The live GitHub smoke remains the acceptance check for real quota behavior.
