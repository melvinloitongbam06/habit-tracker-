"""Unit tests for tracker.validators (no Django needed: python -m unittest)."""
import unittest
from datetime import date

from tracker import validators as v


def habit(**kw):
    base = {"id": "h1", "name": "Read", "type": "count", "goal": 20, "unit": "min",
            "freq": "daily", "start": "2026-10-01"}
    base.update(kw)
    return base


class HabitTests(unittest.TestCase):
    def test_valid_count_habit(self):
        h = v.clean_habit(habit())
        self.assertEqual((h["type"], h["goal"], h["unit"]), ("count", 20, "min"))
        self.assertEqual(h["days"], [0, 1, 2, 3, 4, 5, 6])
        self.assertEqual(h["start"], date(2026, 10, 1))

    def test_check_habit_forces_goal_one_and_no_unit(self):
        h = v.clean_habit(habit(type="check", goal=9, unit="x"))
        self.assertEqual((h["type"], h["goal"], h["unit"]), ("check", 1, ""))

    def test_count_with_goal_one_stays_count_based(self):
        self.assertEqual(v.clean_habit(habit(goal=1))["type"], "count")

    def test_duration_habit_and_increment_are_cleaned(self):
        duration = v.clean_habit(habit(type="duration", goal=30, unit="min"))
        self.assertEqual((duration["type"], duration["goal"], duration["unit"]), ("duration", 30, "min"))
        count = v.clean_habit(habit(goal=8, increment=250))
        self.assertEqual(count["increment"], 250)
        self.assertIsNone(v.clean_habit(habit()).get("increment"))

    def test_name_required_and_trimmed(self):
        with self.assertRaises(v.ApiError):
            v.clean_habit(habit(name="   "))
        self.assertEqual(v.clean_habit(habit(name="  " + "a" * 60))["name"], "a" * 40)

    def test_bad_id_rejected(self):
        for bad in (None, "", "a b", "x" * 41, "a/b", 5):
            with self.assertRaises(v.ApiError, msg=repr(bad)):
                v.clean_habit(habit(id=bad))

    def test_unknown_values_fall_back(self):
        h = v.clean_habit(habit(icon="evil", freq="hourly", remind="25:99", start="nope"))
        self.assertEqual((h["icon"], h["freq"], h["remind"]), ("bolt", "daily", ""))
        self.assertEqual(h["start"], date.today())
        self.assertEqual(v.clean_habit(habit(type=[]))["type"], "check")

    def test_days_cleaning(self):
        h = v.clean_habit(habit(freq="days", days=[4, 4, 1, 9, -1, "2", True]))
        self.assertEqual(h["days"], [1, 4])
        self.assertEqual(v.clean_habit(habit(freq="days", days=[]))["days"], [0, 1, 2, 3, 4])

    def test_weekly_target_range(self):
        self.assertEqual(v.clean_habit(habit(freq="weekly", wk=5))["wk"], 5)
        self.assertEqual(v.clean_habit(habit(freq="weekly", wk=99))["wk"], 3)

    def test_goal_clamped(self):
        self.assertEqual(v.clean_habit(habit(goal=10**9))["goal"], 100000)

    def test_booleans_must_be_real_booleans(self):
        self.assertFalse(v.clean_habit(habit(archived="false"))["archived"])
        self.assertTrue(v.clean_habit(habit(archived=True))["archived"])


class EntryTests(unittest.TestCase):
    def test_count_value_can_exceed_goal(self):
        self.assertEqual(v.clean_entry({"v": 50, "g": 8, "note": " hi "}), (50, 8, "hi", None, None))

    def test_rejects_garbage(self):
        for bad in ({"v": "x"}, {"v": None}, {"v": -1}, {"v": float("nan")},
                    {"v": float("inf")}, {"v": True}, {"v": 2e6}):
            with self.assertRaises(v.ApiError, msg=repr(bad)):
                v.clean_entry(bad)

    def test_note_trimmed(self):
        self.assertEqual(len(v.clean_entry({"v": 1, "g": 1, "note": "n" * 500})[2]), 200)

    def test_timer_data_is_validated(self):
        result = v.clean_entry({"v": 0, "g": 20, "duration_seconds": 65,
                                "timer_sessions": [30, 35]})
        self.assertEqual(result[3:], (65, [30, 35]))
        for bad in (1.5, -1, True, "invalid"):
            with self.assertRaises(v.ApiError):
                v.clean_entry({"v": 0, "duration_seconds": bad})


