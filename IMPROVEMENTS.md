# EduStream – Improvement Analysis

Scope: `elearning-client` (React 19 / Vite / Tailwind), `elearning-server` (Express 5 / pg), `elearning-database` (PostgreSQL schema, functions, triggers, views).
Reviewed on 2026-10-15 by reading the code in the three zips. Nothing was run, so every item below comes from reading the source, not from executing it. Where something is a guess, it says so.

Legend: **P0** = real bug or security/data risk, fix first · **P1** = important gap · **P2** = polish / nice to have.

---

## 1. Your question: do teacher / student / admin need separation?

**Short answer: keep ONE `users` table and ONE API, but separate the roles properly in the UI and fill the missing admin role. Do not split into separate apps, tables or services.**

### What is already separated (good, keep it)

| Layer | Status |
|---|---|
| DB | `roles` + `user_roles` tables, role resolved via `fn_user_role` / `fn_get_user_by_id`. Admin cannot be self-registered (`fn_register_user` only allows student/instructor). |
| API | `authorizeRoles(...)` on instructor/admin routes, `requireCourseOwner()` for ownership, student-only enroll route, per-owner analytics scoping, IDOR protection on progress/payment (404 instead of 403). |
| Client | `ProtectedRoute allowedRoles`, role-based Navbar links, pages folder split into `pages/student/` and `pages/instructor/`. |

### What is NOT properly separated (the real gaps)

1. **Admin exists but has nothing to do.** The seed creates `admin@elearning.com`, the server lets admins pass instructor checks, but there is no admin page, no admin endpoint, no user management, no course moderation. After login an admin lands on the *instructor* dashboard (`Login.jsx`), and sees an "Instructor Analytics" page. See §3.
2. **Instructor and admin are locked out of learning.** `POST /enrollments` is `authorizeRoles('student')` only, and `canViewCourseContent` only allows owner / admin / enrolled. So an instructor can never buy or take another instructor's course. If you want "instructor can also be a student" (very common), you need a multi-role model (see §3.3). If you do not want it, make that an explicit decision and show a clear message instead of a failing Enroll button.
3. **Role is baked into the JWT for 7 days** and `authenticateJWT` never re-checks the user. A banned/deactivated user or a role change keeps working until the token expires (only `/auth/me` checks `status`). See P0-5.
4. **Anyone can self-register as Instructor** (dropdown on `Register.jsx`) and immediately create and publish courses and receive payments. No approval step. See P1-3.
5. **One shared page tree for two audiences.** `CourseDetails.jsx` and `Login.jsx` live in `pages/` root, `/courses/:id` shows the same "Enroll & Pay" box to guests, enrolled students, the owning instructor, and admins. The page is not role-aware. See P1-1.
6. **No layouts per role.** One `Navbar` with `if role === ...` branches. Fine today, but it will get messy once admin pages exist.

### Recommended target structure

```
client/src/
  layouts/        PublicLayout, StudentLayout, InstructorLayout, AdminLayout
  routes/         publicRoutes.jsx, studentRoutes.jsx, instructorRoutes.jsx, adminRoutes.jsx
  pages/
    public/       Catalog, CourseDetails, Login, Register, NotFound
    student/      MyLearning, CoursePlayer, Certificates, CertificateView
    instructor/   CourseList, CreateCourse, CourseEditor(modules/batches/announcements), Analytics, Students
    admin/        Dashboard, Users, Courses(moderation), Payments/Refunds, AuditLog
server/src/routes/
  ...existing...
  admin.routes.js         (authorizeRoles('admin') on the whole router)
```

Rule of thumb: **role decides which area you can enter; ownership decides which record you can touch.** The server already does both, the client should mirror it.

---

## 2. P0 – Bugs and risks (fix first)

### P0-1. Certificates can never be issued for courses that contain PDFs
> ✅ **Done in step 1** (PDF/text viewer + "Mark as complete" in the player).

- DB trigger `trg_progress_check_completion` (triggers.sql) requires **every `ready` content row** of the course to be `completed`.
- Instructors can upload `pdf` content (`CourseModules.jsx` offers "Document (PDF)", server accepts it).
- The player (`CoursePlayer.jsx`) always renders `VideoPlayer`/`LessonPlayer`, a PDF is put into a `<video>` tag, nothing is ever sent to `POST /progress`, so that content never completes → the student never gets the certificate, and `completion_percentage` can never reach 100.
- **Fix:** add a PDF/text viewer in the player + a "Mark as complete" action for non-video content (server: allow `trackProgress` to complete `pdf`/`text` content explicitly), or exclude non-video content from the completion rule.

