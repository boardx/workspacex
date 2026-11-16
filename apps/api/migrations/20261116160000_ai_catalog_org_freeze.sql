-- Install the existing organization write-freeze policies on the AI catalog tables.
SELECT kernel_apply_org_freeze_policies();
