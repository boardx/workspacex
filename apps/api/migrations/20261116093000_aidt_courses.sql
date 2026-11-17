-- User explicitly approved course design A (session 2026-11-16, Backlog seq28).
-- Course metadata does not grant access to any group Project or change membership.
CREATE TABLE IF NOT EXISTS aidt_courses (
 id text PRIMARY KEY,
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 120),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 create_operation_id uuid NOT NULL,
 UNIQUE(id,org_id),
 UNIQUE(org_id,created_by,create_operation_id)
);
CREATE TABLE IF NOT EXISTS aidt_course_groups (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 course_id text NOT NULL,
 project_id text NOT NULL,
 linked_by text NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(org_id,project_id),
 FOREIGN KEY(course_id,org_id) REFERENCES aidt_courses(id,org_id),
 FOREIGN KEY(project_id,org_id) REFERENCES general_projects(id,org_id),
 FOREIGN KEY(project_id) REFERENCES projects(id)
);
ALTER TABLE aidt_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_courses FORCE ROW LEVEL SECURITY;
ALTER TABLE aidt_course_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_course_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aidt_courses_tenant ON aidt_courses;
CREATE POLICY aidt_courses_tenant ON aidt_courses USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS aidt_course_groups_tenant ON aidt_course_groups;
CREATE POLICY aidt_course_groups_tenant ON aidt_course_groups USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON aidt_courses,aidt_course_groups FROM app_rw;
GRANT SELECT,INSERT ON aidt_courses,aidt_course_groups TO app_rw;
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
COMMENT ON TABLE aidt_courses IS 'AIDT course registry only; no Project access or course-completion claim.';
COMMENT ON TABLE aidt_course_groups IS 'One actual general Project per course association; memberships remain in native Project storage.';
