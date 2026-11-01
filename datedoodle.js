/* DateDoodle: datedoodle.js (all features in one file)
   Attach in your HTML just before </body>:
   <script src="datedoodle.js"></script>
   This file adds its own styles, so no CSS changes are needed.

   Features:
   1. Rotating quotation pop-up on every visit
   2. Pastel green hover glow on the example boxes
   3. Dashboard "Back" button (stays logged in) + nav button shows username
   4. FAQ boxes closed by default, opened/closed with + / - icons
   5. Scrollable "Add event" and login windows
   6. Gen Z reminders per category, shuffled each time an event is set       */

document.addEventListener("DOMContentLoaded", function () {

  /* ---------- Injected styles ---------- */
  var css = `
    /* 2. Pastel green backlight on example boxes */
    .cards .card{transition:transform .25s, box-shadow .25s, border-color .25s}
    .cards .card:hover{
      border-top-color:#8fd0a0;
      box-shadow:0 0 0 4px rgba(184,230,196,.55), 0 14px 40px rgba(143,208,160,.65);
    }

    /* 1. Quotation pop-up */
    .ddq-overlay{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px;
      background:rgba(63,42,99,.55);backdrop-filter:blur(3px);animation:ddqFade .35s ease;overflow-y:auto}
    .ddq-box{position:relative;width:100%;max-width:520px;text-align:center;padding:44px 34px 32px;
      border-radius:26px;background:linear-gradient(160deg,#ffffff 0%,#f1eafc 100%);
      box-shadow:0 24px 70px rgba(63,42,99,.35);border:2px solid #e2d4f8;animation:ddqPop .4s ease}
    .ddq-flower{font-size:2rem;margin-bottom:10px}
    .ddq-text{font-family:Georgia,serif;font-size:1.3rem;line-height:1.55;color:#3f2a63;margin-bottom:16px}
    .ddq-by{color:#7a4fb5;font-weight:700;margin-bottom:24px}
    .ddq-x{position:absolute;top:12px;right:14px;width:38px;height:38px;border-radius:50%;border:none;
      background:#f1eafc;color:#7a4fb5;font-size:1.6rem;line-height:1;cursor:pointer}
    .ddq-x:hover{background:#e2d4f8}
    .ddq-close{border:none;cursor:pointer;font:inherit;font-weight:600;padding:12px 32px;border-radius:999px;
      color:#fff;background:linear-gradient(135deg,#b18ee3,#7a4fb5);box-shadow:0 6px 16px rgba(148,103,209,.35)}
    .ddq-close:hover{transform:translateY(-2px)}
    @keyframes ddqFade{from{opacity:0}to{opacity:1}}
    @keyframes ddqPop{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}

    /* 3. Dashboard back button */
    .ddback{display:inline-flex;align-items:center;gap:6px;margin-bottom:18px;padding:9px 20px;border:none;
      border-radius:999px;background:#f1eafc;color:#7a4fb5;font:inherit;font-weight:600;cursor:pointer;
      box-shadow:0 3px 10px rgba(148,103,209,.15);text-decoration:none}
    .ddback:hover{background:#e2d4f8}

    /* 4. FAQ accordion */
    .qa h3{margin:0}
    .ddfaq-q{width:100%;display:flex;justify-content:space-between;align-items:center;gap:14px;background:none;
      border:none;font:inherit;font-weight:inherit;color:inherit;text-align:left;cursor:pointer;padding:0;text-decoration:none}
    .ddfaq-icon{flex:0 0 32px;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;
      background:#f1eafc;color:#7a4fb5;font-size:1.3rem;font-weight:700;line-height:1;transition:background .2s}
    .ddfaq-q:hover .ddfaq-icon{background:#e2d4f8}
    .ddfaq-a{max-height:0;overflow:hidden;transition:max-height .3s ease}
    .ddfaq-a p{padding-top:10px}

    /* 5. Scrollable windows (so the last category is always reachable) */
    #ddModal,#loginModal{display:flex;justify-content:center;align-items:flex-start;
      overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    #ddModal .modal,#loginModal .modal{margin:auto}

    /* 6. Reminder text on events + toast */
    .ddrem{display:block;margin-top:6px;font-style:italic;font-size:.92rem;color:#6f6388}
    .ddtoast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);z-index:90;max-width:min(92vw,460px);
      padding:16px 22px;border-radius:18px;background:#fff;color:#3f2a63;box-shadow:0 14px 40px rgba(63,42,99,.3);
      border:2px solid #c8ebce;opacity:0;transition:opacity .3s, transform .3s;text-align:center}
    .ddtoast.show{opacity:1;transform:translate(-50%,0)}
    .ddtoast b{display:block;color:#3f7a52;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}
  `;
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- 1. Rotating quotation pop-up ---------- */
  var quotes = [
    { text: "Kindness is a language the deaf can hear and the blind can see.", by: "Mark Twain" },
    { text: "Life is either a daring adventure or nothing at all.", by: "Helen Keller" },
    { text: "The best and most beautiful things in the world cannot be seen or even touched. They must be felt with the heart.", by: "Helen Keller" },
    { text: "It all comes to this: the simplest way to be happy is to do good.", by: "Helen Keller" },
    { text: "And your Lord says, \u201CCall upon Me; I will respond to you.\u201D", by: "Quran 40:60" }
  ];

  // Each visit shows the next quote in the list, then loops back to the first.
  var KEY = "datedoodleQuoteIndex";
  var index = 0;
  try {
    var saved = parseInt(localStorage.getItem(KEY), 10);
    index = isNaN(saved) ? 0 : (saved + 1) % quotes.length;
    localStorage.setItem(KEY, String(index));
  } catch (e) {
    index = Math.floor(Math.random() * quotes.length); // storage blocked: random quote
  }
  var q = quotes[index];

  var overlay = document.createElement("div");
  overlay.className = "ddq-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Welcome quotation");

  var box = document.createElement("div");
  box.className = "ddq-box";

  var xBtn = document.createElement("button");
  xBtn.className = "ddq-x";
  xBtn.setAttribute("aria-label", "Close quotation");
  xBtn.innerHTML = "&times;";

  var flower = document.createElement("div");
  flower.className = "ddq-flower";
  flower.textContent = "\uD83C\uDF38";

  var text = document.createElement("p");
  text.className = "ddq-text";
  text.textContent = (q.by === "Quran 40:60") ? q.text : "\u201C" + q.text + "\u201D";

  var by = document.createElement("p");
  by.className = "ddq-by";
  by.textContent = "\u2014 " + q.by;

  var closeBtn = document.createElement("button");
  closeBtn.className = "ddq-close";
  closeBtn.textContent = "Close";

  box.append(xBtn, flower, text, by, closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function closeQuote() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") closeQuote(); }
  xBtn.addEventListener("click", closeQuote);
  closeBtn.addEventListener("click", closeQuote);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeQuote(); });
  document.addEventListener("keydown", onKey);
  closeBtn.focus();

  /* ---------- 3. Dashboard back button + username on nav button ---------- */
  var landing = document.getElementById("landing");
  var dashboard = document.getElementById("dashboard");
  var navLinks = document.getElementById("navLinks");
  var navUser = document.getElementById("navUser");
  var navName = document.getElementById("navName");
  var navLoginBtn = navLinks ? navLinks.querySelector(".btn") : null;
  var loggedIn = false;

  function showDashboard() {
    landing.classList.add("hidden");
    dashboard.classList.remove("hidden");
    navLinks.classList.add("hidden");
    navUser.classList.remove("hidden");
    window.scrollTo(0, 0);
  }
  function showLandingStayLoggedIn() {
    loggedIn = true;
    dashboard.classList.add("hidden");
    landing.classList.remove("hidden");
    navUser.classList.add("hidden");
    navLinks.classList.remove("hidden");
    if (navLoginBtn) navLoginBtn.textContent = (navName && navName.textContent.trim()) || "My account";
    window.scrollTo(0, 0);
  }

  var dashMain = dashboard ? dashboard.querySelector("main") : null;
  if (dashMain) {
    var backBtn = document.createElement("button");
    backBtn.className = "ddback";
    backBtn.type = "button";
    backBtn.textContent = "\u2190 Back";
    backBtn.addEventListener("click", showLandingStayLoggedIn);
    dashMain.prepend(backBtn);
  }

  // When logged in, the nav button (now showing the username) returns to the dashboard
  var originalOpenLogin = window.openLogin;
  window.openLogin = function () {
    if (loggedIn) { showDashboard(); }
    else if (typeof originalOpenLogin === "function") { originalOpenLogin(); }
  };

  // Logging out resets everything
  var originalLogout = window.logout;
  window.logout = function () {
    if (typeof originalLogout === "function") originalLogout();
    loggedIn = false;
    if (navLoginBtn) navLoginBtn.textContent = "Log in";
  };

  // Mark the user as logged in as soon as they sign in
  var loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", function () { loggedIn = true; });
  }

  /* ---------- 4. FAQ accordion (closed by default, + / -) ---------- */
  document.querySelectorAll(".qa").forEach(function (item) {
    var h3 = item.querySelector("h3");
    var p = item.querySelector("p");
    if (!h3 || !p) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ddfaq-q";
    btn.setAttribute("aria-expanded", "false");

    var label = document.createElement("span");
    label.textContent = h3.textContent;
    var icon = document.createElement("span");
    icon.className = "ddfaq-icon";
    icon.textContent = "+";
    btn.append(label, icon);

    h3.textContent = "";
    h3.appendChild(btn);

    var wrap = document.createElement("div");
    wrap.className = "ddfaq-a";
    p.parentNode.insertBefore(wrap, p);
    wrap.appendChild(p);

    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      icon.textContent = open ? "+" : "\u2212";
      wrap.style.maxHeight = open ? "0" : wrap.scrollHeight + "px";
    });
  });
  window.addEventListener("resize", function () {
    document.querySelectorAll(".ddfaq-q[aria-expanded='true']").forEach(function (b) {
      var w = b.closest(".qa").querySelector(".ddfaq-a");
      w.style.maxHeight = w.scrollHeight + "px";
    });
  });

  /* ---------- 6. Gen Z reminders, shuffled within each category ---------- */
  var reminderPools = {
    "Exercise / Workout Routine": [
      "Gym arc loading... lock in, bestie. Those gains won't grind themselves, no cap. \uD83D\uDCAA",
      "It's giving main character energy. Hit that workout and level up your glow-up era. \uD83D\uDD25",
      "Your future self is lowkey begging you to show up today. Sneakers on, let's gooo!"
    ],
    "Birthday Reminders": [
      "Birthday alert! Don't be the giftless friend, bestie. Show up and serve main character love. \uD83C\uDF82",
      "It's giving party time! Drop that birthday text before the group chat starts roasting you. \uD83C\uDF89",
      "Cake, vibes, and good company. Go be the W friend today, fr fr."
    ],
    "Family and Friends Events": [
      "Squad goals unlocked! Show up, touch grass, and make memories, no cap. \uD83E\uDEF6",
      "Your people are waiting, bestie. Phone down, vibes up, let's gooo!",
      "Quality time is lowkey the best flex. Go be the favorite person today. \uD83D\uDC9C"
    ],
    "Job Interviews": [
      "Interview day! Lock in, bestie. You understood the assignment, now go eat. \uD83D\uDCBC",
      "Main character energy only. Walk in like the job is already yours, no cap.",
      "Deep breath, you're built for this. Slay that interview and let that rizz do the talking. \u2728"
    ],
    "Business Meetings": [
      "Meeting time! Show up prepared and ready to eat that agenda, no cap. \uD83D\uDCCA",
      "Slides ready? Notes locked in? Go be the MVP of the meeting, fr fr.",
      "It's giving productive era. Join on time, speak your truth, and let that brain cook. \uD83E\uDDE0"
    ],
    "Parent Teacher Meeting": [
      "PTM day! Bring your questions and good vibes, bestie. Let's help that student shine. \uD83D\uDCDA",
      "Teacher meeting alert! Show up, stay curious, and be the W in this education arc.",
      "It's giving teamwork makes the dream work. Go chat, plan, and cheer that student on, no cap. \u2B50"
    ],
    "Others": [
      "Heads up, bestie! You've got something on your plate and you're gonna slay it, no cap. \u2728",
      "Reminder: you're doing amazing, sweetie. Go handle your business, W energy only. \uD83D\uDC9C",
      "It's giving main character energy. Today's your day, so go make it count, fr fr. \uD83C\uDF38"
    ]
  };

  // Shuffle bag: every reminder in a category gets used once, in a random order,
  // before the category is reshuffled. The same reminder never shows twice in a row.
  var reminderBags = {}, lastReminder = {};
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pickReminder(category) {
    var pool = reminderPools[category] || reminderPools["Others"];
    var key = reminderPools[category] ? category : "Others";
    if (!reminderBags[key] || !reminderBags[key].length) {
      var bag = shuffle(pool);
      if (bag.length > 1 && bag[bag.length - 1] === lastReminder[key]) bag.reverse(); // avoid an immediate repeat
      reminderBags[key] = bag;
    }
    lastReminder[key] = reminderBags[key].pop();
    return lastReminder[key];
  }

  var toastEl = document.createElement("div");
  toastEl.className = "ddtoast";
  document.body.appendChild(toastEl);
  var toastTimer;
  function showToast(msg) {
    toastEl.innerHTML = "<b>Your reminder</b>";
    toastEl.appendChild(document.createTextNode(msg));
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 5500);
  }

  // Wrap the calendar's draw function: give every new event a reminder, then show it in the list
  var originalDraw = window.ddDraw;
  if (typeof originalDraw === "function" && typeof ddEvents !== "undefined") {
    window.ddDraw = function () {
      var fresh = null;
      ddEvents.forEach(function (e) {
        if (!e.reminder) { e.reminder = pickReminder(e.cat); fresh = e.reminder; }
      });
      originalDraw();
      var sorted = ddEvents.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
      document.querySelectorAll("#ddList .dd-item").forEach(function (row, i) {
        if (!sorted[i]) return;
        var span = document.createElement("span");
        span.className = "ddrem";
        span.textContent = "\uD83D\uDD14 \u201C" + sorted[i].reminder + "\u201D";
        row.firstElementChild.appendChild(span);
      });
      if (fresh) showToast(fresh);
    };
  }
});