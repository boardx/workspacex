# Develop production tag routing — issue6073

Incident41241085068 selected workflow_dispatch/develop/cn with an empty tag. Old branch mapping rejected it before production's missing-tag diagnostic. User strategy is one develop-built image set promoted by tag to all environments.

Change: explicit manual develop targets may be DevApp/CN/US; auto and develop push stay DevApp. Production still requires an existing tag, returns build=false, and selects its own protected environment and runner. Legacy main/main-us cross-region restrictions remain. No deployment credentials or protection rules changed.

Red:17 Python tests produced7 failures with old mapping. Green: `python3 -m unittest discover -s tests -p test_registry_images.py`17 tests passed. Related image-release/admission Vitest13 passed. Read-only independent review ACCEPT for three-file implementation. No server writes or successful CN deployment claimed; source CI and queue remain required. Existing DevApp-tag admission repair is separate PR6070.
