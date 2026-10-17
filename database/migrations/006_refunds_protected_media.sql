-- Migration 006: refunds + protected (signed) media (step 5 of IMPROVEMENTS.md, P0-6 and P0-3)
-- Run ONCE on an existing database (safe to run twice):
--   psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f migrations/006_refunds_protected_media.sql
-- Fresh installs already get all of this from schema.sql / functions.sql / elearning_full_setup.sql.
-- After it, run `node scripts/migrate-media-to-authenticated.mjs` in the server folder to protect files
-- that were uploaded before this step (new uploads are protected automatically).

BEGIN;

-- Refunds (P0-6) and protected media (P0-3)
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS refunded_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refund_id     VARCHAR(255),
    ADD COLUMN IF NOT EXISTS refund_reason TEXT,
    ADD COLUMN IF NOT EXISTS needs_refund  BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- 'upload' = public Cloudinary URL (older files), 'authenticated' = only reachable with a signed URL
ALTER TABLE content
    ADD COLUMN IF NOT EXISTS delivery VARCHAR(13) NOT NULL DEFAULT 'upload' CHECK (delivery IN ('upload', 'authenticated'));
ALTER TABLE content_parts
    ADD COLUMN IF NOT EXISTS delivery VARCHAR(13) NOT NULL DEFAULT 'upload' CHECK (delivery IN ('upload', 'authenticated'));

-- Refunds (IMPROVEMENTS.md P0-6) -----------------------------------------------------------------------

-- Admin payment list. p_needs_refund = TRUE shows only payments that were captured by the gateway but whose
-- enrollment was already dropped / expired (the old "MANUAL REFUND NEEDED" log line). Filters may be NULL.
CREATE OR REPLACE FUNCTION fn_list_payments(
    p_search       TEXT,
    p_status       payment_status_enum,
    p_needs_refund BOOLEAN,
    p_limit        INTEGER,
    p_offset       INTEGER
)
RETURNS TABLE (payment_id INTEGER, enrollment_id INTEGER, amount DECIMAL, currency CHAR(3),
               status payment_status_enum, payment_method payment_method_enum, transaction_id VARCHAR,
               needs_refund BOOLEAN, created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, refunded_at TIMESTAMPTZ,
               refund_reason TEXT, student_id INTEGER, student_name VARCHAR, student_email VARCHAR,
               course_id INTEGER, course_title VARCHAR, enrollment_status enrollment_status_enum,
               total_count BIGINT) AS $$
    SELECT p.payment_id, p.enrollment_id, p.amount, p.currency, p.status, p.payment_method, p.transaction_id,
           p.needs_refund, p.created_at, p.paid_at, p.refunded_at, p.refund_reason,
           u.user_id, u.user_name, u.email, c.course_id, c.title, e.status, count(*) OVER ()
      FROM payments p
      JOIN enrollments e ON e.enrollment_id = p.enrollment_id
      JOIN users u       ON u.user_id = e.student_id
      JOIN courses c     ON c.course_id = e.course_id
     WHERE (COALESCE(p_search, '') = ''
            OR u.user_name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR u.email     ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR c.title     ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR p.transaction_id = btrim(p_search))
       AND (p_status IS NULL OR p.status = p_status)
       AND (p_needs_refund IS NULL OR p.needs_refund = p_needs_refund)
     ORDER BY p.created_at DESC, p.payment_id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$ LANGUAGE sql STABLE;

-- Called by the Razorpay webhook when money was captured but the enrollment can no longer be activated
-- (dropped / expired). Remembers the gateway payment id and marks the row so an admin sees it.
CREATE OR REPLACE FUNCTION fn_flag_payment_for_refund(p_payment_id INTEGER, p_gateway_payment_id VARCHAR)
RETURNS VOID AS $$
    UPDATE payments
       SET needs_refund   = TRUE,
           transaction_id = COALESCE(transaction_id, p_gateway_payment_id)
     WHERE payment_id = p_payment_id AND status IN ('pending', 'failed');
$$ LANGUAGE sql;

-- Checks that a payment may be refunded and returns what the gateway call needs. Rules:
--   * caller is an admin (42501); payment exists (P0002)
--   * not already refunded, not a free enrollment, a gateway payment id is known (P0001)
--   * the payment must be successful, or flagged needs_refund (captured but enrollment dead) (P0001)
--   * an enrollment that is already COMPLETED (certificate issued) is not refundable (P0001)
CREATE OR REPLACE FUNCTION fn_get_refund_target(p_admin_id INTEGER, p_payment_id INTEGER)
RETURNS TABLE (payment_id INTEGER, amount DECIMAL, transaction_id VARCHAR, enrollment_id INTEGER,
               student_id INTEGER, enrollment_status enrollment_status_enum) AS $$
#variable_conflict use_column
DECLARE
    v_p payments%ROWTYPE;
    v_e enrollments%ROWTYPE;
BEGIN
    IF fn_user_role(p_admin_id) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Only an admin can refund a payment' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_p FROM payments WHERE payments.payment_id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_p.status = 'refunded' THEN
        RAISE EXCEPTION 'This payment is already refunded' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.amount <= 0 OR v_p.payment_method = 'free' THEN
        RAISE EXCEPTION 'A free enrollment has nothing to refund' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.status <> 'success' AND NOT v_p.needs_refund THEN
        RAISE EXCEPTION 'Only successful payments can be refunded' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.transaction_id IS NULL THEN
        RAISE EXCEPTION 'This payment has no gateway payment id, so it cannot be refunded automatically' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_e FROM enrollments WHERE enrollments.enrollment_id = v_p.enrollment_id;
    IF v_e.status = 'completed' THEN
        RAISE EXCEPTION 'The student has completed this course (certificate issued), so it cannot be refunded' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT v_p.payment_id, v_p.amount, v_p.transaction_id, v_e.enrollment_id, v_e.student_id, v_e.status;
END;
$$ LANGUAGE plpgsql;

-- Records a refund that the gateway has accepted: payment -> 'refunded', a pending / active enrollment is
-- dropped (frees the seat, the student loses access) and the student gets a notification.
CREATE OR REPLACE FUNCTION fn_mark_payment_refunded(
    p_admin_id  INTEGER,
    p_payment_id INTEGER,
    p_refund_id VARCHAR,
    p_reason    TEXT
)
RETURNS TABLE (payment_id INTEGER, status payment_status_enum, enrollment_id INTEGER, student_id INTEGER, amount DECIMAL) AS $$
#variable_conflict use_column
DECLARE
    t RECORD;
    v_title VARCHAR;
BEGIN
    SELECT * INTO t FROM fn_get_refund_target(p_admin_id, p_payment_id);

    UPDATE payments
       SET status = 'refunded', refunded_at = now(), refund_id = p_refund_id,
           refund_reason = left(p_reason, 300), needs_refund = FALSE
     WHERE payments.payment_id = p_payment_id;

    IF t.enrollment_status IN ('pending', 'active') THEN
        PERFORM fn_drop_enrollment(t.enrollment_id, t.student_id, 'Refunded');
    END IF;

    SELECT c.title INTO v_title FROM enrollments e JOIN courses c ON c.course_id = e.course_id
     WHERE e.enrollment_id = t.enrollment_id;
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (t.student_id, 'Payment refunded',
            'Your payment of INR ' || t.amount || ' for "' || v_title || '" was refunded. It can take 5-7 working days to reach your account.',
            'payment');

    RETURN QUERY SELECT p_payment_id, 'refunded'::payment_status_enum, t.enrollment_id, t.student_id, t.amount;
END;
$$ LANGUAGE plpgsql;

COMMIT;
