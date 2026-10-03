# Real model expert profile proposal (#5065)

Base83462a88ef49d0983fc1f0e02a6ee3190d409f18. Before fix actual POST preview returned201 with a full real DashScope Markdown proposal, but client rejected the title-label shape prescribed by the server: H1 virtual-role-name label followed by the actual role name as paragraph.

Two regression cases failed before fix: valid labeled name rejected and empty labeled name accepted as the literal label. After fix33 parser/editing/analysis tests pass. Real IAB API/PGlite/DashScope preview fills all fields and renders the proposal, remains unsaved until user review. Edited name to acceptance5065 synthetic installation support, checked simulated boundary and added; reordered and confirmed two roles. No fabricated model response used for browser validation.

Only the narrow labeled-name shape is normalized. Empty/multiline names, unexpected headings, extra unreviewed text and HTML remain rejected. Existing direct-title format still round trips.
