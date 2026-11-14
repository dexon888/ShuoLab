import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";

export const TEAM_DOMAIN = "https://shuolab-test.cloudflareaccess.com";
export const AUD = "test-audience-tag";
export const OWNER_EMAIL = "owner@example.test";

export interface TokenOptions {
  email?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
}

export interface AccessFixture {
  /** Key resolver for the genuine signing key, as the Access JWKS would provide. */
  getKey: JWTVerifyGetKey;
  /** Signs a token with the genuine key. */
  sign: (options?: TokenOptions) => Promise<string>;
  /** Signs a token with a different key that the JWKS does not contain. */
  signWithUnknownKey: (options?: TokenOptions) => Promise<string>;
}

async function signer(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const sign = (options: TokenOptions = {}) =>
    new SignJWT({ email: options.email ?? OWNER_EMAIL })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(options.issuer ?? TEAM_DOMAIN)
      .setAudience(options.audience ?? AUD)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(privateKey);
  return { jwk, sign };
}

/** Locally generated stand-in for Cloudflare Access: no network, no real identities. */
export async function createAccessFixture(): Promise<AccessFixture> {
  const genuine = await signer("genuine");
  const other = await signer("genuine"); // same kid, different key material
  return {
    getKey: createLocalJWKSet({ keys: [genuine.jwk] }),
    sign: genuine.sign,
    signWithUnknownKey: other.sign,
  };
}