class SyncTests(unittest.TestCase):
    def test_full_payload(self):
        c = v.clean_sync({
            "profile": {"name": "Sam", "theme": "dark", "week": "sun", "inapp": True, "remind": False},
            "habits": [habit()],
            "deleted": ["old"],
            "logs": [
                {"habit": "h1", "date": "2026-10-02", "v": 5, "g": 20, "note": "ok"},
                {"habit": "h1", "date": "2026-10-03", "delete": True},
                {"habit": "h1", "date": "2026-10-04", "v": 0, "g": 20},
            ],
        })
        self.assertEqual(c["profile"]["theme"], "dark")
        self.assertEqual(c["deleted"], ["old"])
        by_date = {r["date"].isoformat(): r for r in c["logs"]}
        self.assertFalse(by_date["2026-10-02"]["delete"])
        self.assertTrue(by_date["2026-10-03"]["delete"])
        self.assertTrue(by_date["2026-10-04"]["delete"])  # empty entry means delete

    def test_empty_payload_is_ok(self):
        c = v.clean_sync({})
        self.assertEqual((c["habits"], c["deleted"], c["logs"], c["profile"]), ([], [], [], {}))

    def test_last_duplicate_log_wins(self):
        c = v.clean_sync({"logs": [
            {"habit": "h1", "date": "2026-10-02", "v": 1, "g": 8},
            {"habit": "h1", "date": "2026-10-02", "v": 3, "g": 8}]})
        self.assertEqual(len(c["logs"]), 1)
        self.assertEqual(c["logs"][0]["v"], 3)

    def test_count_progress_and_timer_fields_are_preserved(self):
        c = v.clean_sync({"logs": [
            {"habit": "h1", "date": "2026-10-02", "v": 27, "g": 20,
             "duration_seconds": 3600, "timer_sessions": [1200, 2400]},
        ]})
        row = c["logs"][0]
        self.assertEqual(row["v"], 27)
        self.assertEqual((row["duration_seconds"], row["timer_sessions"]), (3600, [1200, 2400]))

    def test_duplicate_habit_ids_rejected(self):
        with self.assertRaises(v.ApiError):
            v.clean_sync({"habits": [habit(), habit()]})

    def test_bad_shapes_rejected(self):
        for bad in ({"habits": "x"}, {"logs": {}}, {"deleted": ["a b"]},
                    {"logs": [{"habit": "h1", "date": "2026-13-45", "v": 1}]},
                    {"logs": [{"habit": "bad id", "date": "2026-10-02", "v": 1}]},
                    {"logs": ["x"]}, []):
            with self.assertRaises(v.ApiError, msg=repr(bad)):
                v.clean_sync(bad)

    def test_size_limits(self):
        with self.assertRaises(v.ApiError) as ctx:
            v.clean_sync({"habits": [habit(id="h%d" % i) for i in range(v.MAX_HABITS + 1)]})
        self.assertEqual(ctx.exception.status, 413)


class ReplaceTests(unittest.TestCase):
    def test_replace_state(self):
        c = v.clean_replace({
            "profile": {"name": "A"},
            "habits": [habit(), habit(id="h2", name="Walk", type="check")],
            "logs": {"h1": {"2026-10-02": {"v": 5, "g": 20}, "2026-10-03": {"v": 0, "g": 20}},
                     "ghost": {"2026-10-02": {"v": 1, "g": 1}}},
        })
        self.assertEqual(len(c["habits"]), 2)
        self.assertEqual([r["date"].isoformat() for r in c["logs"]], ["2026-10-02"])

    def test_replace_rejects_bad_logs(self):
        with self.assertRaises(v.ApiError):
            v.clean_replace({"habits": [habit()], "logs": {"h1": {"bad-date": {"v": 1}}}})


class ProfileTests(unittest.TestCase):
    def test_only_valid_fields(self):
        p = v.clean_profile({"name": " " + "x" * 50, "theme": "neon", "week": "sun",
                             "chime": "yes", "dismiss": {"h1": "2026-10-02", "bad id": "2026-10-02",
                                                         "h2": "nope"}})
        self.assertEqual(len(p["name"]), 30)
        self.assertNotIn("theme", p)
        self.assertEqual(p["week"], "sun")
        self.assertFalse(p["chime"])
        self.assertEqual(p["dismiss"], {"h1": "2026-10-02"})


class CredentialTests(unittest.TestCase):
    def test_username_rules(self):
        self.assertEqual(v.check_username("sam_1.x"), "sam_1.x")
        for bad in ("ab", "a" * 31, "has space", "emoji😀x", "a@b"):
            with self.assertRaises(v.ApiError, msg=bad):
                v.check_username(bad)

    def test_credentials_must_be_strings(self):
        with self.assertRaises(v.ApiError):
            v.clean_credentials({"username": 1, "password": "x"})
        self.assertEqual(v.clean_credentials({"username": " sam ", "password": "p"}), ("sam", "p"))


if __name__ == "__main__":
    unittest.main()
