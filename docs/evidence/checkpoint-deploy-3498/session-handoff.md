# Deployment handoff — #3498

This direct user repair is tracked in issue #3498. It does not modify feature
passing status. The module coordinator does not merge its own PR.

After review, green CI, and authorized merge, use the existing
`devapp-install-trusted-scripts` workflow from main. The installer takes fixed
files from main git objects and preserves the existing privileged-install gate.
Then run the standard backend deployment for the reviewed merged revision.
Do not execute branch scripts as root or bypass environment reviewers.

Completion requires successful deployment plus confirmation that the public
research page serves the updated build. Local database tests alone are not an
online repair claim. External model/search behavior remains outside these
synthetic tests.
