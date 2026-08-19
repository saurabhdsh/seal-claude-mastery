import { test, expect } from "@playwright/test";

test("admin login reaches command center", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Claude Mastery/i })).toBeVisible();
  await page.getByLabel("Email").fill("superadmin@seal.local");
  await page.getByLabel("Password").fill("SealAdmin!2026");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible({ timeout: 15000 });
});

test("trainee login shows assessment home", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("elena.voss@seal.local");
  await page.getByLabel("Password").fill("SealTrainee!2026");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Continue to instructions" })).toBeVisible({ timeout: 15000 });
});
