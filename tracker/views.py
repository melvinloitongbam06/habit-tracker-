"""Views: the single-page shell plus a small JSON API.

API overview (all JSON, session cookie auth, CSRF header on unsafe methods):

    GET  /api/auth/me/        -> {authenticated, username}
    POST /api/auth/register/  {username, password}
    POST /api/auth/login/     {username, password}
    POST /api/auth/logout/
    GET  /api/state/          -> the signed-in user's profile, habits and check-ins
    PUT  /api/state/          replace everything (import / restore a backup)
    POST /api/sync/           apply a batch of changes atomically
"""
import hashlib
import json
import secrets
from datetime import datetime, time, timedelta
from functools import wraps

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import RequestDataTooBig, ValidationError
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from . import validators as v
from .gamification import experience_json, experience_total, refresh_experience
from .models import (
    Habit, HabitLog, HealthConnectDailySteps, HealthConnectDevice,
    HealthConnectPairingCode, Profile,
)

User = get_user_model()

LOGIN_ATTEMPTS = 10
LOGIN_WINDOW = 15 * 60  # seconds
CHUNK = 500  # keep SQL "IN (...)" lists small
HEALTH_PAIR_WINDOW = 15 * 60
HEALTH_PAIR_ATTEMPTS = 10
HEALTH_PAIR_EXPIRY = 10 * 60


# ---------- helpers ----------

def fail(message, status=400):
    return JsonResponse({"error": message}, status=status)


def api(methods, auth=True):
    """JSON endpoint wrapper: method check, sign-in check, uniform errors, no caching."""

    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            if auth and not request.user.is_authenticated:
                return fail("Sign in required.", 401)
            try:
                return view(request, *args, **kwargs)
            except v.ApiError as exc:
                return fail(str(exc), exc.status)

        return never_cache(require_http_methods(methods)(wrapper))

    return decorator


def read_json(request):
    if request.content_type != "application/json":
        raise v.ApiError("Send JSON.", 415)
    try:
        text = request.body.decode("utf-8")
    except RequestDataTooBig:
        raise v.ApiError("That request is too large.", 413)
    except UnicodeDecodeError:
        raise v.ApiError("Invalid text encoding.")
    try:
        data = json.loads(text or "null")
    except ValueError:
        raise v.ApiError("Invalid JSON.")
    if not isinstance(data, dict):
        raise v.ApiError("Expected a JSON object.")
    return data


def chunks(items, size=CHUNK):
    items = list(items)
    for i in range(0, len(items), size):
        yield items[i : i + size]


def get_profile(user):
    return Profile.objects.get_or_create(user=user)[0]


def number(x):
    return int(x) if float(x).is_integer() else x