### P0-2. `text` content type is half-built
> ✅ **Done in step 1** (finished: `content.text_body` column, upload form, validation, viewer).

- Enum and server accept `type=text`, but the upload route still **requires a file** (`Media file is required`), the UI has no text option, and the player cannot show it. Either finish it (text body column + editor + viewer) or remove `text` from the enum/validation.

### P0-3. Paid course media is reachable without being enrolled
- Videos and PDFs are stored as plain public Cloudinary URLs. The API hides `video_url` from non-entitled users, but once any entitled person (or anyone who saw the URL) has it, the file can be shared freely and never expires.
- **Fix options:** Cloudinary signed/authenticated delivery with short-lived URLs generated per request, or at least `type: 'authenticated'` uploads. PDFs are uploaded as `raw` and have the same issue.

### P0-4. Player is not guarded for non-entitled states
> ✅ **Done in step 1** (player redirects to the course page with a message).

- `/learn/:courseId` is only behind "logged in". A student with a `pending` or `dropped` latest enrollment, or a user with no enrollment, still gets the player shell, with `video_url` missing (server hides it) → broken `<video>` and silent failures.
- **Fix:** after loading, if enrollment is not `active/completed` (and the user is not owner/admin) redirect to `/courses/:id` with a message.

### P0-5. Banned / inactive users and role changes are not enforced per request
> ✅ **Done in step 2** (status + role read from the DB on every request, admin API to list users and activate / deactivate / ban; the admin *screens* come with §3.1 in step 4).

- `authenticateJWT` only verifies the signature. `users.status` has `inactive`/`banned`, but nothing in the API sets it, and nothing reads it after login.
- **Fix:** either short-lived access token (15 min) + refresh token, or one cheap DB lookup (`fn_get_user_by_id`) in `authenticateJWT`, cached for ~60 s. Also add a way to set status (admin endpoint).

### P0-6. No refund path when a student drops after paying
- `fn_drop_enrollment` frees the seat but the payment stays `success`; the webhook comments say "MANUAL REFUND NEEDED". `payment_status_enum` has `refunded` but nothing sets it.
- **Fix:** define a refund policy (e.g. within N days / before batch start), add an admin/instructor refund action that calls Razorpay refunds API and sets `payments.status = 'refunded'`, notify the student. At the very least show a warning in the Drop confirm dialog ("no refund") so the student is not surprised.

### P0-7. Course lifecycle is incomplete (publish only, no way back)
> ✅ **Done in step 3** (course edit / status / publish checks; module edit, reorder, delete; batch edit / close / reopen; course delete, refused once anyone has enrolled).
- Only `PATCH /courses/:id/publish` exists. No edit course (title/price/description), no unpublish, no archive (enum has `archived`), no delete, no edit/reorder/delete module, no edit batch.
- A wrong price or typo needs a manual SQL fix. **Fix:** `PATCH /courses/:id`, `PATCH /courses/:id/status`, `PUT/DELETE /modules/:id`, `PATCH /batches/:id`. Block price change/delete rules once students are enrolled (decide the policy).
- Publishing is also not validated: an empty course (no ready content, no open batch) can be published and appears in the catalog with "No active batches available". Require ≥1 ready content and ≥1 open batch.

---

## 3. P1 – Role model and feature gaps

### 3.1 Admin area (missing entirely)
> ✅ **Partly done in step 4 (first half):** admin layout + Dashboard (platform numbers), Users (search / role / status filter, activate / deactivate / ban), Courses (all statuses, archive / unpublish / restore), Audit log viewer. Login now sends admins to `/admin`. **Still open:** change role, approve instructor, reassign course instructor, payments list + refunds (step 5), audit coverage beyond courses / enrollments / user status. §3.2 and the §3.3 multi-role decision are not started.
Minimum useful admin:
- Users list (search, role, status), ban/unban, change role, approve instructor.
- Course moderation (list all incl. drafts, unpublish/archive, reassign instructor).
- Payments list + refund action; failed/stuck payments (the "MANUAL REFUND NEEDED" log lines should become rows an admin can see).
- Audit log viewer (the table and middleware exist; audit only covers `courses` and `enrollments` today).
- Platform analytics (analytics endpoint already supports `instructorId = null` for admin, it just has no admin UI).

### 3.2 Instructor approval
- Add `users.instructor_status` (`pending/approved/rejected`) or a separate `instructor_applications` table. Registering as instructor creates a *student* + a pending application; only approved instructors can create/publish courses.

