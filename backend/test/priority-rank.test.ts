import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { closePool, query } from "../src/db/pool";

const P = "prank-";
describe("priority_rank generated column", () => {
  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${P}%`]);
    for (const [i, prio] of ["critical", "high", "normal", "low"].entries()) {
      await query(
        `INSERT INTO notifications (id, module, title, description, priority, snoozable, audience_scope)
         VALUES ($1,'test','t','',$2,true,'global')`,
        [`${P}${i}`, prio],
      );
    }
  });
  afterAll(async () => {
    await query("DELETE FROM notifications WHERE id LIKE $1", [`${P}%`]);
    await closePool();
  });

  it("ranks critical<high<normal<low as 0..3", async () => {
    const { rows } = await query<{ priority: string; priority_rank: number }>(
      "SELECT priority, priority_rank FROM notifications WHERE id LIKE $1 ORDER BY priority_rank",
      [`${P}%`],
    );
    expect(rows.map((r) => [r.priority, r.priority_rank])).toEqual([
      ["critical", 0],
      ["high", 1],
      ["normal", 2],
      ["low", 3],
    ]);
  });
});
