# elearning-database

PostgreSQL 14+ (tested on 16).

## Setup (fresh database)

```bash
psql -U postgres -f 00_create_db.sql                 # once, creates elearning_db
for f in schema functions triggers views seed/base_seed; do
  psql -U postgres -d elearning_db -v ON_ERROR_STOP=1 -f $f.sql
done
```

To rebuild from scratch during development: `DROP DATABASE elearning_db;` then repeat.
`schema.sql` no longer drops the database by itself.

Seed logins (all use password `Password123!`):

| Email | Role |
|---|---|
| admin@elearning.com | Admin |
| john.doe@elearning.com, sarah.smith@elearning.com | Instructor |
| alice@student.com, bob@student.com | Student |

Seed courses: 1 Full-Stack (paid), 2 DSA (paid), 3 Git (**free**), 4 System Design (**draft**, not in catalog).

## What changed (maps to FIXES.md)

| Fix | Change |
|---|---|
| D2 / decision | `courses.course_name` removed, `title` is the only name column. Functions/views/seed updated. |
| D6, D7 | `notifications.created_at` and `batches.created_at` added. |
| D9 | `progress.last_accessed_at` added and maintained by `fn_upsert_progress`. |
| D11, F6, F7 | `payments`: added `currency`, `created_at`, `paid_at`, `gateway_order_id`; `payment_method` nullable until paid; `transaction_id` now holds only the Razorpay **payment** id. Many attempts per enrollment, max one `success` (partial unique index). |
| D12, X7 | `fn_drop_enrollment(enrollment_id, student_id, reason)` checks ownership, only pending/active can be dropped, seat released once. |
| D13 | `audit_logs`: `record_id` nullable, added `old_values`, `new_values`, `ip_address`. |
| D14, F16 | Views renamed to the names the dashboard reads: `course_title`, `completion_percentage`, `is_full`. `instructor_id` exposed on all views for scoping (X9). |
| D15 | Seed uses a real bcrypt hash, looks roles/courses up by name/title, dates are in the future, ids are stable. |
| D16 | `00_create_db.sql` split out; `\c` lines removed. |
| F2 | Composite FK `enrollments(batch_id, course_id)` -> `batches(batch_id, course_id)`; `fn_enroll_student` also checks course is published, user active, not the course's own instructor. |
| F3 | Unique index is now `WHERE status <> 'dropped'`, so dropped students can re-enroll. |
| F4 | `fn_enroll_student` returns the existing pending enrollment (retry after closed popup); `fn_expire_pending_enrollments(minutes)` frees unpaid seats. |
| X1 | `fn_register_user` only allows `student` / `instructor`. |
| X6 | `fn_upsert_progress` checks enrollment is active/completed, content belongs to the course, clamps watch time, and enforces the 80 % rule in the DB. |
| X11 (partial) | Trigger T-06: replies must be in the same module and 1 level deep. |
| K8 | `TIMESTAMPTZ` everywhere. |
| T-04 | Certificate trigger counts only `ready` content on both sides, is race-safe (`ON CONFLICT`), only fires for `active` enrollments. |
| T-03 | Hard-delete trigger no longer double-releases a seat for already-dropped rows. |

## New helper functions the server should call

| Function | Replaces / used for |
|---|---|
| `fn_register_user(name, email, bcrypt_hash, role)` | register (returns `user_id, user_name, email, role`) |
| `fn_get_user_for_login(email)` | login (returns hash + `role` lower-case + `status`) |
| `fn_get_user_by_id(id)` | new `GET /auth/me` |
| `fn_user_role(id)` | role for the JWT |
| `fn_can_manage_course(course_id, user_id)` | ownership check for modules / batches / content / publish |
| `fn_enrollment_belongs_to(enrollment_id, user_id)` | ownership check for progress |
| `fn_begin_payment(enrollment_id, student_id)` | create-order: returns the amount to charge (never trust the client) |
| `fn_attach_gateway_order(enrollment_id, order_id, amount, currency)` | store the Razorpay order |
| `fn_confirm_payment(payment_id, razorpay_payment_id, gateway, method)` | verify + webhook (look the payment up by `gateway_order_id`) |
| `fn_create_announcement(course_id, author_id, title, content)` | announcements + notifications, ownership enforced |
| `fn_expire_pending_enrollments(minutes)` | call every few minutes from the server or pg_cron |

Errors raised with `P0001` (rule violated), `P0002` (not found), `23505` (duplicate), `42501` (not allowed) so the API can map them to 400/409, 404, 409, 403.

## Heads-up for the server step (next)

Signatures that changed and **will break the current server code until it is updated**:
`fn_drop_enrollment` (now 3 args), `fn_confirm_payment` (new optional args, expects payment id), `payments` lookups by order id must use `gateway_order_id` (not `transaction_id`), view column names (`course_title`, `completion_percentage`), `courses` has no `course_name`.
