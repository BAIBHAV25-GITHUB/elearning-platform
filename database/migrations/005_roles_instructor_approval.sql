-- Migration 005: role change, instructor approval, course reassignment
-- (step 4, second half of IMPROVEMENTS.md: sections 3.1, 3.2 and the 3.3 decision)
-- Run ONCE on an existing database (safe to run twice):
--   psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f migrations/005_roles_instructor_approval.sql
-- Fresh installs already get all of this from schema.sql / functions.sql / elearning_full_setup.sql.
--
-- Decision for 3.3 (multi-role): ONE role per account. Instructors and admins do not enrol in courses;
-- a person who wants to teach AND learn uses two accounts. An admin can switch an account between
-- student and instructor (fn_set_user_role).

BEGIN;

-- 3.2 instructor approval: NULL for non-instructors, 'pending' after self-registering as instructor.
ALTER TABLE users ADD COLUMN IF NOT EXISTS instructor_status VARCHAR(10);
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_instructor_status;
ALTER TABLE users ADD CONSTRAINT chk_users_instructor_status
    CHECK (instructor_status IS NULL OR instructor_status IN ('pending', 'approved', 'rejected'));

-- Everyone who is an instructor today keeps working: mark them approved.
UPDATE users u SET instructor_status = 'approved'
 WHERE u.instructor_status IS NULL AND fn_user_role(u.user_id) = 'instructor';

-- Role change / instructor approval / course reassignment (step 4, second half) ----------------------

-- Self-registration: an instructor starts as 'pending' and cannot create or publish courses until an
-- admin approves the account.
CREATE OR REPLACE FUNCTION fn_register_user(
    p_name          VARCHAR,
    p_email         VARCHAR,
    p_password_hash VARCHAR,
    p_role          VARCHAR DEFAULT 'student'
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR, role TEXT) AS $$
#variable_conflict use_column
DECLARE
    v_role_id SMALLINT;
    v_user_id INTEGER;
    v_role    TEXT := lower(COALESCE(NULLIF(btrim(p_role), ''), 'student'));
BEGIN
    IF v_role NOT IN ('student', 'instructor') THEN
        RAISE EXCEPTION 'Role "%" cannot be self-registered', v_role USING ERRCODE = 'P0001';
    END IF;

    SELECT role_id INTO v_role_id FROM roles WHERE lower(role_name) = v_role;
    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'Role "%" is not configured', v_role USING ERRCODE = 'P0002';
    END IF;

    -- unique_violation (23505) on lower(email) is raised naturally for duplicates
    INSERT INTO users (user_name, email, password, instructor_status)
    VALUES (btrim(p_name), lower(btrim(p_email)), p_password_hash,
            CASE WHEN v_role = 'instructor' THEN 'pending' ELSE NULL END)
    RETURNING users.user_id INTO v_user_id;

    INSERT INTO user_roles (user_id, role_id) VALUES (v_user_id, v_role_id);

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_role
          FROM users u WHERE u.user_id = v_user_id;
END;
$$ LANGUAGE plpgsql;

