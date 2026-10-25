-- Migration 004: module edit / reorder / delete, batch edit / close, course delete
-- (step 3 of IMPROVEMENTS.md, P0-7, second half)
-- Run ONCE on an existing database (safe to run twice):
--   psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f migrations/004_module_batch_course_delete.sql
-- Fresh installs already get all of this from schema.sql / functions.sql / elearning_full_setup.sql.

BEGIN;

-- Make the module order key deferrable so a reorder can swap numbers inside one transaction.
ALTER TABLE content_modules DROP CONSTRAINT IF EXISTS uq_module_seq;
ALTER TABLE content_modules
    ADD CONSTRAINT uq_module_seq UNIQUE (course_id, sequence_no) DEFERRABLE INITIALLY IMMEDIATE;

-- Module edit / reorder / delete, batch edit / close, course delete (IMPROVEMENTS.md P0-7, second half) ----

-- Edit a module's title / description. p_patch keys present are changed.
CREATE OR REPLACE FUNCTION fn_update_module(
    p_course_id INTEGER,
    p_module_id INTEGER,
    p_user_id   INTEGER,
    p_patch     JSONB
)
RETURNS SETOF content_modules AS $$
DECLARE
    v_title TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM content_modules WHERE module_id = p_module_id AND course_id = p_course_id) THEN
        RAISE EXCEPTION 'Module not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;
    IF (SELECT status FROM courses WHERE course_id = p_course_id) = 'archived' THEN
        RAISE EXCEPTION 'An archived course cannot be edited. Restore it first.' USING ERRCODE = 'P0001';
    END IF;
    IF p_patch ? 'title' THEN
        v_title := btrim(p_patch ->> 'title');
        IF v_title IS NULL OR v_title = '' OR length(v_title) > 200 THEN
            RAISE EXCEPTION 'Module title is required (max 200 characters)' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE content_modules m
       SET title       = CASE WHEN p_patch ? 'title'       THEN v_title                  ELSE m.title END,
           description = CASE WHEN p_patch ? 'description' THEN p_patch ->> 'description' ELSE m.description END
     WHERE m.module_id = p_module_id;

    RETURN QUERY SELECT * FROM content_modules WHERE module_id = p_module_id;
END;
$$ LANGUAGE plpgsql;

-- Reorder: p_module_ids must list EVERY module of the course exactly once, in the new order.
-- Sequence numbers become 1..n. The unique key is checked at the end of the statement set
-- (DEFERRED), so the numbers can swap without colliding.
CREATE OR REPLACE FUNCTION fn_reorder_modules(
    p_course_id   INTEGER,
    p_user_id     INTEGER,
    p_module_ids  INTEGER[]
)
RETURNS VOID AS $$
DECLARE
    v_existing INTEGER[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM courses WHERE course_id = p_course_id) THEN
        RAISE EXCEPTION 'Course not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(p_course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;
    IF (SELECT status FROM courses WHERE course_id = p_course_id) = 'archived' THEN
        RAISE EXCEPTION 'An archived course cannot be edited. Restore it first.' USING ERRCODE = 'P0001';
    END IF;

    SELECT array_agg(module_id ORDER BY module_id) INTO v_existing
      FROM content_modules WHERE course_id = p_course_id FOR UPDATE;

    IF v_existing IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_module_ids) AS x) THEN
        RAISE EXCEPTION 'The new order must list every module of this course exactly once' USING ERRCODE = 'P0001';
    END IF;

    SET CONSTRAINTS uq_module_seq DEFERRED;
    UPDATE content_modules m
       SET sequence_no = o.ord
      FROM unnest(p_module_ids) WITH ORDINALITY AS o(module_id, ord)
     WHERE m.module_id = o.module_id;
END;
$$ LANGUAGE plpgsql;

