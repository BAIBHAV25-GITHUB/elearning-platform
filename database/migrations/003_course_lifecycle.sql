-- Migration 003: course edit + lifecycle (step 3 of IMPROVEMENTS.md, P0-7, first half)
-- Run ONCE on an existing database (only adds two functions, safe to run twice):
--   psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f migrations/003_course_lifecycle.sql
-- Fresh installs already get these from functions.sql / elearning_full_setup.sql.

BEGIN;

-- Course edit + lifecycle (IMPROVEMENTS.md P0-7) ------------------------------------------------------

-- Edit a course. p_patch is a JSON object; only the keys that are present are changed:
--   title, description, price, thumbnail_url   (description / thumbnail_url may be null to clear them)
-- Rules (so no caller can bypass them):
--   * the course must exist (P0002) and the caller must be its instructor or an admin (42501)
--   * an archived course is read-only until it is restored (P0001)
--   * the price is locked once any student has an enrollment that is not 'dropped' (P0001),
--     because pending / paid enrollments were made at the old price
CREATE OR REPLACE FUNCTION fn_update_course(
    p_course_id INTEGER,
    p_user_id   INTEGER,
    p_patch     JSONB
)
RETURNS SETOF courses AS $$
DECLARE
    v_course courses%ROWTYPE;
    v_title  TEXT;
    v_price  NUMERIC;
BEGIN
    SELECT * INTO v_course FROM courses WHERE course_id = p_course_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;
    IF v_course.status = 'archived' THEN
        RAISE EXCEPTION 'An archived course cannot be edited. Restore it first.' USING ERRCODE = 'P0001';
    END IF;

    IF p_patch ? 'title' THEN
        v_title := btrim(p_patch ->> 'title');
        IF v_title IS NULL OR v_title = '' OR length(v_title) > 255 THEN
            RAISE EXCEPTION 'Course title is required (max 255 characters)' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF p_patch ? 'price' THEN
        v_price := (p_patch ->> 'price')::NUMERIC;
        IF v_price IS NULL OR v_price < 0 THEN
            RAISE EXCEPTION 'Price must be 0 or more' USING ERRCODE = 'P0001';
        END IF;
        IF v_price IS DISTINCT FROM v_course.price
           AND EXISTS (SELECT 1 FROM enrollments e
                        WHERE e.course_id = p_course_id AND e.status <> 'dropped') THEN
            RAISE EXCEPTION 'The price cannot be changed once students have enrolled in this course' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE courses c
       SET title         = CASE WHEN p_patch ? 'title'         THEN v_title                    ELSE c.title END,
           description   = CASE WHEN p_patch ? 'description'   THEN p_patch ->> 'description'   ELSE c.description END,
           price         = CASE WHEN p_patch ? 'price'         THEN v_price                    ELSE c.price END,
           thumbnail_url = CASE WHEN p_patch ? 'thumbnail_url' THEN p_patch ->> 'thumbnail_url' ELSE c.thumbnail_url END
     WHERE c.course_id = p_course_id;

    RETURN QUERY SELECT * FROM courses WHERE course_id = p_course_id;
END;
$$ LANGUAGE plpgsql;

-- Change a course's status: draft <-> published <-> archived.
--   * publishing needs at least one 'ready' lesson and one joinable batch (open, not ended)
--   * moving a course back to draft is blocked while students are enrolled (active / completed),
--     because they would lose access; archive it instead (existing students keep their access,
--     new enrollments are blocked)
-- Errors: P0002 not found, 42501 not allowed, P0001 rule violated (message is shown to the user).
CREATE OR REPLACE FUNCTION fn_set_course_status(
    p_course_id INTEGER,
    p_user_id   INTEGER,
    p_status    course_status_enum
)
RETURNS SETOF courses AS $$
DECLARE
    v_course courses%ROWTYPE;
BEGIN
    SELECT * INTO v_course FROM courses WHERE course_id = p_course_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;

    IF v_course.status = p_status THEN
        RETURN NEXT v_course;   -- nothing to do
        RETURN;
    END IF;

    IF p_status = 'published' THEN
        IF NOT EXISTS (SELECT 1 FROM content_modules m JOIN content ct ON ct.module_id = m.module_id
                        WHERE m.course_id = p_course_id AND ct.status = 'ready') THEN
            RAISE EXCEPTION 'Add at least one ready lesson before publishing' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM batches b
                        WHERE b.course_id = p_course_id AND b.status = 'open' AND b.end_date >= CURRENT_DATE) THEN
            RAISE EXCEPTION 'Add at least one open batch (end date not passed) before publishing' USING ERRCODE = 'P0001';
        END IF;
    ELSIF p_status = 'draft' THEN
        IF EXISTS (SELECT 1 FROM enrollments e
                    WHERE e.course_id = p_course_id AND e.status IN ('active', 'completed')) THEN
            RAISE EXCEPTION 'Students are enrolled in this course, so it cannot go back to draft. Archive it instead.' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE courses SET status = p_status WHERE course_id = p_course_id;
    RETURN QUERY SELECT * FROM courses WHERE course_id = p_course_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
