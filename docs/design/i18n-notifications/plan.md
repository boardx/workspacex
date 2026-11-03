# Notifications presentation — #6146

Translate the TaskNotifications trigger, unread live-region/aria count, kind labels, scheduled failure codes, empty/error/read/paging controls. Keep original notification titles/body, stable IDs, grouping, destinations, focus and read semantics. Locale changes only rerender presentation; they must not restart polling or acknowledge notices.

1. Fail English category/count/schedule/error tests using real hooks and contract-validated fixture values.
2. Add an independent notifications namespace; consume the existing global provider without changing hooks or protocol.
3. Run existing notification/schedule/placement/click/popover tests and resource checks.
4. Extend the already registered real self-service-profile journey with the actual global bell, English empty dialog and right-opening geometry/focus assertion. No new preview route or independent CI lane.
5. Verify web static gates, independent review, evidence, normal push and distinct develop PR. Dynamic system title templates require their own structured metadata work; never rewrite mixed user titles by regex.
