import { expect, test } from "@playwright/test";

const SHOTS = ".data/screenshots";

/**
 * The Definition of Done, through the real UI:
 * dashboard → agent → 50 scenarios → run evaluation (live progress) → trace → failures → failure detail
 * (first divergence, invariant, evidence, fix) → compare v1.0 vs v1.1 → regressions → release gate PASS/FAIL.
 */
test("engineer workflow end to end", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Customer Support Agent v1.1.0" })).toBeVisible();
  await expect(page.getByText(/Behavioral dimensions/)).toBeVisible();
  await expect(page.getByText(/Hard gate failed in/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-overview.png`, fullPage: true });

  await page.goto("/agents");
  await expect(page.getByText("Customer Support Agent")).toBeVisible();
  await expect(page.getByRole("cell", { name: "v1.1.0" })).toBeVisible();

  await page.goto("/scenarios");
  await expect(page.getByText(/50 of 50 scenarios/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-scenarios.png` });

  await page.goto("/scenarios/SCN-017");
  await expect(page.getByText("Billing cancellation while refund is pending")).toBeVisible();
  await expect(page.getByText("BILL-002").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-scenario-detail.png`, fullPage: true });

  // Run an evaluation from the UI and watch it complete.
  await page.goto("/runs?new=1");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/runs\/run_/);
  await expect(page.getByText(/Scenario results \(50\)/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("completed").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-run.png`, fullPage: true });

  // Failure list → failure detail.
  await page.goto("/failures?severity=critical&regression=true");
  await expect(page.getByRole("heading", { name: "Regressions" })).toBeVisible();
  await page.locator("a", { hasText: "Unsafe action" }).first().click();
  await expect(page.getByText(/First divergence at position/)).toBeVisible();
  await expect(page.getByText("Violated invariant")).toBeVisible();
  await expect(page.getByText("Recommended fix")).toBeVisible();
  await expect(page.getByText(/Passed in/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-failure.png`, fullPage: true });

  // Trace viewer.
  await page.getByRole("link", { name: "Open trace" }).click();
  await expect(page).toHaveURL(/\/traces\/trc_/);
  await expect(page.getByRole("heading", { name: "Execution", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("First divergence", { exact: true })).toBeVisible();
  await expect(page.getByText("Evaluation decisions on this step")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-trace.png`, fullPage: true });

  // Compare versions.
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: "Agent comparison" })).toBeVisible();
  await expect(page.getByText("New failure").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-compare.png`, fullPage: true });

  await page.goto("/regression");
  await expect(page.getByText(/New failures, passed before and fail now/)).toBeVisible();

  // Release gate: v1.1.0 is blocked.
  await page.goto("/release-gates");
  const runSelect = page.locator("select").nth(1);
  const v11 = await runSelect.locator("option", { hasText: "v1.1.0 · all" }).first().getAttribute("value");
  await runSelect.selectOption(v11!);
  await page.getByRole("button", { name: "Run release gate" }).click();
  await expect(page.getByText("Release blocked")).toBeVisible();
  await expect(page.getByText(/Do not deploy/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-release-gate.png`, fullPage: true });

  // Command palette.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("SCN-017");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toContainText("Billing cancellation");
  await page.keyboard.press("Escape");
});

test("scenario builder compiles natural language into a validated spec", async ({ page }) => {
  await page.goto("/scenarios/new");
  await page.getByRole("button", { name: "Compile" }).click();
  await expect(page.getByText("rule-based@1")).toBeVisible();
  await expect(page.getByText("valid", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("✓ Valid specification")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/09-builder.png`, fullPage: true });
});