def digest_secret(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def health_local_date(day_text, zone_name, offset_text):
    if (
        not isinstance(day_text, str)
        or not isinstance(zone_name, str)
        or not zone_name.strip()
        or len(zone_name) > 64
        or isinstance(offset_text, bool)
    ):
        raise v.ApiError("A valid local date and time zone are required.")
    try:
        day = datetime.strptime(day_text, "%Y-%m-%d").date()
        offset = int(offset_text)
    except (TypeError, ValueError):
        raise v.ApiError("A valid local date and time zone are required.")
    if (
        day.isoformat() != day_text
        or not -720 <= offset <= 840
        or day != (timezone.now() + timedelta(minutes=offset)).date()
    ):
        raise v.ApiError("Only today's Health Connect steps can be synced.", 403)
    return day, zone_name


def health_device(request):
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > 200:
        raise v.ApiError("Valid device authorization is required.", 401)
    device = HealthConnectDevice.objects.filter(
        token_digest=digest_secret(token), revoked_at__isnull=True
    ).first()
    if device is None:
        raise v.ApiError("This device is disconnected. Pair it again.", 401)
    return device


def limit_health_pair_attempts(request):
    address = request.META.get("REMOTE_ADDR", "")
    key = "health-pair:" + digest_secret(address or "unknown")
    attempts = cache.get(key, 0)
    if attempts >= HEALTH_PAIR_ATTEMPTS:
        raise v.ApiError("Too many pairing attempts. Try again later.", 429)
    cache.set(key, attempts + 1, HEALTH_PAIR_WINDOW)


def server_today():
    return timezone.localdate()


def require_today(day):
    if day != server_today():
        raise v.ApiError("Only today's habit records can be changed.", 403)


def close_expired_timers(user, now=None):
    """Close yesterday's running sessions at that day's local midnight."""
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    today = local_now.date()
    midnight = timezone.make_aware(
        datetime.combine(today, time.min), timezone.get_current_timezone()
    )
    closed = []
    with transaction.atomic():
        expired = HabitLog.objects.filter(
            habit__user=user,
            timer_started_at__lt=midnight,
        ).select_related("habit").select_for_update()
        for log in expired:
            started = timezone.localtime(log.timer_started_at)
            day_end = timezone.make_aware(
                datetime.combine(started.date() + timedelta(days=1), time.min),
                timezone.get_current_timezone(),
            )
            seconds = max(0, int((day_end - log.timer_started_at).total_seconds()))
            log.duration_seconds += seconds
            if seconds:
                log.timer_sessions = [*log.timer_sessions, seconds]
            log.timer_started_at = None
            log.save(update_fields=["duration_seconds", "timer_sessions", "timer_started_at"])
            closed.append((log.habit.cid, log.date))
    return closed


def ensure_sync_mutations_are_current(user, clean, allow_preserved_history=False):
    today = server_today()
    if not allow_preserved_history:
        for row in clean["logs"]:
            if row["date"] != today:
                raise v.ApiError("Only today's habit records can be changed.", 403)

    if clean["deleted"]:
        has_history = HabitLog.objects.filter(
            habit__user=user,
            habit__cid__in=clean["deleted"],
        ).exclude(date=today).exists()
        if has_history:
            raise v.ApiError("Archive this habit instead; its historical records are read-only.", 403)

    existing = {
        habit.cid: habit
        for habit in Habit.objects.filter(user=user, cid__in=[h["cid"] for h in clean["habits"]])
    }
    for data in clean["habits"]:
        habit = existing.get(data["cid"])
        if habit and data["type"] != habit.type:
            raise v.ApiError("A habit's tracking type cannot be changed after creation.", 403)


def ensure_replace_preserves_history(user, clean):
    today = server_today()
    habits = {habit["cid"] for habit in clean["habits"]}
    incoming = {(row["habit"], row["date"]): row for row in clean["logs"]}
    old_logs = HabitLog.objects.filter(habit__user=user).exclude(date=today).select_related("habit")
    for log in old_logs:
        key = (log.habit.cid, log.date)
        row = incoming.get(key)
        if log.habit.cid not in habits or row is None or row["delete"]:
            raise v.ApiError("Restore would remove historical records, which are read-only.", 403)
        if (
            row["v"] != log.v
            or row["g"] != log.g
            or row["note"] != log.note
            or ("duration_seconds" in row and row["duration_seconds"] != log.duration_seconds)
            or ("timer_sessions" in row and row["timer_sessions"] != log.timer_sessions)
        ):
            raise v.ApiError("Historical habit records are read-only.", 403)

    for row in clean["logs"]:
        if row["date"] == today:
            continue
        if row["delete"]:
            continue
        log = HabitLog.objects.filter(
            habit__user=user, habit__cid=row["habit"], date=row["date"]
        ).first()
        if log is None:
            raise v.ApiError("Only today's habit records can be added.", 403)


def state_json(user):
    closed_timers = close_expired_timers(user)
    refresh_experience(user, closed_timers)
    profile = get_profile(user)
    habits = list(Habit.objects.filter(user=user).order_by("pk"))
    logs = {h.cid: {} for h in habits}
    rows = HabitLog.objects.filter(habit__user=user).values_list(
        "habit__cid", "date", "v", "g", "note", "duration_seconds",
        "timer_sessions", "timer_started_at"
    )
    for cid, day, value, goal, note, duration_seconds, timer_sessions, timer_started_at in rows:
        entry = {"v": number(value), "g": goal}
        if note:
            entry["note"] = note
        if duration_seconds or timer_sessions or timer_started_at:
            entry["duration_seconds"] = duration_seconds
            entry["timer_sessions"] = timer_sessions
        if timer_started_at:
            entry["timer_started_at"] = timer_started_at.isoformat()
        logs[cid][day.isoformat()] = entry
    return {
        "today": server_today().isoformat(),
        "user": {"username": user.get_username()},
        "xp": experience_json(user),
        "profile": {
            "name": profile.name,
            "theme": profile.theme,
            "week": profile.week,
            "inapp": profile.inapp,
            "chime": profile.chime,
            "remind": profile.remind,
            "dismiss": profile.dismiss or {},
        },
        "habits": [
            {
                "id": h.cid,
                "name": h.name,
                "icon": h.icon,
                "type": h.type,
                "goal": h.goal,
                "unit": h.unit,
                "increment": h.increment,
                "freq": h.freq,
                "days": h.days,
                "wk": h.wk,
                "remind": h.remind,
                "start": h.start.isoformat(),
                "archived": h.archived,
                "demo": h.demo,
            }
            for h in habits
        ],
        "logs": logs,
    }


HABIT_FIELDS = (
    "name", "icon", "type", "goal", "unit", "increment", "freq", "days", "wk",
    "remind", "start", "archived", "demo",
)  # fmt: skip


def apply_changes(user, clean, changed_logs=()):
    """Apply cleaned changes. Call inside transaction.atomic()."""
    changed_logs = list(changed_logs)
    if clean["profile"]:
        profile = get_profile(user)
        for key, value in clean["profile"].items():
            setattr(profile, key, value)
        profile.save()

    if clean["deleted"]:
        for part in chunks(clean["deleted"]):
            Habit.objects.filter(user=user, cid__in=part).delete()

    existing = {h.cid: h for h in Habit.objects.filter(user=user)}
    for data in clean["habits"]:
        fields = {
            key: data[key] for key in HABIT_FIELDS
            if key != "increment" or data.get("increment") is not None
        }
        habit = existing.get(data["cid"])
        if habit is None:
            if "increment" not in fields:
                goal = data["goal"]
                fields["increment"] = 10 if goal >= 100 else 5 if goal >= 20 else 1
            existing[data["cid"]] = Habit.objects.create(user=user, cid=data["cid"], **fields)
        else:
            for key, value in fields.items():
                setattr(habit, key, value)
            habit.save()
    if len(existing) > v.MAX_HABITS:
        raise v.ApiError("That's more habits than this app supports.", 413)

    by_habit = {}
    for row in clean["logs"]:
        habit = existing.get(row["habit"])
        if habit is not None:  # check-ins for unknown or deleted habits are ignored
            by_habit.setdefault(habit, []).append(row)

    for habit, rows in by_habit.items():
        current = {}
        for part in chunks(row["date"] for row in rows):
            for log in HabitLog.objects.filter(habit=habit, date__in=part):
                current[log.date] = log
        create, update, remove = [], [], []
        for row in rows:
            log = current.get(row["date"])
            if row["delete"]:
                if log is not None:
                    remove.append(log.pk)
            elif log is None:
                changed_logs.append((habit.cid, row["date"]))
                create.append(
                    HabitLog(
                        habit=habit,
                        date=row["date"],
                        v=min(row["v"], 1) if habit.type == "check" else row["v"],
                        g=1 if habit.type == "check" else row["g"],
                        note=row["note"],
                        duration_seconds=row.get("duration_seconds") or 0,
                        timer_sessions=row.get("timer_sessions") or [],
                    )
                )
            else:
                changed_logs.append((habit.cid, row["date"]))
                log.v = min(row["v"], 1) if habit.type == "check" else row["v"]
                log.g = 1 if habit.type == "check" else row["g"]
                log.note = row["note"]
                if "duration_seconds" in row:
                    log.duration_seconds = row["duration_seconds"]
                if "timer_sessions" in row:
                    log.timer_sessions = row["timer_sessions"]
                update.append(log)
        if create:
            HabitLog.objects.bulk_create(create, batch_size=CHUNK)
        if update:
            HabitLog.objects.bulk_update(
                update, ["v", "g", "note", "duration_seconds", "timer_sessions"], batch_size=CHUNK
            )
        for part in chunks(remove):
            HabitLog.objects.filter(pk__in=part).delete()
    refresh_experience(user, changed_logs)


# ---------- pages ----------

@ensure_csrf_cookie
def index(request):
    return render(request, "tracker/index.html")


@api(["GET"], auth=False)
def api_root(request):
    return JsonResponse({"ok": True})


# ---------- auth ----------

@api(["GET"], auth=False)
@ensure_csrf_cookie
def me(request):
    if request.user.is_authenticated:
        return JsonResponse({
            "authenticated": True,
            "username": request.user.get_username(),
            "today": server_today().isoformat(),
        })
    return JsonResponse({"authenticated": False, "today": server_today().isoformat()})


@api(["POST"], auth=False)
def register(request):
    username, password = v.clean_credentials(read_json(request))
    v.check_username(username)
    if User.objects.filter(username__iexact=username).exists():
        raise v.ApiError("That username is taken.", 409)
    candidate = User(username=username)
    try:
        validate_password(password, user=candidate)
    except ValidationError as exc:
        raise v.ApiError(" ".join(exc.messages))
    try:
        with transaction.atomic():
            user = User.objects.create_user(username=username, password=password)
            Profile.objects.create(user=user)
    except IntegrityError:
        raise v.ApiError("That username is taken.", 409)
    login(request, user)
    return JsonResponse({"authenticated": True, "username": user.get_username()}, status=201)


def throttle_key(request, username):
    raw = f"{request.META.get('REMOTE_ADDR', '?')}|{username.lower()}"
    return "login:" + hashlib.sha256(raw.encode()).hexdigest()


@api(["POST"], auth=False)
def login_view(request):
    username, password = v.clean_credentials(read_json(request))
    key = throttle_key(request, username)
    attempts = cache.get(key, 0)
    if attempts >= LOGIN_ATTEMPTS:
        raise v.ApiError("Too many attempts. Try again in a few minutes.", 429)
    user = authenticate(request, username=username, password=password)
    if user is None:
        cache.set(key, attempts + 1, LOGIN_WINDOW)
        raise v.ApiError("That username and password don't match.", 400)
    cache.delete(key)
    login(request, user)
    return JsonResponse({"authenticated": True, "username": user.get_username()})


@api(["POST"], auth=False)
def logout_view(request):
    logout(request)
    return JsonResponse({"authenticated": False})


# ---------- Health Connect (read-only steps import) ----------

@api(["POST"])
def health_connect_pairing(request):
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = "HTR-" + "-".join(
        "".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3)
    )
    HealthConnectPairingCode.objects.filter(user=request.user).delete()
    pairing = HealthConnectPairingCode.objects.create(
        user=request.user,
        code_digest=digest_secret(code),
        expires_at=timezone.now() + timedelta(seconds=HEALTH_PAIR_EXPIRY),
    )
    return JsonResponse({
        "code": code,
        "expires_at": pairing.expires_at.isoformat(),
        "expires_in": HEALTH_PAIR_EXPIRY,
    }, status=201)


