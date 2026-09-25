# Skill consolidation for upper-level agents

Source baseline: PR #4017 head `fabee33d8b822d0bd3e904f048f691af55ded4a4` (645 scored skills).

This directory is a **non-destructive consolidation layer**. Raw score/evidence files remain unchanged for provenance. Upper-level agents should consume the canonical catalog produced here rather than the raw 645 entries.

## Result

- Raw skills: **645**
- Drop from active upper-agent catalog: **148**
- Merge source members: **195**
- Synthetic canonical skills created from merge groups: **49**
- Unique skills retained but needing improvement: **299**
- Unique skills retained as-is: **3**
- Estimated active/canonical catalog: **351**

## Actions

- `drop`: excluded from the active agent skill catalog. The raw record remains for provenance.
- `merge`: source capability is absorbed into a canonical skill. Do not expose the source skill directly to an upper-level agent.
- `improve`: useful and sufficiently distinct, but needs rewriting/localization/evals/guardrails/output-contract/runtime work before production.
- `keep`: sufficiently distinct and currently does not trigger the improvement heuristics.

## Merge semantics

- `modes`: one skill, explicit mode/action parameter.
- `workflow`: multiple former skills become stages/actions in one workflow.
- `base+overlay`: shared workflow core plus agent/domain-specific policy or playbook overlays.
- `provider-adapter`: provider-specific implementations become adapters behind one stable skill contract.

## Improvement tags

- `professional-depth`: Q1 <= 2
- `output-contract`: Q2 <= 2
- `guardrails`: Q3 <= 2 or a fixable gate exists
- `evals`: Q4 <= 2
- `runtime-dependency`: R1 <= 2
- `localization`: R3 <= 2
- `icp-fit`: U3 <= 2
- `evidence`: E1 or low confidence

## Upper-agent taxonomy

`executive-strategy`, `product-design`, `sales-revenue`, `marketing-growth`, `customer-success`, `finance-investing`, `legal-compliance`, `people-hr`, `operations-project`, `data-research`, `engineering-it`, `knowledge-productivity`.

Shared canonical skills may be mounted by more than one agent. Platform-only skills are not treated as normal business capabilities.

## Important

This pass intentionally avoids deleting raw evaluation evidence. “Delete” means remove from the **active upper-agent catalog**, not erase historical/source data.
