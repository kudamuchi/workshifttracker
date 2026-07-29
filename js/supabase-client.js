// Supabase project connection details.
// The anon key is safe to expose in client-side code — access to data is
// controlled by Row Level Security policies defined in sql/schema.sql.
const SUPABASE_URL = "https://ftrvwsqmmltciedymcmz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0cnZ3c3FtbWx0Y2llZHltY216Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTAwNjMsImV4cCI6MjEwMDgyNjA2M30.ZAdOr0uMTMjwsD0GDREN1cJmR9BewOqN2T6xDL2c9iw";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
