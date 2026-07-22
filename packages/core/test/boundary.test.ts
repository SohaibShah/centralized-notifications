import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// The load-bearing invariant of the extraction: @notifications/core must reference NO host identity
// table and read NO process.env. If this ever fails, a coupling crept back in and the library is no
// longer droppable into a host with its own identity. Fails the build with the offending file:line.

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const forbidden: { pattern: RegExp; why: string }[] = [
  { pattern: /\buser_teams\b/, why: "identity table user_teams" },
  { pattern: /\buser_roles\b/, why: "identity table user_roles" },
  { pattern: /\bfrom\s+users\b/i, why: "SELECT ... FROM users" },
  { pattern: /\bjoin\s+users\b/i, why: "JOIN users" },
  { pattern: /process\.env/, why: "direct env read (config must be injected)" },
  { pattern: /secure-session/, why: "session coupling" },
];

test("packages/core/src references no identity table and no process.env", () => {
  const violations: string[] = [];
  for (const file of tsFiles(srcDir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { pattern, why } of forbidden) {
        if (pattern.test(line)) {
          violations.push(`${path.relative(srcDir, file)}:${i + 1} — ${why}: ${line.trim()}`);
        }
      }
    });
  }
  expect(violations, violations.join("\n")).toEqual([]);
});
