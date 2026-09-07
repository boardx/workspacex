# W14 image generation and durable intent

WX-T038 retains catalog input names: prompt, referenceAttachmentIds, sizeProfile, idempotencyKey. Only sizeProfile `square` is implemented, matching the existing provider's 1024×1024 single-image request. Caller/model identity and credentials are not input fields. The output is explicitly `generated` with a verified workspace file and actual image metadata, **not** an artifact ID. The model calls existing `wx_artifact_publish` next; staged becomes a real artifact only through existing writeback. The catalog output summary records this accepted adjustment.

## Existing components reused

- `BailianImageProvider.generateImage`: unchanged structured provider, including submission/poll deadlines and caller cancellation. No second vendor implementation.
- Existing ToolExecutionAuthority, NativeSessionOwner and PgNativeRunInputs for actual trusted run/lease/binding and current source ACL/hash checks.
- Existing ObjectStore.putOnce, shared UDS read/write/execute, preinstalled Pillow, and existing output staging/writeback.
- Existing public-address literal guard and connection-time guardedFetch DNS resolution; no separate SSRF policy.

## Durable-before-submit invariant

The same trusted org/run plus user-visible idempotencyKey hashes choose a fixed object prefix. Before any billable submission, complete normalized request and configured modelRef are persisted with putOnce and read back. Only the call that created the immutable intent can invoke the vendor. Every recovery call, even from a new real toolCallId, must pass actual current authority again.

Same key with different request or model conflicts. Existing intent without persisted result reports unknown outcome and never resubmits. This is deliberately conservative: cancellation/crash before actual submission can leave an unresolved intent even if no charge occurred. The service never guesses that lack of acknowledgement means no vendor task exists. A new key is a new billable intent; the Python error and skill instruct no automatic key substitution after unknown results.

On success, the guarded image download is bounded by the existing 8 MiB file limit and 15-second download deadline. Actual PNG/JPEG bytes are written to the bound workspace; fixed server-authored Python reads bytes once, checks SHA256 and verifies/fully decodes them with Pillow in BytesIO, under the existing 30-second OS execution limit. Dimensions must be the requested 1024×1024. This prevents a workspace replacement from substituting a different file during validation. Persisted image bytes are read back and hashed, then a result descriptor is saved. Recovery restores those bytes without vendor submission. No signed vendor URL or provider credential is exposed in tool results or stored result descriptors.

Current owner state is watched during the vendor operation and passed to its existing AbortSignal support. Authority and binding are checked again before download/validation and before returning success. Unknown/failed results can leave unreferenced intent/image/workspace objects; cleanup of the new object prefix still requires integration with retention policy; no ready artifact is fabricated.

## Reference images and unavailable capabilities

Each supplied reference attachment ID must be present in this run's fixed input manifest and pass current source visibility/digest/size checks. Even an authorized reference then gets an explicit editing-unsupported error because this provider only supports text-to-image. References are never silently ignored. Local-only organizations are denied before remote submission. Missing native configuration or provider key yields an unavailable service, not a fallback.

## Verification limits

The complete-chain test uses real Bailian provider HTTP submit/poll against a deterministic local vendor fixture, actual guarded TLS download, real sandbox decoding and real PG/storage/writeback. It proves integration and invariants, not live external-model aesthetic quality. S017 separately instructs visual inspection and precise-text verification; successful byte decoding alone is not visual design QA or G-SKILL.
