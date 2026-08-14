# Personal realtime ASR WebSocket proxy implementation plan

1. Extend the deployment-readiness fixture with a public personal-ASR
   WebSocket response mode and add a failing route regression test.
2. Add the exact personal transcription WebSocket route to the provisioned
   Caddy configuration.
3. Add a bounded public WebSocket routing probe to the post-restart smoke gate;
   accept only the API gateway's unauthenticated `401` response.
4. Run the focused Vitest suite, shell syntax checks, and relevant harness
   verification, then publish a PR that closes issue #1237.

