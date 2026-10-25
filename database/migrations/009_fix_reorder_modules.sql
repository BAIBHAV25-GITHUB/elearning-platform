-- 009: fix fn_reorder_modules (PUT /courses/:id/modules/order always failed with
--      "FOR UPDATE is not allowed with aggregate functions", i.e. HTTP 500).
-- The row lock is now taken in its own statement. Safe to run twice.
BEGIN;

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

    -- lock the course's modules first; FOR UPDATE cannot be combined with array_agg in one statement
    PERFORM 1 FROM content_modules WHERE course_id = p_course_id FOR UPDATE;
    SELECT array_agg(module_id ORDER BY module_id) INTO v_existing
      FROM content_modules WHERE course_id = p_course_id;

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

COMMIT;
