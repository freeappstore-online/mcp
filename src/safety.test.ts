import { describe, expect, it } from "vitest";
import {
  audit,
  dryRun,
  listAuditEvents,
  parseScopes,
  requireConfirmation,
  requirePermission,
  type SafetyContext,
} from "./safety.js";

function makeKv(): KVNamespace {
  const data = new Map<string, string>();
  return {
    get: async (key: string) => data.get(key) ?? null,
    put: async (key: string, value: string) => {
      data.set(key, value);
    },
    delete: async (key: string) => {
      data.delete(key);
    },
    list: async ({ prefix = "", limit = 1000 }: { prefix?: string; limit?: number } = {}) => ({
      keys: Array.from(data.keys())
        .filter((name) => name.startsWith(prefix))
        .slice(0, limit)
        .map((name) => ({ name })),
      list_complete: true,
      cursor: undefined,
      cacheStatus: null,
    }),
  } as unknown as KVNamespace;
}

describe("MCP safety helpers", () => {
  it("parses scopes with safe defaults", () => {
    expect(parseScopes(null)).toEqual(["read", "write", "runtime", "destructive"]);
    expect(parseScopes("read runtime unknown")).toEqual(["read", "runtime"]);
    expect(parseScopes("openid email profile")).toEqual(["read", "write", "runtime", "destructive"]);
    expect(parseScopes("unknown")).toEqual(["read", "write", "runtime", "destructive"]);
  });

  it("blocks writes in read-only mode", async () => {
    const ctx: SafetyContext = { env: { MCP_READ_ONLY: "1" }, scopes: ["read", "write"] };
    const result = await requirePermission(ctx, "write", "create_app", {});
    expect(result?.content[0]?.text).toContain("read-only mode");
  });

  it("blocks missing scopes", async () => {
    const ctx: SafetyContext = { env: {}, scopes: ["read"] };
    const result = await requirePermission(ctx, "runtime", "agent_build", {});
    expect(result?.content[0]?.text).toContain('scope "runtime"');
  });

  it("requires exact destructive confirmations", async () => {
    const ctx: SafetyContext = { env: {}, scopes: ["destructive"] };
    const result = await requireConfirmation(ctx, "delete_app", undefined, "delete_app", {});
    expect(result?.content[0]?.text).toContain('confirm="delete_app"');
  });

  it("returns auditable dry-run responses", async () => {
    const ctx: SafetyContext = { env: { OAUTH_KV: makeKv() }, subject: "user-1", scopes: ["write"] };
    const result = await dryRun(ctx, "create_app", "create app", { token: "secret" }, { slug: "demo" });
    const body = JSON.parse(result.content[0]?.text || "{}") as Record<string, unknown>;
    expect(body).toMatchObject({ dryRun: true, tool: "create_app" });
    const events = await listAuditEvents(ctx);
    expect(events).toHaveLength(1);
  });

  it("redacts secrets in audit logs", async () => {
    const ctx: SafetyContext = { env: { OAUTH_KV: makeKv() }, subject: "user-1", scopes: ["write"] };
    await audit(ctx, {
      tool: "create_app",
      input: { secret: "shh", nested: { password: "shh" } },
    });
    const [event] = await listAuditEvents(ctx);
    expect(event).toMatchObject({
      input: { secret: "[redacted]", nested: { password: "[redacted]" } },
    });
  });
});
