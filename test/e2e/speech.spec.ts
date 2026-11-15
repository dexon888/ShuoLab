import { expect, test } from "@playwright/test";

// The real Worker runtime with the local stand-in token issuer: nothing is
// sent to Azure. The desktop and 320px projects share this database.

test.describe("speech tokens and the free-tier count (SPEC §7.1)", () => {
  test("a token is issued with the month's allowance and is never cached", async ({ request }) => {
    const res = await request.post("/api/v1/speech/token");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ mock: true, region: "local" });
    expect(body.allowance.recognitionLimitSeconds).toBe(18000);
    expect(body.allowance.synthesisLimitChars).toBe(500000);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  test("tokens cannot be fetched with GET or from another site", async ({ request }) => {
    expect((await request.get("/api/v1/speech/token")).status()).toBe(404);
    expect((await request.post("/api/v1/speech/token", { headers: { Origin: "https://evil.example" } })).status()).toBe(403);
  });

  test("a usage report is counted once and shows in Settings", async ({ request, page }) => {
    const event = { clientEventId: crypto.randomUUID(), kind: "synthesis", characters: 42 };
    expect((await request.post("/api/v1/speech/usage", { data: event })).status()).toBe(201);
    expect((await request.post("/api/v1/speech/usage", { data: event })).status()).toBe(200);
    expect((await request.post("/api/v1/speech/usage", { data: { ...event, characters: 5000 } })).status()).toBe(400);

    await page.goto("/settings");
    const region = page.getByRole("region", { name: "Spending this month" });
    await expect(region).toContainText("Speech (Azure free tier)");
    await expect(region).toContainText(/Spoken replies: [\d,]+ of 500,000 characters\./);
  });
});
