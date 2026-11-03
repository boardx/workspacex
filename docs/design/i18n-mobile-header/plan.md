# Mobile TopBar visibility — #6165

The existing organization group cannot shrink and can push the fixed language control beyond the mobile viewport. Preserve all controls, routes, organization/role logic and unsaved form data.

1. Register one real self-service-profile browser case in its existing API/PG/Next lane; use a dedicated TopBar fixture account without changing persisted data. Before implementation, demonstrate the language control fails full viewport/header geometry at narrow width.
2. Make the organization text group shrink while protecting interactive controls and decorative icons. Use existing layout utilities only.
3. At 320/375/768/1280, in both locales, assert the language control is fully visible, inside the header, clickable/focusable, and preserves an unsaved profile name. Check mobile organization and feedback controls, retain screenshots and inspect them. Run existing TopBar regressions.
4. Record evidence, independent exact-SHA review, mandatory normal push, one develop PR and canonical final-head CI gates. Coordinator owns merge. No claim that all internationalization routes are complete.
