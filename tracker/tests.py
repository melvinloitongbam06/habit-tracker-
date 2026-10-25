"""API tests. Run with:  python manage.py test"""
import hashlib
import json
from datetime import date, datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.test import Client, RequestFactory, TestCase
from django.utils import timezone

from .admin import HabitLogAdminForm
from .models import (
    ExperienceAward, Habit, HabitLog, HealthConnectDailySteps, HealthConnectDevice,
    HealthConnectPairingCode,
)

User = get_user_model()
PASSWORD = "correct-horse-battery-9"


def hab(cid="h1", **kw):
    data = {"id": cid, "name": "Read", "icon": "book", "type": "count", "goal": 20, "unit": "min",
            "freq": "daily", "days": [0, 1, 2, 3, 4, 5, 6], "wk": 3, "remind": "",
            "start": "2026-10-01", "archived": False, "demo": False}
    data.update(kw)
    return data


class ApiClient:
    """A test client that enforces CSRF like a browser, sending the token as a header."""

    def __init__(self):
        self.c = Client(enforce_csrf_checks=True)
        self.c.get("/")  # sets the csrftoken cookie

    def _token(self):
        morsel = self.c.cookies.get("csrftoken")
        return morsel.value if morsel else ""

    def get(self, url):
        return self.c.get(url)

    def send(self, method, url, data=None, token=True):
        headers = {"HTTP_X_CSRFTOKEN": self._token()} if token else {}
        return self.c.generic(
            method, url, json.dumps(data if data is not None else {}),
            content_type="application/json", **headers,
        )

    def post(self, url, data=None, **kw):
        return self.send("POST", url, data, **kw)

    def put(self, url, data=None, **kw):
        return self.send("PUT", url, data, **kw)


def signed_in(username="sam"):
    api = ApiClient()
    r = api.post("/api/auth/register/", {"username": username, "password": PASSWORD})
    assert r.status_code == 201, r.content
    return api


class ExperienceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.api = signed_in("xp-user")

    def test_activity_xp_is_awarded_once_and_survives_undo(self):
        day = timezone.localdate().isoformat()
        self.api.post("/api/sync/", {"habits": [hab("read", type="count", goal=5)]})
        partial = self.api.post("/api/sync/", {
            "logs": [{"habit": "read", "date": day, "v": 4, "g": 5}],
        })
        self.assertEqual(partial.json()["xp"]["total"], 0)

        completed = self.api.post("/api/sync/", {
            "logs": [{"habit": "read", "date": day, "v": 5, "g": 5}],
        }).json()
        self.assertEqual((completed["xp_gained"], completed["xp"]["total"]), (10, 10))

        repeated = self.api.post("/api/sync/", {
            "logs": [{"habit": "read", "date": day, "v": 5, "g": 5}],
        }).json()
        self.assertEqual(repeated["xp_gained"], 0)

        self.api.post("/api/sync/", {
            "logs": [{"habit": "read", "date": day, "delete": True}],
        })
        restored = self.api.post("/api/sync/", {
            "logs": [{"habit": "read", "date": day, "v": 5, "g": 5}],
        }).json()
        self.assertEqual((restored["xp_gained"], restored["xp"]["total"]), (0, 10))
        self.assertEqual(ExperienceAward.objects.filter(kind="activity").count(), 1)

    def test_full_weeks_earn_base_and_consecutive_streak_bonus(self):
        today = timezone.localdate()
        monday = today - timedelta(days=today.weekday())
        first_week = monday - timedelta(days=14)
        last_week = monday - timedelta(days=7)
        user = User.objects.get(username="xp-user")
        habit = Habit.objects.create(
            user=user, cid="daily", name="Read", icon="book", type="check", goal=1,
            freq="daily", days=[0, 1, 2, 3, 4, 5, 6], wk=3,
            start=first_week, archived=False,
        )
        HabitLog.objects.bulk_create([
            HabitLog(habit=habit, date=first_week + timedelta(days=week * 7 + day), v=1, g=1)
            for week in range(2)
            for day in range(7)
        ])

        state = self.api.get("/api/state/").json()
        weekly = list(ExperienceAward.objects.filter(kind="weekly").order_by("period_start"))
        self.assertEqual([award.period_start for award in weekly], [first_week, last_week])
        self.assertEqual([award.points for award in weekly], [25, 35])
        self.assertEqual(state["xp"]["total"], 200)
        self.assertEqual(state["xp"]["weekly"]["streak"], 2)
        self.assertEqual(state["xp"]["weekly"]["next_bonus"], 45)

    def test_duration_goal_awards_xp_when_timer_stops(self):
        self.api.post("/api/sync/", {
            "habits": [hab("focus", type="duration", goal=1, unit="min")],
        })
        day = timezone.localdate().isoformat()
        started = datetime.combine(
            timezone.localdate(), datetime.min.time()
        ).replace(hour=12, tzinfo=dt_timezone.utc)
        with patch("tracker.views.timezone.now", return_value=started):
            self.api.post("/api/timer/", {"habit": "focus", "date": day, "action": "start"})
        with patch("tracker.views.timezone.now", return_value=started + timedelta(seconds=60)):
            completed = self.api.post(
                "/api/timer/", {"habit": "focus", "date": day, "action": "stop"}
            ).json()["log"]
        self.assertEqual((completed["xp_gained"], completed["xp"]["total"]), (10, 10))

        repeated = self.api.post(
            "/api/timer/", {"habit": "focus", "date": day, "action": "stop"}
        ).json()["log"]
        self.assertEqual(repeated["xp_gained"], 0)



