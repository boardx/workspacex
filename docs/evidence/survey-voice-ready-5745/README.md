# Survey voice readiness test — #5745

The full Web suite failed when the error alert was visible but the parent generation button was still disabled. The source was identical to main. The unchanged test subsequently passed alone (9 tests); that isolated pass did not erase the full-suite failure.

`InterviewVoiceInput` renders the microphone error before publishing `active || recoverable` to its parent through an effect. Await the full ready state in one bounded `waitFor`: the specific error, preserved text, enabled textarea, and enabled generation button. No product logic, timeout or retry settings changed. Both microphone failure cases remain covered.

The focused voice/import regression passed 28 tests. Full Web verification passed on source e75c02787: all 938 files, 8067 tests passed and 5 skipped; exit 0. Web typecheck and lint also exited 0. The full-Web log here is an explicitly labelled output excerpt. The interrupted billing release run is not a successful release certificate.
