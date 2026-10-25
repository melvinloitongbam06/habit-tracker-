from django.contrib import admin
from django import forms
from django.core.exceptions import ValidationError
from django.utils import timezone

from .models import ExperienceAward, Habit, HabitLog, Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "name", "theme", "week", "xp_initialized")


@admin.register(ExperienceAward)
class ExperienceAwardAdmin(admin.ModelAdmin):
    list_display = ("user", "kind", "points", "reason", "period_start", "created_at")
    list_filter = ("kind", "created_at")
    search_fields = ("user__username", "reason", "key")
    readonly_fields = ("user", "key", "kind", "points", "reason", "period_start", "period_end", "created_at")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Habit)
class HabitAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "type", "freq", "archived", "start")
    list_filter = ("type", "freq", "archived")
    search_fields = ("name", "user__username")

    def has_delete_permission(self, request, obj=None):
        if obj is None:
            return False
        return super().has_delete_permission(request, obj) and not obj.logs.exclude(
            date=timezone.localdate()
        ).exists()


class HabitLogAdminForm(forms.ModelForm):
    class Meta:
        model = HabitLog
        fields = "__all__"

    def clean_date(self):
        day = self.cleaned_data["date"]
        if day != timezone.localdate():
            raise ValidationError("Only today's habit records can be changed.")
        return day


@admin.register(HabitLog)
class HabitLogAdmin(admin.ModelAdmin):
    form = HabitLogAdminForm
    actions = None
    list_display = ("habit", "date", "v", "g")
    list_filter = ("date",)

    def has_change_permission(self, request, obj=None):
        if obj is not None and obj.date != timezone.localdate():
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.date != timezone.localdate():
            return False
        return super().has_delete_permission(request, obj)