class PageTests(TestCase):
    def test_index_sets_csrf_cookie_and_loads_static_files(self):
        r = Client().get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("csrftoken", r.cookies)
        body = r.content.decode()
        for name in ("css/styles.css", "js/api.js", "js/app.js", "js/coach.js", "js/main.js"):
            self.assertIn(name, body)


class AuthTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_me_when_signed_out(self):
        r = ApiClient().get("/api/auth/me/")
        self.assertEqual(r.json(), {"authenticated": False, "today": timezone.localdate().isoformat()})

    def test_register_login_logout(self):
        api = ApiClient()
        r = api.post("/api/auth/register/", {"username": "Sam", "password": PASSWORD})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(api.get("/api/auth/me/").json(), {
            "authenticated": True, "username": "Sam",
            "today": timezone.localdate().isoformat(),
        })
        api.post("/api/auth/logout/")
        self.assertFalse(api.get("/api/auth/me/").json()["authenticated"])
        r = api.post("/api/auth/login/", {"username": "Sam", "password": PASSWORD})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(api.get("/api/auth/me/").json()["authenticated"])

    def test_register_validation(self):
        api = ApiClient()
        self.assertEqual(api.post("/api/auth/register/", {"username": "a", "password": PASSWORD}).status_code, 400)
        self.assertEqual(api.post("/api/auth/register/", {"username": "samsam", "password": "123"}).status_code, 400)
        signed_in("taken")
        r = ApiClient().post("/api/auth/register/", {"username": "TAKEN", "password": PASSWORD})
        self.assertEqual(r.status_code, 409)

    def test_wrong_password_and_throttle(self):
        signed_in("sam")
        api = ApiClient()
        for _ in range(10):
            self.assertEqual(api.post("/api/auth/login/", {"username": "sam", "password": "nope"}).status_code, 400)
        r = api.post("/api/auth/login/", {"username": "sam", "password": PASSWORD})
        self.assertEqual(r.status_code, 429)

    def test_data_endpoints_need_sign_in(self):
        api = ApiClient()
        self.assertEqual(api.get("/api/state/").status_code, 401)
        self.assertEqual(api.post("/api/sync/", {}).status_code, 401)
        self.assertEqual(api.get("/api/xp/").status_code, 401)
        self.assertEqual(api.post("/api/timer/", {}).status_code, 401)

    def test_csrf_is_enforced(self):
        api = signed_in()
        self.assertEqual(api.post("/api/sync/", {}, token=False).status_code, 403)
        self.assertEqual(api.put("/api/state/", {}, token=False).status_code, 403)