-- Paged user list (now with instructor_status and an instructor_status filter).
DROP FUNCTION IF EXISTS fn_list_users(TEXT, TEXT, user_status_enum, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION fn_list_users(
    p_search            TEXT,
    p_role              TEXT,
    p_status            user_status_enum,
    p_limit             INTEGER,
    p_offset            INTEGER,
    p_instructor_status TEXT DEFAULT NULL
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               status user_status_enum, role TEXT, created_at TIMESTAMPTZ,
               instructor_status VARCHAR, total_count BIGINT) AS $$
    SELECT u.user_id, u.user_name, u.email, u.status, fn_user_role(u.user_id), u.created_at,
           u.instructor_status, count(*) OVER ()
      FROM users u
     WHERE (COALESCE(p_search, '') = ''
            OR u.user_name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR u.email     ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       AND (p_status IS NULL OR u.status = p_status)
       AND (p_role   IS NULL OR fn_user_role(u.user_id) = p_role)
       AND (p_instructor_status IS NULL OR u.instructor_status = p_instructor_status)
     ORDER BY u.created_at DESC, u.user_id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$ LANGUAGE sql STABLE;

-- Switch an account between 'student' and 'instructor' (one role per account).
--   * caller must be an admin (42501); target must exist (P0002)
--   * not your own account, not an admin account, no 'admin' as target role (P0001)
--   * an instructor who still owns courses cannot become a student: reassign or delete them first (P0001)
--   * becoming an instructor through an admin is approved at once; becoming a student clears the approval
CREATE OR REPLACE FUNCTION fn_set_user_role(
    p_admin_id INTEGER,
    p_user_id  INTEGER,
    p_role     TEXT
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               old_role TEXT, role TEXT, instructor_status VARCHAR) AS $$
#variable_conflict use_column
DECLARE
    v_old     TEXT;
    v_new     TEXT := lower(btrim(COALESCE(p_role, '')));
    v_role_id SMALLINT;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can change a role' USING ERRCODE = '42501';
    END IF;
    IF v_new NOT IN ('student', 'instructor') THEN
        RAISE EXCEPTION 'Role must be student or instructor' USING ERRCODE = 'P0001';
    END IF;

    PERFORM 1 FROM users u WHERE u.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
    IF p_user_id = p_admin_id THEN
        RAISE EXCEPTION 'You cannot change your own role' USING ERRCODE = 'P0001';
    END IF;

    v_old := fn_user_role(p_user_id);
    IF v_old = 'admin' THEN
        RAISE EXCEPTION 'Admin accounts cannot be changed here' USING ERRCODE = 'P0001';
    END IF;

    IF v_old IS DISTINCT FROM v_new THEN
        IF v_old = 'instructor' AND EXISTS (SELECT 1 FROM courses c WHERE c.instructor_id = p_user_id) THEN
            RAISE EXCEPTION 'This instructor still owns courses. Reassign or delete them before making the account a student.'
                USING ERRCODE = 'P0001';
        END IF;

        SELECT r.role_id INTO v_role_id FROM roles r WHERE lower(r.role_name) = v_new;
        IF v_role_id IS NULL THEN
            RAISE EXCEPTION 'Role "%" is not configured', v_new USING ERRCODE = 'P0002';
        END IF;

        DELETE FROM user_roles ur WHERE ur.user_id = p_user_id;
        INSERT INTO user_roles (user_id, role_id) VALUES (p_user_id, v_role_id);

        UPDATE users u
           SET instructor_status = CASE WHEN v_new = 'instructor' THEN 'approved' ELSE NULL END
         WHERE u.user_id = p_user_id;
    END IF;

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_old, v_new, u.instructor_status
          FROM users u WHERE u.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Approve or reject an instructor account (decision 'approved' | 'rejected'; can be changed later).
-- Only accounts whose role is instructor can be reviewed. Returns the old and the new decision.
CREATE OR REPLACE FUNCTION fn_review_instructor(
    p_admin_id INTEGER,
    p_user_id  INTEGER,
    p_decision TEXT
)
RETURNS TABLE (user_id INTEGER, user_name VARCHAR, email VARCHAR,
               old_instructor_status VARCHAR, instructor_status VARCHAR) AS $$
#variable_conflict use_column
DECLARE
    v_old VARCHAR;
    v_dec TEXT := lower(btrim(COALESCE(p_decision, '')));
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can review instructors' USING ERRCODE = '42501';
    END IF;
    IF v_dec NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Decision must be approved or rejected' USING ERRCODE = 'P0001';
    END IF;

    SELECT u.instructor_status INTO v_old FROM users u WHERE u.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;
    IF fn_user_role(p_user_id) IS DISTINCT FROM 'instructor' THEN
        RAISE EXCEPTION 'Only instructor accounts can be approved or rejected' USING ERRCODE = 'P0001';
    END IF;

    UPDATE users u SET instructor_status = v_dec WHERE u.user_id = p_user_id;

    RETURN QUERY
        SELECT u.user_id, u.user_name, u.email, v_old, u.instructor_status
          FROM users u WHERE u.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Move a course to another instructor (admin only). The new owner must be an active, approved instructor
-- and must not be enrolled in this course. Students, batches and progress stay untouched.
CREATE OR REPLACE FUNCTION fn_reassign_course(
    p_admin_id      INTEGER,
    p_course_id     INTEGER,
    p_instructor_id INTEGER
)
RETURNS TABLE (course_id INTEGER, title VARCHAR, old_instructor_id INTEGER,
               instructor_id INTEGER, instructor_name VARCHAR) AS $$
#variable_conflict use_column
DECLARE
    v_old INTEGER;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can reassign a course' USING ERRCODE = '42501';
    END IF;

    SELECT c.instructor_id INTO v_old FROM courses c WHERE c.course_id = p_course_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = p_instructor_id) THEN
        RAISE EXCEPTION 'Instructor % not found', p_instructor_id USING ERRCODE = 'P0002';
    END IF;
    IF fn_user_role(p_instructor_id) IS DISTINCT FROM 'instructor' THEN
        RAISE EXCEPTION 'The new owner must be an instructor account' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM users u WHERE u.user_id = p_instructor_id
                  AND (u.status <> 'active' OR u.instructor_status IS DISTINCT FROM 'approved')) THEN
        RAISE EXCEPTION 'The new owner must be an active, approved instructor' USING ERRCODE = 'P0001';
    END IF;
    IF v_old = p_instructor_id THEN
        RAISE EXCEPTION 'This instructor already owns the course' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM enrollments e
                WHERE e.course_id = p_course_id AND e.student_id = p_instructor_id AND e.status <> 'dropped') THEN
        RAISE EXCEPTION 'That instructor is enrolled in this course as a student' USING ERRCODE = 'P0001';
    END IF;

    UPDATE courses c SET instructor_id = p_instructor_id WHERE c.course_id = p_course_id;

    RETURN QUERY
        SELECT c.course_id, c.title, v_old, c.instructor_id, u.user_name
          FROM courses c JOIN users u ON u.user_id = c.instructor_id
         WHERE c.course_id = p_course_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
