// Shared helpers used across pages for auth state.

async function getSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("getSession error", error);
    return null;
  }
  return data.session;
}

// Redirects to login.html if not authenticated. Call on protected pages.
async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  return session;
}

async function getProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) console.error("getProfile error", error);
  return data;
}

function homeForRole(role) {
  return role === "manager" ? "manager-dashboard.html" : "dashboard.html";
}

// Ensures the signed-in user has `expectedRole`; otherwise sends them to
// their own home page. Returns { session, profile } or null (already redirected).
async function requireRole(expectedRole) {
  const session = await requireAuth();
  if (!session) return null;

  const profile = await getProfile(session.user.id);
  const role = profile?.role || "employee";

  if (role !== expectedRole) {
    window.location.href = homeForRole(role);
    return null;
  }
  return { session, profile };
}

// Redirects to the right dashboard if already authenticated. Call on login/register.
async function redirectIfAuthed() {
  const session = await getSession();
  if (!session) return;
  const profile = await getProfile(session.user.id);
  window.location.href = homeForRole(profile?.role || "employee");
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
}

function toggleUserDropdown() {
  const dd = document.getElementById("userDropdown");
  if (dd) dd.classList.toggle("open");
}

document.addEventListener("click", (e) => {
  const menu = document.getElementById("userMenu");
  const dd = document.getElementById("userDropdown");
  if (menu && dd && !menu.contains(e.target)) {
    dd.classList.remove("open");
  }
});
