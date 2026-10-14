-- PostgreSQL Triggers for E-Learning Platform
-- Run after functions.sql:  psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f triggers.sql

-- Standard set_updated_at triggers
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_courses_updated_at
    BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- T-01: Capacity Guard on Enrollment (BEFORE INSERT ON enrollments)
CREATE OR REPLACE FUNCTION trg_enrollment_capacity_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_max_cap SMALLINT;
    v_cur_cap SMALLINT;
    v_status  batch_status_enum;
BEGIN
    SELECT max_capacity, current_capacity, status
      INTO v_max_cap, v_cur_cap, v_status
      FROM batches
     WHERE batch_id = NEW.batch_id FOR UPDATE;

    IF v_status = 'closed' THEN
        RAISE EXCEPTION 'Cannot enroll in a closed batch' USING ERRCODE = 'P0001';
    END IF;

    IF v_cur_cap >= v_max_cap THEN
        RAISE EXCEPTION 'Batch capacity limit reached (% max)', v_max_cap USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T01_enrollment_before_insert
    BEFORE INSERT ON enrollments
    FOR EACH ROW EXECUTE FUNCTION trg_enrollment_capacity_guard();

-- T-02: Increment Batch Capacity & Flip to Full (AFTER INSERT ON enrollments)
CREATE OR REPLACE FUNCTION trg_enrollment_increment_capacity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE batches
       SET current_capacity = current_capacity + 1,
           status = CASE WHEN current_capacity + 1 >= max_capacity THEN 'full'::batch_status_enum ELSE status END
     WHERE batch_id = NEW.batch_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T02_enrollment_after_insert
    AFTER INSERT ON enrollments
    FOR EACH ROW EXECUTE FUNCTION trg_enrollment_increment_capacity();

-- T-03: Decrement Capacity on Hard Delete (AFTER DELETE ON enrollments)
-- Only frees a seat if the row still held one (i.e. it was not already dropped,
-- because fn_drop_enrollment / fn_expire_pending_enrollments release it).
CREATE OR REPLACE FUNCTION trg_enrollment_decrement_capacity()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status <> 'dropped' THEN
        UPDATE batches
           SET current_capacity = GREATEST(current_capacity - 1, 0),
               status = CASE WHEN status = 'full' THEN 'open'::batch_status_enum ELSE status END
         WHERE batch_id = OLD.batch_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T03_enrollment_after_delete
    AFTER DELETE ON enrollments
    FOR EACH ROW EXECUTE FUNCTION trg_enrollment_decrement_capacity();

-- T-04: Auto-Generate Certificates (AFTER INSERT and AFTER UPDATE of progress)
-- Fix vs. first draft: completed items are now counted only if the content is
-- itself 'ready', so total and completed are measured on the same set.
CREATE OR REPLACE FUNCTION trg_progress_check_completion()
RETURNS TRIGGER AS $$
DECLARE
    v_course_id         INTEGER;
    v_student_id        INTEGER;
    v_enr_status        enrollment_status_enum;
    v_total_content     INTEGER;
    v_completed_content INTEGER;
BEGIN
    SELECT course_id, student_id, status INTO v_course_id, v_student_id, v_enr_status
      FROM enrollments WHERE enrollment_id = NEW.enrollment_id;

    IF v_enr_status <> 'active' THEN
        RETURN NEW;                  -- completed already, or not entitled
    END IF;

    SELECT COUNT(c.content_id) INTO v_total_content
      FROM content c
      JOIN content_modules m ON c.module_id = m.module_id
     WHERE m.course_id = v_course_id AND c.status = 'ready';

    IF v_total_content = 0 THEN
        RETURN NEW;
    END IF;

    SELECT COUNT(p.progress_id) INTO v_completed_content
      FROM progress p
      JOIN content c ON p.content_id = c.content_id
      JOIN content_modules m ON c.module_id = m.module_id
     WHERE p.enrollment_id = NEW.enrollment_id
       AND m.course_id = v_course_id
       AND c.status = 'ready'
       AND p.completed = TRUE;

    IF v_completed_content >= v_total_content THEN
        -- enrollment_id is UNIQUE on certificates, so this is also race-safe
        INSERT INTO certificates (enrollment_id, user_id, certificate_url)
        VALUES (
            NEW.enrollment_id,
            v_student_id,
            'https://elearning.org/certificates/CERT-' || NEW.enrollment_id || '-' || EXTRACT(EPOCH FROM now())::BIGINT
        )
        ON CONFLICT (enrollment_id) DO NOTHING;

        IF FOUND THEN
            UPDATE enrollments SET status = 'completed' WHERE enrollment_id = NEW.enrollment_id;

            INSERT INTO notifications (user_id, title, message, type)
            VALUES (
                v_student_id,
                'Course Completed!',
                'Congratulations! You have completed all modules and your certificate has been issued.',
                'certificate'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T04_progress_after_insert
    AFTER INSERT ON progress
    FOR EACH ROW WHEN (NEW.completed = TRUE)
    EXECUTE FUNCTION trg_progress_check_completion();

CREATE TRIGGER trg_T04_progress_after_update
    AFTER UPDATE ON progress
    FOR EACH ROW WHEN (NEW.completed = TRUE AND OLD.completed = FALSE)
    EXECUTE FUNCTION trg_progress_check_completion();

-- T-05: Payment Guard - enrollment must exist and be pending/active
-- (BEFORE INSERT ON payments)
CREATE OR REPLACE FUNCTION trg_payment_enrollment_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_status enrollment_status_enum;
BEGIN
    SELECT status INTO v_status FROM enrollments WHERE enrollment_id = NEW.enrollment_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Associated enrollment % does not exist', NEW.enrollment_id USING ERRCODE = 'P0002';
    END IF;

    IF v_status NOT IN ('pending', 'active') THEN
        RAISE EXCEPTION 'Cannot attach payment to enrollment in % status', v_status USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T05_payment_before_insert
    BEFORE INSERT ON payments
    FOR EACH ROW EXECUTE FUNCTION trg_payment_enrollment_guard();

-- T-06: Comment replies must stay inside the same module (and stay 1 level deep)
CREATE OR REPLACE FUNCTION trg_comment_parent_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_module INTEGER;
    v_parent_parent INTEGER;
BEGIN
    IF NEW.parent_comment_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT module_id, parent_comment_id INTO v_parent_module, v_parent_parent
      FROM comments WHERE comment_id = NEW.parent_comment_id;

    IF v_parent_module IS DISTINCT FROM NEW.module_id THEN
        RAISE EXCEPTION 'Reply must belong to the same module as its parent' USING ERRCODE = 'P0001';
    END IF;
    IF v_parent_parent IS NOT NULL THEN
        RAISE EXCEPTION 'Nested replies are restricted to a maximum depth of 1 level' USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T06_comment_before_insert
    BEFORE INSERT ON comments
    FOR EACH ROW EXECUTE FUNCTION trg_comment_parent_guard();
