/** Runtime connection. Supabase's transaction pooler (port 6543) belongs here. */
export function databaseUrl() {
  return present(process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.SUPABASE_DATABASE_URL);
}

function present(url: string | undefined) {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return withSsl(trimmed);
}

function withSsl(url: string) {
  const supabase = url.includes("supabase.com") || url.includes("supabase.co");
  if (!supabase || url.includes("sslmode=")) return url;
  return url.includes("?") ? `${url}&sslmode=require` : `${url}?sslmode=require`;
}
