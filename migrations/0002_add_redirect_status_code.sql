ALTER TABLE links
ADD COLUMN IF NOT EXISTS redirect_status_code integer NOT NULL DEFAULT 302;

