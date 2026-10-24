import type { Config } from "drizzle-kit";

const url =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  "";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Supabase: DIRECT_URL (port 5432). The transaction pooler cannot run migrations.
    url,
  },
} satisfies Config;
