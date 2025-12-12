import { Pool } from "pg";

/**
 * PostgreSQL connection pool.
 * Security: Use DATABASE_URL over TLS; least-privilege DB user.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

// Example schema:
// CREATE TABLE IF NOT EXISTS proctor_events (
//   id SERIAL PRIMARY KEY,
//   test_id TEXT NOT NULL,
//   user_id TEXT NOT NULL,
//   type TEXT NOT NULL,
//   payload JSONB NOT NULL,
//   client_hash TEXT NOT NULL,
//   server_hash TEXT NOT NULL,
//   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );

