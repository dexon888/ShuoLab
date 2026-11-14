import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server";
import type { Env } from "../../src/server/env";
import {
  curriculumStatusResponseSchema,
  errorEnvelopeSchema,
  healthResponseSchema,
  meResponseSchema,
} from "../../src/shared/api";
import { AUD, OWNER_EMAIL, TEAM_DOMAIN, createAccessFixture, type AccessFixture } from "../helpers/access";
import { createTestDatabase, type TestDatabase } from "../helpers/d1";

let database: TestDatabase;
let access: AccessFixture;
let app: ReturnType<typeof createApp>;

const PROD_ORIGIN = "https://shuolab.example.test";

function prodEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: database.db,
    APP_ENV: "production",
    OWNER_EMAIL,
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUD,
    ...overrides,
  };
}

function devEnv(overrides: Partial<Env> = {}): Env {
  return { DB: database.db, APP_ENV: "development", DEV_AUTH_BYPASS: "true", ...overrides };
}

async function get(path: string, env: Env, init: { origin?: string; headers?: Record<string, string> } = {}) {
  return app.request(`${init.origin ?? PROD_ORIGIN}/api/v1${path}`, { headers: init.headers }, env);
}

async function errorCode(res: Response): Promise<string> {
  return errorEnvelopeSchema.parse(await res.json()).error.code;
}

beforeAll(async () => {
  database = await createTestDatabase();
  access = await createAccessFixture();
  app = createApp({ auth: { getKey: access.getKey } });
});

afterAll(async () => {
  await database.dispose();
});