@api(["GET"])
def health_connect_status(request):
    device = HealthConnectDevice.objects.filter(
        user=request.user, revoked_at__isnull=True
    ).first()
    result = {
        "connected": device is not None,
        "device_name": device.name if device else None,
        "last_synced_at": device.last_synced_at.isoformat() if device and device.last_synced_at else None,
        "steps": None,
        "date": None,
    }
    day_text = request.GET.get("date")
    if day_text:
        day, _ = health_local_date(
            day_text,
            request.GET.get("time_zone", ""),
            request.GET.get("utc_offset_minutes"),
        )
        steps = HealthConnectDailySteps.objects.filter(
            user=request.user, date=day
        ).first()
        if steps:
            result.update(steps=steps.steps, date=steps.date.isoformat())
    return JsonResponse(result)


@api(["POST"])
def health_connect_disconnect(request):
    now = timezone.now()
    HealthConnectDevice.objects.filter(
        user=request.user, revoked_at__isnull=True
    ).update(revoked_at=now)
    HealthConnectPairingCode.objects.filter(user=request.user).delete()
    HealthConnectDailySteps.objects.filter(user=request.user).delete()
    return JsonResponse({"connected": False})


@csrf_exempt
@api(["POST"], auth=False)
def health_connect_exchange(request):
    limit_health_pair_attempts(request)
    data = read_json(request)
    code = data.get("code")
    device_name = data.get("device_name", "Android device")
    if not isinstance(code, str) or len(code) > 20:
        raise v.ApiError("Enter a valid pairing code.")
    if not isinstance(device_name, str):
        raise v.ApiError("Invalid device name.")
    code = code.strip().upper()
    device_name = " ".join(device_name.split())[:80] or "Android device"
    now = timezone.now()
    with transaction.atomic():
        pairing = HealthConnectPairingCode.objects.select_for_update().filter(
            code_digest=digest_secret(code),
            used_at__isnull=True,
            expires_at__gt=now,
        ).first()
        if pairing is None:
            raise v.ApiError("That pairing code is invalid or expired.", 400)
        claimed = HealthConnectPairingCode.objects.filter(
            pk=pairing.pk, used_at__isnull=True, expires_at__gt=now
        ).update(used_at=now)
        if claimed != 1:
            raise v.ApiError("That pairing code is invalid or expired.", 400)
        HealthConnectDevice.objects.filter(
            user=pairing.user, revoked_at__isnull=True
        ).update(revoked_at=now)
        HealthConnectDailySteps.objects.filter(user=pairing.user).delete()
        token = secrets.token_urlsafe(32)
        HealthConnectDevice.objects.create(
            user=pairing.user,
            token_digest=digest_secret(token),
            name=device_name,
        )
    return JsonResponse({"token": token}, status=201)


