# Neutral upstream HTTP failure guidance

Base efcbb1b986a5392d94f70360d8a6560952e8b47b. The review blocker was an unsupported claim that every non-success status meant automated-access refusal and retries could not succeed. The shared contract guidance now reports the numeric status and lack of confirmed content without guessing cause or future success. The generated Python artifact is refreshed from that source.

No reason enum, transport behavior, outbound policy or retry behavior changes. Tests cover 403, 429 and 503. Restoring the previous generated guidance makes those three cases fail; the updated guidance passes the full selected Python suite. Raw logs remain local under /tmp; only numerical evidence is committed. Isolated init and generated-schema freshness check passed.
