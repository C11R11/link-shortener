CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  destination_url text NOT NULL,
  title text,
  description text,
  status text NOT NULL DEFAULT 'active',
  click_count integer NOT NULL DEFAULT 0,
  last_clicked_at timestamptz,
  created_by text,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS links_status_idx ON links (status);

CREATE TABLE IF NOT EXISTS link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  referrer text,
  user_agent text,
  country text,
  ip_hash text
);

CREATE INDEX IF NOT EXISTS link_clicks_link_id_idx ON link_clicks (link_id);
CREATE INDEX IF NOT EXISTS link_clicks_clicked_at_idx ON link_clicks (clicked_at DESC);

