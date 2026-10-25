# Habit Tracker (Django)

A habit tracker with accounts, a Django JSON API and a plain HTML/CSS/JS front end.
Includes **Sprig**, a small habit coach that reacts to your real progress.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py test            # optional: API tests
python manage.py runserver
```

Open http://127.0.0.1:8000/ and create an account. Each account has its own habits.
`python manage.py createsuperuser` gives you access to `/admin/`.
For an existing database created before migrations were added, use
`python manage.py migrate --fake-initial` once to adopt the initial schema without
recreating tables or deleting data.

## Layout

```
config/                     settings, urls, wsgi/asgi
android/healthconnect/      Android companion for Health Connect steps
tracker/
  models.py                 Profile, Habit, HabitLog and timer persistence
  gamification.py           server-authoritative XP, level, and weekly bonus rules
  validators.py             all input cleaning (plain Python, no Django imports)
  views.py, urls.py         page + JSON API
  tests.py                  API tests (python manage.py test)
  test_validators.py        validator unit tests (python -m unittest tracker.test_validators)
  templates/tracker/index.html      HTML
  static/tracker/css/styles.css     CSS
  static/tracker/js/
    api.js                  fetch wrapper + Sync (turns app changes into small API updates)
    app.js                  the app: views, habit logic, sign-in screens
    coach.js                Sprig, the coach
    main.js                 start-up
```

## How it works

- The page loads, asks `/api/auth/me/`, then shows sign-in or loads `/api/state/`.
- The app keeps its state in memory. After any change, `Sync` compares it with what the
  server already has and sends only the difference to `/api/sync/` in one atomic request.
  If you are offline or the server errors, a banner shows and it retries with back-off.
- Returning to the tab pulls changes made on another device (only when this device has
  nothing unsaved).
- Habit ids are created in the browser and are unique per user, so one user can never
  read or overwrite another user's data.

## API

All endpoints use JSON. Browser endpoints use session-cookie auth and `X-CSRFToken`.
Android exchange, steps, and revoke endpoints use a device-scoped Bearer token.

| Method | URL | Purpose |
| --- | --- | --- |
| GET | `/api/auth/me/` | `{authenticated, username, today}` (`today` is the server-local date) |
| POST | `/api/auth/register/` | `{username, password}` |
| POST | `/api/auth/login/` | `{username, password}` (10 failures per 15 min per IP+user) |
| POST | `/api/auth/logout/` | |
| GET | `/api/state/` | profile, habits, check-ins |
| PUT | `/api/state/` | replace everything (restore a backup) |
| POST | `/api/sync/` | `{profile?, habits[], deleted[], logs[]}` applied atomically |
| GET | `/api/xp/` | refresh and return the signed-in user's XP and level progress |
| POST | `/api/timer/` | `{habit, date, action}`; start, pause, stop, or reset a duration session |
| POST | `/api/health-connect/pairing/` | Create a short-lived pairing code for the signed-in account |
| GET | `/api/health-connect/status/` | Connection state and today's separately stored step total |
| POST | `/api/health-connect/disconnect/` | Revoke the paired device and delete imported step totals |
| POST | `/api/health-connect/exchange/` | Exchange a one-use pairing code for a device-scoped token |
| POST | `/api/health-connect/steps/` | Store today's step total using the device-scoped token |
| POST | `/api/health-connect/revoke/` | Revoke the calling Android device and delete imported steps |

## Deploying

Set these environment variables:

```
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<long random string>
DJANGO_ALLOWED_HOSTS=habits.example.com
DJANGO_CSRF_TRUSTED=https://habits.example.com
```

With `DEBUG` off, Django does not serve static files: run `python manage.py collectstatic`
and serve `staticfiles/` from your web server (or add WhiteNoise). Use a real database and
a shared cache (for the login throttle) if you run more than one process; the defaults are
SQLite and a per-process cache.

## Notes

- Habits saved by the earlier single-file version live in the browser's localStorage. After
  you sign in to an empty account the app offers to add them.
- Backups: Profile → Export / Import still work and are now saved to your account.
- Habits can be completion-, count-, or duration-based. Count goals support custom units,
  increments, manual quantity entry, and values above the target.
- Completing a habit's daily goal earns 10 XP once per habit and date. Partial progress
  earns no XP. Reaching a new level requires 100 XP for level 2, then 25 more XP per
  additional level. The home screen shows total XP, rank, level progress, and this week's
  consistency quest.
- A perfect week earns 25 bonus XP when every scheduled goal for every active habit is met;
  weekly-goal habits must reach their configured weekly target. Each consecutive perfect
  week adds 10 XP to that bonus, up to 50 extra. The account's week-start preference sets
  the game week. Existing completed history is credited the first time the XP system loads.
  XP rewards are stored server-side and only awarded once, so retries, undoing activity,
  importing backups, or resetting habits cannot duplicate or erase earned XP.
- Duration progress is stored per habit and date. The timer API records server timestamps
  for active sessions and commits elapsed seconds when paused or stopped, so an active
  session can be restored after a refresh and does not depend on a browser interval.
  When a running timer reaches its goal, the app shows an in-app alert and, if browser
  notifications are enabled, a browser notification. Like other reminders, this requires
  the page to be open.
- Daily progress may be changed only for the current date in Django's active timezone.
  Past and future records remain viewable but read-only in the UI and are rejected by
  the sync, restore, and timer APIs. Admin edits/deletes of non-today logs and habit
  deletion that would cascade into non-today logs are also blocked.
- Backup restore must preserve every existing non-today log unchanged and cannot add
  non-today records. An active timer that passes local midnight is automatically
  finalized at that midnight when the server next processes a request; this records
  only the elapsed portion on the day the timer began.
- Connect Health Connect creates a server-side pairing code that expires after ten minutes
  and can be used once. The code and device token are stored as hashes. The Android companion
  requests read access to steps, synchronizes only the current local day's aggregate when the
  user taps Sync, and stores that total separately from habit logs. It never updates habit
  progress. Only the latest synced daily total is retained; syncing a new day replaces the
  previous total. Disconnecting revokes access and deletes imported totals. Health Connect
  data shared from Google Fit can be included if it is present in the Health Connect store.
- Android companion: open `android/healthconnect/` in Android Studio with JDK 17 and Android
  SDK 36 installed. Build and install the app, then enter the HTTPS URL of the deployed
  Habit Tracker server and the temporary code from Home → Connect Health Connect. Approve
  step access in the Health Connect permission screen and tap Sync. This workspace does not
  include a built APK; the Android companion must be built and installed separately.
