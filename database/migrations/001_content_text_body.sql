-- Migration 001: text lessons (step 1 of IMPROVEMENTS.md, P0-2)
-- Run ONCE on an existing database:
--   psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f migrations/001_content_text_body.sql
-- Fresh installs already get this from schema.sql / elearning_full_setup.sql.
-- Safe to run twice (IF NOT EXISTS / guarded constraint).

BEGIN;

ALTER TABLE content ADD COLUMN IF NOT EXISTS text_body TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_content_text_body') THEN
        -- NOT VALID: rows that already exist are not re-checked (old 'text' rows could only
        -- have been created with a file, so they have no body). New rows must satisfy it.
        ALTER TABLE content
            ADD CONSTRAINT chk_content_text_body
            CHECK (type <> 'text' OR (text_body IS NOT NULL AND length(btrim(text_body)) > 0))
            NOT VALID;
    END IF;
END $$;

COMMIT;
