# Historical browser contract fixture

`cn-maintenance-browser-aa367861.cjs` is the exact7833-byte Git blob from
commit `aa36786188de51a0dc11b15cc1ffa2d192666555`, path
`.harness/scripts/vm/cn-maintenance-browser.cjs`, SHA256
`3aa186d48cc524703e14088cc5aeab5604b80c27482a167f523118715b2342e6`.

It models the installed historical tool in synthetic BC receipt-sidecar tests.
It is never installed or executed by those tests. The production sidecar's
historical version and file pins remain unchanged. The tests verify these exact
fixture bytes and reject the current browser source under that old profile.
This is historical test data, not a second authority for the current browser.
