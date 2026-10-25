from django.urls import path

from . import views

app_name = "tracker"

urlpatterns = [
    path("", views.index, name="index"),
    path("api/", views.api_root, name="api-root"),
    path("api/auth/me/", views.me, name="me"),
    path("api/auth/register/", views.register, name="register"),
    path("api/auth/login/", views.login_view, name="login"),
    path("api/auth/logout/", views.logout_view, name="logout"),
    path("api/health-connect/pairing/", views.health_connect_pairing, name="health-connect-pairing"),
    path("api/health-connect/status/", views.health_connect_status, name="health-connect-status"),
    path("api/health-connect/disconnect/", views.health_connect_disconnect, name="health-connect-disconnect"),
    path("api/health-connect/exchange/", views.health_connect_exchange, name="health-connect-exchange"),
    path("api/health-connect/steps/", views.health_connect_steps, name="health-connect-steps"),
    path("api/health-connect/revoke/", views.health_connect_revoke, name="health-connect-revoke"),
    path("api/state/", views.state, name="state"),
    path("api/sync/", views.sync, name="sync"),
    path("api/xp/", views.experience, name="experience"),
    path("api/timer/", views.timer, name="timer"),
]
