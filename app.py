"""
DateDoodle backend: Flask web server + CSV storage + email reminders.

Run:  python app.py        then open  http://127.0.0.1:5000
Files this program reads/writes (same folder):
  users.csv   - accounts (passwords are stored HASHED, never as plain text)
  events.csv  - each user's events
  static/     - index.html, datedoodle.js, datedoodle-api.js (served to the browser)
"""
import csv
import os
import re
import secrets
import smtplib
import threading
import time
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from functools import wraps
from html import escape
from urllib.parse import quote

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

# ----------------------------------------------------------------- settings
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_CSV = os.path.join(BASE_DIR, "users.csv")
EVENTS_CSV = os.path.join(BASE_DIR, "events.csv")
USER_FIELDS = ["id", "name", "email", "password_hash", "subscribed", "unsub_token", "created_at"]
EVENT_FIELDS = ["id", "user_id", "category", "name", "date", "reminder", "reminded"]
TEXT_FIELDS = ("name", "reminder")  # free text typed by users (protected against CSV formula injection)

CATEGORIES = [
    "Exercise / Workout Routine", "Birthday Reminders", "Family and Friends Events",
    "Job Interviews", "Business Meetings", "Parent Teacher Meeting", "Others",
]
MAX_EVENTS = 5

# Email settings come from environment variables so passwords never sit in the code.
BASE_URL = os.environ.get("APP_BASE_URL", "http://127.0.0.1:5000").rstrip("/")
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
MAIL_FROM = os.environ.get("MAIL_FROM", SMTP_USER or "reminders@datedoodle.local")
REMIND_HOUR = int(os.environ.get("REMIND_HOUR", "8"))  # send on the event day, from this hour onward
CHECK_SECONDS = 60

