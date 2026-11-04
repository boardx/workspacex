# Structured activity compatibility and access invariants

Refs #6145. The old `/identity/me/activity` response validates each event with `.strict()`. Sending an unconditional extra field would break old validating clients. The request therefore accepts only the optional literal `displayFormat=structured-v1`; the default response omits `display` entirely. Legacy summary content and pagination remain unchanged. Old servers ignore the extra query and return summary; the new frontend validates display independently and falls back to summary for absent, unknown or malformed metadata.

The response display schema is a discriminated union keyed by stable event code. Parameters are whitelisted: optional displayName, explicit cleared boolean, empty params for password changes, optional team name. Raw provenance detail, credentials, password data, target IDs and unrelated values never become presentation params. Unknown event kinds omit metadata. The existing reader query still uses the authenticated principal's userId and orgId; metadata negotiation is not an authorization decision.

The UI translates templates with typed resource keys. User values enter interpolation once and remain unchanged even if they contain braces or quotes. No summary parsing or regex translation is used. Chinese source summary remains as the legacy compatibility projection, not as the English UI translation source.

Verification separates contract rejection, whitelist/query-scope unit tests, frontend fallbacks, and real negotiated/legacy HTTP response assertions in the existing registered self-service-profile browser journey. No human signoff status was modified.
