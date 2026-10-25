"""Server-authoritative, idempotent experience rewards."""
from datetime import timedelta

from django.db.models import Q, Sum
from django.utils import timezone

from .models import ExperienceAward, Habit, HabitLog, Profile

WEEK_XP_LOOKBACK_LIMIT = 100
ACTIVITY_XP = 10
PERFECT_WEEK_XP = 25
WEEK_STREAK_XP = 10
MAX_WEEK_STREAK_BONUS = 50


def activity_completed(log, now=None):
    goal = log.g or log.habit.goal
    if log.habit.type == "duration":
        seconds = log.duration_seconds
        if log.timer_started_at:
            seconds += max(0, int(((now or timezone.now()) - log.timer_started_at).total_seconds()))
        return seconds >= goal * 60
    return log.v >= goal


def game_week_start(day, week):
    offset = (day.weekday() + 1) % 7 if week == "sun" else day.weekday()
    return day - timedelta(days=offset)


def closed_week_start(day, week):
    start = game_week_start(day, week)
    return start if start + timedelta(days=6) <= day else start - timedelta(days=7)


def level_progress(total):
    level, start, step = 1, 0, 100
    while total >= start + step:
        start += step
        level += 1
        step += 25
    if level >= 20:
        rank = "Legend"
    elif level >= 10:
        rank = "Habit Hero"
    elif level >= 6:
        rank = "Wayfinder"
    elif level >= 3:
        rank = "Apprentice"
    else:
        rank = "Novice"
    return {
        "level": level,
        "rank": rank,
        "xp_in_level": total - start,
        "xp_to_next": step,
        "next_level_xp": start + step,
    }


def _award_for_log(user, log, now):
    if not activity_completed(log, now):
        return None
    return ExperienceAward(
        user=user,
        key=f"a:{log.habit.cid}:{log.date.isoformat()}",
        kind="activity",
        points=ACTIVITY_XP,
        reason=f"Completed {log.habit.name}",
        period_start=log.date,
        period_end=log.date,
    )


def _week_status(habits, logs, start, end, now):
    relevant = False
    by_habit_day = {(log.habit_id, log.date): log for log in logs}
    for habit in habits:
        if habit.start > end:
            continue
        if habit.freq == "weekly":
            relevant = True
            count = sum(
                1
                for day in (start + timedelta(days=i) for i in range(7))
                if day >= habit.start
                and (log := by_habit_day.get((habit.pk, day))) is not None
                and activity_completed(log, now)
            )
            if count < habit.wk:
                return False, relevant
            continue

        scheduled = [
            start + timedelta(days=i)
            for i in range(7)
            if start + timedelta(days=i) >= habit.start
            and (
                habit.freq == "daily"
                or (habit.freq == "days" and (start + timedelta(days=i)).weekday() in habit.days)
            )
        ]
        if not scheduled:
            continue
        relevant = True
        if any(
            (log := by_habit_day.get((habit.pk, day))) is None
            or not activity_completed(log, now)
            for day in scheduled
        ):
            return False, relevant
    return relevant, relevant


def _weekly_award(user, start, streak, existing_periods=None):
    end = start + timedelta(days=6)
    if existing_periods is None:
        overlapping = ExperienceAward.objects.filter(
            user=user,
            kind="weekly",
            period_start__lte=end,
            period_end__gte=start,
        ).exists()
    else:
        overlapping = any(old_start <= end and old_end >= start for old_start, old_end in existing_periods)
    if overlapping:
        return None
    points = PERFECT_WEEK_XP + min(streak * WEEK_STREAK_XP, MAX_WEEK_STREAK_BONUS)
    return ExperienceAward(
        user=user,
        key=f"w:{start.isoformat()}",
        kind="weekly",
        points=points,
        reason="Perfect week consistency bonus",
        period_start=start,
        period_end=end,
    )


def _backfill_weekly_awards(user, profile, habits, logs, now):
    completed_days = [
        log.date for log in logs
        if activity_completed(log, now)
    ]
    if not completed_days:
        return
    start = game_week_start(min(completed_days), profile.week)
    last_start = closed_week_start(timezone.localdate(now), profile.week)
    streak = 0
    awards = []
    existing_periods = list(
        ExperienceAward.objects.filter(user=user, kind="weekly")
        .values_list("period_start", "period_end")
    )
    logs_by_week = {}
    for log in logs:
        week = game_week_start(log.date, profile.week)
        if start <= week <= last_start:
            logs_by_week.setdefault(week, []).append(log)
    while start <= last_start:
        end = start + timedelta(days=6)
        perfect, relevant = _week_status(habits, logs_by_week.get(start, []), start, end, now)
        if perfect:
            award = _weekly_award(user, start, streak, existing_periods)
            if award:
                awards.append(award)
                existing_periods.append((start, end))
            streak += 1
        elif relevant:
            streak = 0
        start += timedelta(days=7)
    if awards:
        ExperienceAward.objects.bulk_create(awards, ignore_conflicts=True, batch_size=500)