class HealthConnectTests(TestCase):
    def setUp(self):
        cache.clear()
        self.api = signed_in("health-user")

    def make_pairing_code(self):
        response = self.api.post("/api/health-connect/pairing/", {})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["code"]

    def exchange(self, code, device_name="Test Android"):
        return Client().post(
            "/api/health-connect/exchange/",
            json.dumps({"code": code, "device_name": device_name}),
            content_type="application/json",
        )

    def test_pairing_code_is_hashed_single_use_and_expires(self):
        code = self.make_pairing_code()
        pairing = HealthConnectPairingCode.objects.get()
        self.assertNotEqual(pairing.code_digest, code)
        self.assertEqual(len(code.split("-")), 4)

        response = self.exchange(code)
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()["token"]
        device = HealthConnectDevice.objects.get()
        self.assertNotEqual(device.token_digest, token)
        self.assertEqual(device.name, "Test Android")
        pairing.refresh_from_db()
        self.assertIsNotNone(pairing.used_at)
        self.assertEqual(self.exchange(code).status_code, 400)

        expired = self.make_pairing_code()
        HealthConnectPairingCode.objects.filter(
            code_digest=hashlib.sha256(expired.encode("utf-8")).hexdigest()
        ).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.exchange(expired).status_code, 400)

    def test_health_steps_sync_is_separate_and_current_day_only(self):
        code = self.make_pairing_code()
        token = self.exchange(code).json()["token"]
        today = timezone.now().date().isoformat()
        headers = {"HTTP_AUTHORIZATION": "Bearer " + token}
        response = Client().post(
            "/api/health-connect/steps/",
            json.dumps({
                "steps": 7342,
                "date": today,
                "time_zone": "UTC",
                "utc_offset_minutes": 0,
            }),
            content_type="application/json",
            **headers,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(HabitLog.objects.count(), 0)
        self.assertEqual(HealthConnectDailySteps.objects.get().steps, 7342)
        self.assertEqual(
            self.api.get(
                "/api/health-connect/status/?date={}&time_zone=UTC&utc_offset_minutes=0".format(today)
            ).json()["steps"],
            7342,
        )

        yesterday = (timezone.now().date() - timedelta(days=1)).isoformat()
        response = Client().post(
            "/api/health-connect/steps/",
            json.dumps({
                "steps": 8000,
                "date": yesterday,
                "time_zone": "UTC",
                "utc_offset_minutes": 0,
            }),
            content_type="application/json",
            **headers,
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(HealthConnectDailySteps.objects.count(), 1)

    def test_invalid_tokens_and_disconnect_revoke_device_access(self):
        response = Client().post(
            "/api/health-connect/steps/",
            json.dumps({
                "steps": 1,
                "date": timezone.now().date().isoformat(),
                "time_zone": "UTC",
                "utc_offset_minutes": 0,
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

        token = self.exchange(self.make_pairing_code()).json()["token"]
        HealthConnectDailySteps.objects.create(
            user=User.objects.get(username="health-user"),
            date=timezone.now().date(),
            time_zone="UTC",
            steps=10,
        )
        self.assertEqual(self.api.post("/api/health-connect/disconnect/", {}).status_code, 200)
        self.assertEqual(HealthConnectDailySteps.objects.count(), 0)
        response = Client().post(
            "/api/health-connect/steps/",
            json.dumps({
                "steps": 1,
                "date": timezone.now().date().isoformat(),
                "time_zone": "UTC",
                "utc_offset_minutes": 0,
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer " + token,
        )
        self.assertEqual(response.status_code, 401)

    def test_android_device_can_revoke_its_token(self):
        token = self.exchange(self.make_pairing_code()).json()["token"]
        device = HealthConnectDevice.objects.get()
        response = Client().post(
            "/api/health-connect/revoke/",
            json.dumps({}),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer " + token,
        )
        self.assertEqual(response.status_code, 200, response.content)
        device.refresh_from_db()
        self.assertIsNotNone(device.revoked_at)
        self.assertFalse(HealthConnectDevice.objects.filter(revoked_at__isnull=True).exists())
        response = Client().post(
            "/api/health-connect/steps/",
            json.dumps({
                "steps": 1,
                "date": timezone.now().date().isoformat(),
                "time_zone": "UTC",
                "utc_offset_minutes": 0,
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer " + token,
        )
        self.assertEqual(response.status_code, 401)


class DataTests(TestCase):
    def setUp(self):
        cache.clear()
        self.api = signed_in("sam")

    def test_empty_state(self):
        s = self.api.get("/api/state/").json()
        self.assertEqual(s["user"], {"username": "sam"})
        self.assertEqual((s["habits"], s["logs"]), ([], {}))
        self.assertEqual(s["profile"]["theme"], "auto")

    def test_sync_creates_updates_and_deletes(self):
        day = timezone.localdate().isoformat()
        r = self.api.post("/api/sync/", {
            "profile": {"name": "Sam", "theme": "dark", "week": "sun"},
            "habits": [hab("h1"), hab("h2", name="Walk", type="check", goal=1, unit="")],
            "logs": [{"habit": "h1", "date": day, "v": 12, "g": 20, "note": "ok"},
                     {"habit": "h2", "date": day, "v": 1, "g": 1}],
        })
        self.assertEqual(r.status_code, 200, r.content)
        s = self.api.get("/api/state/").json()
        self.assertEqual([h["id"] for h in s["habits"]], ["h1", "h2"])
        self.assertEqual(s["profile"]["name"], "Sam")
        self.assertEqual(s["logs"]["h1"][day], {"v": 12, "g": 20, "note": "ok"})

        # update one check-in, delete another, rename a habit
        self.api.post("/api/sync/", {
            "habits": [hab("h1", name="Read more")],
            "logs": [{"habit": "h1", "date": day, "v": 20, "g": 20},
                     {"habit": "h2", "date": day, "delete": True}],
        })
        s = self.api.get("/api/state/").json()
        self.assertEqual(s["habits"][0]["name"], "Read more")
        self.assertEqual(s["logs"]["h1"][day], {"v": 20, "g": 20})
        self.assertEqual(s["logs"]["h2"], {})

        # deleting a habit removes its history
        self.api.post("/api/sync/", {"deleted": ["h1"]})
        s = self.api.get("/api/state/").json()
        self.assertEqual([h["id"] for h in s["habits"]], ["h2"])
        self.assertEqual(HabitLog.objects.count(), 0)

    def test_count_increment_and_over_target_value_persist(self):
        day = timezone.localdate().isoformat()
        result = self.api.post("/api/sync/", {
            "habits": [hab("steps", name="Steps", type="count", goal=10000,
                           unit="steps", increment=250)],
            "logs": [{"habit": "steps", "date": day, "v": 12350, "g": 10000}],
        })
        self.assertEqual(result.status_code, 200, result.content)
        state = self.api.get("/api/state/").json()
        self.assertEqual(state["habits"][0]["increment"], 250)
        self.assertEqual(state["logs"]["steps"][day]["v"], 12350)
        old_client_habit = hab("steps", name="Steps renamed", type="count",
                               goal=10000, unit="steps")
        self.api.post("/api/sync/", {"habits": [old_client_habit]})
        refreshed = self.api.get("/api/state/").json()
        self.assertEqual(refreshed["habits"][0]["increment"], 250)

    def test_invalid_payload_changes_nothing(self):
        self.api.post("/api/sync/", {"habits": [hab("h1")]})
        r = self.api.post("/api/sync/", {
            "habits": [hab("h1", name="Changed")],
            "logs": [{"habit": "h1", "date": "not-a-date", "v": 1, "g": 1}],
        })
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Habit.objects.get().name, "Read")

    def test_replace_state(self):
        day = timezone.localdate().isoformat()
        self.api.post("/api/sync/", {"habits": [hab("old")]})
        r = self.api.put("/api/state/", {
            "profile": {"name": "Restored"},
            "habits": [hab("new1")],
            "logs": {"new1": {day: {"v": 5, "g": 20}}},
        })
        self.assertEqual(r.status_code, 200, r.content)
        s = r.json()
        self.assertEqual([h["id"] for h in s["habits"]], ["new1"])
        self.assertEqual(s["logs"]["new1"][day], {"v": 5, "g": 20})
        self.assertEqual(s["profile"]["name"], "Restored")

    def test_users_are_isolated(self):
        day = timezone.localdate().isoformat()
        self.api.post("/api/sync/", {
            "habits": [hab("h1")],
            "logs": [{"habit": "h1", "date": day, "v": 5, "g": 20}],
        })
        other = signed_in("alex")
        self.assertEqual(other.get("/api/state/").json()["habits"], [])
        # the same client-side id is allowed for another user and does not touch sam's data
        other.post("/api/sync/", {"habits": [hab("h1", name="Alex's")],
                                  "logs": [{"habit": "h1", "date": day, "v": 1, "g": 20}]})
        mine = self.api.get("/api/state/").json()
        self.assertEqual(mine["habits"][0]["name"], "Read")
        self.assertEqual(mine["logs"]["h1"][day]["v"], 5)
        # deleting by id only affects the caller
        other.post("/api/sync/", {"deleted": ["h1"]})
        self.assertEqual(len(self.api.get("/api/state/").json()["habits"]), 1)

    def test_logs_for_unknown_habits_are_ignored(self):
        r = self.api.post("/api/sync/", {"logs": [{
            "habit": "ghost", "date": timezone.localdate().isoformat(), "v": 1, "g": 1,
        }]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(HabitLog.objects.count(), 0)

    def test_non_json_is_rejected(self):
        r = self.api.c.generic("POST", "/api/sync/", "x=1", content_type="text/plain",
                               HTTP_X_CSRFTOKEN=self.api._token())
        self.assertEqual(r.status_code, 415)
        r = self.api.c.generic("POST", "/api/sync/", "{oops", content_type="application/json",
                               HTTP_X_CSRFTOKEN=self.api._token())
        self.assertEqual(r.status_code, 400)

    def test_wrong_method(self):
        self.assertEqual(self.api.get("/api/sync/").status_code, 405)

    def test_sync_rejects_past_and_future_log_writes(self):
        today = timezone.localdate()
        self.api.post("/api/sync/", {"habits": [hab("h1")]})
        for day in (today - timedelta(days=1), today + timedelta(days=1)):
            response = self.api.post("/api/sync/", {"logs": [{
                "habit": "h1", "date": day.isoformat(), "v": 5, "g": 20,
            }]})
            self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(HabitLog.objects.count(), 0)

    def test_duration_timer_sessions_persist_and_accumulate(self):
        self.api.post("/api/sync/", {
            "habits": [hab("focus", type="duration", goal=20, unit="min")],
        })
        day = timezone.localdate().isoformat()
        started = datetime.combine(timezone.localdate(), datetime.min.time()).replace(
            hour=12, tzinfo=dt_timezone.utc
        )
        with patch("tracker.views.timezone.now", return_value=started):
            first = self.api.post("/api/timer/", {
                "habit": "focus", "date": day, "action": "start",
            })
        self.assertEqual(first.status_code, 200, first.content)
        self.assertIsNotNone(first.json()["log"]["timer_started_at"])

        with patch("tracker.views.timezone.now", return_value=started + timedelta(seconds=600)):
            paused = self.api.post("/api/timer/", {
                "habit": "focus", "date": day, "action": "pause",
            })
        self.assertEqual(paused.json()["log"]["duration_seconds"], 600)
        self.assertEqual(paused.json()["log"]["timer_sessions"], [600])
        self.assertIsNone(paused.json()["log"]["timer_started_at"])

        with patch("tracker.views.timezone.now", return_value=started + timedelta(seconds=900)):
            self.api.post("/api/timer/", {
                "habit": "focus", "date": day, "action": "start",
            })
        with patch("tracker.views.timezone.now", return_value=started + timedelta(seconds=1200)):
            stopped = self.api.post("/api/timer/", {
                "habit": "focus", "date": day, "action": "stop",
            })
        self.assertEqual(stopped.json()["log"]["duration_seconds"], 900)
        self.assertEqual(stopped.json()["log"]["timer_sessions"], [600, 300])

        log = self.api.get("/api/state/").json()["logs"]["focus"][day]
        self.assertEqual(log["duration_seconds"], 900)
        self.assertEqual(HabitLog.objects.get().duration_seconds, 900)

    def test_timer_is_idempotent_and_prevents_parallel_sessions(self):
        self.api.post("/api/sync/", {
            "habits": [hab("focus", type="duration", goal=20, unit="min")],
        })
        first_day = timezone.localdate().isoformat()
        other_day = (timezone.localdate() - timedelta(days=1)).isoformat()
        started = datetime.combine(timezone.localdate(), datetime.min.time()).replace(
            hour=12, tzinfo=dt_timezone.utc
        )
        payload = {"habit": "focus", "date": first_day, "action": "start"}
        with patch("tracker.views.timezone.now", return_value=started):
            first = self.api.post("/api/timer/", payload)
        with patch("tracker.views.timezone.now", return_value=started + timedelta(seconds=10)):
            second = self.api.post("/api/timer/", payload)
            conflict = self.api.post("/api/timer/", {
                "habit": "focus", "date": other_day, "action": "start",
            })
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["log"]["timer_started_at"], second.json()["log"]["timer_started_at"])
        self.assertEqual(conflict.status_code, 403)
        self.assertEqual(HabitLog.objects.filter(timer_started_at__isnull=False).count(), 1)

    def test_timer_reset_clears_only_tracked_time(self):
        day = timezone.localdate().isoformat()
        self.api.post("/api/sync/", {
            "habits": [hab("focus", type="duration", goal=20, unit="min")],
            "logs": [{"habit": "focus", "date": day, "v": 0, "g": 20,
                      "note": "keep this note", "duration_seconds": 120,
                      "timer_sessions": [120]}],
        })
        result = self.api.post("/api/timer/", {
            "habit": "focus", "date": day, "action": "reset",
        })
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["log"]["duration_seconds"], 0)
        saved = HabitLog.objects.get()
        self.assertEqual(saved.timer_sessions, [])
        self.assertEqual(saved.note, "keep this note")

    def test_timer_rejects_past_and_future_dates(self):
        self.api.post("/api/sync/", {
            "habits": [hab("focus", type="duration", goal=20, unit="min")],
        })
        today = timezone.localdate()
        for day in (today - timedelta(days=1), today + timedelta(days=1)):
            response = self.api.post("/api/timer/", {
                "habit": "focus", "date": day.isoformat(), "action": "start",
            })
            self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(HabitLog.objects.count(), 0)

    def test_timer_rechecks_date_inside_mutation_transaction(self):
        self.api.post("/api/sync/", {
            "habits": [hab("focus", type="duration", goal=20, unit="min")],
        })
        today = timezone.localdate()
        with patch("tracker.views.server_today", side_effect=[today, today + timedelta(days=1)]):
            response = self.api.post("/api/timer/", {
                "habit": "focus", "date": today.isoformat(), "action": "start",
            })
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(HabitLog.objects.count(), 0)

    def test_historical_sync_and_habit_deletion_are_rejected(self):
        habit = Habit.objects.create(
            user=User.objects.get(username="sam"), cid="h1", name="Read",
            type="count", goal=20, unit="min", start=date(2026, 1, 1),
        )
        historical = timezone.localdate() - timedelta(days=1)
        log = HabitLog.objects.create(habit=habit, date=historical, v=15, g=20, note="kept")
        change = self.api.post("/api/sync/", {"logs": [{
            "habit": "h1", "date": historical.isoformat(), "v": 20, "g": 20,
        }]})
        delete = self.api.post("/api/sync/", {"logs": [{
            "habit": "h1", "date": historical.isoformat(), "delete": True,
        }]})
        remove_habit = self.api.post("/api/sync/", {"deleted": ["h1"]})
        self.assertEqual([change.status_code, delete.status_code, remove_habit.status_code],
                         [403, 403, 403])
        log.refresh_from_db()
        self.assertEqual((log.v, log.g, log.note), (15, 20, "kept"))

    def test_replace_can_preserve_but_not_rewrite_historical_logs(self):
        habit = Habit.objects.create(
            user=User.objects.get(username="sam"), cid="h1", name="Read",
            type="count", goal=20, unit="pages", start=date(2026, 1, 1),
        )
        historical = timezone.localdate() - timedelta(days=1)
        log = HabitLog.objects.create(habit=habit, date=historical, v=10, g=20, note="original")
        backup = {
            "habits": [hab("h1", name="Reading", goal=25, unit="pages")],
            "logs": {"h1": {historical.isoformat(): {"v": 10, "g": 20, "note": "original"}}},
        }
        preserved = self.api.put("/api/state/", backup)
        self.assertEqual(preserved.status_code, 200, preserved.content)
        log.refresh_from_db()
        self.assertEqual((log.v, log.g, log.note), (10, 20, "original"))
        self.assertEqual(Habit.objects.get().name, "Reading")

        changed = {
            **backup,
            "logs": {"h1": {historical.isoformat(): {"v": 19, "g": 20, "note": "edited"}}},
        }
        response = self.api.put("/api/state/", changed)
        self.assertEqual(response.status_code, 403, response.content)
        missing = {"habits": backup["habits"], "logs": {"h1": {}}}
        response = self.api.put("/api/state/", missing)
        self.assertEqual(response.status_code, 403, response.content)
        log.refresh_from_db()
        self.assertEqual((log.v, log.g, log.note), (10, 20, "original"))

    def test_historical_records_are_readable_and_definition_edits_keep_them(self):
        habit = Habit.objects.create(
            user=User.objects.get(username="sam"), cid="h1", name="Read",
            type="count", goal=20, unit="pages", start=date(2026, 1, 1),
        )
        historical = timezone.localdate() - timedelta(days=1)
        log = HabitLog.objects.create(habit=habit, date=historical, v=20, g=20)
        response = self.api.post("/api/sync/", {
            "habits": [hab("h1", name="Read more", goal=30, unit="pages")],
        })
        self.assertEqual(response.status_code, 200, response.content)
        state = self.api.get("/api/state/").json()
        self.assertEqual(state["logs"]["h1"][historical.isoformat()]["v"], 20)
        log.refresh_from_db()
        self.assertEqual((log.v, log.g), (20, 20))

    def test_server_local_date_and_midnight_timer_rollover(self):
        self.api.post("/api/sync/", {
            "habits": [hab("focus", type="duration", goal=20, unit="min")],
        })
        utc_start = datetime(2026, 10, 21, 9, 55, tzinfo=dt_timezone.utc)
        with timezone.override("Pacific/Kiritimati"):
            with patch("tracker.views.timezone.now", return_value=utc_start):
                with patch(
                    "tracker.views.server_today",
                    side_effect=lambda: timezone.localtime().date(),
                ):
                    server_day = self.api.get("/api/auth/me/").json()["today"]
                    started = self.api.post("/api/timer/", {
                        "habit": "focus", "date": server_day, "action": "start",
                    })
            self.assertEqual(server_day, "2026-10-21")
            self.assertEqual(started.status_code, 200, started.content)
            next_day_utc = utc_start + timedelta(minutes=10)
            with patch("tracker.views.timezone.now", return_value=next_day_utc):
                with patch(
                    "tracker.views.server_today",
                    side_effect=lambda: timezone.localtime().date(),
                ):
                    next_day = self.api.get("/api/auth/me/").json()["today"]
                    wrong_utc_day = self.api.post("/api/timer/", {
                        "habit": "focus", "date": "2026-10-21", "action": "start",
                    })
            self.assertEqual(next_day, "2026-10-22")
            self.assertEqual(wrong_utc_day.status_code, 403)
            with patch("tracker.views.timezone.now", return_value=next_day_utc):
                with patch(
                    "tracker.views.server_today",
                    side_effect=lambda: timezone.localtime().date(),
                ):
                    state = self.api.get("/api/state/").json()
            self.assertEqual(state["today"], "2026-10-22")
            previous = HabitLog.objects.get(habit__cid="focus", date=date(2026, 10, 21))
            self.assertEqual(previous.duration_seconds, 300)
            self.assertEqual(previous.timer_sessions, [300])
            self.assertIsNone(previous.timer_started_at)
            self.assertEqual(state["logs"]["focus"]["2026-10-21"]["duration_seconds"], 300)


class AdminDateRestrictionTests(TestCase):
    def test_admin_cannot_mutate_historical_logs_or_bulk_delete(self):
        user = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        habit = Habit.objects.create(
            user=user, cid="h1", name="Read", type="check", start=timezone.localdate(),
        )
        historical = HabitLog.objects.create(
            habit=habit, date=timezone.localdate() - timedelta(days=1), v=1, g=1,
        )
        current = HabitLog.objects.create(
            habit=habit, date=timezone.localdate(), v=1, g=1,
        )
        request = RequestFactory().get("/admin/")
        request.user = user
        log_admin = admin.site._registry[HabitLog]
        habit_admin = admin.site._registry[Habit]

        self.assertFalse(log_admin.has_change_permission(request, historical))
        self.assertFalse(log_admin.has_delete_permission(request, historical))
        self.assertTrue(log_admin.has_change_permission(request, current))
        self.assertTrue(log_admin.has_delete_permission(request, current))
        self.assertEqual(log_admin.get_actions(request), {})
        self.assertFalse(habit_admin.has_delete_permission(request, habit))

    def test_admin_form_rejects_non_today_log_dates(self):
        form = HabitLogAdminForm()
        form.cleaned_data = {"date": timezone.localdate() + timedelta(days=1)}
        with self.assertRaisesMessage(ValidationError, "Only today's habit records"):
            form.clean_date()
