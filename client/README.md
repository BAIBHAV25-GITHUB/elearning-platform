# EduStream client

React 19 + Vite + Tailwind single-page app for students, instructors and admins.
It talks to the Express API in `../server` (everything under `/api/v1`).

## Run it

```bash
cd client
npm install
cp .env.example .env      # only needed if the API is not on http://localhost:5000
npm run dev               # http://localhost:5173
```

The API has to be running and `CLIENT_URL` in `server/.env` has to contain the address the browser uses
(`http://localhost:5173` by default), otherwise CORS blocks the calls.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | oxlint (warnings are allowed, errors fail) |
| `npm test` | Vitest + React Testing Library (jsdom); no server or database needed, the API is mocked |
| `npm run test:watch` | Tests in watch mode |

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:5000/api/v1` | Base URL of the API. Baked in at **build** time. Use `/api/v1` when a reverse proxy (the Docker setup's nginx) serves the app and the API on one origin. |

The Razorpay key is not configured here: the server returns it when an order is created.

## Layout

```
src/
  api/axios.js          axios instance: adds the JWT, ends the session on 401 / disabled account
  context/AuthContext   login / register / logout, restores the session from localStorage
  components/           common (toasts, confirm dialog, loading / error states), charts, Navbar, ProtectedRoute (role gate), video + lesson players, discussion, instructor tools
  layouts/              AdminLayout
  pages/                public pages (catalog, course details, login, register, certificate verification)
    student/            catalog, My Learning, course player, certificates
    instructor/         course list / create / edit, modules + content, analytics
    admin/              dashboard, users, courses, payments + refunds, audit log
  services/             thin API helpers used by some pages
  __tests__/            component tests (ProtectedRoute, CourseDetails call-to-action, CoursePlayer access, toasts / confirm dialog, analytics)
```

Role decides which area you can enter (`ProtectedRoute allowedRoles`); the server re-checks the role and
ownership on every request, so hiding a link here is only a convenience.

## Tests

The tests mock `../api/axios` and `useAuth`, so they run offline. They cover:

* `ProtectedRoute`: guest goes to `/login`, wrong role goes to `/`, allowed role renders.
* `CourseDetails`: guest, student without / with pending / with active enrollment, owning instructor, admin,
  other instructor.
* `CoursePlayer`: no, pending and dropped enrollment are redirected with a notice; active / completed students
  open the player and resume at the right lesson; owner and admin may preview; another instructor is redirected.
