# Research report presentation — issue #5507

Coverage projection now rejects excluded/empty/untraceable quotations, distinguishes contextual/snippet evidence from direct document evidence, and does not label completed reports partial solely because an old search task failed. Internal quality diagnostics remain in the trust console, but are removed from the reader and export input. Genuine errors and report prose limitations remain.

Validation: API trust 18 tests; web report reading/live/formal/export 32 tests; API/web TypeScript; scoped web ESLint; git diff --check. Independent review accepted after fixing snippet fallback.

Real saved report grs_e45648d7491e49e1aaba152a768982f3 was inspected before the local services stopped: no diagnostic card, 5 chapters/22 references, toolbar fixed at y=36 after scrollY=7279.5. Actual Word download succeeded and contained no internal quality strings. The temporary PostgreSQL container later restarted empty; standard migrations and dev accounts were restored, without altering production.

Screenshots use the existing development prototype route with the same report renderer (explicit sample data): 390×844 mobile and 1280×900 desktop after scrolling to references. Mobile controls no longer overlap navigation. Further print/export verification was explicitly waived by the user.

Local web/API services are left running on 3000/3200 for the user. The previous temporary local research session is no longer present; its downloaded Word document remains in Downloads.
