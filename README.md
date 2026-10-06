# TaskFlow — Task Manager

A full-stack task manager with accounts, roles, and an admin panel —
dashboard, list/kanban/calendar views, team workload, and analytics.

**Stack:** vanilla HTML/CSS/JS frontend (single file, no build step) +
Node.js/Express backend + MongoDB, connected by a JWT-based API.

---

## Features

- Dashboard, list, kanban, and calendar views of your tasks
- Team directory with per-person task stats
- Analytics: completion rate, month-over-month trends, priority/category
  breakdowns, overdue/due-soon counts
- Role-based accounts: **Member** and **Admin**, enforced server-side, not
  just hidden in the UI
- A separate **Admin Panel** for everything administrative: approving new
  accounts, managing members, workspace settings, and data maintenance
- Profile photos, dark/light-aware styling, mobile-friendly layout

## How accounts and roles work

- **The first account created becomes the workspace admin**, automatically,
  on sign-up — this is the one-time bootstrap for a brand-new database.
- **After that, anyone can still fill out "Create account," but it only
  creates a *pending* request.** It can't log in until an admin approves it.
  Both the "awaiting approval" message and the login rejection are enforced
  on the server (`approvalStatus` check in `POST /api/auth/login`), not just
  hidden in the UI.
- **Admins approve or decline requests** from the Admin Panel's "Pending
  Approvals" section (with a count badge so it's hard to miss). Approving
  activates the account; declining deletes the pending request so the email
  can be reused.
- **Admins can also add a member directly**, skipping the queue — the admin
  creating it *is* the approval, and they set the person's user type
  (Member/Admin) right there.
- Admins can promote/demote roles, disable accounts, reset passwords, and
  reassign or delete a departing member's tasks. An admin can't demote,
  disable, or delete *their own* account through these routes, so a
  workspace can't accidentally end up with no admin.
- Pending/declined accounts never appear in the Team directory or task
  assignment — they're not real members until approved.
- Regular members only ever see and edit their own tasks; admins can view
  the whole workspace (`?scope=all`) and assign tasks to anyone. Every check
  is server-side: a non-admin token gets a 403 from an admin-only route even
  if someone calls the API directly, bypassing the UI entirely.
- Every request (except `/api/auth/*` and `/api/health`) requires a valid
  `Authorization: Bearer <token>` header — a JWT issued at login, valid 30 days.

## Project structure

```
taskflow/
├── render.yaml                 # Render Blueprint (see Deployment below)
├── frontend/
│   ├── config.js                # the ONE place the frontend's backend URL lives
│   └── index.html                # the entire UI — single self-contained file
└── backend/
    ├── .env                      # local secrets (not committed)
    ├── .env.example              # documents every env var
    ├── .gitignore
    ├── server.js                 # app setup, security middleware, DB connection
    ├── package.json
    ├── package-lock.json
    ├── middleware/
    │   └── auth.js                # JWT verification + requireAdmin gate
    ├── models/
    │   ├── User.js                 # accounts, roles, approvalStatus
    │   ├── Task.js
    │   └── Settings.js             # workspace name
    └── routes/
        ├── auth.js                 # config, register, login, profile, password
        ├── admin.js                 # user management, approvals, settings, maintenance
        ├── tasks.js                 # task CRUD, ownership + admin-assign logic
        ├── team.js                  # member directory with task stats
        └── dashboard.js             # analytics
```

## Getting started (local)

1. `cd backend && npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `MONGO_URI` — your MongoDB Atlas connection string
   - `JWT_SECRET` — a random string, **at least 32 characters** (the server
     refuses to start otherwise)
3. `node server.js`
4. Open `http://localhost:5000` — the backend serves the frontend itself, so
   there's nothing else to run.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URI` | Yes | MongoDB Atlas connection string |
| `JWT_SECRET` | Yes | ≥32 random characters; server won't start without it |
| `PORT` | No | Defaults to 5000 |
| `NODE_ENV` | No | Set to `production` on your host — hides internal error details from API responses |
| `CORS_ORIGIN` | No | Only needed if the frontend is hosted on a different origin than the backend (see below). Comma-separate multiple exact origins. Never use `*` in production. |

## Deployment

### Option A — one service does everything (recommended default)

This repo includes `render.yaml`. In Render: **New +** → **Blueprint** →
point it at your repo. It creates one Web Service that runs the backend
*and* serves `frontend/` itself — same origin, no CORS to configure.
Render will prompt for `MONGO_URI`; `JWT_SECRET` is generated for you.

