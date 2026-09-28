# DigitalHuman / Workflow Skill closure contract

Status: **proposed requirement; not implemented on main**.

Graph audit baseline: `30c1c4332025151610502988b0379b95ff7298c7` (2026-09-28). Runtime claims remain explicitly unverified unless a document names the inspected file/blob and evidence.

## Edge meaning

- A `DigitalHuman → Skill` matrix edge is a role-core Skill pin. It is available to that role only when included in the run's immutable Skill snapshot.
- A `DigitalHuman → Workflow` edge authorizes the role to request that exact Workflow, subject to the caller's current authorization and the Workflow's human gates.
- A `Workflow → Skill` edge is a conditional dependency. It becomes eligible only for a run that selected both the owning DigitalHuman and that Workflow. It does not grant a Skill to the DigitalHuman for unrelated runs.
- The current 475 direct role Skill edges remain direct role-core edges. The current 315 Workflow Skill edges remain the exact conditional dependencies. The graph does not invent or duplicate 841 transitive `DigitalHuman → Skill` edges.

## Effective Skill set for a run

For a run with DigitalHuman `D`, selected Workflow `W`, and caller `U`:

```text
effectiveSkillIds(D, W) = roleCoreSkillIds(D) ∪ workflowSkillIds(W)
```

Resolve and pin every member before the first model or tool execution. For this phase, an effective run set is at most 18 Skills across all 59 DigitalHuman→Workflow pairs. No implemented run Skill-count limit has been verified on main. Persist the resolved immutable Skill version IDs and a composition record mapping each pin to its origin (`role-core` or `workflow-inherited`) in the run snapshot. The set is frozen for the life of that run. A later edit to either graph or a Skill release applies only to a newly created run.

Resolve from the exact published DigitalHuman and Workflow versions selected for run creation. Role-core Skill versions come from the published DigitalHuman/agent version; inherited Skill versions come from the selected published Workflow's exact binding slots. If one Skill ID resolves to different Skill version IDs anywhere in the effective set—including two Workflow binding slots—reject the composition before starting; do not choose one silently or expose multiple versions under one Skill ID. Deduplicate identical pins while preserving all origins. The canonical ID-level matrices define dependency intent; release records define immutable version pins.

Persist the DigitalHuman/agent version, Workflow version, composition-graph revision (or immutable graph digest), exact Skill version IDs, and pin origins in the run snapshot. A retry or resume reuses this exact composition record.

## Authorization and failure behavior

1. Confirm `D → W` is an exact graph edge and the caller may invoke both objects in the selected organization/project scope.
2. Resolve the union above to exact, enabled, visible Skill versions under the current tenant's authorization rules. Workflow inheritance adds graph dependencies; it never widens document, connector, tool, or data permissions.
3. If any required pin is missing, ambiguous, disabled, inaccessible, or cannot be resolved to an immutable version, fail before side effects. Do not silently drop the Skill, substitute a nearby Skill, select `latest` during a running job, or continue with a partial set.
4. Pass only the resolved set into the existing run snapshot and Skill catalog. Revalidate caller and data permissions at each protected read/write according to the applicable API contract; pinning a Skill is not an ACL grant. If access is revoked, stop before the next protected side effect and fail the stage/run with an authorization result.
5. A Workflow revision changes its dependency closure for new runs only. Existing runs and HITL resumes keep their recorded object and Skill versions; resume must revalidate current caller authorization before continuing. If a pinned Skill version is no longer retrievable or allowed, fail closed; do not substitute a newer version.

## Workflow-stage scope

All Workflow-inherited Skills are eligible in the Skill catalog for the duration of the selected Workflow run. The Workflow's stage mapping specifies the intended Skill calls for each stage; it is not a separate runtime Skill allowlist in this contract. This matches main's current run-wide pinned Skill catalog. Human gates and tool permission checks still control protected side effects. A future per-stage Skill allowlist requires a separately reviewed contract and must not be implied by the current graph.

## Compatibility with current main

Current main takes explicit `skillVersionIds` from the run snapshot; the Skill catalog is built from that pinned set. Workflow-template Skill binding validation is a separate path. The inspected implementation does not demonstrate automatic Workflow-to-DigitalHuman pin inheritance. Therefore the resolver and snapshot-origin metadata above are new work. Until implemented and tested, documents may describe this as a proposed target contract but must mark the behavior **unwired / not implementation-ready**. Do not claim that selecting a Workflow currently mounts its Skills into a DigitalHuman run.

## Classification and gaps

The composition matrix's existing DigitalHuman Skill column is the role-core set. Workflow-bound Skills are conditional on selecting the named Workflow and can be derived exactly from the Workflow matrix. A direct optional or conditionally activated persona Skill requires an explicit per-edge condition and owner-reviewed matrix change; authors must not infer one from prose. Skill gaps remain explicit and must not be approximated by this closure rule.
