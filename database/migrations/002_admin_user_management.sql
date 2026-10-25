-- Migration 002: admin user management (step 2 of IMPROVEMENTS.md, P0-5)
-- Run ONCE on an existing database (needs no data change, only two new functions; safe to run twice):
--   psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f migrations/002_admin_user_management.sql
-- Fresh installs already get these from functions.sql / elearning_full_setup.sql.

BEGIN;

-- Admin user management (IMPROVEMENTS.md P0-5) --------------------------------------------------------

-- Paged user list for the admin area. p_search matches name or email (LIKE wildcards in it are escaped);
-- p_role / p_status / p_search may be NULL = no filter. Never returns the password hash.
CREATE OR REPLACE FUNCTION fn_list_users(
    p_search TEXT,
    p_role   TEXT,
    p_status user_status_enum,
    p_limit  INTEGER,
    p_offset INTEGER
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               status user_status_enum, role TEXT, created_at TIMESTAMPTZ, total_count BIGINT) AS $$
    SELECT u.user_id, u.user_name, u.email, u.status, fn_user_role(u.user_id), u.created_at,
           count(*) OVER ()
      FROM users u
     WHERE (COALESCE(p_search, '') = ''
            OR u.user_name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR u.email     ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       AND (p_status IS NULL OR u.status = p_status)
       AND (p_role   IS NULL OR fn_user_role(u.user_id) = p_role)
     ORDER BY u.created_at DESC, u.user_id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$ LANGUAGE sql STABLE;

-- Activate / deactivate / ban an account. The rules live here so no caller can bypass them:
--   * the caller must be an admin                      (42501)
--   * the target must exist                            (P0002)
--   * an admin cannot change their own status          (P0001)
--   * admin accounts cannot be changed through this    (P0001)
-- Returns the previous and the new status so the API can write a real audit-log entry.
CREATE OR REPLACE FUNCTION fn_set_user_status(
    p_admin_id INTEGER,
    p_user_id  INTEGER,
    p_status   user_status_enum
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               old_status user_status_enum, status user_status_enum, role TEXT) AS $$
DECLARE
    v_old  user_status_enum;
    v_role TEXT;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can change an account status' USING ERRCODE = '42501';
    END IF;

    SELECT u.status INTO v_old FROM users u WHERE u.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
    IF p_user_id = p_admin_id THEN
        RAISE EXCEPTION 'You cannot change your own account status' USING ERRCODE = 'P0001';
    END IF;

    v_role := fn_user_role(p_user_id);
    IF v_role = 'admin' THEN
        RAISE EXCEPTION 'Admin accounts cannot be changed here' USING ERRCODE = 'P0001';
    END IF;

    UPDATE users SET status = p_status WHERE users.user_id = p_user_id;

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_old, u.status, v_role
          FROM users u WHERE u.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
