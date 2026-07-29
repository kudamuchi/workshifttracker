let currentUser = null;
let activeShift = null; // row from public.shifts, or null
let tickHandle = null;
let map = null;
let marker = null;

const els = {
  statusPill: document.getElementById("statusPill"),
  statusPillText: document.getElementById("statusPillText"),
  userLabel: document.getElementById("userLabel"),
  actionsRow: document.getElementById("actionsRow"),
  workingTime: document.getElementById("workingTime"),
  breakTime: document.getElementById("breakTime"),
  startedAtBox: document.getElementById("startedAtBox"),
  startedAt: document.getElementById("startedAt"),
  statusBanner: document.getElementById("statusBanner"),
  statusBannerText: document.getElementById("statusBannerText"),
  statToday: document.getElementById("statToday"),
  statWeek: document.getElementById("statWeek"),
  statMonth: document.getElementById("statMonth"),
  latVal: document.getElementById("latVal"),
  lngVal: document.getElementById("lngVal"),
  updateLocationBtn: document.getElementById("updateLocationBtn"),
};

init();

async function init() {
  const session = await requireAuth();
  if (!session) return;
  currentUser = session.user;

  await loadProfile();
  await loadActiveShift();
  initMap();
  render();
  await loadStats();

  tickHandle = setInterval(tick, 1000);
  els.updateLocationBtn.addEventListener("click", updateLocation);
}

let currentProfile = null;

async function loadProfile() {
  const { data } = await supabaseClient
    .from("profiles")
    .select("first_name, last_name, email, role")
    .eq("id", currentUser.id)
    .maybeSingle();

  currentProfile = data;
  const name = data && [data.first_name, data.last_name].filter(Boolean).join(" ");
  els.userLabel.textContent = name || (data && data.email) || currentUser.email || "User";

  if (data && data.role === "manager") {
    const link = document.createElement("a");
    link.href = "manager-dashboard.html";
    link.className = "btn btn-outline";
    link.textContent = "Team Dashboard";
    link.style.marginRight = "4px";
    document.querySelector(".topbar-right").prepend(link);
  }
}

async function loadActiveShift() {
  const { data, error } = await supabaseClient
    .from("shifts")
    .select("*")
    .eq("user_id", currentUser.id)
    .neq("status", "ended")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) console.error("loadActiveShift error", error);
  activeShift = data || null;
}

// ---------------- Actions ----------------

async function startShift() {
  setButtonsDisabled(true);
  const pos = await getCurrentPosition();

  const { data, error } = await supabaseClient
    .from("shifts")
    .insert({
      user_id: currentUser.id,
      status: "working",
      started_at: new Date().toISOString(),
      latitude: pos ? pos.lat : null,
      longitude: pos ? pos.lng : null,
    })
    .select()
    .single();

  setButtonsDisabled(false);

  if (error) {
    alert("Could not start shift: " + error.message);
    return;
  }

  activeShift = data;
  render();
}

async function takeBreak() {
  if (!activeShift) return;
  setButtonsDisabled(true);

  const { data, error } = await supabaseClient
    .from("shifts")
    .update({ status: "on_break", break_started_at: new Date().toISOString() })
    .eq("id", activeShift.id)
    .select()
    .single();

  setButtonsDisabled(false);
  if (error) { alert("Could not start break: " + error.message); return; }
  activeShift = data;
  render();
}

async function endBreak() {
  if (!activeShift) return;
  setButtonsDisabled(true);

  const breakSeconds = Math.floor((Date.now() - new Date(activeShift.break_started_at).getTime()) / 1000);
  const newTotal = (activeShift.total_break_seconds || 0) + Math.max(breakSeconds, 0);

  const { data, error } = await supabaseClient
    .from("shifts")
    .update({ status: "working", break_started_at: null, total_break_seconds: newTotal })
    .eq("id", activeShift.id)
    .select()
    .single();

  setButtonsDisabled(false);
  if (error) { alert("Could not resume shift: " + error.message); return; }
  activeShift = data;
  render();
}

async function endShift() {
  if (!activeShift) return;
  if (!confirm("End your shift now?")) return;
  setButtonsDisabled(true);

  let totalBreak = activeShift.total_break_seconds || 0;
  let updates = { status: "ended", ended_at: new Date().toISOString() };

  if (activeShift.status === "on_break" && activeShift.break_started_at) {
    const breakSeconds = Math.floor((Date.now() - new Date(activeShift.break_started_at).getTime()) / 1000);
    totalBreak += Math.max(breakSeconds, 0);
    updates.total_break_seconds = totalBreak;
    updates.break_started_at = null;
  }

  const { data, error } = await supabaseClient
    .from("shifts")
    .update(updates)
    .eq("id", activeShift.id)
    .select()
    .single();

  setButtonsDisabled(false);
  if (error) { alert("Could not end shift: " + error.message); return; }

  activeShift = null;
  render();
  await loadStats();
}