@csrf_exempt
@api(["POST"], auth=False)
def health_connect_steps(request):
    device = health_device(request)
    data = read_json(request)
    steps = data.get("steps")
    if isinstance(steps, bool) or not isinstance(steps, int) or not 0 <= steps <= 1000000:
        raise v.ApiError("Steps must be a whole number from 0 to 1,000,000.")
    day, zone_name = health_local_date(
        data.get("date"), data.get("time_zone"), data.get("utc_offset_minutes")
    )
    HealthConnectDailySteps.objects.filter(user=device.user).exclude(date=day).delete()
    HealthConnectDailySteps.objects.update_or_create(
        user=device.user,
        date=day,
        defaults={"time_zone": zone_name, "steps": steps},
    )
    device.last_synced_at = timezone.now()
    device.save(update_fields=["last_synced_at"])
    return JsonResponse({"date": day.isoformat(), "steps": steps})


@csrf_exempt
@api(["POST"], auth=False)
def health_connect_revoke(request):
    device = health_device(request)
    device.revoked_at = timezone.now()
    device.save(update_fields=["revoked_at"])
    HealthConnectDailySteps.objects.filter(user=device.user).delete()
    HealthConnectPairingCode.objects.filter(user=device.user).delete()
    return JsonResponse({"connected": False})