In MongoDB Atlas → Network Access, allow `0.0.0.0/0` (Render's outbound IP
isn't fixed on the free plan).

No Blueprint? Create the Web Service by hand: root directory `backend`,
build command `npm install`, start command `npm start`, same env vars.

### Option B — backend and frontend hosted separately

The backend works fine as a standalone API — if there's no `frontend/`
folder next to `server.js`, it just logs that it's running API-only and
keeps going; it never fails because of a missing frontend.

1. Deploy `backend/` on Render as its own Web Service.
2. Host `frontend/` anywhere that serves static files (Netlify, Vercel, a
   Render Static Site, GitHub Pages...).
3. In `frontend/config.js`, point `API_BASE_URL` at the backend:
   ```js
   window.APP_CONFIG = { API_BASE_URL: 'https://your-backend.onrender.com' };
   ```
   (No trailing slash — the app strips one if present, but keep it clean.)
4. On the backend, set `CORS_ORIGIN` to the frontend's exact URL:
   ```
   CORS_ORIGIN=https://your-frontend.example.com
   ```
   Skipping this doesn't break the backend or the frontend individually —
   it silently blocks every request *between* them. The error shows up as
   "blocked by CORS policy" in the browser console, not in server logs.

### Deployment troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `Publish directory build does not exist!` | You created a **Static Site** instead of a **Web Service**. A Static Site only runs a build step and serves its output folder — it never runs `node server.js`. Delete it, create a Web Service instead (root dir `backend`, build `npm install`, start `npm start`). |
| `ENOENT ... frontend/index.html` at runtime | Old code. Current `server.js` never fails over a missing frontend — update it from this repo. If you're intentionally running API-only (Option B), this is expected and not an error. |
| Request reaches the API but gets `404`, with a **double slash** in the URL (`...onrender.com//api/...`) | `API_BASE_URL` in `config.js` has a trailing slash. The frontend strips it automatically now, but clean it up in `config.js` anyway. |
| Frontend loads, requests silently fail, console says "blocked by CORS policy" | `CORS_ORIGIN` on the backend doesn't match the frontend's exact URL (Option B). |
| `ECONNREFUSED 127.0.0.1:27017` | `.env` not loaded, or wrong `MONGO_URI` |
| `Could not connect to any servers... IP whitelist` | Atlas → Network Access → allow `0.0.0.0/0` |
| Server exits immediately citing `MONGO_URI` or `JWT_SECRET` | One of them is missing, or `JWT_SECRET` is under 32 characters |
| 401 on every request after it worked before | JWT expired (30 days) or the server restarted with a different `JWT_SECRET` — log in again |
| Page loads but nothing shows up | Open DevTools → Network tab to see which request is failing, and why |

## Connectivity check

`GET /api/health` needs no login and returns:
```json
{ "status": "ok", "mongo": "connected" }
```
If `mongo` says `"not connected"`, the Node process is up but lost its
database connection — check server logs for the reconnect warning.

If the frontend can't reach the backend at all, the login screen shows
**"Can't reach the server at …"** directly, instead of failing silently.

## Security

- Passwords hashed with bcrypt — never stored or returned in plain text.
- Sessions are JWTs; the server refuses to start without a `JWT_SECRET` of
  at least 32 characters.
- CORS defaults to same-origin only; widens only to origins you explicitly
  list in `CORS_ORIGIN`, never a wildcard in production.
- Security headers via `helmet` (clickjacking, MIME-sniffing, HSTS, etc.).
  Content-Security-Policy is intentionally off — this is a self-contained
  single-file frontend with inline `<script>`/`<style>`, which a default
  CSP would block outright.
- Rate limiting: 600 req/15min generally per IP, tightened to 20 req/15min
  specifically on `/api/auth/login` and `/api/auth/register` to blunt
  password-guessing and mass fake sign-ups.
- Production error responses never leak internal details — a raw exception
  becomes a generic message to the client; the real error still goes to
  the server log.
- All role and ownership checks are server-side (see "How accounts and
  roles work" above) — the UI hiding a button is a convenience, not the
  actual security boundary.
- `app.set('trust proxy', 1)` so rate limiting sees real client IPs behind
  Render's (or any) reverse proxy.

---

*A MongoDB Atlas password shared earlier in this project's history should
be rotated (Atlas → Database Access → edit user → new password) before
this is used anywhere public, if that hasn't been done already.*
