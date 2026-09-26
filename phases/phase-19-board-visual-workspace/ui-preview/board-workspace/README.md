# Board workspace UI preview — issue #4219

Route: `/preview/board-workspace`. Mock only, no API, no server deletion, no persistence or collaboration. Components are isolated from the production Board route.

Visual plan: retain the WorkspaceX semantic background, foreground, border and muted tokens. Use the existing UI font. The memorable element is a lower, floating, touch-sized drawing dock; the library stays quiet with visual miniatures. Canvas object colors are document colors, not application chrome. Motion only responds to tool selection and honors reduced motion.

Seven states: `?state=default|loading|empty|validation|error|forbidden|success`; editor states `?state=editor|readonly`. Browser acceptance and screenshots are owned by the root session.

Interaction scope: create/rename/delete with confirmation, search, open/back; real Fabric canvas supports creating sticky/text, shapes, PencilBrush free drawing and straight/dashed free connectors. The preview demonstrates free connectors only, not production endpoint binding. Canvas Enter places the active tool at center; Delete removes selected objects; native toolbar keyboard focus and dialog focus trapping are available. Persisted canonical commands, collaboration and advanced connector anchoring remain formal implementation work after design review.

Acceptance matrix: 375 / 768 / 1280 widths; all state routes; keyboard dialog and tool flow; destructive cancellation; readonly; reduced motion; actual painted Fabric pixels. Root must record evidence before promoting this as reviewed UI material.