async function updateLocation() {
  els.updateLocationBtn.disabled = true;
  els.updateLocationBtn.textContent = "Locating...";

  const pos = await getCurrentPosition();

  if (pos) {
    setMapPosition(pos.lat, pos.lng);
    if (activeShift) {
      const { data, error } = await supabaseClient
        .from("shifts")
        .update({ latitude: pos.lat, longitude: pos.lng })
        .eq("id", activeShift.id)
        .select()
        .single();
      if (!error) activeShift = data;
    }
  }

  els.updateLocationBtn.disabled = false;
  els.updateLocationBtn.innerHTML = "&#128205; Update Location";
}

function setButtonsDisabled(disabled) {
  els.actionsRow.querySelectorAll("button").forEach((b) => (b.disabled = disabled));
}

// ---------------- Geolocation ----------------

function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

// ---------------- Map ----------------

function initMap() {
  const lat = activeShift?.latitude ?? 9.6685;
  const lng = activeShift?.longitude ?? 80.0074;

  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([lat, lng], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  marker = L.marker([lat, lng]).addTo(map);

  if (activeShift?.latitude != null) {
    els.latVal.textContent = activeShift.latitude.toFixed(6);
    els.lngVal.textContent = activeShift.longitude.toFixed(6);
  }
}

function setMapPosition(lat, lng) {
  els.latVal.textContent = lat.toFixed(6);
  els.lngVal.textContent = lng.toFixed(6);
  if (map && marker) {
    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], 14);
  }
}

// ---------------- Rendering ----------------

function render() {
  const status = activeShift ? activeShift.status : "not_working";

  // Top-right pill
  els.statusPill.className = "pill" + (status === "working" ? " working" : "");
  els.statusPillText.textContent = status === "working" ? "Working" : status === "on_break" ? "On Break" : "Not Working";

  // Status banner
  els.statusBanner.className = "status-banner " + status;
  els.statusBannerText.textContent =
    status === "working" ? "Working" : status === "on_break" ? "On Break" : "Not Working";

  // Started at box
  if (activeShift) {
    els.startedAtBox.style.display = "";
    els.startedAt.textContent = new Date(activeShift.started_at).toLocaleTimeString();
  } else {
    els.startedAtBox.style.display = "none";
  }

  // Action buttons
  els.actionsRow.innerHTML = "";
  if (!activeShift) {
    els.actionsRow.appendChild(makeBtn("btn-primary", "&#9201; Start Shift", startShift));
  } else if (activeShift.status === "working") {
    els.actionsRow.appendChild(makeBtn("btn-muted", "&#9209; Take Break", takeBreak));
    els.actionsRow.appendChild(makeBtn("btn-danger", "&#9209; End Shift", endShift));
  } else if (activeShift.status === "on_break") {
    els.actionsRow.appendChild(makeBtn("btn-primary", "&#9654; Resume Shift", endBreak));
    els.actionsRow.appendChild(makeBtn("btn-danger", "&#9209; End Shift", endShift));
  }

  if (activeShift?.latitude != null && map) {
    setMapPosition(activeShift.latitude, activeShift.longitude);
  }

  tick();
}

function makeBtn(cls, html, handler) {
  const b = document.createElement("button");
  b.className = "btn " + cls;
  b.innerHTML = html;
  b.addEventListener("click", handler);
  return b;
}

function tick() {
  if (!activeShift) {
    els.workingTime.textContent = formatDuration(0);
    els.breakTime.textContent = formatDuration(0);
    return;
  }

  const startedAt = new Date(activeShift.started_at).getTime();
  const now = Date.now();
  const totalBreak = activeShift.total_break_seconds || 0;

  let workingSeconds;
  let breakSeconds;

  if (activeShift.status === "on_break" && activeShift.break_started_at) {
    const breakStarted = new Date(activeShift.break_started_at).getTime();
    workingSeconds = Math.floor((breakStarted - startedAt) / 1000) - totalBreak;
    breakSeconds = totalBreak + Math.floor((now - breakStarted) / 1000);
  } else {
    workingSeconds = Math.floor((now - startedAt) / 1000) - totalBreak;
    breakSeconds = totalBreak;
  }

  els.workingTime.textContent = formatDuration(Math.max(workingSeconds, 0));
  els.breakTime.textContent = formatDuration(Math.max(breakSeconds, 0));
}

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// ---------------- Stats ----------------

async function loadStats() {
  const now = new Date();

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - dow);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [today, week, month] = await Promise.all([
    sumWorkedSeconds(startOfDay),
    sumWorkedSeconds(startOfWeek),
    sumWorkedSeconds(startOfMonth),
  ]);

  els.statToday.textContent = (today / 3600).toFixed(2) + "h";
  els.statWeek.textContent = (week / 3600).toFixed(2) + "h";
  els.statMonth.textContent = (month / 3600).toFixed(2) + "h";
}

async function sumWorkedSeconds(sinceDate) {
  const { data, error } = await supabaseClient
    .from("shift_summaries")
    .select("worked_seconds")
    .eq("user_id", currentUser.id)
    .gte("started_at", sinceDate.toISOString());

  if (error) { console.error("stats error", error); return 0; }
  return (data || []).reduce((sum, row) => sum + (row.worked_seconds || 0), 0);
}
