module.exports = function handler(_request, response) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!supabaseUrl || !supabaseAnonKey) {
    response.status(503).json({
      error: "IRIS is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to the Vercel project."
    });
    return;
  }

  response.status(200).json({ supabaseUrl, supabaseAnonKey });
};