-- Edit a batch. p_patch keys (all optional): batch_name, start_date, end_date, max_capacity, status
--   * status may be 'open' or 'closed' ('full' is set by the system); closing is allowed any time,
--     existing students keep their seat; reopening needs end_date today or later
--   * max_capacity cannot go below the seats already taken
--   * a batch that has reached max_capacity becomes 'full', one that has free seats again becomes 'open'
CREATE OR REPLACE FUNCTION fn_update_batch(
    p_batch_id  INTEGER,
    p_user_id   INTEGER,
    p_patch     JSONB
)
RETURNS SETOF batches AS $$
DECLARE
    v_b      batches%ROWTYPE;
    v_name   TEXT;
    v_start  DATE;
    v_end    DATE;
    v_cap    INTEGER;
    v_status batch_status_enum;
BEGIN
    SELECT * INTO v_b FROM batches WHERE batch_id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Batch not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT fn_can_manage_course(v_b.course_id, p_user_id) THEN
        RAISE EXCEPTION 'You do not manage this course' USING ERRCODE = '42501';
    END IF;
    IF (SELECT status FROM courses WHERE course_id = v_b.course_id) = 'archived' THEN
        RAISE EXCEPTION 'An archived course cannot be edited. Restore it first.' USING ERRCODE = 'P0001';
    END IF;

    v_name   := CASE WHEN p_patch ? 'batch_name'   THEN btrim(p_patch ->> 'batch_name')    ELSE v_b.batch_name END;
    v_start  := CASE WHEN p_patch ? 'start_date'   THEN (p_patch ->> 'start_date')::DATE   ELSE v_b.start_date END;
    v_end    := CASE WHEN p_patch ? 'end_date'     THEN (p_patch ->> 'end_date')::DATE     ELSE v_b.end_date END;
    v_cap    := CASE WHEN p_patch ? 'max_capacity' THEN (p_patch ->> 'max_capacity')::INTEGER ELSE v_b.max_capacity END;
    v_status := CASE WHEN p_patch ? 'status'       THEN (p_patch ->> 'status')::batch_status_enum ELSE v_b.status END;

    IF v_name IS NULL OR v_name = '' OR length(v_name) > 100 THEN
        RAISE EXCEPTION 'Batch name is required (max 100 characters)' USING ERRCODE = 'P0001';
    END IF;
    IF v_end <= v_start THEN
        RAISE EXCEPTION 'The start date must be earlier than the end date' USING ERRCODE = 'P0001';
    END IF;
    IF v_cap < 1 OR v_cap > 30 THEN
        RAISE EXCEPTION 'Capacity must be between 1 and 30' USING ERRCODE = 'P0001';
    END IF;
    IF v_cap < v_b.current_capacity THEN
        RAISE EXCEPTION 'Capacity cannot be lower than the % seat(s) already taken', v_b.current_capacity USING ERRCODE = 'P0001';
    END IF;
    IF v_status NOT IN ('open', 'closed', 'full') OR (v_status = 'full' AND v_b.status <> 'full') THEN
        RAISE EXCEPTION 'Status must be open or closed' USING ERRCODE = 'P0001';
    END IF;

    IF v_status = 'closed' THEN
        NULL;  -- stays closed
    ELSE
        IF v_b.status = 'closed' AND v_end < CURRENT_DATE THEN
            RAISE EXCEPTION 'This batch has already ended. Move the end date forward to reopen it.' USING ERRCODE = 'P0001';
        END IF;
        IF v_end < CURRENT_DATE THEN
            v_status := 'closed';
        ELSIF v_b.current_capacity >= v_cap THEN
            v_status := 'full';
        ELSE
            v_status := 'open';
        END IF;
    END IF;

    UPDATE batches
       SET batch_name = v_name, start_date = v_start, end_date = v_end,
           max_capacity = v_cap, status = v_status
     WHERE batch_id = p_batch_id;

    RETURN QUERY SELECT * FROM batches WHERE batch_id = p_batch_id;
END;
$$ LANGUAGE plpgsql;
COMMIT;
