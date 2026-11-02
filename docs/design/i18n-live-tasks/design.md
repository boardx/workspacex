# Live task localization — #6167

Continue the approved phase-two typed dictionary/provider approach. Keep one canonical text source and one-pass interpolation. Do not translate user fields, execution strings, task status/source/risk enum values or the existing audit reason sent by rollback.

Use keys for section/action metadata; read locale in real card/form/board components. Format due dates with that locale without changing stored dates/timezone policy. Hold errors as raw wrapped causes and an action discriminator so visible failures retranslate without replay. Give existing describeFailure an optional default-zh-CN locale; its contract-keyed error maps become typed dictionary-key maps, preserving precedence/default Chinese strings and generic unknown masking. Do not duplicate its known error meanings in a task-specific helper.

Rejected approaches: translating already rendered text would also mutate raw titles and freeze failed notices; putting locale into refresh dependencies would refetch data and alter behavior. Preview mock components are an independent backlog slice. Validation uses real components, original task regressions and a registered API/PG seeded browser journey. A raw task title containing Chinese and braces must persist after reload, and exact status/rollback payloads must stay unchanged.
