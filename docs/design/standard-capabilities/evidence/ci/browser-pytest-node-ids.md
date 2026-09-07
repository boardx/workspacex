# Bounded pytest node identifiers

At b8352e879, GitHub run 34089155689 / job 101638956792 ended with the annotation that its 20-minute execution limit was exceeded. The pytest log blob was unavailable, so no specific logical deadlock is established.

Independent exact-SHA collection found the new browser oversized-response parameter expanded to a 2,097,238-character pytest node id under verbose output. Explicit parameter IDs reduce the largest browser node id to 95 characters while retaining the original 2 MiB+1 payload and every assertion. This removes a deterministic logging defect; whether it resolves the entire CI timeout still requires current-SHA CI.

Local verification: the seven browser gateway tests passed after the change. No timeout, payload limit, authorization check or assertion was weakened.
