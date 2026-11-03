-- Shared-password administration has no user or student account records.
-- This counter bounds password-verifier work before deriving any password hash.
CREATE TABLE admin_login_budgets (
  minute INTEGER PRIMARY KEY,
  attempts INTEGER NOT NULL
);
