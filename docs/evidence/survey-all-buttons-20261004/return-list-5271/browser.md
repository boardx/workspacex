# Return entry real-browser acceptance

Product SHA 4c0017fd2cb42102c53b89258162a16e58ea37ab; web25708, compatible Survey API24705; see preview-runtime.md. Parent IAB normal DOM interaction worked despite native Mac lock / child IAB unavailable, without native controls or unlocking.

Entered normal import through actual New Survey dialog → synthetic name → AI import → Next. Did not request a model, upload, or create a questionnaire.

|View|Button position|Following content|Center uncovered|Actual click result|
|---|---|---|---|---|
|Desktop1280x720 normal|108,76;93.93x32|Title108,124|true|/studio/survey|
|Mobile390x844 normal|24,68;93.93x32|Title24,116|true|/studio/survey|
|Mobile390x844 invalid|24,68;78x32|Alert24,124|true|/studio/survey|
|Desktop1280x720 invalid|254,68;78x32|Alert254,124|true|/studio/survey|

Read-only DOM geometry plus actual clicks and four corresponding screenshots. No duplicate entry. Mobile viewport reset after testing. Source review verified project-aware existing handler is unchanged; this UI run did not assert actual project-scoped navigation or unsaved-proposal behavior. No broader matrix PASS implied.
