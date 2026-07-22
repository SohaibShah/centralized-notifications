// Test env defaults — only a connection string, to construct the test pg.Pool. `??=` so a real
// value (CI's DATABASE_URL) is never overridden.
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/postgres";
