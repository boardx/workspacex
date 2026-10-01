# Member directory 500 from a nullable legacy role label — #4867

Real browser testing found that enabling official roles was followed by an Agent directory 500: `items[0].roleLabel` expected string, received null. The nullable `agents.role_label` column was incorrectly typed as non-null in the directory read adapter and passed straight into the response schema. Official import itself writes nonempty labels; a legacy/bootstrap row could break the entire mixed directory.

The adapter now acknowledges `string | null` and uses an empty string for absent labels, matching existing Agent definition read adapters. This represents an unknown label rather than inventing duties. Official labels, visibility predicates and the response contract remain intact.

A regression executes the actual PostgreSQL adapter against a controlled tenant session, then the actual use cases/controller response parsers with one legacy null-label row and one official product-manager row. List, single-card and profile reads survive; both entries remain present and the official role label/duty stays intact. Existing authorization/repository guard tests remain covered.

Evidence: new regression failed before the fix with the same response validation error (`agent-directory-null-label-red.log`). Three targeted files passed 33/33 afterward (`agent-directory-null-label-green.log`). Logs normalize trailing whitespace only. These are database-free component tests, explicitly registered as such; the integrating agent owns the real browser/full-stack rerun and normal pre-push type checks.
