/**
 * Single-owner authentication (SPEC §4.1, SEC-01).
 *
 * Production: the Cloudflare Access JWT is verified here, at the application
 * layer, against the team's published keys, audience and issuer. Identity
 * headers such as `Cf-Access-Authenticated-User-Email` are never trusted.
 *
 * Local development: `DEV_AUTH_BYPASS=true` skips verification, but only when
 * APP_ENV is development/test and the request is addressed to a loopback host.
 * A bypass flag in any other environment makes every API route fail.
 */
import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { hasValue, isProduction, type Env } from "../env";
import { ApiError } from "../validation/errors";

export interface Owner {
  email: string | null;
  authMode: "access" | "dev-bypass";
}

export type AppBindings = {
  Bindings: Env;
  Variables: { owner: Owner };
};

export interface AuthDeps {
  /** Overrides the remote JWKS lookup; used by tests with a local key set. */
  getKey?: JWTVerifyGetKey;
}

const JWT_HEADER = "Cf-Access-Jwt-Assertion";
const JWT_COOKIE = "CF_Authorization";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function remoteKeySet(teamDomain: string): JWTVerifyGetKey {
  let keySet = remoteKeySets.get(teamDomain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    remoteKeySets.set(teamDomain, keySet);
  }
  return keySet;
}

function normalizeTeamDomain(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return /^https:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isLoopback(url: string): boolean {
  const { hostname } = new URL(url);
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

/** True when the dev bypass flag is set somewhere it must never be. */
export function hasForbiddenBypass(env: Env): boolean {
  return env.DEV_AUTH_BYPASS === "true" && isProduction(env);
}

/**
 * Rejects every request when the deployment is misconfigured in a way that
 * would weaken authentication. Mounted before all routes, including /health.
 */
export function configGuard(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (hasForbiddenBypass(c.env)) {
      console.error("DEV_AUTH_BYPASS is set outside development; refusing all API requests.");
      throw new ApiError(
        "CONFIG_INVALID",
        "This deployment is misconfigured and is refusing requests.",
      );
    }
    await next();
  };
}

export function requireOwner(deps: AuthDeps = {}): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const env = c.env;

    if (env.DEV_AUTH_BYPASS === "true") {
      // configGuard has already rejected production; this is defence in depth.
      if (isProduction(env) || !isLoopback(c.req.url)) {
        throw new ApiError("FORBIDDEN", "Development sign-in bypass is only available on localhost.");
      }
      c.set("owner", { email: hasValue(env.OWNER_EMAIL) ? env.OWNER_EMAIL : null, authMode: "dev-bypass" });
      await next();
      return;
    }

    if (!hasValue(env.ACCESS_TEAM_DOMAIN) || !hasValue(env.ACCESS_AUD) || !hasValue(env.OWNER_EMAIL)) {
      throw new ApiError(
        "AUTH_NOT_CONFIGURED",
        "Cloudflare Access is not configured. Set OWNER_EMAIL, ACCESS_TEAM_DOMAIN and ACCESS_AUD (see README).",
      );
    }

    const token = c.req.header(JWT_HEADER) ?? readCookie(c.req.header("Cookie"), JWT_COOKIE);
    if (!token) {
      throw new ApiError("UNAUTHENTICATED", "Sign in through Cloudflare Access to use ShuoLab.");
    }

    const issuer = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
    let email: unknown;
    try {
      const { payload } = await jwtVerify(token, deps.getKey ?? remoteKeySet(issuer), {
        issuer,
        audience: env.ACCESS_AUD,
        algorithms: ["RS256"],
      });
      email = payload.email;
    } catch {
      // Do not echo verification details or token contents.
      throw new ApiError("UNAUTHENTICATED", "Your sign-in is invalid or has expired. Sign in again.");
    }

    if (typeof email !== "string" || email.toLowerCase() !== env.OWNER_EMAIL.trim().toLowerCase()) {
      throw new ApiError("FORBIDDEN", "This account is not the owner of this ShuoLab.");
    }

    c.set("owner", { email, authMode: "access" });
    await next();
  };
}
