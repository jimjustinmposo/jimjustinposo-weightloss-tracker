-- Offline-first sync support (additive only).
-- food_logs.client_id = a client-generated id attached to locally created
-- entries so the sync retry path can never insert a duplicate row.
ALTER TABLE food_logs ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_logs_client_id ON food_logs(client_id);