### 3.3 Multi-role (instructor can also learn)
- `user_roles` already allows several roles per user, but `fn_user_role` returns **one** and the JWT carries a single `role`.
- Decide: (a) keep single role and add a clear "use a separate account to learn" message, or (b) put `roles: []` in the token/`/auth/me`, make Navbar show a role switcher (Learn / Teach), and change `authorizeRoles('student')` on enroll to "any authenticated user who is not the course owner". Option (b) is the common product choice.

### 3.4 Instructor-side features that students/instructors will expect
- **Students list per course/batch** with progress (data is in `vw_student_progress`, only shown as a table inside Analytics).
- Reply to / moderate comments: instructors cannot delete or pin comments, comments have no edit/delete for authors either; no way to mark an instructor reply.
- Announcements: create only. No list/edit/delete, and students have no page to read past announcements (only the bell notification).
- Thumbnail is a pasted URL. Add an image upload through the existing Cloudinary integration.

### 3.5 Student-side features
- **My Learning** shows no progress bar (progress data exists), no "continue where you left off" (player always opens module 1, content 1; `positions` are fetched but the starting lesson is not chosen from them).
- Catalog has no search, filter, sort, pagination. `GET /courses` returns every published course in one response.
- Certificate: `certificates.certificate_url` is a made-up `https://elearning.org/certificates/CERT-…` string that goes nowhere, the in-app view fetches **all** certificates and filters in the browser, there is no public verification page/QR, no real PDF, and `email_sent` is never used. Add `GET /certificates/:id`, a public `GET /verify/:code` and a generated PDF.
- Ratings/reviews, wishlist, course preview video: not present (feature ideas, P2).

### 3.6 Auth and account basics
- Missing: logout (server side), refresh token, change password, forgot/reset password, email verification, profile page (the `users.phone` column is never used).
- Token is stored in `localStorage` (XSS-readable). Acceptable for a student project; for production prefer httpOnly cookie + CSRF protection.
- Password rule is only length 8-72; no strength feedback on the client; `Register.jsx` has no confirm-password or client-side checks (server validates).
- Login rate limit exists (good). Other write endpoints (comments, uploads, progress) have no rate limit.

### P1-1. Role-aware Course Details page
`CourseDetails.jsx` should render different call-to-actions:
- Guest → "Login to enroll" (currently the Enroll button fires, gets 401 "Token missing", and shows a raw error; the axios interceptor only redirects when a token already exists). Redirect to login and come back (`?next=`).
- Enrolled (active/completed) → "Go to course".
- Pending → "Finish payment".
- Owner / admin → "Manage course" / "Preview as student".
- Logged-in but not allowed to enroll → explain why.
It also uses `alert()` for success; replace with a toast/inline message.

### P1-2. Seat/batch rules are rigid
- `max_capacity` is hard-limited to 1–30 by a CHECK constraint, in the controller, and in the form. If that is a business rule, keep it and say so in the UI; if not, make it configurable.
- Students are forced to pick a batch even for self-paced/free courses. Consider "self-paced" courses without batches.
- No batch edit/close/cancel, no waitlist when full, no notification when a seat frees up.

### P1-3. Video pipeline robustness
- Processing jobs live **in memory** (`enqueueVideo`). A restart marks every in-flight video as failed and the instructor must re-upload (the temp file is also gone). For anything beyond a demo use a persistent queue (BullMQ/pg-boss) or at least resumable uploads.
- Upload size limit is 4 GB through your own server; the server request timeout is set to 1 hour. Consider direct-to-Cloudinary signed uploads so big files do not pass through Express.
- Error message for oversize says "max 100 MB" while the real limit is `MAX_VIDEO_UPLOAD_MB` (4096) – `utils/errors.js` text is stale.
- `ffmpeg-static` is a heavy dependency on small hosts; document the memory/CPU needs.

### P1-4. Analytics page
- Labelled "Instructor Analytics" even for admin; headings still show raw view names (`💰 Course Revenue (vw_course_revenue)`), which looks like a leftover from development.
- `recharts` is a dependency but the page is tables only. Add revenue-over-time, enrollments-over-time, completion funnel.
- Revenue is `SUM(amount)` of successful payments; refunded payments are not subtracted once refunds exist.

---

## 4. P1 – Database

