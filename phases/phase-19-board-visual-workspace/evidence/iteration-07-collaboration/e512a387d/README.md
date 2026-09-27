# Main-integrated collaboration regression

Main session tested runtime e512a387d after resolving the merge with main: six real browser collaboration scenarios passed, 2.5 minutes, exit 0; API and Web strict type checks and 54 focused core tests passed. The collaboration test command also named the spatial spec, but its selected `seeded` project does not include that spec. Only the six listed collaboration tests count as executed.

The spatial suite was therefore run separately under `seeded-github-import` on 2fef13ed7 after incorporating PR4340. It produced two passes and two failures: drag expectations differed by 0.5 world px. These failures are unresolved in this evidence and block release until diagnosed and retested. No test threshold was relaxed.
