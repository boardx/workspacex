#!/bin/sh
# New reviewed probe; old probe approval does not authorize its execution.
# No Docker plan, locks, writes, containers, env/config contents or SQL queries.
set -eu
export PATH=/usr/bin:/bin
export LC_ALL=C
printf 'probe=fixed-cn-readonly-v1\n'
date -u '+observedAt=%Y-%m-%dT%H:%M:%SZ'
uname -sm
for tool in /usr/bin/node /usr/bin/docker /usr/bin/aliyun; do
  if [ -f "$tool" ]; then
    stat -c '%u:%g %a %s %n' "$tool"
    sha256sum "$tool"
  fi
done
df -Pk /var/lib/docker /var/lib/workspacex-cn
free -m
