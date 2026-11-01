/* DateDoodle: datedoodle-api.js
   Connects the page to the Python backend (app.py).
   Load it AFTER datedoodle.js:
     <script src="datedoodle.js"></script>
     <script src="datedoodle-api.js"></script>
   The page must be opened through the server (http://127.0.0.1:5000), not by double-clicking the HTML. */

document.addEventListener("DOMContentLoaded", function () {
  var $ = function (id) { return document.getElementById(id); };
  var currentUser = null;

  function api(path, method, body) {
    return fetch(path, {
      method: method || "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    });
  }

  function applyUser(u) {
    var nice = u.name || u.email.split("@")[0];
    $("navName").textContent = nice;
    $("sideName").textContent = nice;
    $("sideEmail").textContent = u.email;
    $("greet").textContent = "Hello, " + nice + "!";
    $("avatar").textContent = nice.charAt(0).toUpperCase();
  }

  function loadEvents() {
    if (typeof ddEvents === "undefined") return;
    return api("/api/events").then(function (res) {
      if (!res.ok) return;
      res.data.events.forEach(function (e) { e.synced = true; });
      ddEvents.splice.apply(ddEvents, [0, ddEvents.length].concat(res.data.events));
      window.ddDraw();
    });
  }

  /* ---- Login / sign-up: ask the server instead of the demo code ---- */
  var form = $("loginForm");
  var errBox = document.createElement("p");
  errBox.style.cssText = "color:#a24b4b;font-size:.9rem;text-align:center;margin:0 0 10px;min-height:1px";
  form.insertBefore(errBox, $("modalBtn"));
  var note = document.createElement("p");
  note.style.cssText = "font-size:.8rem;color:#6f6388;text-align:center;margin-top:12px";
  note.textContent = "We email you reminders for your events. Every email has an unsubscribe link.";
  form.appendChild(note);

  var allowNext = false;
  $("loginModal").addEventListener("submit", function (e) {
    if (allowNext) { allowNext = false; return; }          // let the page's own code open the dashboard
    e.preventDefault();
    e.stopPropagation();                                   // block the fake demo login
    var isSignup = $("nameField").style.display !== "none";
    var payload = { email: $("lEmail").value, password: $("lPass").value };
    if (isSignup) payload.name = $("lName").value;
    errBox.textContent = "";
    api(isSignup ? "/api/signup" : "/api/login", "POST", payload).then(function (res) {
      if (!res.ok) { errBox.textContent = res.data.error || "Something went wrong."; return; }
      currentUser = res.data;
      allowNext = true;
      form.requestSubmit();
      $("lPass").value = "";
      applyUser(currentUser);
      loadEvents();
    }).catch(function () {
      errBox.textContent = "Can't reach the server. Start app.py and open http://127.0.0.1:5000";
    });
  }, true);

  /* ---- Remember the login after a refresh ---- */
  api("/api/me").then(function (res) {
    if (!res.ok) return;
    currentUser = res.data;
    applyUser(currentUser);
    $("landing").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("navLinks").classList.add("hidden");
    $("navUser").classList.remove("hidden");
    loadEvents();
  }).catch(function () {});

  /* ---- Logout ---- */
  var origLogout = window.logout;
  window.logout = function () {
    api("/api/logout", "POST").catch(function () {});
    currentUser = null;
    origLogout();
    if (typeof ddEvents !== "undefined") { ddEvents.splice(0, ddEvents.length); window.ddDraw(); }
  };

  /* ---- Calendar events: guests are asked to log in first ---- */
  $("calendar").addEventListener("click", function (e) {
    if (e.target.closest("#ddAdd") && !currentUser) {
      e.stopPropagation();
      e.preventDefault();
      window.openLogin();
      $("modalSub").textContent = "Log in to add events and get reminder emails";
    }
  }, true);

  /* ---- Save new events to the server ---- */
  $("ddForm").addEventListener("submit", function () {
    var ev = ddEvents[ddEvents.length - 1];
    if (!ev || ev.synced || !currentUser) return;
    ev.synced = true;
    function undo(message) {
      var i = ddEvents.indexOf(ev);
      if (i > -1) ddEvents.splice(i, 1);
      window.ddDraw();
      alert(message);
    }
    api("/api/events", "POST", { category: ev.cat, name: ev.name, date: ev.date, reminder: ev.reminder || "" })
      .then(function (res) {
        if (!res.ok) return undo(res.data.error || "Couldn't save that event.");
        ev.id = res.data.event.id;      // use the server's id from now on
        window.ddDraw();
      })
      .catch(function () { undo("Can't reach the server, so the event wasn't saved."); });
  });

  /* ---- Reschedule and delete ---- */
  var origMove = window.ddMove, origDel = window.ddDel;
  window.ddMove = function (id, value) {
    origMove(id, value);
    if (currentUser && value) api("/api/events/" + id, "PATCH", { date: value }).catch(function () {});
  };
  window.ddDel = function (id) {
    origDel(id);
    if (currentUser) api("/api/events/" + id, "DELETE").catch(function () {});
  };
});