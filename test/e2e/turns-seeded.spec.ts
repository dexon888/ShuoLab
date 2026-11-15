import { expect, test } from "@playwright/test";

// Runs against the database seeded with SYNTHETIC placeholder vocabulary, on
// the real Worker runtime with the local stand-in tutor: no model is called
// and nothing is charged. The conversation screen is not built yet, so these
// tests drive the API the way that screen will.

test.describe("tutor turns through the real Worker (SPEC §9, REL-01)", () => {
  test("a typed turn is answered, saved once, and survives a resend", async ({ request }) => {
    const planned = await request.post("/api/v1/sessions/plan", { data: {} });
    expect([200, 201]).toContain(planned.status());
    const { session } = await planned.json();
    const targetIds: string[] = session.plan.targets.map((t: { itemId: string }) => t.itemId);

    const body = {
      clientTurnId: crypto.randomUUID(),
      transcript: "我周末想跟朋友去吃火锅。",
      sourceMode: "typed",
    };
    const first = await request.post(`/api/v1/sessions/${session.id}/turn`, { data: body });
    expect(first.status()).toBe(201);
    const result = await first.json();
    expect(result.provider).toMatchObject({ mock: true });
    expect(result.sessionStatus).toBe("active");
    expect(result.turn.reply.spokenZh).toMatch(/\p{Script=Han}/u);
    expect(result.turn.fallback).toBe(false);
    for (const id of result.turn.referencedCurriculumItemIds) {
      expect(targetIds).toContain(id);
    }
    expect(result.usage.estimatedUsdThisTurn).toBe(0);

    const again = await request.post(`/api/v1/sessions/${session.id}/turn`, { data: body });
    expect(again.status()).toBe(200);
    const replayed = await again.json();
    expect(replayed.replayed).toBe(true);
    expect(replayed.turn.turnId).toBe(result.turn.turnId);

    const saved = await (await request.get(`/api/v1/sessions/${session.id}`)).json();
    const mine = saved.turns.filter((t: { clientTurnId: string }) => t.clientTurnId === body.clientTurnId);
    expect(mine).toHaveLength(1);
    expect(mine[0].learnerText).toBe(body.transcript);
  });

  test("malformed and cross-site turns are refused", async ({ request }) => {
    const { session } = await (await request.post("/api/v1/sessions/plan", { data: {} })).json();
    const url = `/api/v1/sessions/${session.id}/turn`;
    const good = { clientTurnId: crypto.randomUUID(), transcript: "你好", sourceMode: "typed" };

    expect((await request.post(url, { data: { ...good, transcript: "" } })).status()).toBe(400);
    expect((await request.post(url, { data: { ...good, clientTurnId: "x" } })).status()).toBe(400);
    expect((await request.post(url, { data: { ...good, hskLevel: 2 } })).status()).toBe(400);
    expect((await request.post(url, { data: good, headers: { Origin: "https://evil.example" } })).status()).toBe(403);
    expect((await request.post("/api/v1/sessions/11111111-2222-4333-8444-555555555555/turn", { data: good })).status()).toBe(404);
  });
});
