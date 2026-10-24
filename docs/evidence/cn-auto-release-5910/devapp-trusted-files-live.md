# Devapp existing installation and key continuity — read-only

The current public DNS for devapp.boardx.us resolved47.77.215.155. Exact public-IP
filter queries found one running ECS in us-west-1; Shanghai and Hong Kong queries
returned no match. Existing console Cloud Shell permissions issued a fixed
metadata-only root observer there, without a new IAM grant or SSH credential.
Independent original API result was Success/0/dropped0 and exact instance,
invocation and command identities matched.

All five existing software files (installer, deploy, readiness, deep-agent lib,
runtime identity module) are regular, root:root, one link, no symlink. Installer
and deploy are0755; the three libs are0644. The installed installer SHA256
`849c9f07245ac1c6500d7bc9c3df8bbca7476ab5c3525f641cc1b4026da92be1`
matches the reviewed repository installer, which already supports all four
targets. Readiness and deep-agent lib also match current reviewed bytes. Deploy
and runtime-identity module differ and still need their normal main-only update.
Presence and metadata do not establish current runtime acceptance.

Existing evidence-signing.pem is root:root0600, regular, one link, no symlink.
A separate fixed read-only command derived only its public key identity in memory;
another did the same for CN's existing evidence public verifier. Both actual API
results were Success/0/dropped0 with exact scope. Their public DER identities
match. No private bytes or secret hashes were emitted or copied; no key or access
permission was created, rotated or replaced. No further key is needed from the
user. Normal installed-code update and actual signed runtime/browser evidence
remain outstanding.

Original responses and sanitized metadata are in the ephemeral existing Cloud
Shell directory ~/cn-tools-inventory-5913. An explicit selected-file evidence
archive/download was requested there; completion has not yet been independently checked.
Do not include CLI credential/configuration files or unrelated provider logs.