1. **Dead / unused structures:** `reports`, `audit_log_details`, `certificates.email_sent`, `users.phone`, `batches` status `closed` only via the timer. Either wire them up or drop them to keep the schema honest.
2. **No `ON DELETE` strategy for user deletion:** `courses.instructor_id`, `enrollments.student_id`, `payments`, `certificates` are `RESTRICT`, so a user can never be deleted (and GDPR-style delete is impossible). Add a soft-delete/anonymise function.
3. **Two sources of truth for setup:** `elearning_full_setup.sql` (≈2,100 lines, includes the Python course seed) duplicates `schema.sql`, `functions.sql`, `triggers.sql`, `views.sql`, `seed/`. They will drift. Generate the full file from the pieces with a script, or drop one.
4. **No migrations tool.** Everything is "drop and recreate". Introduce a migration runner (node-pg-migrate, dbmate, Flyway) before real data exists.
5. **README is partly stale:** the "Heads-up for the server step (next)" section describes breaking changes that the server has already adapted to. Replace with a current "how to run" + schema diagram.
6. **Certificate trigger edge cases:** a course with 0 ready content never completes (fine), but when an instructor *adds* content after a student already completed, nothing re-opens the enrollment (decide the policy). Deleting content that others completed can also flip results.
7. **Indexes to consider:** `comments(module_id, created_at)`, `notifications(user_id, created_at DESC)`, `payments(status)`, `courses(instructor_id, status)`. Check with `EXPLAIN` after seeding more data.
8. **Seed passwords:** all seed users share `Password123!` – fine for dev, make sure the seed is never run in production (guard with an env check or a separate file).

---

## 5. P1 – Backend

1. **Dead code:** `middleware/errorHandler.js` is unused (`error.middleware.js` is the one wired in `app.js`). Duplicate seed scripts: `server/seed-content.mjs` and `server/scripts/seed-content.mjs` **differ**. Delete or reconcile.
2. **Inconsistent response shapes:** some endpoints return `{ success, message }`, auth middleware returns `{ message }` only. Pick one envelope.
3. **Mixed naming at the edges:** DB `snake_case`, client sometimes reads `course_id`, sometimes `id` (the dead root `pages/CourseCatalog.jsx` uses `course.id`). Normalise in one mapper layer.
4. **Validation scattered by hand** in every controller. Introduce a schema validator (zod/joi) per route so rules live in one place and tests can reuse them.
5. **`userName` vs `name`** both accepted by register; client sends both "to prevent mismatch". Remove the compatibility shim.
6. **Audit logging** covers only `courses` and `enrollments`, logs only selected fields, and `oldValues` is always `null`. Add payments, user status/role changes, refunds, deletes.
7. **Pagination** missing on: courses, comments, notifications, enrollments, analytics rows.
8. **Notifications:** polled every 60 s from every open tab. Fine for now; later SSE/WebSocket or longer interval + "mark all read".
9. **Health/ops:** `/health` does not check the DB; `process.exit(-1)` on any idle-client error is harsh; no graceful pool shutdown on SIGTERM; logs are `console.*` (use pino/winston with request ids).
10. **Security extras:** `helmet()` defaults only (no CSP tuned for Razorpay/Cloudinary), no `rateLimit` outside auth, CORS allows credentials-less origins list only (ok). `ssl: { rejectUnauthorized: false }` in production weakens DB TLS verification.
11. **`server/manifest.json`** (≈219 KB, Cloudinary upload manifest incl. your cloud name) is in the zip. It is gitignored, so just make sure it never gets committed or shared.
12. **No automated tests.** Only `scripts/smoke-test.sh`. See §7.

---

## 6. P1/P2 – Frontend

1. **Dead / duplicate files:** `pages/CourseCatalog.jsx` (unused, reads wrong field names), `services/auth.service.js` (calls `/v1/auth/...` on a base URL that already ends in `/v1`, so it would 404), `components/video/VideoPlayer` vs `LessonPlayer` share logic. Pages also bypass `services/*` and call `api` directly – pick one pattern.
2. **Routing:** no `*` NotFound route, no route-level code splitting (`React.lazy`), no `next=` redirect after login, admin lands on the instructor area.
3. **State/data fetching:** each page hand-rolls `useEffect + loading + error`. Adopt TanStack Query (cache, retry, invalidation) – it would also remove several "refetch after action" bugs.
4. **UX gaps:** many pages swallow errors with `console.error` and show nothing (CourseDetails, Certificates, Analytics); no toasts, no skeletons, no empty/error components, `alert()` and `window.confirm()` used for flows.
5. **Accessibility:** form inputs use labels without `htmlFor`/ids, status conveyed by colour only, no focus management on modals/dropdowns, video has no captions/transcript.
6. **Responsive:** Navbar has no mobile menu (a single flex row with 6+ items will overflow on phones); player layout uses `h-16` header plus `overflow-hidden` flex that can clip on small screens.
7. **Upload UX:** progress bar exists; add cancel, retry, and show server-side "processing" state with polling (the content row flips `processing → ready`).
8. **Config:** `.env.example` is good. README is still the Vite template – replace with run/build/env instructions.
9. **Tooling:** oxlint only; add Prettier, and TypeScript or at least JSDoc types for API shapes. Consider `vite-plugin-pwa` only if offline is a goal.
10. **Lesson list UX:** a module with one lesson of the same name is collapsed into one row (nice), but there is no overall course progress bar or "next lesson" button.

