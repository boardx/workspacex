# Project and organization module entries — #6401

The project overview and organization home now render the same ModuleEntryCard and ModuleEntryGrid. Geometry, responsive column minimum, spacing, icons, text, borders, hover and keyboard focus use one component. Project entries retain their actual counts (including loading dashes), project-scoped URLs and filters. Icon and description metadata reuse the organization catalog, with explicit mapping from project resource kinds.

Validation: project-general-overview-i18n, home-page-v2 and home-redesign-presentation suites cover populated/empty/error states, bilingual labels and unchanged destinations. Browser visual inspection and production deployment are separate from these component checks; no CN release is performed by this PR.
