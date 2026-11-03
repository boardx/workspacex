Current branch is independent on actual develop97c19b3c423534966114c4ba869abd58efe24748. The unmerged activity ancestor is removed; see docs/design/i18n-notifications/independent-base.md and independent-* evidence. Original browser run below is historical and included additional activity checks, which are owned separately by PR6147. New-head CI remains required.

# Notifications presentation evidence — #6146

Static controls and categories consume the global zh-CN/en provider. Original titles/body, IDs, grouping, server unread count, destinations and explicit acknowledgment behavior are unchanged. Locale only affects presentation and never enters hook request dependencies.

-27 tests across7 files passed: new English labels/categories/aria counts/schedule/error messages, unchanged literal titles and fact IDs, no locale-triggered requests or reads, plus existing default-Chinese popover/grouping/destination/placement/schedule regressions and resource completeness.
- Web typecheck and lint passed before dependency sync; final normal pre-push/CI must still validate the final head.
- Real existing registered self-service-profile journey passed1test in1m30s including startup/cleanup after synchronizing foundation864 and activitye0. Actual notifications API parsed successfully; English trigger/empty dialog rendered; numeric bounding boxes prove the popup opens right and remains within viewport; Escape restores focus and pending display-name input remains unchanged. Existing real activity/legacy/negotiated/password/login/responsive assertions pass too. Owned compose stack is removed.
- Independent read-only review at a623433cf173473774745c939c693f36a045839b found no findings. Later dependency sync preserves the scoped product delta; final-head recertification/CI remains required.

Screenshot captures the actual app and API, not a preview fixture. No API/protocol/auth/schema/CSS changes in this slice. Dynamic title templates are retained as source content pending a distinct structured-metadata slice; no regex translation is used. Logs normalize trailing whitespace.
