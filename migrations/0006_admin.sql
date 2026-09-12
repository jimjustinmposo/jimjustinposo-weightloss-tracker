-- Add admin flag to users table and set admin for jimjustinmposo@gmail.com
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Create index for admin lookups
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin) WHERE is_admin = 1;

-- Set jimjustinmposo@gmail.com as admin (in case the user already exists)
UPDATE users SET is_admin = 1 WHERE email = 'jimjustinmposo@gmail.com';