# ---------- data ----------

@api(["GET", "PUT"])
def state(request):
    if request.method == "GET":
        return JsonResponse(state_json(request.user))
    clean = v.clean_replace(read_json(request))
    with transaction.atomic():
        closed_timers = close_expired_timers(request.user)
        if HabitLog.objects.filter(habit__user=request.user, timer_started_at__isnull=False).exists():
            raise v.ApiError("Stop the active timer before restoring a backup.", 409)
        ensure_replace_preserves_history(request.user, clean)
        incoming_ids = {habit["cid"] for habit in clean["habits"]}
        clean["deleted"] = list(
            Habit.objects.filter(user=request.user)
            .exclude(cid__in=incoming_ids)
            .values_list("cid", flat=True)
        )
        incoming_current = {
            (row["habit"], row["date"]) for row in clean["logs"] if row["date"] == server_today()
        }
        for log in HabitLog.objects.filter(habit__user=request.user, date=server_today()):
            if log.habit.cid not in incoming_ids:
                continue
            if (log.habit.cid, log.date) not in incoming_current:
                clean["logs"].append({
                    "habit": log.habit.cid, "date": log.date, "delete": True,
                })
        ensure_sync_mutations_are_current(request.user, clean, allow_preserved_history=True)
        apply_changes(request.user, clean, closed_timers)
    return JsonResponse(state_json(request.user))


