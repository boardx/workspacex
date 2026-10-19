# Board menu dimension precision — #5834

PR #5833 head42ccb9d7a fullstack run39227014524/job117975930347: sole failure at board-menu-layout.spec.ts:84:130, 390px label height expected36 / actual36.00001525878906. 170 PASS /1 FAIL /51 not run. Exact input/label bounds equality passed before this assertion. This is an existing test outside PDF changes.

Only the two nominal36px dimensions change to toBeCloseTo(36,3): error strictly less than0.0005 CSS px. No product layout, workflow, timeout, retries or other assertions changed. precision.txt uses actual Playwright expect, confirms old strict assertion fails observed value, new assertion passes, and35.99/35/36.01/37 remain rejected.

First local browser attempt was rejected by runtimeSourceIdentity's clean-source guard before the test body, due to not yet committed changes. It is not accepted as behavioral verification. The fix is committed before rerunning original full spec on fresh production/API/PG at390 and1440. No new models or online state changes.
