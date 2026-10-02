-- PostgreSQL Functions for E-Learning Platform

\c elearning_db;

-- 1. Updated At Trigger Function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Student Enrollment Procedure Function
CREATE OR REPLACE FUNCTION fn_enroll_student(
    p_student_id INTEGER,
    p_course_id INTEGER,
    p_batch_id INTEGER
)
RETURNS INTEGER AS $$
DECLARE
    v_enrollment_id INTEGER;
    v_price DECIMAL(10,2);
    v_payment_method payment_method_enum;
BEGIN
    -- Verify course price
    SELECT price INTO v_price FROM courses WHERE course_id = p_course_id;
    IF v_price IS NULL THEN
        RAISE EXCEPTION 'Course % does not exist', p_course_id USING ERRCODE = 'P0002';
    END IF;

    -- Insert Enrollment (Triggers T-01 and T-02 handle capacity guarding and tracking)
    INSERT INTO enrollments (student_id, course_id, batch_id, status)
    VALUES (p_student_id, p_course_id, p_batch_id, 'pending')
    RETURNING enrollment_id INTO v_enrollment_id;

    -- If course is free ($0.00), automatically create a success payment row
    IF v_price = 0.00 THEN
        v_payment_method := 'free';
        INSERT INTO payments (enrollment_id, amount, payment_method, status, transaction_id, gateway)
        VALUES (v_enrollment_id, 0.00, v_payment_method, 'success', 'FREE-' || v_enrollment_id || '-' || EXTRACT(EPOCH FROM now()), 'system');

        UPDATE enrollments SET status = 'active' WHERE enrollment_id = v_enrollment_id;
    END IF;

    RETURN v_enrollment_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Confirm Payment Function (Idempotent Webhook Handler)
CREATE OR REPLACE FUNCTION fn_confirm_payment(
    p_payment_id INTEGER,
    p_transaction_id VARCHAR(255),
    p_gateway VARCHAR(50)
)
RETURNS VOID AS $$
DECLARE
    v_enrollment_id INTEGER;
    v_student_id INTEGER;
    v_course_name VARCHAR(200);
BEGIN
    -- Retrieve payment & enrollment info
    SELECT p.enrollment_id, e.student_id, c.course_name
      INTO v_enrollment_id, v_student_id, v_course_name
      FROM payments p
      JOIN enrollments e ON p.enrollment_id = e.enrollment_id
      JOIN courses c ON e.course_id = c.course_id
     WHERE p.payment_id = p_payment_id FOR UPDATE;

    IF v_enrollment_id IS NULL THEN
        RAISE EXCEPTION 'Payment record % not found', p_payment_id USING ERRCODE = 'P0002';
    END IF;

    -- Update Payment Record
    UPDATE payments
       SET status = 'success',
           transaction_id = p_transaction_id,
           gateway = p_gateway
     WHERE payment_id = p_payment_id;

    -- Update Enrollment to Active
    UPDATE enrollments
       SET status = 'active'
     WHERE enrollment_id = v_enrollment_id;

    -- Create System Notification
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
        v_student_id,
        'Payment Confirmed & Enrollment Active',
        'Your payment for ' || v_course_name || ' was confirmed successfully.',
        'payment'
    );
END;
$$ LANGUAGE plpgsql;

-- 4. Upsert Progress Function
CREATE OR REPLACE FUNCTION fn_upsert_progress(
    p_enrollment_id INTEGER,
    p_content_id INTEGER,
    p_watch_duration INTEGER,
    p_completed BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO progress (enrollment_id, content_id, watch_duration, completed, completed_at)
    VALUES (
        p_enrollment_id,
        p_content_id,
        p_watch_duration,
        p_completed,
        CASE WHEN p_completed THEN now() ELSE NULL END
    )
    ON CONFLICT (enrollment_id, content_id) DO UPDATE
    SET watch_duration = GREATEST(progress.watch_duration, EXCLUDED.watch_duration),
        completed = progress.completed OR EXCLUDED.completed,
        completed_at = CASE 
            WHEN progress.completed THEN progress.completed_at
            WHEN EXCLUDED.completed THEN now()
            ELSE NULL 
        END;
END;
$$ LANGUAGE plpgsql;

-- 5. Soft-Drop Enrollment Function (Releases Seat Safely)
CREATE OR REPLACE FUNCTION fn_drop_enrollment(
    p_enrollment_id INTEGER,
    p_reason VARCHAR(255)
)
RETURNS VOID AS $$
DECLARE
    v_student_id INTEGER;
    v_batch_id INTEGER;
    v_course_name VARCHAR(200);
BEGIN
    SELECT e.student_id, c.course_name, e.batch_id
      INTO v_student_id, v_course_name, v_batch_id
      FROM enrollments e
      JOIN courses c ON e.course_id = c.course_id
     WHERE e.enrollment_id = p_enrollment_id FOR UPDATE;

    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Enrollment % not found', p_enrollment_id USING ERRCODE = 'P0002';
    END IF;

    -- Mark enrollment as dropped
    UPDATE enrollments
       SET status = 'dropped'
     WHERE enrollment_id = p_enrollment_id;

    -- Release batch capacity
    UPDATE batches
       SET current_capacity = GREATEST(current_capacity - 1, 0),
           status = CASE WHEN status = 'full' THEN 'open' ELSE status END
     WHERE batch_id = v_batch_id;

    -- Notify student
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
        v_student_id,
        'Enrollment Dropped',
        'Your enrollment for ' || v_course_name || ' was dropped. Reason: ' || COALESCE(p_reason, 'User request'),
        'enrollment'
    );
END;
$$ LANGUAGE plpgsql;