-- REVIEW ONLY. Pending human UI/usecase/API signoff. Not an executable migration.
-- All names/limits/permissions below are proposals, not existing product facts.
CREATE TABLE aidt_courses (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  create_operation_id uuid NOT NULL,
  UNIQUE(id, org_id),
  UNIQUE(org_id, created_by, create_operation_id)
);
CREATE TABLE aidt_course_groups (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id text NOT NULL,
  project_id text NOT NULL,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(org_id, project_id), -- one actual group Project belongs to one course
  FOREIGN KEY(course_id,org_id) REFERENCES aidt_courses(id,org_id),
  FOREIGN KEY(project_id,org_id) REFERENCES general_projects(id,org_id),
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
-- Before activation: FORCE RLS on both, USING/WITH CHECK app.current_org;
-- org freeze restrictions; native project-archive write policy on mapping;
-- grants for existing app_rw only; replay-safe DDL; migration schema/replay tests.
-- No project contents, roles or memberships are updated by this migration.
