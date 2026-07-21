-- Allow the read-only 'viewer' role on users.role.
-- The viewer sees everything in the app but every write is blocked server-side
-- (see src/proxy.ts). Safe to re-run.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'staff', 'comms', 'viewer'));
