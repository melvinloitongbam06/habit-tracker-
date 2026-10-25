"""Input cleaning for the JSON API.

This module is plain Python (no Django imports) so it can be unit tested on its
own. Every function either returns clean data or raises ApiError. The rules
mirror what the browser app already enforces, so the server never trusts the
client.
"""
import math
import re
from datetime import date

MAX_HABITS = 200
MAX_LOGS = 50000
MAX_DELETED = 200

ICONS = frozenset(
    "water book bolt study mind moon heart home list cal chart user ck edit note "
    "archive trash undo bell flame".split()
)
TYPES = frozenset(["check", "count", "duration"])
FREQS = frozenset(["daily", "days", "weekly"])
THEMES = frozenset(["auto", "light", "dark"])
WEEKS = frozenset(["mon", "sun"])

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ApiError(ValueError):
    """A problem with the request. `status` is the HTTP status to return."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _text(value, limit):
    return ("" if value is None else str(value)).strip()[:limit]


def _flag(value):
    return value is True


def _int(value, low, high, default):
    """Round to an int. Below `low` or unparseable -> default; above `high` -> high."""
    if isinstance(value, bool):
        return default
    try:
        number = round(float(value))
    except (TypeError, ValueError, OverflowError):
        return default
    if not number >= low:
        return default
    return min(number, high)


def parse_date(value):
    if not isinstance(value, str) or not DATE_RE.match(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def valid_id(value):
    return isinstance(value, str) and bool(ID_RE.match(value))


def clean_profile(data):
    """Return only the profile fields that are present and valid."""
    if not isinstance(data, dict):
        raise ApiError("Invalid profile.")
    out = {}
    if "name" in data:
        out["name"] = _text(data["name"], 30)
    if data.get("theme") in THEMES:
        out["theme"] = data["theme"]
    if data.get("week") in WEEKS:
        out["week"] = data["week"]
    for key in ("inapp", "chime", "remind"):
        if key in data:
            out[key] = _flag(data[key])
    if "dismiss" in data:
        dismiss = data["dismiss"]
        clean = {}
        if isinstance(dismiss, dict):
            for key, value in list(dismiss.items())[:MAX_HABITS]:
                if valid_id(key) and parse_date(value):
                    clean[key] = value
        out["dismiss"] = clean
    return out


def clean_habit(data):
    if not isinstance(data, dict):
        raise ApiError("Invalid habit.")
    cid = data.get("id")
    if not valid_id(cid):
        raise ApiError("Invalid habit id.")
    name = _text(data.get("name"), 40)
    if not name:
        raise ApiError("A habit needs a name.")

    type_value = data.get("type")
    kind = type_value if isinstance(type_value, str) and type_value in TYPES else "check"
    goal = _int(data.get("goal"), 1, 100000, 1)
    if kind == "check":
        goal = 1

    freq = data.get("freq") if data.get("freq") in FREQS else "daily"
    days = data.get("days")
    if isinstance(days, list):
        days = sorted(
            {d for d in days if isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6}
        )
    else:
        days = []
    if not days:
        days = [0, 1, 2, 3, 4] if freq == "days" else [0, 1, 2, 3, 4, 5, 6]

    wk = _int(data.get("wk"), 1, 10**6, 3)
    if wk > 7:  # out of range falls back to the default, as the browser does
        wk = 3

    remind = data.get("remind")
    remind = remind if isinstance(remind, str) and TIME_RE.match(remind) else ""

    return {
        "cid": cid,
        "name": name,
        "icon": data.get("icon") if data.get("icon") in ICONS else "bolt",
        "type": kind,
        "goal": goal,
        "unit": _text(data.get("unit"), 20) if kind in ("count", "duration") else "",
        "increment": (
            1 if kind != "count"
            else _int(data.get("increment"), 1, 100000, 1) if "increment" in data
            else None
        ),
        "freq": freq,
        "days": days,
        "wk": wk,
        "remind": remind,
        "start": parse_date(data.get("start")) or date.today(),
        "archived": _flag(data.get("archived")),
        "demo": _flag(data.get("demo")),
    }


def clean_entry(data):
    """Validate the v / g / note part of a day record.

    Returns validated progress and optional timer data. Count values are not
    capped at the target, so exceeding a goal remains recorded.
    """
    if not isinstance(data, dict):
        raise ApiError("Invalid check-in.")
    value = data.get("v")
    if isinstance(value, bool):
        raise ApiError("Invalid check-in value.")
    try:
        v = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ApiError("Invalid check-in value.")
    if not math.isfinite(v) or v < 0 or v > 1e6:
        raise ApiError("Invalid check-in value.")
    g = _int(data.get("g"), 1, 100000, 1)
    duration_seconds = None
    if "duration_seconds" in data:
        raw_duration = data["duration_seconds"]
        if isinstance(raw_duration, bool):
            raise ApiError("Invalid tracked duration.")
        try:
            numeric_duration = float(raw_duration)
        except (TypeError, ValueError, OverflowError):
            raise ApiError("Invalid tracked duration.")
        if not math.isfinite(numeric_duration) or not numeric_duration.is_integer():
            raise ApiError("Invalid tracked duration.")
        duration_seconds = int(numeric_duration)
        if duration_seconds < 0 or duration_seconds > 100000000:
            raise ApiError("Invalid tracked duration.")
    clean_sessions = None
    if "timer_sessions" in data:
        sessions = data["timer_sessions"]
        if not isinstance(sessions, list) or len(sessions) > 1000:
            raise ApiError("Invalid timer sessions.")
        clean_sessions = []
        for session in sessions:
            if isinstance(session, bool):
                raise ApiError("Invalid timer session.")
            try:
                numeric_seconds = float(session)
            except (TypeError, ValueError, OverflowError):
                raise ApiError("Invalid timer session.")
            if not math.isfinite(numeric_seconds) or not numeric_seconds.is_integer():
                raise ApiError("Invalid timer session.")
            seconds = int(numeric_seconds)
            if seconds < 0 or seconds > 100000000:
                raise ApiError("Invalid timer session.")
            clean_sessions.append(seconds)
        if sum(clean_sessions) > 100000000:
            raise ApiError("Total tracked duration is too large.")
    return v, g, _text(data.get("note"), 200), duration_seconds, clean_sessions


def _log_row(habit_id, day, entry):
    """Build a clean log row, or a delete row when the entry is empty."""
    parsed = parse_date(day)
    if parsed is None:
        raise ApiError("Invalid date in check-ins.")
    if not valid_id(habit_id):
        raise ApiError("Invalid habit id in check-ins.")
    if isinstance(entry, dict) and entry.get("delete") is True:
        return {"habit": habit_id, "date": parsed, "delete": True}
    v, g, note, duration_seconds, timer_sessions = clean_entry(entry)
    if v <= 0 and not note and not duration_seconds and not timer_sessions:
        return {"habit": habit_id, "date": parsed, "delete": True}
    row = {
        "habit": habit_id,
        "date": parsed,
        "delete": False,
        "v": v,
        "g": g,
        "note": note,
    }
    if duration_seconds is not None:
        row["duration_seconds"] = duration_seconds
    if timer_sessions is not None:
        row["timer_sessions"] = timer_sessions
    return row


def _list(value, label, limit):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError(f"{label} must be a list.")
    if len(value) > limit:
        raise ApiError(f"Too many {label}.", 413)
    return value


def clean_sync(payload):
    """Clean a partial update: changed habits, deleted ids, changed check-ins."""
    if not isinstance(payload, dict):
        raise ApiError("Expected a JSON object.")
    habits = [clean_habit(h) for h in _list(payload.get("habits"), "habits", MAX_HABITS)]
    seen = set()
    for h in habits:
        if h["cid"] in seen:
            raise ApiError("Duplicate habit id.")
        seen.add(h["cid"])

    deleted = []
    for cid in _list(payload.get("deleted"), "deleted habits", MAX_DELETED):
        if not valid_id(cid):
            raise ApiError("Invalid habit id.")
        deleted.append(cid)

    rows = {}
    for item in _list(payload.get("logs"), "check-ins", MAX_LOGS):
        if not isinstance(item, dict):
            raise ApiError("Invalid check-in.")
        row = _log_row(item.get("habit"), item.get("date"), item)
        rows[(row["habit"], row["date"])] = row  # last one wins

    profile = clean_profile(payload["profile"]) if payload.get("profile") is not None else {}
    return {"profile": profile, "habits": habits, "deleted": deleted, "logs": list(rows.values())}


def clean_replace(payload):
    """Clean a full state (import / restore): profile, habits and logs by habit."""
    if not isinstance(payload, dict):
        raise ApiError("Expected a JSON object.")
    habits_in = _list(payload.get("habits"), "habits", MAX_HABITS)
    habits = [clean_habit(h) for h in habits_in]
    ids = set()
    for h in habits:
        if h["cid"] in ids:
            raise ApiError("Duplicate habit id.")
        ids.add(h["cid"])

    logs_in = payload.get("logs") or {}
    if not isinstance(logs_in, dict):
        raise ApiError("Check-ins must be an object.")
    rows = []
    for cid, by_day in logs_in.items():
        if cid not in ids:
            continue
        if not isinstance(by_day, dict):
            raise ApiError("Invalid check-ins.")
        for day, entry in by_day.items():
            row = _log_row(cid, day, entry)
            if not row["delete"]:
                rows.append(row)
            if len(rows) > MAX_LOGS:
                raise ApiError("Too many check-ins.", 413)

    profile = clean_profile(payload["profile"]) if payload.get("profile") is not None else {}
    return {"profile": profile, "habits": habits, "deleted": [], "logs": rows}


def clean_credentials(data):
    """Validate a username/password pair for sign-up or sign-in."""
    if not isinstance(data, dict):
        raise ApiError("Expected a JSON object.")
    username = data.get("username")
    password = data.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        raise ApiError("Enter a username and a password.")
    return username.strip(), password


USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")


def check_username(username):
    if not USERNAME_RE.match(username):
        raise ApiError("Usernames are 3 to 30 characters: letters, numbers, dot, dash or underscore.")
    return username
