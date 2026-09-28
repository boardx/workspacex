# DigitalHuman Avatar System

All 60 official DigitalHumans require a production avatar.

## Asset contract
- Master: 512×512 WebP, sRGB, target <= 200 KB.
- Optional derivative: 128×128 WebP.
- Path: `apps/web/public/digital-humans/<slug>.webp`.
- Metadata: `avatarAssetId`, `avatarAlt`, `avatarVersion`, focal/crop safe zone.
- Fallback: role initials from canonical name.

## Visual system
Professional editorial portrait/icon hybrid; consistent lighting/composition; subtle category-coded background. No celebrity/real-person likeness, protected logo, stereotype, or false credential signal.

## Surfaces
Catalog card, agent header, Board participant object, workflow owner chip, handoff UI, approval UI, audit timeline.

Avatar is presentation metadata only. It must not alter model/tool/permission behavior.
