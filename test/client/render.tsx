import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AppRoutes, createQueryClient } from "../../src/client/app/App";

export type Responder = () => Response;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Renders the whole app at `path`; any request not listed in `routes` fails the test. */
export function renderApp(path: string, routes: Record<string, Responder>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const responder = routes[url];
    if (!responder) throw new Error(`Unexpected request: ${url}`);
    return responder();
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