---

## 7. Quality, DevOps and docs

- **Tests:** add API integration tests (supertest + a throwaway Postgres, or Testcontainers) for the rules already encoded in `smoke-test.sh`: role guards, IDOR, capacity, payment signature, webhook idempotency, certificate trigger. Add a few React Testing Library tests for `ProtectedRoute`, `CourseDetails` CTA states and the player.
- **CI:** GitHub Actions: lint → test → build for client and server.
- **Containers:** `docker-compose.yml` with Postgres + server + client, so "clone and run" works in one command.
- **Docs:** one root README: architecture diagram, role/permission matrix, ER diagram, env vars, how to run, seed logins, API list (OpenAPI/Swagger).
- **Observability:** structured logs, error tracking (Sentry), uptime check on `/health` (make it check the DB).
- **Secrets:** rotate any real keys that were ever pasted into chat/zips; keep `.env` out of every zip.

---

## 8. Suggested order of work

| Step | Work | Why first |
|---|---|---|
| 1 | P0-1, P0-2, P0-4 (player + PDF/text + guards) | Students currently cannot finish some courses or hit broken screens |
| 2 | P0-5 (token/status check) + admin user status endpoint | Closes the ban/role-change hole |
| 3 | P0-7 (edit/unpublish/archive course, module & batch edit) + publish validation | Instructors need to fix mistakes without SQL |
| 4 | §3.1 + §3.2 (admin area, instructor approval) + §3.3 decision on multi-role | This is the actual "role separation" work |
| 5 | P0-6 refunds + P0-3 signed media URLs | Money and content protection before real users |
| 6 | §3.5 certificates (real PDF + verify page), My Learning progress/resume | Visible product quality |
| 7 | Backend/DB cleanup (§4, §5), tests + CI (§7) | Keeps the above from regressing |
| 8 | Frontend polish (§6), analytics charts | Last, lowest risk |

> ✅ **Step 8, first half done:** §6 items 1, 2, 4 (partly), 5 (partly), 6. Toasts and a confirm dialog replace every `alert()` / `window.confirm()`; shared Loading / Error / Empty components; 404 page; route code splitting (`React.lazy`); `?next=` redirect from protected routes; mobile navbar menu with skip link; dead files removed (`pages/CourseCatalog.jsx`, `services/auth.service.js`); form labels linked to inputs and confirm-password on Register; Analytics headings no longer show view names.
>
> ✅ **Step 8, part 2 done:** Analytics now has headline cards (revenue, enrollments, average completion, courses completed) and three recharts charts (revenue per course, taken vs free seats per batch, completion bands), each with a text label for screen readers and the old tables kept for exact numbers. The course player works on phones (header wraps, page scrolls normally, sidebar sits under the lesson). Chart data comes from the existing endpoint, so there is **no revenue-over-time chart yet** (needs a new server query). The client README was already current, so only the test list was extended.
>
> **Step 8, part 3 (still open):** TanStack Query (§6.3), remaining accessibility (modals in other components, captions / transcripts, colour-only status), upload cancel / retry with processing polling (§6.7), Prettier + JSDoc types (§6.9), lesson-list items (§6.10), revenue-over-time chart + server endpoint, subtracting refunds in revenue (§P1-4).

---

## 9. Role / permission matrix (proposed target)

| Capability | Guest | Student | Instructor (approved) | Admin |
|---|:--:|:--:|:--:|:--:|
| Browse catalog, view syllabus (no media) | ✅ | ✅ | ✅ | ✅ |
| Enroll, pay, learn, comment, certificate | ❌ | ✅ | ✅ (other instructors' courses, if multi-role) | ✅ (optional) |
| Create / edit / publish own courses | ❌ | ❌ | ✅ | ✅ (any) |
| Manage own batches, announcements, comments | ❌ | ❌ | ✅ | ✅ (any) |
| See own analytics / students | ❌ | ❌ | ✅ (own) | ✅ (all) |
| Approve instructors, ban users, change roles | ❌ | ❌ | ❌ | ✅ |
| Refunds, payment overview, audit log | ❌ | ❌ | ❌ | ✅ |

Today's code implements the first, third and fourth rows reasonably; the "multi-role" cells and the whole admin row are what is missing.
