# #5832 — Complete-job CI budget correction

The user requires PR#5833 itself to finish successfully, not a separate prerequisite PR. The accepted PDF42+Boarded union was pushed as9ca30f87b1d89866328dd620dcd700c6d2fc09e5. Run39240395565/job118019533061 retained30 successful checks but fullstack-smoke was CANCELLED by GitHub: "The job has exceeded the maximum execution time of40m0s".

Actual latest log: job started10:51:09Z, trusted smoke execution10:59:28Z (8m19s setup/directory). Final smoke summary11:30:45Z:221PASS+1FLAKY (presence cursor initial20s assertion, existing retry#1 passed),0 terminal failures; never claim222 purePASS. Fabric1PASS3.2s,trace7PASS11.5s. Evidence102227240bytes uploaded/finalized11:31:11Z, post cleanup ended11:31:12Z; overall job remained CANCELLED. Artifact12182393879. Original raw log stays local /tmp/research-5833-combined-ci.txt.

Earlier independent run39201160326 attempt1 also exhausted40m after222PASS31.6m,Fabric1 andtrace7 completed, as recorded in ../../research-report-delivery-5829/ci-36717d1-verification-results.txt. Attempt2 was intentionally stopped by coordinator as an obsolete-head run, and is not another timeout observation. Separately, prerequisite PR#5835 run39232845845 genuinely succeeded:222PASS31.0m plus other lanes, close to40m total. This is budget evidence, not a substitute for this PR's latest CI.

After the coordinator reviewed these repeated observations, adjust only fullstack-smoke total job deadline40→50 minutes. Keep testcase timeouts, assertions, retries, skip rules, commands, evidence uploads, continue-on-error and all other job budgets unchanged. Existing CI budget guard upper bound45→50 follows the same approved operational budget and stays bounded. RED1 confirms the old guard, GREEN131 covers runtime command binding/dedup/merge-queue/full regression; YAML semantic comparison proves only the single job timeout differs. No repeated browser/model execution, main merge, production deployment or old-result reuse.

The next exact head must pass its own normal full CI. Neither this CANCELLED job nor the1FLAKY case is counted as purePASS.
