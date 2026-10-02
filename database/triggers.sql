-- PostgreSQL Triggers T-01 through T-05 for E-Learning Platform

\c elearning_db;

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
    v_status batch_status_enum;
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
CREATE OR REPLACE FUNCTION trg_enrollment_decrement_capacity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE batches
       SET current_capacity = GREATEST(current_capacity - 1, 0),
           status = CASE WHEN status = 'full' THEN 'open'::batch_status_enum ELSE status END
     WHERE batch_id = OLD.batch_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_T03_enrollment_after_delete
    AFTER DELETE ON enrollments
    FOR EACH ROW EXECUTE FUNCTION trg_enrollment_decrement_capacity();

-- T-04: Auto-Generate Certificates (Fires on BOTH AFTER INSERT and AFTER UPDATE of progress)
CREATE OR REPLACE FUNCTION trg_progress_check_completion()
RETURNS TRIGGER AS $$
DECLARE
    v_course_id INTEGER;
    v_student_id INTEGER;
    v_total_content INTEGER;
    v_completed_content INTEGER;
    v_cert_exists BOOLEAN;
BEGIN
    -- Find course and student from enrollment
    SELECT course_id, student_id INTO v_course_id, v_student_id
      FROM enrollments WHERE enrollment_id = NEW.enrollment_id;

    -- Count total ready content in course
    SELECT COUNT(c.content_id) INTO v_total_content
      FROM content c
      JOIN content_modules m ON c.module_id = m.module_id
     WHERE m.course_id = v_course_id AND c.status = 'ready';

    IF v_total_content = 0 THEN
        RETURN NEW;
    END IF;

    -- Count completed content for this enrollment
    SELECT COUNT(p.progress_id) INTO v_completed_content
      FROM progress p
      JOIN content c ON p.content_id = c.content_id
      JOIN content_modules m ON c.module_id = m.module_id
     WHERE p.enrollment_id = NEW.enrollment_id 
       AND m.course_id = v_course_id 
       AND p.completed = TRUE;

    -- Check if 100% completed
    IF v_completed_content >= v_total_content THEN
        SELECT EXISTS(SELECT 1 FROM certificates WHERE enrollment_id = NEW.enrollment_id) INTO v_cert_exists;
        
        IF NOT v_cert_exists THEN
            INSERT INTO certificates (enrollment_id, user_id, certificate_url)
            VALUES (
                NEW.enrollment_id,
                v_student_id,
                'https://elearning.org/certificates/CERT-' || NEW.enrollment_id || '-' || EXTRACT(EPOCH FROM now())::BIGINT
            );

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

-- T-05: Payment Guard - Ensures enrollment exists and is in pending/active status BEFORE INSERT ON payments
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