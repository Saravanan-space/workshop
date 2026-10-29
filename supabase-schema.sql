-- ============================================================
-- Workshop Live Prompts - Supabase Database Schema
-- Run this script in your Supabase SQL Editor:
-- Supabase Dashboard -> SQL Editor -> New Query -> Paste & Run
-- ============================================================

-- 1. Create the Prompts table
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  notes TEXT DEFAULT '',
  why_it_works TEXT DEFAULT '',
  how_not_to_prompt TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  "order" INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deployed_at TIMESTAMPTZ
);

-- 2. Create the Workshop Settings table (for active prompt, broadcast alert, title)
CREATE TABLE IF NOT EXISTS workshop_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  workshop_title TEXT DEFAULT 'Google Antigravity workshop by T M Saravanan',
  active_prompt_id TEXT,
  broadcast JSONB DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_settings ENABLE ROW LEVEL SECURITY;

-- 4. Create Policies for Public / Anonymous API access (Anon & Service Role)
-- Drop old policies if they exist to avoid duplicate conflicts
DROP POLICY IF EXISTS "Allow anon all on prompts" ON prompts;
DROP POLICY IF EXISTS "Allow anon all on workshop_settings" ON workshop_settings;

CREATE POLICY "Allow anon all on prompts" 
  ON prompts 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

CREATE POLICY "Allow anon all on workshop_settings" 
  ON workshop_settings 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

-- Insert default settings row if not present
INSERT INTO workshop_settings (id, workshop_title, active_prompt_id, broadcast)
VALUES ('default', 'Google Antigravity workshop by T M Saravanan', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

