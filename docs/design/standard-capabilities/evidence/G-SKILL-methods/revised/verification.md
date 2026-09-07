# Reviewed immutable Skill corrections

The S017 offline poster scenario initially included an unsupported claim that pixel statistics prove Chinese glyph correctness. Version 1.0.1 now distinguishes pixel/size checks from actual visual inspection. Its actual-model rerun produced an 800x600 Chinese poster, declared the model had not visually inspected it, and completed artifact writeback. Independent manual viewing verified the expected Chinese content and uncropped boundaries. This is an offline poster case, not generative-provider quality evidence.

The S019 research-plan scenario initially omitted objective mapping on its closing question and inadequately covered users who abandoned setup. The new user-research-planning 1.0.1 requires objective mapping for every question, target-appropriate recruitment including failed/abandoned journeys, and respect for skipping sensitive questions. Its actual-model report was manually checked against all three conditions and persisted through the existing artifact path.

The old packs are immutable. standard-methods 1.0.1 advances only user-research-planning; digest 57388744be5b621047578e07843351787c8e83d55038543d785bc87085ab7fdb. standard-visual 1.0.1 digest fca4589ef11d932b7404b4441ea1944fa099e3833165ed4c99b6744f3b6b980d. Both committed package verification scripts pass and preserve the old pack identity. Adjacent scenario directories contain the actual source, model trace, result and delivered files.

These are representative actual-model and human-review cases, not general reliability estimates. S015 authoring still has a separate unfinished acceptance gate; its failure is not relabeled by these passes. Shared opt-in live harness work continues separately and is not part of this prompt/package-only correction.