def refresh_experience(user, changed_logs=(), now=None):
    """Grant missing awards for saved logs; repeated calls never duplicate rewards."""
    now = now or timezone.now()
    profile = Profile.objects.get_or_create(user=user)[0]
    habits = list(Habit.objects.filter(user=user, archived=False).order_by("pk"))

    if not profile.xp_initialized:
        logs = list(
            HabitLog.objects.filter(habit__user=user).select_related("habit").order_by("date", "pk")
        )
        awards = [
            award for log in logs
            if (award := _award_for_log(user, log, now)) is not None
        ]
        if awards:
            ExperienceAward.objects.bulk_create(awards, ignore_conflicts=True, batch_size=500)
        _backfill_weekly_awards(user, profile, habits, logs, now)
        profile.xp_initialized = True
        profile.save(update_fields=["xp_initialized"])
    else:
        pairs = set(changed_logs)
        if pairs:
            changes = Q()
            for cid, day in pairs:
                changes |= Q(habit__cid=cid, date=day)
            logs = HabitLog.objects.filter(habit__user=user).filter(changes).select_related("habit")
            awards = [
                award for log in logs
                if (award := _award_for_log(user, log, now)) is not None
            ]
            if awards:
                ExperienceAward.objects.bulk_create(awards, ignore_conflicts=True, batch_size=500)

        active_timers = HabitLog.objects.filter(
            habit__user=user, timer_started_at__isnull=False
        ).select_related("habit")
        timer_awards = [
            award for log in active_timers
            if (award := _award_for_log(user, log, now)) is not None
        ]
        if timer_awards:
            ExperienceAward.objects.bulk_create(timer_awards, ignore_conflicts=True, batch_size=500)

        _award_latest_perfect_week(user, profile, habits, now)


def _award_latest_perfect_week(user, profile, habits, now):
    today = timezone.localdate(now)
    start = closed_week_start(today, profile.week)
    end = start + timedelta(days=6)
    logs = list(
        HabitLog.objects.filter(
            habit__user=user, date__gte=start, date__lte=end
        ).select_related("habit")
    )
    perfect, relevant = _week_status(habits, logs, start, end, now)
    if not perfect or not relevant:
        return

    streak = 0
    previous = start - timedelta(days=7)
    while streak < MAX_WEEK_STREAK_BONUS // WEEK_STREAK_XP:
        prior = ExperienceAward.objects.filter(
            user=user,
            kind="weekly",
            period_start=previous,
            period_end=previous + timedelta(days=6),
        ).exists()
        if not prior:
            break
        streak += 1
        previous -= timedelta(days=7)
    award = _weekly_award(user, start, streak)
    if award:
        ExperienceAward.objects.bulk_create([award], ignore_conflicts=True)


def experience_json(user):
    total = ExperienceAward.objects.filter(user=user).aggregate(total=Sum("points"))["total"] or 0
    progress = level_progress(total)
    profile = Profile.objects.get_or_create(user=user)[0]
    today = timezone.localdate()
    start = game_week_start(today, profile.week)
    end = start + timedelta(days=6)
    habits = list(Habit.objects.filter(user=user, archived=False).order_by("pk"))
    logs = list(
        HabitLog.objects.filter(
            habit__user=user, date__gte=start, date__lte=min(today, end)
        ).select_related("habit")
    )
    by_habit = {}
    for log in logs:
        if activity_completed(log):
            by_habit.setdefault(log.habit_id, set()).add(log.date)

    done = target = 0
    for habit in habits:
        if habit.start > min(today, end):
            continue
        completed_days = by_habit.get(habit.pk, set())
        if habit.freq == "weekly":
            target += habit.wk
            done += min(
                habit.wk,
                sum(habit.start <= day <= min(today, end) for day in completed_days),
            )
        else:
            scheduled = [
                start + timedelta(days=i)
                for i in range(7)
                if start + timedelta(days=i) >= habit.start
                and start + timedelta(days=i) <= today
                and (
                    habit.freq == "daily"
                    or (
                        habit.freq == "days"
                        and (start + timedelta(days=i)).weekday() in habit.days
                    )
                )
            ]
            target += len(scheduled)
            done += sum(day in completed_days for day in scheduled)

    last_start = closed_week_start(today, profile.week)
    awards_by_start = dict(
        ExperienceAward.objects.filter(
            user=user,
            kind="weekly",
            period_start__lte=last_start,
        ).order_by("-period_start").values_list("period_start", "points")[:WEEK_XP_LOOKBACK_LIMIT]
    )
    streak = 0
    while streak < WEEK_XP_LOOKBACK_LIMIT and last_start in awards_by_start:
        streak += 1
        last_start -= timedelta(days=7)

    return {
        "total": total,
        **progress,
        "weekly": {
            "done": done,
            "target": target,
            "streak": streak,
            "next_bonus": PERFECT_WEEK_XP + min(streak * WEEK_STREAK_XP, MAX_WEEK_STREAK_BONUS),
        },
    }


def experience_total(user):
    return ExperienceAward.objects.filter(user=user).aggregate(total=Sum("points"))["total"] or 0
