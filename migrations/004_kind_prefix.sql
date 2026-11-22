-- Transaction kinds are namespaced '<module>.<name>' (docs/modules.md section 4). Core-owned kinds start with 'core.'.
-- txns has no UPDATE trigger (ledger_lock guards INSERTs and accounts.balance_cents only), so no lock dance is needed here;
-- every guard trigger from 002 stays untouched.
UPDATE txns SET kind = 'bank-basic.transfer' WHERE kind = 'transfer';
UPDATE txns SET kind = 'bank-basic.welcome' WHERE kind = 'grant' AND json_extract(meta, '$.reason') = 'welcome';
UPDATE txns SET kind = 'core.reversal' WHERE kind = 'reversal';

-- The bank module's audit actions follow the same rule (k.audit prefixes the module id): 'bank.transfer' -> 'bank-basic.transfer'.
UPDATE audit_log SET action = 'bank-basic.' || substr(action, 6) WHERE action LIKE 'bank.%';

-- Module migrations are recorded by name now ('mod:<module>:<migration id>'), not by position. bank-basic's first one was recorded
-- as 'mod:bank-basic:001' and is called '001_settings' from here on, so it is not run a second time.
UPDATE schema_migrations SET id = 'mod:bank-basic:001_settings' WHERE id = 'mod:bank-basic:001';
