import { describe, it, expect } from "vitest";
import { createAuthChallenge } from "./oauth-provider.js";

describe("createAuthChallenge", () => {
  const issuer = "https://mcp.freeappstore.online";

  it("returns 401 with a WWW-Authenticate challenge pointing at the resource metadata", () => {
    const res = createAuthChallenge({ issuer });
    expect(res.status).toBe(401);
    const header = res.headers.get("WWW-Authenticate");
    expect(header).toContain("Bearer");
    expect(header).toContain(
      `resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`,
    );
    // No error param unless asked.
    expect(header).not.toContain("error=");
  });

  it("includes error=invalid_token when a bad token was presented", () => {
    const res = createAuthChallenge({ issuer }, "invalid_token");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});