describe("GET /health", () => {
  it("is public and returns only safe status", async () => {
    const res = await get("/health", prodEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(healthResponseSchema.parse(body)).toEqual({ ready: true, version: "test" });
    expect(Object.keys(body as object).sort()).toEqual(["ready", "version"]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("owner authentication (FR-002, SEC-01)", () => {
  it("rejects a request with no Access token", async () => {
    const res = await get("/me", prodEnv());
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHENTICATED");
  });

  it("does not trust an unverified identity header", async () => {
    const res = await get("/me", prodEnv(), {
      headers: { "Cf-Access-Authenticated-User-Email": OWNER_EMAIL },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid owner token from the header", async () => {
    const res = await get("/me", prodEnv(), {
      headers: { "Cf-Access-Jwt-Assertion": await access.sign() },
    });
    expect(res.status).toBe(200);
    const me = meResponseSchema.parse(await res.json());
    expect(me.owner).toEqual({ email: OWNER_EMAIL, authMode: "access" });
  });

  it("accepts a valid owner token from the CF_Authorization cookie", async () => {
    const res = await get("/me", prodEnv(), {
      headers: { Cookie: `other=1; CF_Authorization=${await access.sign()}` },
    });
    expect(res.status).toBe(200);
  });

  it("matches the owner email case-insensitively", async () => {
    const res = await get("/me", prodEnv({ OWNER_EMAIL: OWNER_EMAIL.toUpperCase() }), {
      headers: { "Cf-Access-Jwt-Assertion": await access.sign() },
    });
    expect(res.status).toBe(200);
  });

  it("forbids a validly signed token for a different person", async () => {
    const res = await get("/me", prodEnv(), {
      headers: { "Cf-Access-Jwt-Assertion": await access.sign({ email: "someone-else@example.test" }) },
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it.each([
    ["wrong audience", { audience: "another-app" }],
    ["wrong issuer", { issuer: "https://attacker.cloudflareaccess.com" }],
    ["expired", { expiresIn: "-1m" }],
  ])("rejects a token with %s", async (_label, options) => {
    const res = await get("/me", prodEnv(), {
      headers: { "Cf-Access-Jwt-Assertion": await access.sign(options) },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token signed by a key that is not in the JWKS", async () => {
    const res = await get("/me", prodEnv(), {
      headers: { "Cf-Access-Jwt-Assertion": await access.signWithUnknownKey() },
    });
    expect(res.status).toBe(401);
  });

  it("rejects garbage tokens without leaking details", async () => {
    const res = await get("/me", prodEnv(), { headers: { "Cf-Access-Jwt-Assertion": "not-a-jwt" } });
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("not-a-jwt");
  });

  it("fails closed when Access is not configured", async () => {
    const res = await get("/me", prodEnv({ ACCESS_AUD: undefined }), {
      headers: { "Cf-Access-Jwt-Assertion": await access.sign() },
    });
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("AUTH_NOT_CONFIGURED");
  });

  it("protects unknown API routes too", async () => {
    const res = await get("/does-not-exist", prodEnv());
    expect(res.status).toBe(401);
  });
});

describe("development bypass (SPEC §4.1)", () => {
  it("works on localhost in development", async () => {
    const res = await get("/me", devEnv(), { origin: "http://localhost:5173" });
    expect(res.status).toBe(200);
    expect(meResponseSchema.parse(await res.json()).owner.authMode).toBe("dev-bypass");
  });

  it("is refused for a non-loopback host even in development", async () => {
    const res = await get("/me", devEnv(), { origin: "https://shuolab.example.test" });
    expect(res.status).toBe(403);
  });

  it.each(["production", undefined, "staging"])(
    "hard-fails every route, including /health, when APP_ENV is %s",
    async (appEnv) => {
      const env = devEnv({ APP_ENV: appEnv });
      for (const path of ["/health", "/me", "/curriculum/status"]) {
        const res = await get(path, env, { origin: "http://localhost:5173" });
        expect(res.status).toBe(500);
        expect(await errorCode(res)).toBe("CONFIG_INVALID");
      }
    },
  );
});

describe("provider status (FR-012)", () => {
  it("reports mock providers in development without keys", async () => {
    const res = await get("/me", devEnv(), { origin: "http://localhost:5173" });
    const me = meResponseSchema.parse(await res.json());
    expect(me.providers.map((p) => [p.id, p.mode])).toEqual([
      ["tutor", "mock"],
      ["speech", "mock"],
    ]);
  });

  it("reports missing providers with setup guidance in production without keys", async () => {
    const res = await get("/me", prodEnv(), {
      headers: { "Cf-Access-Jwt-Assertion": await access.sign() },
    });
    const me = meResponseSchema.parse(await res.json());
    for (const provider of me.providers) {
      expect(provider.mode).toBe("missing");
      expect(provider.setupHint).toBeTruthy();
    }
  });

  it("reports live providers without ever returning the secret", async () => {
    const env = prodEnv({
      OPENAI_API_KEY: "sk-test-secret-value",
      AZURE_SPEECH_KEY: "azure-test-secret-value",
      AZURE_SPEECH_REGION: "eastus",
    });
    const res = await get("/me", env, { headers: { "Cf-Access-Jwt-Assertion": await access.sign() } });
    const text = await res.text();
    expect(text).not.toContain("sk-test-secret-value");
    expect(text).not.toContain("azure-test-secret-value");
    const me = meResponseSchema.parse(JSON.parse(text));
    expect(me.providers.map((p) => p.mode)).toEqual(["live", "live"]);
    expect(me.providers[0]?.model).toBe("gpt-6-luna");
  });
});

describe("GET /curriculum/status on real D1 (FR-005, FR-016)", () => {
  const headers = async () => ({ "Cf-Access-Jwt-Assertion": await access.sign() });

  it("reports an honest not-imported state on an empty database", async () => {
    const res = await get("/curriculum/status", prodEnv(), { headers: await headers() });
    expect(res.status).toBe(200);
    const status = curriculumStatusResponseSchema.parse(await res.json());

    expect(status.activeEdition).toBeNull();
    expect(status.manifests).toEqual([]);
    for (const dimension of status.dimensions) {
      expect(dimension.status).toBe("missing");
      expect(dimension.importedCount).toBe(0);
    }
    expect(status.vocabByBand.map((b) => b.band)).toEqual(["1", "2", "3", "4", "5", "6", "7-9"]);
    expect(status.vocabByBand.at(-1)).toMatchObject({ expectedNew: 5600, expectedCumulative: 11000 });

    const me = meResponseSchema.parse(
      await (await get("/me", prodEnv(), { headers: await headers() })).json(),
    );
    expect(me.curriculumImported).toBe(false);
  });

  it("never reports a partial import as verified", async () => {
    const db = database.db;
    await db
      .prepare(
        "INSERT INTO curriculum_editions (id, publisher, edition_date, is_active) VALUES (?, ?, ?, 1)",
      )
      .bind("test-edition", "Synthetic test fixture", "2025-11-01")
      .run();
    // Synthetic placeholder rows — not HSK content.
    for (let sourceId = 1; sourceId <= 3; sourceId++) {
      await db
        .prepare(
          "INSERT INTO curriculum_items (id, edition_id, source_id, item_type, hsk_band, hanzi) VALUES (?, ?, ?, 'vocab', '1', ?)",
        )
        .bind(`test-edition:vocab:${sourceId}`, "test-edition", sourceId, `测${sourceId}`)
        .run();
    }
    await db
      .prepare(
        "INSERT INTO curriculum_items (id, edition_id, source_id, item_type, hsk_band, hanzi) VALUES (?, ?, 1, 'grammar', '1', ?)",
      )
      .bind("test-edition:grammar:1", "test-edition", "测试语法")
      .run();

    const res = await get("/curriculum/status", prodEnv(), { headers: await headers() });
    const status = curriculumStatusResponseSchema.parse(await res.json());

    expect(status.activeEdition?.id).toBe("test-edition");
    const vocab = status.dimensions.find((d) => d.itemType === "vocab");
    expect(vocab).toMatchObject({ status: "imported", importedCount: 3, expectedCount: 11000 });
    const grammar = status.dimensions.find((d) => d.itemType === "grammar");
    expect(grammar).toMatchObject({ status: "imported", importedCount: 1, expectedCount: null });
    expect(status.vocabByBand[0]).toMatchObject({ band: "1", importedNew: 3, expectedNew: 300 });
  });
});

describe("schema constraints (SPEC §8.1)", () => {
  const insert = (id: string, sourceId: number, band: string, type = "vocab") =>
    database.db
      .prepare(
        "INSERT INTO curriculum_items (id, edition_id, source_id, item_type, hsk_band, hanzi) VALUES (?, 'test-edition', ?, ?, ?, '测')",
      )
      .bind(id, sourceId, type, band)
      .run();

  it("rejects separate HSK 7, 8 or 9 bands", async () => {
    for (const band of ["7", "8", "9", "0", "HSK1"]) {
      await expect(insert(`test-edition:vocab:9${band}`, 900, band)).rejects.toThrow();
    }
  });

  it("accepts the shared 7-9 band", async () => {
    await expect(insert("test-edition:vocab:500", 500, "7-9")).resolves.toBeDefined();
  });

  it("rejects a duplicate source id within an edition and type", async () => {
    await expect(insert("test-edition:vocab:dup", 1, "1")).rejects.toThrow();
  });

  it("rejects unknown item types and non-positive source ids", async () => {
    await expect(insert("test-edition:slang:1", 7000, "1", "slang")).rejects.toThrow();
    await expect(insert("test-edition:vocab:0", 0, "1")).rejects.toThrow();
  });

  it("rejects items that reference a missing edition", async () => {
    await expect(
      database.db
        .prepare(
          "INSERT INTO curriculum_items (id, edition_id, source_id, item_type, hsk_band, hanzi) VALUES ('x:vocab:1', 'no-such-edition', 1, 'vocab', '1', '测')",
        )
        .run(),
    ).rejects.toThrow();
  });
});