LOCK = threading.RLock()
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def load_secret_key():
    """Used to sign login cookies. Saved to .secret_key so logins survive restarts."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(BASE_DIR, ".secret_key")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(path, "w", encoding="utf-8") as f:
        f.write(key)
    return key


app = Flask(__name__, static_folder="static", static_url_path="")
app.secret_key = load_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=BASE_URL.startswith("https"),
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)


# -------------------------------------------------------------- CSV storage
def ensure_files():
    for path, fields in ((USERS_CSV, USER_FIELDS), (EVENTS_CSV, EVENT_FIELDS)):
        if not os.path.exists(path):
            with open(path, "w", newline="", encoding="utf-8") as f:
                csv.DictWriter(f, fieldnames=fields).writeheader()


def _csv_safe(value):
    # A cell starting with = + - @ can run as a formula when opened in Excel.
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def _csv_restore(value):
    return value[1:] if value[:1] == "'" and value[1:2] in ("=", "+", "-", "@", "\t", "\r") else value


def read_rows(path):
    with LOCK, open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for k in TEXT_FIELDS:
            if k in r and r[k]:
                r[k] = _csv_restore(r[k])
    return rows


def write_rows(path, fields, rows):
    with LOCK:
        tmp = path + ".tmp"
        with open(tmp, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow({k: (_csv_safe(r.get(k, "")) if k in TEXT_FIELDS else r.get(k, "")) for k in fields})
        os.replace(tmp, path)  # swap in the new file in one step so it can't be half-written


# ------------------------------------------------------------------ helpers
def err(message, code=400):
    return jsonify({"error": message}), code


def clean(text, limit):
    return " ".join(str(text or "").split())[:limit]  # trims, removes line breaks, caps length


def parse_date(value):
    try:
        d = datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        return None
    return d if 2026 <= d.year <= 2031 else None


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    return next((u for u in read_rows(USERS_CSV) if u["id"] == uid), None)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return err("Please log in first.", 401)
        return fn(user, *args, **kwargs)
    return wrapper


def public_user(u):
    return {"name": u["name"], "email": u["email"], "subscribed": u["subscribed"] == "yes"}


def public_event(e):
    return {"id": int(e["id"]), "cat": e["category"], "name": e["name"], "date": e["date"], "reminder": e["reminder"]}


def user_by_token(token):
    for u in read_rows(USERS_CSV):
        if token and secrets.compare_digest(u["unsub_token"], token):
            return u
    return None


# --------------------------------------------------------------- account API
@app.post("/api/signup")
def signup():
    data = request.get_json(silent=True) or {}
    email = clean(data.get("email"), 120).lower()
    password = str(data.get("password") or "")
    name = clean(data.get("name"), 40) or email.split("@")[0].capitalize()
    if not EMAIL_RE.match(email):
        return err("Please enter a valid email address.")
    if len(password) < 8:
        return err("Password must be at least 8 characters.")
    with LOCK:
        users = read_rows(USERS_CSV)
        if any(u["email"] == email for u in users):
            return err("That email already has an account. Try logging in.", 409)
        user = {
            "id": secrets.token_hex(8), "name": name, "email": email,
            "password_hash": generate_password_hash(password), "subscribed": "yes",
            "unsub_token": secrets.token_urlsafe(24), "created_at": datetime.now().isoformat(timespec="seconds"),
        }
        users.append(user)
        write_rows(USERS_CSV, USER_FIELDS, users)
    session.permanent = True
    session["uid"] = user["id"]
    return jsonify(public_user(user))


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = clean(data.get("email"), 120).lower()
    password = str(data.get("password") or "")
    user = next((u for u in read_rows(USERS_CSV) if u["email"] == email), None)
    if not user or not check_password_hash(user["password_hash"], password):
        return err("Incorrect email or password.", 401)
    session.permanent = True
    session["uid"] = user["id"]
    return jsonify(public_user(user))


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def me(user):
    return jsonify(public_user(user))


# ----------------------------------------------------------------- event API
@app.get("/api/events")
@login_required
def list_events(user):
    mine = [public_event(e) for e in read_rows(EVENTS_CSV) if e["user_id"] == user["id"]]
    return jsonify({"events": mine})


@app.post("/api/events")
@login_required
def add_event(user):
    data = request.get_json(silent=True) or {}
    category = data.get("category")
    name = clean(data.get("name"), 60)
    d = parse_date(data.get("date"))
    if category not in CATEGORIES:
        return err("Please choose a valid category.")
    if not name:
        return err("Please enter an event name.")
    if not d:
        return err("Pick a date between 2026 and 2031.")
    with LOCK:
        rows = read_rows(EVENTS_CSV)
        if sum(1 for e in rows if e["user_id"] == user["id"]) >= MAX_EVENTS:
            return err("All 5 slots are in use. Delete or reschedule an event first.")
        new_id = max([int(e["id"]) for e in rows] or [0]) + 1  # numeric id (the page expects numbers)
        ev = {"id": str(new_id), "user_id": user["id"], "category": category, "name": name,
              "date": d.isoformat(), "reminder": clean(data.get("reminder"), 200), "reminded": "no"}
        rows.append(ev)
        write_rows(EVENTS_CSV, EVENT_FIELDS, rows)
    return jsonify({"event": public_event(ev)}), 201


@app.patch("/api/events/<int:event_id>")
@login_required
def reschedule_event(user, event_id):
    d = parse_date((request.get_json(silent=True) or {}).get("date"))
    if not d:
        return err("Pick a date between 2026 and 2031.")
    with LOCK:
        rows = read_rows(EVENTS_CSV)
        ev = next((e for e in rows if e["id"] == str(event_id) and e["user_id"] == user["id"]), None)
        if not ev:
            return err("Event not found.", 404)
        ev["date"], ev["reminded"] = d.isoformat(), "no"  # new date -> reminder is due again
        write_rows(EVENTS_CSV, EVENT_FIELDS, rows)
    return jsonify({"ok": True})


@app.delete("/api/events/<int:event_id>")
@login_required
def delete_event(user, event_id):
    with LOCK:
        rows = read_rows(EVENTS_CSV)
        kept = [e for e in rows if not (e["id"] == str(event_id) and e["user_id"] == user["id"])]
        if len(kept) == len(rows):
            return err("Event not found.", 404)
        write_rows(EVENTS_CSV, EVENT_FIELDS, kept)
    return jsonify({"ok": True})


# ------------------------------------------------------ unsubscribe (emails)
PAGE = """<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>__TITLE__</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf7ff;
font-family:"Segoe UI",system-ui,sans-serif;color:#3a2c52}
.box{background:#fff;max-width:440px;margin:20px;padding:36px;border-radius:22px;text-align:center;
box-shadow:0 10px 30px rgba(122,79,181,.18);border-top:6px solid #b18ee3}
h1{font-family:Georgia,serif;color:#3f2a63;margin-top:0}
button{border:none;cursor:pointer;font:inherit;font-weight:600;padding:12px 28px;border-radius:999px;color:#fff;
background:linear-gradient(135deg,#b18ee3,#7a4fb5)}</style></head>
<body><div class="box">__BODY__</div></body></html>"""


def page(title, body):
    return PAGE.replace("__TITLE__", escape(title)).replace("__BODY__", body)


@app.get("/unsubscribe")
def unsubscribe_confirm():
    token = request.args.get("token", "")
    user = user_by_token(token)
    if not user:
        return page("Link not valid", "<h1>Hmm...</h1><p>This unsubscribe link isn't valid.</p>"), 404
    return page("Unsubscribe", (
        "<h1>Unsubscribe?</h1><p>Stop DateDoodle reminder emails to <b>%s</b>?</p>"
        '<form method="post" action="/unsubscribe?token=%s"><button>Yes, unsubscribe me</button></form>'
    ) % (escape(user["email"]), quote(token)))


def _set_subscription(token, value):
    with LOCK:
        users = read_rows(USERS_CSV)
        user = next((u for u in users if token and secrets.compare_digest(u["unsub_token"], token)), None)
        if user:
            user["subscribed"] = value
            write_rows(USERS_CSV, USER_FIELDS, users)
        return user


@app.post("/unsubscribe")  # also handles one-click unsubscribe from email apps
def unsubscribe():
    token = request.values.get("token", "")
    if not _set_subscription(token, "no"):
        return page("Link not valid", "<h1>Hmm...</h1><p>This unsubscribe link isn't valid.</p>"), 404
    return page("Unsubscribed", (
        "<h1>You're unsubscribed</h1><p>No more reminder emails from DateDoodle.</p>"
        '<p>Changed your mind?</p><form method="post" action="/resubscribe?token=%s">'
        "<button>Resubscribe</button></form>"
    ) % quote(token))


@app.post("/resubscribe")
def resubscribe():
    token = request.values.get("token", "")
    if not _set_subscription(token, "yes"):
        return page("Link not valid", "<h1>Hmm...</h1><p>This link isn't valid.</p>"), 404
    return page("Resubscribed", "<h1>Welcome back!</h1><p>Reminder emails are switched on again.</p>")


# ------------------------------------------------------------------- emails
def build_email(user, event):
    unsub = "%s/unsubscribe?token=%s" % (BASE_URL, quote(user["unsub_token"]))
    when = datetime.strptime(event["date"], "%Y-%m-%d").strftime("%A, %d %B %Y")
    msg = EmailMessage()
    msg["Subject"] = "DateDoodle reminder: %s is today!" % event["name"]
    msg["From"] = MAIL_FROM
    msg["To"] = user["email"]
    msg["List-Unsubscribe"] = "<%s>" % unsub
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content(
        "Hi %s,\n\n%s\n\nEvent: %s (%s)\nWhen: %s\n\n--\nDateDoodle\n"
        "You're getting this because you added an event on DateDoodle.\n"
        "Unsubscribe from reminder emails: %s\n"
        % (user["name"], event["reminder"] or "Your event is today!", event["name"], event["category"], when, unsub)
    )
    msg.add_alternative("""\
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;background:#faf7ff;padding:24px;border-radius:18px">
  <h2 style="font-family:Georgia,serif;color:#7a4fb5;margin:0 0 12px">DateDoodle</h2>
  <p style="color:#3a2c52">Hi %s,</p>
  <div style="background:#f1eafc;border-radius:14px;padding:16px;color:#3a2c52;font-style:italic">%s</div>
  <p style="color:#3a2c52"><b>%s</b> (%s)<br>%s</p>
  <hr style="border:none;border-top:1px solid #e2d4f8;margin:22px 0">
  <p style="font-size:12px;color:#6f6388">You're getting this because you added an event on DateDoodle.<br>
  <a href="%s" style="color:#7a4fb5;font-weight:bold;text-decoration:none">Unsubscribe from reminder emails</a></p>
</div>""" % (escape(user["name"]), escape(event["reminder"] or "Your event is today!"),
             escape(event["name"]), escape(event["category"]), escape(when), escape(unsub, quote=True)),
        subtype="html")
    return msg


def send_email(user, event):
    msg = build_email(user, event)
    if not SMTP_USER or not SMTP_PASS:  # no email account set up yet: print instead of sending
        print("\n[DRY RUN - set SMTP_USER and SMTP_PASS to really send]\nTo: %s\nSubject: %s\n%s"
              % (user["email"], msg["Subject"], msg.get_body(("plain",)).get_content()))
        return True
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        print("Reminder sent to", user["email"])
        return True
    except Exception as exc:
        print("Could not send to %s: %s" % (user["email"], exc))
        return False


def send_due_reminders():
    now = datetime.now()
    if now.hour < REMIND_HOUR:
        return
    today = now.date().isoformat()
    with LOCK:
        users = {u["id"]: u for u in read_rows(USERS_CSV)}
        due = [e for e in read_rows(EVENTS_CSV) if e["date"] == today and e["reminded"] != "yes"]
    for ev in due:
        user = users.get(ev["user_id"])
        if not user or user["subscribed"] != "yes":  # respects unsubscribes
            continue
        if send_email(user, ev):
            with LOCK:
                rows = read_rows(EVENTS_CSV)
                for r in rows:
                    if r["id"] == ev["id"]:
                        r["reminded"] = "yes"
                write_rows(EVENTS_CSV, EVENT_FIELDS, rows)


def reminder_loop():
    while True:
        try:
            send_due_reminders()
        except Exception as exc:
            print("Reminder check failed:", exc)
        time.sleep(CHECK_SECONDS)


# --------------------------------------------------------------------- pages
@app.get("/")
def home():
    return send_from_directory(app.static_folder, "index.html")


ensure_files()

if __name__ == "__main__":
    threading.Thread(target=reminder_loop, daemon=True).start()
    app.run(host="127.0.0.1", port=5000, debug=False)