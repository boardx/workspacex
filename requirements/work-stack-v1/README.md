# WorkspaceX Work Stack Requirements v1

Baseline: `main@91a2a52d93adfb4a0af1749e4795b148c1910da8`.

This requirement pack defines exactly **320 product entities**:
- 200 canonical Work Skills
- 60 Reference Workflows
- 60 DigitalHumans

The pack intentionally extends the current WorkspaceX architecture rather than creating parallel runtimes.

## Architecture decision
- **Skill** extends the existing Skill domain/version/import/review/source-binding model.
- **Workflow** generalizes the proven TypeScript LangGraph + PostgreSQL/PostgresSaver + business-row pattern used by digital interview.
- **DigitalHuman** is a role specialization/composition of the existing Agent domain and Agent Skill Pins. It is not a second Agent runtime.
- **Context/Memory** stays in Context Engine / Org Brain.
- **Tool/MCP** stays provider-neutral and permission-scoped.
- **Visual Workspace** is the projection/interaction surface for Agents, Workflows, Artifacts, Evidence and Decisions.

## Three implementation phases
| Phase | Skills | Workflows | DigitalHumans | Exit objective |
|---|---:|---:|---:|---|
| 1 | 60 | 15 | 10 | Common runtime + 3 production-realistic pilot journeys |
| 2 | 140 cumulative | 40 cumulative | 30 cumulative | Broad functions/method experts + connector categories + CN/US overlays |
| 3 | 200 | 60 | 60 | Industry depth, governance, community-ready lifecycle |

See `ARCHITECTURE-REVIEW.md`, `IMPLEMENTATION-PLAN.md`, `SOURCE-STRATEGY.md`, `AVATAR-SYSTEM.md`, and `MANIFEST.md`.
