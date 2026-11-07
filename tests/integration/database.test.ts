import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, projects, scenarios, scenarioVersions, type DatabaseHandle } from "@rel/database";

let handle: DatabaseHandle;

beforeAll(async () => {
  handle = await createDatabase({ url: "memory://" });
});
afterAll(async () => handle.close());

describe("database", () => {
  it("applies migrations and round-trips JSONB scenario specs", async () => {
    const { db } = handle;
    await db.insert(projects).values({ id: "prj_1", slug: "demo", name: "Demo" });
    await db.insert(scenarios).values({
      id: "scn_1",
      projectId: "prj_1",
      code: "SCN-001",
      name: "Test",
      domain: "billing",
      category: "happy_path",
      severity: "high",
    });
    await db.insert(scenarioVersions).values({ id: "sv_1", scenarioId: "scn_1", version: 1, spec: { a: { b: [1, 2] } } });
    const rows = await db.select().from(scenarioVersions).where(eq(scenarioVersions.scenarioId, "scn_1"));
    expect(rows[0]!.spec).toEqual({ a: { b: [1, 2] } });
  });

  it("enforces unique scenario codes per project", async () => {
    await expect(
      handle.db.insert(scenarios).values({
        id: "scn_2",
        projectId: "prj_1",
        code: "SCN-001",
        name: "Dup",
        domain: "billing",
        category: "happy_path",
        severity: "high",
      }),
    ).rejects.toThrow();
  });
});
