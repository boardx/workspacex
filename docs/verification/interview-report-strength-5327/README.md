# Report evidence strength (#5327)

Independent reading of the public synthetic report found unsupported frequency/risk/causal generalizations despite exact quote and structural gates passing. This change strengthens the existing model request guidance on both bounded attempts: distinguish answer facts from conditional inferences and proposals, compare contextual counterexamples accurately, describe actual task/question counts, and give concrete actions with applicability/failure conditions and observable validation. It does not rewrite model bytes or weaken validators/CAS/repair bounds.

TDD: bounded-attempt request guidance regression failed before the change (1 failed/19 passed), then recovery 20 and grounding 17 passed. Request guidance tests do not prove semantic correctness; fresh public real-model generation and independent content review remain pending. Original private report failure remains unknown.
