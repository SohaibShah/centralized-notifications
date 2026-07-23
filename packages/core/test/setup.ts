// Test env defaults. Core reads NO env at runtime (a pool is injected), but its tests need a
// connection string to construct a test pg.Pool. `??=` so a real value (e.g. CI's DATABASE_URL)
// is never overridden — only fills the gap for local runs.
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/postgres";