@api(["POST"])
def sync(request):
    clean = v.clean_sync(read_json(request))
    previous_xp = experience_total(request.user)
    with transaction.atomic():
        closed_timers = close_expired_timers(request.user)
        ensure_sync_mutations_are_current(request.user, clean)
        apply_changes(request.user, clean, closed_timers)
    xp = experience_json(request.user)
    return JsonResponse({"ok": True, "xp": xp, "xp_gained": max(0, xp["total"] - previous_xp)})


@api(["GET"])
def experience(request):
    previous_xp = experience_total(request.user)
    closed_timers = close_expired_timers(request.user)
    refresh_experience(request.user, closed_timers)
    xp = experience_json(request.user)
    return JsonResponse({"xp": xp, "xp_gained": max(0, xp["total"] - previous_xp)})


@api(["POST"])
def timer(request):
    data = read_json(request)
    cid, action = data.get("habit"), data.get("action")
    day = v.parse_date(data.get("date"))
    if not v.valid_id(cid):
        raise v.ApiError("Invalid habit id.")
    if action not in ("start", "pause", "stop", "reset"):
        raise v.ApiError("Choose a valid timer action.")
    if day is None:
        raise v.ApiError("Invalid timer date.")
    require_today(day)

    try:
        with transaction.atomic():
            previous_xp = experience_total(request.user)
            closed_timers = close_expired_timers(request.user)
            require_today(day)
            habit = Habit.objects.filter(user=request.user, cid=cid).first()
            if habit is None:
                raise v.ApiError("Habit not found.", 404)
            if habit.type != "duration":
                raise v.ApiError("This habit does not track time.")
            log, _ = HabitLog.objects.select_for_update().get_or_create(
                habit=habit, date=day, defaults={"g": habit.goal}
            )
            now = timezone.now()
            if action == "start":
                active_elsewhere = HabitLog.objects.filter(
                    habit=habit, timer_started_at__isnull=False
                ).exclude(pk=log.pk).exists()
                if active_elsewhere:
                    raise v.ApiError("Stop the existing timer before starting another session.", 409)
                if log.timer_started_at is None:
                    log.timer_started_at = now
                    log.g = habit.goal
                    log.save(update_fields=["timer_started_at", "g"])
            elif action in ("pause", "stop"):
                if log.timer_started_at is not None:
                    elapsed = max(0, int((now - log.timer_started_at).total_seconds()))
                    log.duration_seconds += elapsed
                    if elapsed:
                        log.timer_sessions = [*log.timer_sessions, elapsed]
                    log.timer_started_at = None
                    log.g = habit.goal
                    log.save(
                        update_fields=["duration_seconds", "timer_sessions", "timer_started_at", "g"]
                    )
            else:
                log.duration_seconds = 0
                log.timer_sessions = []
                log.timer_started_at = None
                log.g = habit.goal
                log.save(
                    update_fields=["duration_seconds", "timer_sessions", "timer_started_at", "g"]
                )
            result = {
                "date": day.isoformat(),
                "v": number(log.v),
                "g": log.g,
                "note": log.note,
                "duration_seconds": log.duration_seconds,
                "timer_sessions": log.timer_sessions,
                "timer_started_at": (
                    log.timer_started_at.isoformat() if log.timer_started_at else None
                ),
            }
            refresh_experience(request.user, [*closed_timers, (cid, day)], now=now)
    except IntegrityError:
        return fail("A timer session is already active for this habit.", 409)
    xp = experience_json(request.user)
    result["xp"] = xp
    result["xp_gained"] = max(0, xp["total"] - previous_xp)
    return JsonResponse({"log": result})
