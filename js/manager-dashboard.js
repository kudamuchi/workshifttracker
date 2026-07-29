let refreshHandle = null;

const mEls = {
  userLabel: document.getElementById("userLabel"),
  rosterBody: document.getElementById("rosterBody"),
  sumTotal: document.getElementById("sumTotal"),
  sumWorking: document.getElementById("sumWorking"),
  sumBreak: document.getElementById("sumBreak"),
  sumIdle: document.getElementById("sumIdle"),
  refreshBtn: document.getElementById("refreshBtn"),
};

init();

async function init() {
  const auth = await requireRole("manager");
  if (!auth) return; // requireRole already redirected non-managers away

  const { first_name, last_name, email } = auth.profile || {};
  mEls.userLabel.textContent = [first_name, last_name].filter(Boolean).join(" ") || email || "Manager";

  mEls.refreshBtn.addEventListener("click", loadRoster);

  await loadRoster();
  refreshHandle = setInterval(loadRoster, 20000);
}

async function loadRoster() {
  const [{ data: roster, error: rosterError }, hoursByUser] = await Promise.all([
    supabaseClient
      .from("employee_status")
      .select("*")
      .eq("role", "employee")
      .order("first_name"),
    loadTodayHours(),
  ]);

  if (rosterError) {
    console.error("loadRoster error", rosterError);
    mEls.rosterBody.innerHTML = `<tr><td colspan="6" class="roster-empty">Could not load the team roster.</td></tr>`;
    return;
  }

  renderSummary(roster || []);
  renderTable(roster || [], hoursByUser);
}

async function loadTodayHours() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabaseClient
    .from("shift_summaries")
    .select("user_id, worked_seconds")
    .gte("started_at", startOfDay.toISOString());

  const map = {};
  if (error) { console.error("loadTodayHours error", error); return map; }

  (data || []).forEach((row) => {
    map[row.user_id] = (map[row.user_id] || 0) + (row.worked_seconds || 0);
  });
  return map;
}

function renderSummary(roster) {
  let working = 0, onBreak = 0;
  roster.forEach((r) => {
    if (r.shift_status === "working") working++;
    else if (r.shift_status === "on_break") onBreak++;
  });

  mEls.sumTotal.textContent = roster.length;
  mEls.sumWorking.textContent = working;
  mEls.sumBreak.textContent = onBreak;
  mEls.sumIdle.textContent = roster.length - working - onBreak;
}

function renderTable(roster, hoursByUser) {
  if (roster.length === 0) {
    mEls.rosterBody.innerHTML = `<tr><td colspan="6" class="roster-empty">No employees have registered yet.</td></tr>`;
    return;
  }

  mEls.rosterBody.innerHTML = roster.map((r) => {
    const status = r.shift_status === "working" || r.shift_status === "on_break" ? r.shift_status : "not_working";
    const statusLabel = status === "working" ? "Working" : status === "on_break" ? "On Break" : "Not Working";
    const pillClass = status === "not_working" ? "" : status;

    const startedAt = (r.shift_status === "working" || r.shift_status === "on_break") && r.started_at
      ? new Date(r.started_at).toLocaleString()
      : "—";

    const todaySeconds = hoursByUser[r.user_id] || 0;
    const todayHours = (todaySeconds / 3600).toFixed(2) + "h";

    const location = (r.latitude != null && r.longitude != null)
      ? `<a href="https://www.google.com/maps?q=${r.latitude},${r.longitude}" target="_blank" rel="noopener">${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}</a>`
      : `<span class="muted">—</span>`;

    return `
      <tr>
        <td class="name-cell">${escapeHtml(r.first_name || "—")}</td>
        <td>${escapeHtml(r.last_name || "—")}</td>
        <td><span class="pill ${pillClass}"><span class="dot"></span>${statusLabel}</span></td>
        <td class="muted">${startedAt}</td>
        <td>${todayHours}</td>
        <td>${location}</td>
      </tr>
    `;
  }).join("");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
