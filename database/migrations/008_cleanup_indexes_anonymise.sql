-- 008: schema cleanup (IMPROVEMENTS.md §4 items 1, 2, 7)
--   * drop structures nothing ever used: reports, audit_log_details, report_format_enum,
--     certificates.email_sent, users.phone
--   * indexes for the queries the app actually runs
--   * fn_anonymise_user: the "delete my account" path (users can never be hard-deleted because
--     courses / enrollments / payments / certificates reference them with RESTRICT)
BEGIN;

-- 1. dead structures --------------------------------------------------------------------------
DROP TABLE IF EXISTS audit_log_details;
DROP TABLE IF EXISTS reports;
DROP TYPE  IF EXISTS report_format_enum;
ALTER TABLE certificates DROP COLUMN IF EXISTS email_sent;
ALTER TABLE users        DROP COLUMN IF EXISTS phone;

-- 2. indexes (the new composites replace the single-column ones they start with) --------------
CREATE INDEX IF NOT EXISTS idx_comments_module_created ON comments (module_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_user_created      ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status         ON payments (status);
CREATE INDEX IF NOT EXISTS idx_courses_instructor_status ON courses (instructor_id, status);
DROP INDEX IF EXISTS idx_comments_module;
DROP INDEX IF EXISTS idx_courses_instructor;

-- 3. anonymise a user (soft delete) -----------------------------------------------------------
-- Keeps every row other tables point at (payments, enrollments, certificates, comments), but removes
-- everything that identifies the person: name, e-mail, password, notifications and logged IPs. The
-- account becomes inactive, so it cannot log in, and the e-mail is freed for a new registration.
CREATE OR REPLACE FUNCTION fn_anonymise_user(p_admin_id INTEGER, p_user_id INTEGER)
RETURNS TABLE (user_id INTEGER, role TEXT) AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can delete an account' USING ERRCODE = '42501';
    END IF;

    PERFORM 1 FROM users u WHERE u.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
    IF p_user_id = p_admin_id THEN
        RAISE EXCEPTION 'You cannot delete your own account here' USING ERRCODE = 'P0001';
    END IF;

    v_role := fn_user_role(p_user_id);
    IF v_role = 'admin' THEN
        RAISE EXCEPTION 'Admin accounts cannot be deleted here' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM users u WHERE u.user_id = p_user_id AND u.email LIKE 'deleted-%@deleted.invalid') THEN
        RAISE EXCEPTION 'This account is already deleted' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM courses c WHERE c.instructor_id = p_user_id AND c.status = 'published') THEN
        RAISE EXCEPTION 'This instructor still has published courses. Reassign or archive them first'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE users
       SET user_name = 'Deleted user',
           email     = 'deleted-' || p_user_id || '@deleted.invalid',
           password  = '!deleted',          -- not a valid bcrypt hash: nobody can ever log in
           status    = 'inactive'
     WHERE users.user_id = p_user_id;

    DELETE FROM notifications n WHERE n.user_id = p_user_id;
    UPDATE audit_logs a SET ip_address = NULL WHERE a.user_id = p_user_id;

    RETURN QUERY SELECT p_user_id, v_role;
END;
$$ LANGUAGE plpgsql;

COMMIT;
