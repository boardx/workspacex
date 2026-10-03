# Necessary marketing derivatives

Changing `assets/css/base.css` invalidated the existing marketing generation gates. Both CI `static` and `validate` reported stale language manifests plus OG cards, home-screen icon and aurora fingerprints. These are derived files, not a redesign of marketing copy, scripts or manuals.

Executed existing scripts in the independent worktree, without edits:

```sh
node scripts/build-brand.mjs
node scripts/build-logo.mjs
node scripts/build-og.mjs
node scripts/build-aurora.mjs
node scripts/check-assets.mjs --update
node scripts/check-all.mjs --static-only
```

Outcome: **all 16 static checks passed**. Product logo/favicon reused from the original app; unchanged logo and favicon produced no Git diff. Four changed binaries and two language manifests are legitimate source-dependent output. No new ImageGen, no installation, no deployment. OG-zh and aurora actual pixels inspected.

Base CSS SHA256: `7fc6d630f48539f3f2e350cd3ed4817bb13a94a318859233cafcd86fa6537a5f`.
Generation fingerprints are in `assets/img/.sources.json`: OG `95b5d093820d5d51`, home-screen icon `812225ef875f4717`, aurora `386d32e4cb8e61f4`.

An existing `apps/home/node_modules` symlink pointed at shared dependencies. One task-created dependency link briefly landed there; its exact target was verified and that link immediately removed. The independent worktree now has a private dependency directory. No shared tracked/staged code was changed. Temporary rendering servers/browser instances terminated normally.

The marketing owner confirmed no conflicting derivative writes; the same PR receives these outputs. Updated CI runs must still be checked. Full product QA remains blocked pending authenticated Home/Chat.
