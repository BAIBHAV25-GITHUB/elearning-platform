-- Migration 007: certificate verification code (step 6 of IMPROVEMENTS.md, section 3.5)
-- Run ONCE on an existing database (safe to run twice; needs PostgreSQL 13+ for gen_random_uuid()):
--   psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f migrations/007_certificate_verification.sql
-- Existing certificates get a code automatically. Fresh installs get this from schema.sql / elearning_full_setup.sql.

BEGIN;

-- Certificates (step 6): a short public code that anyone can check on the verify page, instead of the
-- made-up certificate_url. (certificate_url stays only because the completion trigger still fills it.)
ALTER TABLE certificates
    ADD COLUMN IF NOT EXISTS verification_code VARCHAR(16) NOT NULL
        DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificates_code ON certificates (verification_code);

COMMIT;
