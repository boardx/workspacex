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

Base CSS SHA256: `0b40a197194b94e39432e780b0990418ad55c486f31c9ed32038ab6f06cd14ae`.
Generation fingerprints are in `assets/img/.sources.json`: OG `1da1b3cda28efabc`, home-screen icon `206b52bed07b7a52`, aurora `870d6d6f8e17401f`.

An existing `apps/home/node_modules` symlink pointed at shared dependencies. One task-created dependency link briefly landed there; its exact target was verified and that link immediately removed. The independent worktree now has a private dependency directory. No shared tracked/staged code was changed. Temporary rendering servers/browser instances terminated normally.

The marketing owner confirmed no conflicting derivative writes; the same PR receives these outputs. Updated CI runs must still be checked. Full product QA remains blocked pending authenticated Home/Chat.
