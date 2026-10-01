# Pending Skill display names (#4869)

The product starter builder writes `name: stableId`, so importing S061/S009 stores those bare identifiers as skills.name and the official-role resolver copied them into pending displayName. The immutable signed SKILL.md files already contain the authored headings `产品探索（S061）` and `客户研究（S009）`.

The existing coordinate generator now derives a displayName from each verified starter file's exact H1. The resolver preserves a meaningful catalog name, otherwise looks up the authored title by all three exact fields (stableId, stableName, contentDigest). Digest/name drift does not match. Skill pins, channels and pending reasons are unchanged. No starter/signature/digest was rewritten; the official pack's signed coordinate shape still excludes presentation metadata.

The title counterproof fails with the original resolver (S061 instead of 产品探索（S061）). With the fix, two target files pass 5 tests including meaningful catalog names, verified pin behavior, and digest/name mismatch. This validates resolver behavior with controlled transaction results, not a real database or provider. Existing frozen pending JSON is not retroactively rewritten; new imports/upgrades derive the corrected labels.
