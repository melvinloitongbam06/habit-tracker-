from django.conf import settings
from django.db import models
from django.db.models import Q


class Profile(models.Model):
    """Per-user settings and small UI state."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="habit_profile"
    )
    name = models.CharField(max_length=30, blank=True)
    theme = models.CharField(max_length=5, default="auto")  # auto | light | dark
    week = models.CharField(max_length=3, default="mon")  # mon | sun
    inapp = models.BooleanField(default=True)  # pop-up reminders
    chime = models.BooleanField(default=False)
    remind = models.BooleanField(default=False)  # browser notifications
    dismiss = models.JSONField(default=dict, blank=True)  # {habit id: "YYYY-MM-DD"}
    xp_initialized = models.BooleanField(default=False)

    def __str__(self):
        return f"Profile of {self.user}"


class Habit(models.Model):
    """A habit. `cid` is the id the browser uses; it is unique per user only."""

    TYPES = [
        ("check", "Simple check"),
        ("count", "Count toward a goal"),
        ("duration", "Track time"),
    ]
    FREQS = [("daily", "Every day"), ("days", "Selected days"), ("weekly", "Weekly goal")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="habits"
    )
    cid = models.CharField(max_length=40)
    name = models.CharField(max_length=40)
    icon = models.CharField(max_length=20, default="bolt")
    type = models.CharField(max_length=8, choices=TYPES, default="check")
    goal = models.PositiveIntegerField(default=1)
    unit = models.CharField(max_length=20, blank=True)
    increment = models.PositiveIntegerField(default=1)
    freq = models.CharField(max_length=6, choices=FREQS, default="daily")
    days = models.JSONField(default=list)  # 0 = Monday ... 6 = Sunday
    wk = models.PositiveSmallIntegerField(default=3)  # times per week for weekly goals
    remind = models.CharField(max_length=5, blank=True)  # "HH:MM"
    start = models.DateField()
    archived = models.BooleanField(default=False)
    demo = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["pk"]
        constraints = [
            models.UniqueConstraint(fields=["user", "cid"], name="unique_habit_cid_per_user")
        ]

    def __str__(self):
        return f"{self.name} ({self.user})"


class HabitLog(models.Model):
    """Progress for one habit on one day. `g` is the goal that applied that day."""

    habit = models.ForeignKey(Habit, on_delete=models.CASCADE, related_name="logs")
    date = models.DateField()
    v = models.FloatField(default=0)
    g = models.PositiveIntegerField(default=1)
    note = models.CharField(max_length=200, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    timer_sessions = models.JSONField(default=list, blank=True)
    timer_started_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["habit", "date"], name="unique_log_per_day"),
            models.UniqueConstraint(
                fields=["habit"],
                condition=Q(timer_started_at__isnull=False),
                name="one_active_timer_per_habit",
            ),
        ]
        indexes = [models.Index(fields=["habit", "date"])]

    def __str__(self):
        return f"{self.habit.name} {self.date}: {self.v}/{self.g}"


class ExperienceAward(models.Model):
    """A permanent, idempotent XP reward for an activity or perfect week."""

    KINDS = [("activity", "Activity"), ("weekly", "Weekly consistency")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="experience_awards"
    )
    key = models.CharField(max_length=64)
    kind = models.CharField(max_length=12, choices=KINDS)
    points = models.PositiveIntegerField()
    reason = models.CharField(max_length=120)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]
        constraints = [
            models.UniqueConstraint(fields=["user", "key"], name="unique_xp_award_per_user_key")
        ]
        indexes = [models.Index(fields=["user", "kind", "period_start"])]

    def __str__(self):
        return f"{self.points} XP for {self.reason} ({self.user})"


class HealthConnectPairingCode(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="health_pairing_codes"
    )
    code_digest = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)


class HealthConnectDevice(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="health_devices"
    )
    token_digest = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=80, default="Android device")
    created_at = models.DateTimeField(auto_now_add=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)


class HealthConnectDailySteps(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="health_steps"
    )
    date = models.DateField()
    time_zone = models.CharField(max_length=64)
    steps = models.PositiveIntegerField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "date"], name="unique_health_steps_per_user_day")
        ]
