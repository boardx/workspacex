# Native document CI mount denial

Run 34101122055, job 101675662445, head d7073c976. Fixed provider-equivalent probe failed before document execution:

```json
{"arch":"x64","status":1,"signal":null,"stderr":"bwrap: Failed to make / slave: Permission denied\n"}
```

Log: `/private/tmp/wx-native-ci-diagnostic.txt`, line 4073. Suite failed in beforeAll; seven cases did not execute. This is not a passing negative test or a document-parser result. Identical fixed probe on the existing local arm64 sandbox returned status 0 and empty stderr.

The seccomp profile already allows trusted setup mount. Docker's Moby v28.0.0 AppArmor template explicitly has `deny mount,` (line 40): https://raw.githubusercontent.com/moby/moby/v28.0.0/profiles/apparmor/template.go . Docker documents that ordinary containers inherit docker-default unless a specific security-opt overrides it: https://docs.docker.com/engine/security/apparmor/ . Ubuntu additionally documents unprivileged-user-namespace restrictions: https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/ . The observed error is a mount denial after namespace setup, not proof of a parser or owner defect.

AppArmor is the matching candidate mechanism; the completed job did not preserve kernel audit records or its resolved AppArmorProfile, so those details are not asserted as directly observed. A next diagnostic should capture the container's AppArmorProfile and only the relevant AppArmor DENIED/mount audit lines. Changing to ubuntu-22.04 does not remove docker-default's mount denial and is not an evidence-backed fix.

The supported remediation to evaluate is a dedicated loaded AppArmor profile scoped to the sessions container, preserving unrelated default restrictions, while the existing mandatory user-code BPF continues denying mount/unshare. Do not disable AppArmor globally, use unconfined/privileged, drop the BPF, or weaken test assertions. Profile installation and cleanup require explicit CI configuration ownership; none was changed in this diagnostic task.

## Proposed scoped remediation (awaiting CI proof)

`security/docker-apparmor-sessions` renders the Moby v28.0.0 baseline under a new name, retains its proc/sys/ptrace denies, replaces the blanket mount deny with setup mount permission and adds userns/pivot_root. These setup permissions apply to this trusted service container; they are not a claim of executable-path-specific AppArmor enforcement. User commands inherit the profile but first receive the mandatory immutable BPF that rejects mount/unshare/setns/pivot_root. Both layers are necessary. The CI-only compose overlay explicitly opts in; legacy/default containers keep docker-default.

The job now uses the existing real session-container test for hostile Python mount/unshare/namespace-clone syscalls (EPERM), actual Node/Python execution, file download, timeout and cancellation, before the unchanged seven document cases. Its temporary test service uses `/tmp/isolation-check.sock` so it cannot replace the live test service's socket. The loaded profile is removed after owned containers stop. No host-wide AppArmor mode/sysctl, daemon template, privileged mode or capabilities are changed.

Local compose rendering on 2026-09-07 confirmed security_opt includes all three entries (`no-new-privileges:true`, dedicated seccomp, `apparmor=workspacex-native-sessions`) and retained network none, cap-drop ALL, read_only true, init true and user node. This is structural evidence only. The local Docker VM lacks the CI host's AppArmor environment; profile parsing/enforcement and the seven tests still require the next actual CI result.
