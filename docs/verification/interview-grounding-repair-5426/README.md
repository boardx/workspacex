# Grounding repair reason #5426

Real browser recovery on exact runtime 48a752bbe1e885d132248372ffa8895e28d16476 failed. Retained public synthetic source version 7/report version 3; raw report SHA256 97036d4ce3d9b7fb71f6f6ba6a5954b7e595cb9ae8e140bac09721910ab6e912. Analysis and claims pass; grounding rejects unsupported_evidence_strength. Response body capture raised Error, so stream equality, actual attempts and generation completion latency are UNKNOWN. First visible delta was 2660ms. This is not a normal report PASS; three required normal real-browser/model reports remain 0.

Recovery currently collapses all grounding reasons into exact_source_grounding and prescribes quote formatting. Preserve the validator reason and give targeted evidence-strength, consensus, attribution or quote guidance for both initial bounded repair and saved failed-version repair. Unchanged raw bytes, validators, source CAS and initial max2/manual max1 calls.

Standard isolated test script RED2/382 then GREEN382/382, new regressions cover automatic and saved recovery. Real model retest PENDING. Owned native runtime ports15460/15470/15475 stopped before edits. No debug permission bypass, main merge or deployment.

Isolated PR rebased by applying only this issue delta onto origin/main 8d0ffff2da8a22e10a8494540c3085f486cdaf62: GREEN375/375. The 382 integration suite includes separately reviewed pending fixes and is not represented as this PR scope.

Simultaneous analysis and grounding rejection retains both feedback channels while preserving existing failure classification. All validator/source/CAS/raw persistence and call-budget regressions still pass. Duplicate open-issue search returned only #5426.

Follow-up controlled public fixture: GREEN376/376. Saved-failure recovery dispatches once with correct reason, candidate isolated from confirmed-source region; a different rejected streamed body is saved as a different failed version/hash. This only establishes controlled behavior, not actual round1e provider output. Actual round1e retained identical raw hash and still failed; real report PASS remains0/3. Production code unchanged by this test-only follow-up.
