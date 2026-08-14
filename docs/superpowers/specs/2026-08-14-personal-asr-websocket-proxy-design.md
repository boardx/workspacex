# Personal realtime ASR WebSocket proxy fix

## Problem

The personal transcription client successfully creates a one-time ticket, then
opens the ticket's WebSocket path directly on the public API origin. The Caddy
configuration proxies the Chat ASR path and the legacy recording ASR path, but
not the personal transcription path. Consequently the WebSocket upgrade falls
through to Next.js and never reaches the NestJS personal ASR gateway.

## Decision

- Route `/recording/realtime-asr/sessions/*/captures/*/stream` to the API service,
  alongside the existing Chat and recording WebSocket routes.
- Keep the BoardX ticket protocol, Fun-ASR model selection, and browser PCM
  client unchanged; they are already reached correctly in the Chat flow and the
  personal REST ticket request succeeds.
- Add a post-restart deployment probe that performs an unauthenticated
  WebSocket upgrade against the public personal path. A prompt `401` proves the
  request reached the API gateway; a timeout, frontend response, or any other
  status fails deployment.

## Failure handling

The probe uses bounded connection and request timeouts and never includes a
real ticket. On failure it reuses the existing bounded, redacted service
diagnostics. The private kernel probe remains unchanged.

## Verification

- Unit-test the readiness helper with both a routed `401` response and a
  missing-route failure.
- Assert the provisioned Caddy configuration contains the exact personal ASR
  route.
- Run shell syntax checks and the existing deployment-readiness test suite.

