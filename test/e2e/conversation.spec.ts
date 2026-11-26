import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// A whole typed session on the real Worker runtime, with SYNTHETIC placeholder
// vocabulary and the local stand-in tutor: no model is called and nothing is
// charged. Each screen size has its own database (playwright.config.ts), and
// the tests run in order because a day has one session.
test.describe.configure({ mode: "serial" });

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow ${where}`).toBeLessThanOrEqual(0);
}

const turns = (page: Page) => page.getByRole("list", { name: "Conversation so far" }).getByRole("listitem");
const box = (page: Page) => page.getByLabel("Your reply in Chinese");

async function say(page: Page, text: string, expectedTurns: number) {
  await box(page).fill(text);
  await box(page).press("Enter");
  await expect(turns(page)).toHaveCount(expectedTurns);
  await expect(turns(page).nth(expectedTurns - 1)).toContainText(text);
  await expect(box(page)).toHaveValue("");
}

test("a typed session from Today to the summary, surviving reloads (FR-010, FR-013)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Start today's session" }).click();
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/);
  const url = page.url();

  await expect(page.getByText("Practice stand-in tutor.")).toBeVisible();
  await expect(page.getByText(/Planned, not started/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish session" })).toHaveCount(0);

  await say(page, "你好！我今天很好。", 1);
  await expect(page.getByText(/In progress/)).toBeVisible();
  await expect(turns(page).first()).toContainText("Tutor");
  await say(page, "我周末想跟朋友去吃火锅。", 2);
  await expectNoSidewaysScroll(page, "during the conversation");

  // A reload shows the same two turns, once each.
  await page.reload();
  await expect(turns(page)).toHaveCount(2);
  await expect(page.getByText("你好！我今天很好。")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Half-typed text survives a reload too.
  await box(page).fill("写到一半");
  await page.reload();
  await expect(box(page)).toHaveValue("写到一半");
  await box(page).fill("");

  // Pause, reload, resume.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused time is not counted as practice. Your conversation is saved.")).toBeVisible();
  await expect(box(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.goto("/");
  await page.getByRole("link", { name: "Resume today's session" }).click();
  await expect(page).toHaveURL(url);
  await page.getByRole("button", { name: "Resume" }).click();
  await say(page, "我们去哪儿吃？", 3);

  // Finish, with a confirmation step.
  await page.getByRole("button", { name: "Finish session" }).click();
  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(box(page)).toBeVisible();
  await page.getByRole("button", { name: "Finish session" }).click();
  await page.getByRole("button", { name: "Yes, finish" }).click();

  const summary = page.getByRole("region", { name: "Session summary" });
  await expect(summary).toContainText("3 turns: 3 typed, 0 spoken.");
  await expect(summary).toContainText("Typed turns are writing practice. They are not counted as speaking.");
  await expect(page.getByRole("region", { name: "Today's words" })).toContainText("Using a word once is not evidence that you know it");
  await expect(page.getByRole("region", { name: "Corrections worth keeping" })).toBeVisible();
  await expect(box(page)).toHaveCount(0);
  await expect(turns(page)).toHaveCount(3);
  await expectNoSidewaysScroll(page, "on the summary");

  // The summary is the same after a reload, and Today is free for a new session.
  await page.reload();
  await expect(page.getByRole("region", { name: "Session summary" })).toContainText("3 turns: 3 typed, 0 spoken.");
  await expect(page.getByText(/· Complete/)).toBeVisible();
  await page.getByRole("link", { name: "Back to Today" }).click();
  await expect(page.getByRole("button", { name: "Start today's session" })).toBeVisible();
  await expect(page.getByText("Recent sessions")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a message that fails to send is kept and saved once when sent again (REL-01)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start today's session" }).click();
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/);

  // The connection drops for the first attempt only.
  const ids: string[] = [];
  let dropped = false;
  await page.route("**/api/v1/sessions/*/turn", async (route) => {
    ids.push(route.request().postDataJSON().clientTurnId);
    if (!dropped) {
      dropped = true;
      await route.abort("connectionfailed");
    } else {
      await route.continue();
    }
  });

  await box(page).fill("我想喝茶。");
  await page.getByRole("button", { name: "Send" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("That message was not answered.");
  await expect(alert).toContainText("Can't reach ShuoLab.");
  await expect(page.getByText("我想喝茶。")).toBeVisible();

  // Even a reload keeps it, and says it may not have been sent.
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("This message may not have been sent.");
  await page.getByRole("button", { name: "Send again" }).click();

  await expect(turns(page)).toHaveCount(1);
  await expect(page.getByText("我想喝茶。")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);

  await page.reload();
  await expect(turns(page)).toHaveCount(1);
});

test("the message box and controls are large enough to tap and work from the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Resume today's session|Open today's plan/ }).click();

  for (const name of ["Send", "Pause", "Finish session"]) {
    const size = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(size?.height ?? 0, `${name} button height`).toBeGreaterThanOrEqual(44);
  }
  await box(page).focus();
  await page.keyboard.type("好的。");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Speak", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(turns(page)).toHaveCount(2);
  await expectNoSidewaysScroll(page, "after a keyboard-only turn");
});

test("speaking with the stand-in: a spoken turn, an unsure transcript to check, and listen-first (SPEC §7.1, §7.4)", async ({ page }) => {
  const errors = trackErrors(page);
  // The stand-in hears what this script says, in order. It never opens the microphone.
  await page.addInitScript(() => {
    (window as unknown as { __shuolabFakeSpeech: unknown }).__shuolabFakeSpeech = {
      recognitions: [
        { text: "我周末喜欢去公园。", confidence: 0.93, seconds: 2.5 },
        { text: "我想喝差。", confidence: 0.35, seconds: 1.8 },
        { noSpeech: true },
      ],
    };
  });
  await page.goto("/");
  await page.getByRole("link", { name: /Resume today's session|Open today's plan/ }).click();
  // The earlier tests left two turns in today's session; wait for them before counting.
  await expect(turns(page).first()).toBeVisible();
  const before = await turns(page).count();

  await expect(page.getByText("Practice stand-in speech.")).toBeVisible();
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(turns(page)).toHaveCount(before + 1);
  const spoken = turns(page).last();
  await expect(spoken).toContainText("我周末喜欢去公园。");
  await expect(spoken).toContainText("(spoken)");

  // An unsure transcript waits in the box to be checked.
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(page.getByText(/Speech recognition wasn't sure it heard this right/)).toBeVisible();
  await expect(box(page)).toHaveValue("我想喝差。");
  await box(page).press("End");
  await box(page).press("Backspace");
  await box(page).press("Backspace");
  await box(page).pressSequentially("茶。");
  await box(page).press("Enter");
  await expect(turns(page)).toHaveCount(before + 2);
  await expect(turns(page).last()).toContainText("我想喝茶。");
  await expect(turns(page).last()).toContainText("(spoken)");

  // Nothing heard: a message, and nothing sent.
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Didn't hear anything.");
  await expect(turns(page)).toHaveCount(before + 2);

  // Listen first hides the newest reply's text until asked.
  await page.getByRole("checkbox", { name: /Listen first/ }).check();
  await expect(page.getByText("Text hidden so you can listen first.")).toBeVisible();
  await page.getByRole("button", { name: "Show text" }).click();
  await expect(page.getByText("Text hidden so you can listen first.")).toHaveCount(0);

  // Both spoken turns, and the reveal, are on the server.
  const sessionId = page.url().split("/").pop();
  const saved = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json();
  const last = saved.turns.slice(-2);
  expect(last.map((t: { sourceMode: string }) => t.sourceMode)).toEqual(["speech", "speech"]);
  expect(saved.turns.at(-1).listening.revealedAt).not.toBeNull();
  // The stand-in is not counted against the free allowance.
  const usage = await (await page.request.get("/api/v1/usage/monthly")).json();
  expect(usage.speech.recognitionSeconds).toBe(0);

  for (const name of ["Speak", "Send"]) {
    const size = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(size?.height ?? 0, `${name} button height`).toBeGreaterThanOrEqual(44);
  }
  await expectNoSidewaysScroll(page, "with the voice controls");
  expect(errors).toEqual([]);
});

test("listen first: hear an exchange, answer before seeing the text, then read it (SPEC §5.3, §6.5)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Resume today's session|Open today's plan/ }).click();
  const listen = page.getByRole("region", { name: "Listen first" });

  await listen.getByRole("button", { name: "Start listening" }).click();
  await expect(listen.getByText("Practice stand-in exchange.")).toBeVisible();
  await expect(listen.getByRole("button", { name: "Play the exchange" })).toBeVisible();
  // No text before an attempt.
  await expect(page.getByText("你周末有空吗？")).toHaveCount(0);
  await listen.getByRole("button", { name: "Play the exchange" }).click();

  // The stand-in's options are shuffled; pick the right ones by their words.
  await listen.getByRole("group", { name: /When is the second speaker free/ }).getByLabel(/Saturday afternoon/).check();
  await listen.getByRole("group", { name: /What does the first speaker suggest/ }).getByLabel(/Staying at home/).check();
  await listen.getByRole("button", { name: "Check answers" }).click();
  await expect(listen.getByText("1 of 2 correct")).toBeVisible();
  await expect(listen.getByText(/answered before seeing the text/)).toBeVisible();

  await listen.getByRole("button", { name: "Show the text" }).click();
  await expect(listen.getByText("你周末有空吗？")).toBeVisible();
  await expectNoSidewaysScroll(page, "with the listening exercise");

  // A reload shows the same exercise and result; nothing is written twice.
  await page.reload();
  await expect(listen.getByText("1 of 2 correct")).toBeVisible();
  const sessionId = page.url().split("/").pop();
  const saved = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json();
  expect(saved.listening.result).toEqual({ correct: 1, total: 2, unassisted: true });
  expect(saved.listening.revealedAt).not.toBeNull();
  // The stand-in plays nothing, so nothing is recorded as heard.
  expect(saved.listening.playedAt).toBeNull();

  for (const name of ["Play the exchange", "Play slower"]) {
    const size = await listen.getByRole("button", { name, exact: true }).boundingBox();
    expect(size?.height ?? 0, `${name} button height`).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});

test("review: words from the finished session come back as cards to rate (SPEC §5.5, FR-014, FR-015)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/review");
  const card = page.getByRole("article", { name: "Review card" });
  await expect(card).toBeVisible();
  const counts = page.getByText(/due of \d+ cards/);
  const before = Number((await counts.textContent())?.match(/^(\d+)/)?.[1]);
  expect(before).toBeGreaterThan(0);
  await expect(card.getByText("Generated placeholder word for testing. Not HSK content.")).toBeVisible();

  // Skipping keeps a card due; showing and rating it schedules it.
  await card.getByRole("button", { name: "Show answer" }).click();
  await expect(card.getByText(/No English definition is imported|Source:/)).toBeVisible();
  await card.getByRole("button", { name: /^Good/ }).click();
  await expect(page.getByText(new RegExp(`^${before - 1} due of`))).toBeVisible();
  await expectNoSidewaysScroll(page, "on the review page");

  for (const name of [/^Show answer/, /^Skip for now/]) {
    const size = await card.getByRole("button", { name }).boundingBox();
    expect(size?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  // The rating is on the server, once, as the learner's own recall.
  const due = await (await page.request.get("/api/v1/reviews/due?limit=50")).json();
  expect(due.dueCount).toBe(before - 1);
  expect(due.cards.some((c: { mastery: string }) => c.mastery === "mastered")).toBe(false);
  expect(errors).toEqual([]);
});

test("progress: practice, communication and coverage, each with its sample (SPEC §5.6)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/progress");
  await expect(page.getByRole("region", { name: "Practice time" })).toBeVisible();
  const finished = page.getByText("Sessions finished").locator("..");
  await expect(finished).toContainText(/[1-9]/);

  // One review rating so far: too few for a recall rate.
  await expect(page.getByText("Insufficient evidence: 1 rating of the 5 needed.")).toBeVisible();
  const table = page.getByRole("table", { name: "Entries per band by evidence state" });
  await expect(table.getByRole("row", { name: /^All bands/ })).toContainText("11000");
  await expect(page.getByText(/Generated placeholder words for testing, not HSK content/)).toBeVisible();
  await expectNoSidewaysScroll(page, "on the progress page");

  await page.getByText("Show as a table").click();
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");

  // Today shows the same evidence in brief.
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Communication progress" })).toContainText(/minutes of practice on \d of the last 7 days/);
  await expect(page.getByRole("region", { name: "Review" })).toContainText(/cards? due/);
  await expectNoSidewaysScroll(page, "on Today with progress");
  expect(errors).toEqual([]);
});

test("your data: export downloads, then deleting a session and everything (FR-019, SPEC §8.4)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/settings");
  const data = page.getByRole("region", { name: "Your data" });

  // The JSON export is a real download holding every owner table.
  const [download] = await Promise.all([page.waitForEvent("download"), data.getByRole("link", { name: "Download JSON" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^shuolab-export-\d{4}-\d{2}-\d{2}\.json$/);
  const doc = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(doc).toMatchObject({ format: "shuolab-export", schemaVersion: 1 });
  expect(doc.tables.sessions.length).toBeGreaterThan(0);
  expect(doc.tables.review_events.length).toBeGreaterThan(0);
  const csv = await page.request.get("/api/v1/export?format=csv&table=conversation_turns");
  expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");

  // Delete one session from its own page.
  const sessionId = doc.tables.sessions[0].id as string;
  await page.goto(`/session/${sessionId}`);
  await page.getByRole("button", { name: "Delete this session…" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get(`/api/v1/sessions/${sessionId}`)).status()).toBe(404);

  // Then everything.
  await page.goto("/settings");
  await data.getByRole("button", { name: "Delete all my data…" }).click();
  await data.getByLabel("Type DELETE MY DATA to confirm").fill("DELETE MY DATA");
  await data.getByRole("button", { name: "Delete everything" }).click();
  await expect(data.getByText(/^Deleted \d+ records\.$/)).toBeVisible();
  const after = await (await page.request.get("/api/v1/my-data")).json();
  expect(after.counts.sessions).toBe(0);
  expect(after.counts.review_cards).toBe(0);
  await expectNoSidewaysScroll(page, "on Settings after deleting");
  expect(errors).toEqual([]);
});
