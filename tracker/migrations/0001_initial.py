# Initial schema retained from the original tracker so existing databases can
# mark this migration as applied and receive the additive feature migration.
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Profile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(blank=True, max_length=30)),
                ("theme", models.CharField(default="auto", max_length=5)),
                ("week", models.CharField(default="mon", max_length=3)),
                ("inapp", models.BooleanField(default=True)),
                ("chime", models.BooleanField(default=False)),
                ("remind", models.BooleanField(default=False)),
                ("dismiss", models.JSONField(blank=True, default=dict)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="habit_profile", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="Habit",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("cid", models.CharField(max_length=40)),
                ("name", models.CharField(max_length=40)),
                ("icon", models.CharField(default="bolt", max_length=20)),
                ("type", models.CharField(choices=[("check", "Simple check"), ("count", "Count toward a goal")], default="check", max_length=5)),
                ("goal", models.PositiveIntegerField(default=1)),
                ("unit", models.CharField(blank=True, max_length=20)),
                ("freq", models.CharField(choices=[("daily", "Every day"), ("days", "Selected days"), ("weekly", "Weekly goal")], default="daily", max_length=6)),
                ("days", models.JSONField(default=list)),
                ("wk", models.PositiveSmallIntegerField(default=3)),
                ("remind", models.CharField(blank=True, max_length=5)),
                ("start", models.DateField()),
                ("archived", models.BooleanField(default=False)),
                ("demo", models.BooleanField(default=False)),
                ("created", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="habits", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["pk"],
                "constraints": [
                    models.UniqueConstraint(fields=("user", "cid"), name="unique_habit_cid_per_user"),
                ],
            },
        ),
        migrations.CreateModel(
            name="HabitLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("v", models.FloatField(default=0)),
                ("g", models.PositiveIntegerField(default=1)),
                ("note", models.CharField(blank=True, max_length=200)),
                ("habit", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="logs", to="tracker.habit")),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("habit", "date"), name="unique_log_per_day"),
                ],
                "indexes": [
                    models.Index(fields=["habit", "date"], name="tracker_hab_habit_i_4ce86f_idx"),
                ],
            },
        ),
    ]
