# Office native entry guidance

Changed only office-skill-packages.ts and its bounded package assertions: an early native instruction routes the model to /workspace, actual packaged renderer and QA reference, disallows runtime installs and separately redrawn previews. Original creation recipes remain embedded. Standard AcroForm text/checkbox filling is distinguished from structural page selection and unsupported XFA/signatures/general body editing.

Package versionId is content-digest-derived. The canonical isolated `tests/skill/office-full-packages.test.ts` run passed 2 tests: exact bytes/digests, native guidance ahead of legacy examples, actual seed upgrade, repeated concurrent seed idempotence and preservation of old published version bytes. See seed.txt. The change does not mutate old pinned package bytes. Real S005/model validation is recorded separately under g-skill-batch/S005.
