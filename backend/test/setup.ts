// Test env defaults. Uses `??=` so real values (e.g. CI's DATABASE_URL) are never
// overridden — only fills gaps for local runs.
process.env.NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "0".repeat(64); // 32-byte all-zero test key (hex)
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/postgres";
process.env.INTERNAL_INTAKE_TOKEN ??= "test-internal-token-0123456789"; // ≥16 chars
