import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AppRoutes, createQueryClient } from "../../src/client/app/App";
import { defaultSettings, type OwnerSettings } from "../../src/shared/settings";

export type Responder = (init?: RequestInit) => Response;

/** Settings of an owner who has finished onboarding. */
export function savedSettings(over: Partial<OwnerSettings> = {}): OwnerSettings {
  return {
    ...defaultSettings(),
    onboardedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Renders the whole app at `path`; any request not listed in `routes` fails the test. */
export function renderApp(path: string, routes: Record<string, Responder>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    // Writes are listed as "PUT /path"; reads by path alone.
    const responder = routes[method === "GET" ? url : `${method} ${url}`];
    if (!responder) throw new Error(`Unexpected request: ${method} ${url}`);
    return responder(init);
  });
  vi.stubGlobal("fetch", fetchMock);

  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}
