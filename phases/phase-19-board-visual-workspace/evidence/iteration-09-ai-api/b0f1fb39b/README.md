# Compact palette root browser acceptance — b0f1fb39b

2026-09-27: real reference UI suite passed (one scenario, 10.3s; isolated lifecycle 2m4s with cleanup). Same command as 0d3024a8d reference acceptance. Concurrent c7389d083 changed only the recovery drill script, not application or UI test runtime.

All 1024/1280/1440 desktop assertions and 390 mobile header checks passed. Root inspected the 1440 palette image: eight color targets now fit one row, shape/bulk actions share a row, popup no longer dominates the board, official wordmark is readable. Seven screenshots retained. These improvements do not establish full visual 90/100 or mobile touch acceptance; long text, every object type, accessibility, full user journeys and final same-SHA gates remain outstanding.
