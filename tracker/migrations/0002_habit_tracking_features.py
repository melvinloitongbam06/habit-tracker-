# Add duration and configurable count tracking fields.

from django.db import migrations, models


def preserve_legacy_count_increments(apps, schema_editor):
    Habit = apps.get_model("tracker", "Habit")
    for habit in Habit.objects.filter(type="count").only("pk", "goal").iterator():
        increment = 10 if habit.goal >= 100 else 5 if habit.goal >= 20 else 1
        Habit.objects.filter(pk=habit.pk).update(increment=increment)


class Migration(migrations.Migration):

    dependencies = [
        ('tracker', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='habit',
            name='increment',
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='habitlog',
            name='duration_seconds',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='habitlog',
            name='timer_sessions',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='habitlog',
            name='timer_started_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(preserve_legacy_count_increments, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='habit',
            name='freq',
            field=models.CharField(choices=[('daily', 'Every day'), ('days', 'Selected days'), ('weekly', 'Weekly goal')], default='daily', max_length=6),
        ),
        migrations.AlterField(
            model_name='habit',
            name='type',
            field=models.CharField(choices=[('check', 'Simple check'), ('count', 'Count toward a goal'), ('duration', 'Track time')], default='check', max_length=8),
        ),
        migrations.AddConstraint(
            model_name='habitlog',
            constraint=models.UniqueConstraint(condition=models.Q(('timer_started_at__isnull', False)), fields=('habit',), name='one_active_timer_per_habit'),
        ),
    ]
