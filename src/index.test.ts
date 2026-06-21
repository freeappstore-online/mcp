import { describe, it, expect, vi } from "vitest";
import { sessionPrefix, decodeUid, auditLog } from "./lib.js";
import { textToB64, b64ToText } from "./github.js";
import { verifySession } from "./session.js";

// ── sessionPrefix ─────────────────────────────────────────────

describe("sessionPrefix", () => {
  it("prefixes a normal userId", () => {
    expect(sessionPrefix("user123")).toBe("mcp-user123-");
  });

  it("strips special characters", () => {
    expect(sessionPrefix("user@evil.com")).toBe("mcp-userevilcom-");
  });

  it("truncates to 24 chars", () => {
    const long = "a".repeat(50);
    const prefix = sessionPrefix(long);
    expect(prefix).toBe("mcp-" + "a".repeat(24) + "-");
  });

  it("uses 'anon' for undefined", () => {
    expect(sessionPrefix(undefined)).toBe("mcp-anon-");
  });

  it("uses 'anon' for empty string", () => {
    expect(sessionPrefix("")).toBe("mcp-anon-");
  });

  it("allows hyphens and underscores", () => {
    expect(sessionPrefix("my-user_123")).toBe("mcp-my-user_123-");
  });
});

// ── decodeUid ─────────────────────────────────────────────────

describe("decodeUid", () => {
  it("extracts uid from a valid token payload", () => {
    const payload = { uid: "gh-12345", iat: 1000, exp: 9999999999 };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeUid(`${b64}.fakesig`)).toBe("gh-12345");
  });

  it("returns undefined for token without uid", () => {
    const b64 = btoa(JSON.stringify({ sub: "something" }));
    expect(decodeUid(`${b64}.fakesig`)).toBeUndefined();
  });

  it("returns undefined for garbage token", () => {
    expect(decodeUid("not-a-token")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(decodeUid("")).toBeUndefined();
  });

  it("returns undefined when uid is not a string", () => {
    const b64 = btoa(JSON.stringify({ uid: 12345 }));
    expect(decodeUid(`${b64}.sig`)).toBeUndefined();
  });
});

// ── auditLog ──────────────────────────────────────────────────

describe("auditLog", () => {
  it("logs structured JSON with tool, userId, and extras", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    auditLog("create_app", "user1", { app_id: "piano" });
    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ audit: "mcp", tool: "create_app", userId: "user1", app_id: "piano" });
    expect(typeof logged.ts).toBe("number");
    spy.mockRestore();
  });

  it("uses 'anon' for undefined userId", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    auditLog("update_files", undefined);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.userId).toBe("anon");
    spy.mockRestore();
  });
});

// ── textToB64 / b64ToText ─────────────────────────────────────

describe("textToB64 / b64ToText", () => {
  it("roundtrips ASCII", () => {
    expect(b64ToText(textToB64("hello world"))).toBe("hello world");
  });

  it("roundtrips UTF-8 with emoji", () => {
    const text = "Hello 🌍 world — café";
    expect(b64ToText(textToB64(text))).toBe(text);
  });

  it("roundtrips empty string", () => {
    expect(b64ToText(textToB64(""))).toBe("");
  });

  it("roundtrips multiline code", () => {
    const code = 'import { x } from "y";\n\nexport default () => <div>hi</div>;\n';
    expect(b64ToText(textToB64(code))).toBe(code);
  });

  it("roundtrips JSON with special chars", () => {
    const json = '{"name":"test","desc":"a \\"quoted\\" thing"}';
    expect(b64ToText(textToB64(json))).toBe(json);
  });
});

// ── verifySession ─────────────────────────────────────────────

describe("verifySession", () => {
  const KEY = "test-signing-key-32chars-long!!!";

  async function makeToken(payload: Record<string, unknown>, key = KEY): Promise<string> {
    const body = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(body));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `${body}.${sigB64}`;
  }

  it("verifies a valid token", async () => {
    const token = await makeToken({ uid: "user1", iat: 1000, exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = await verifySession(token, KEY);
    expect(result).not.toBeNull();
    expect(result!.uid).toBe("user1");
  });

  it("rejects an expired token", async () => {
    const token = await makeToken({ uid: "user1", iat: 1000, exp: 1 });
    expect(await verifySession(token, KEY)).toBeNull();
  });

  it("rejects a token signed with the wrong key", async () => {
    const token = await makeToken(
      { uid: "user1", iat: 1000, exp: Math.floor(Date.now() / 1000) + 3600 },
      "wrong-key-wrong-key-wrong-key!!!",
    );
    expect(await verifySession(token, KEY)).toBeNull();
  });

  it("rejects a token with no dot separator", async () => {
    expect(await verifySession("nodottoken", KEY)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await makeToken({ uid: "user1", iat: 1000, exp: Math.floor(Date.now() / 1000) + 3600 });
    const tampered = "dGFtcGVyZWQ" + token.slice(10);
    expect(await verifySession(tampered, KEY)).toBeNull();
  });

  it("returns roles when present", async () => {
    const token = await makeToken({
      uid: "admin1",
      roles: ["admin", "creator"],
      iat: 1000,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifySession(token, KEY);
    expect(result!.roles).toEqual(["admin", "creator"]);
  });
});
