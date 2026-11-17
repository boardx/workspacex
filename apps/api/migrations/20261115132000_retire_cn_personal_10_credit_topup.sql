-- Keep the SKU and historical payment records for settlement and reconciliation.
UPDATE credit_packages SET enabled = false WHERE package_id = 'credit-cn-10-v1';
