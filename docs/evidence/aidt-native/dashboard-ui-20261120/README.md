# AIDT project dashboard and native Chat tools

This revision follows the user's November 20 screenshots and requests: expose the six steps immediately, move membership management to settings, remove dashboard self-review and linked-material sections, and consolidate teaching tools into the existing Chat Inspector.

## Behavior

- The project dashboard contains six stage links and one contextual start/continue action. An unsaved local edit and a saved group version remain distinct; no completion percentage or automatic group confirmation is invented.
- Settings opens the existing accessible Dialog and project collaborator panel, mounted only after the existing project/member guards. Closing returns focus. Changing actor/project/session unmounts the old panel; archived projects retain read-only access.
- Materials remain available inside stages. Removing dashboard sections does not remove stored data or the resource APIs.
- Teaching tools use the canonical Chat Inspector through an optional UI slot. Ordinary Chat does not provide the slot and retains its existing behavior. Saving, version conflict handling, student round confirmation, and API authorization remain in their existing controllers.
- The secondary action is labeled “带入对话草稿”: it prepares a composer draft and does not send a message or save the stage automatically. Technical timestamps and source references are available on demand rather than occupying the default form.

## Visual evidence and limits

The PNGs render the actual React dashboard, settings and existing collaborator components with compiled WorkspaceX theme tokens and explicitly synthetic data. The dashboard/settings HTML was captured in a temporary Vitest fixture, then inspected with headless Chromium at 375, 768 and 1280px. `checks.json` records card counts and horizontal overflow. These are component visual checks, not authenticated backend, real-model, or classroom acceptance.

- [Desktop dashboard](dashboard-1280.png)
- [Phone dashboard](dashboard-375.png)
- [Phone settings](settings-375.png)
- [Desktop Chat with tools closed](sidebar-chat-1280.png)
- [Desktop stage outcome in the native Inspector](sidebar-outcome-1280.png)
- [Phone outcome drawer](sidebar-outcome-375.png)

The sidebar captures mount the actual AIDT workspace/form and native Inspector. The message area, composer, session and service data are synthetic fixtures; these images do not prove an authenticated Chat session or model execution. The dedicated Inspector/member-launcher tests exercise event ownership, including normal Escape and composing keyCode 229.

The original comparison screenshots were supplied by the user in this conversation. No user account data or credentials are included in these fixtures.

Verification commands and final results are recorded in the PR and accompanying verification receipt. A successful PR check, a successful image build, an actual deployment, and classroom acceptance are separate results.
