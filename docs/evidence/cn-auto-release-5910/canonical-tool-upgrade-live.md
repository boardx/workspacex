# Canonical tool upgrade preparation — not installed

Read-only Workbench checks on the existing Shanghai production instance found
`trusted-tool-binding.json.toolRevision` is the complete commit
`8d0ffff2da8a22e10a8494540c3085f486cdaf62` (40 characters). An earlier manual
transcription omitted one `f`; do not use that invalid spelling. The complete
object is present in the local repository.

The old identity source defines128 sources/90 installed targets. The currently
reviewed611c442 identity defines139/97; the old set is a subset, with no deleted
sources or retargets. A narrow25-file update would leave the full profile and
maintenance/recovery consumers inconsistent. It was not installed. The canonical
producer and transaction already support replacing software and its derived
profile together; their contract needs the automatic helpers, explicit modes
and protected tool root before use.

Actual host checks also found `/usr/local/bin/aliyun` is a regular0755 single-link
file owned by uid/gid1001, although its parent directories are root-owned. The
root trust check rejected it before execution. `/root/.aliyun/config.json` is
absent. No ownership change, credentials file or global CLI installation was
performed by these checks. A bounded IMDSv2 role-name query returned
`INSTANCE_RAM_ROLE_PRESENT True`; no role token or credential was printed.
This does not establish Cloud Assistant command permissions.

The official Alibaba Cloud CLI release API reports v3.5.2 Linux amd64 archive
size80174977 and SHA256
`8058cb91fa0e2d46a7c5fd47e44ab6a465be8477b28595d408dcc03a0ed5bd4e`.
A GitHub asset download was interrupted while blocked in SSL reads; its partial
archive was retained and never executed. Downloading the same version from the
official domestic CDN returned0, exact80174977 bytes and the same independently
recorded SHA256. The archive contains exactly one regular `aliyun` member,
98624433 bytes. The extracted root0700 single-link executable stays in the private
staging directory; its SHA256 is
`1c90e33768cdf38f86a1457072957c68a6f755a64d9e3d079798644a019bf7fb`.

Initial CLI calls returned3 because a usable profile was absent. The first
`configure set --config-path` attempt returned1: that flag loads an existing
profile file before saving it. After checking the official v3.5.2 configuration
source, a separate root600 staging profile was created containing only the
existing instance role name, region and bounded client settings. It contains no
AccessKey, token or new grant, disables automatic plugin installation, and leaves
the installed binary unchanged. A subsequent real `sts GetCallerIdentity`
returned0 and the expected account comparison returned true. Temporary identity
credentials stay in the official client's memory; none were printed.

The instance role's real `DescribeInvocationResults` call was denied. Its STS
success must not be presented as Cloud Assistant permission. The already signed
in console's existing Cloud Shell was then opened. Its own STS and read-result
calls succeeded without creating a new identity or permission.

An initial observer command had a Python string syntax error and did not call
the API. Two subsequent RunCommand requests failed; the retained second response
identified `MissingParam.InstanceId`. This Cloud Shell CLI needs the numbered
`--InstanceId.1` parameter; a JSON value supplied to `--InstanceId` was not mapped
to the API array. Reading recent invocation metadata found no matching original
name. A new request using the numbered parameter returned0. It executed only
`test $(id -u) = 0 && printf CN_TOOL_INVENTORY_CHANNEL_READY`.

Independent `DescribeInvocationResults` returned0, one result, terminal
`Success`, exit0, dropped0, matching instance/invocation/command identities and
the exact expected public marker. Original start/result bytes are retained in
Cloud Shell `~/cn-tools-inventory-5913/channel-v3-{start,result}.json`. The observed
raw result SHA256 is
`03b5dbcb4d4017b638bc5395b3d9b2ec2a9585b7ff4ef7fed27867725e3d192f`.
This proves the existing console operation channel, not a complete installation
inventory, provider receipt, installation or deployment. Cloud Shell is ephemeral;
preserve needed evidence before its one-hour expiry. No IAM permission was added.

This does not replace the installed client or create a credential. Official source:
https://github.com/aliyun/aliyun-cli/releases/tag/v3.5.2.

Production tools/profile/policy, accepted refs, databases and running services
remain unchanged by these observations. Actual complete inventory/provider
receipt, reviewed installation and deployment acceptance are still required.
