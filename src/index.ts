import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
  API_BASE: string;
  GITHUB_ORG: string;
}

// GitHub Actions API (public repos, no auth needed)
async function getDeployStatus(org: string, appId: string) {
  const res = await fetch(
    `https://api.github.com/repos/${org}/${appId}/actions/runs?per_page=5`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "freeappstore-mcp" } }
  );
  if (!res.ok) return { error: `GitHub API ${res.status}` };
  const data = (await res.json()) as {
    workflow_runs: Array<{
      name: string;
      conclusion: string | null;
      status: string;
      updated_at: string;
      html_url: string;
      head_sha: string;
    }>;
  };
  return (data.workflow_runs ?? []).map((r) => ({
    name: r.name,
    status: r.conclusion ?? r.status,
    updatedAt: r.updated_at,
    url: r.html_url,
    sha: r.head_sha?.slice(0, 7),
  }));
}

// FAS backend API
async function fasApi(apiBase: string, path: string, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}${path}`, { headers });
  if (!res.ok) return { error: `API ${res.status}: ${await res.text()}` };
  return await res.json();
}

export class FreeAppStoreMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "FreeAppStore",
    version: "0.1.0",
  });

  async init() {
    // ── list_apps ──────────────────────────────────────────────
    this.server.tool(
      "list_apps",
      "List your published apps on FreeAppStore. Requires a FAS session token.",
      { token: z.string().describe("FAS session token from `fas login`") },
      async ({ token }) => {
        const data = (await fasApi(this.env.API_BASE, "/v1/apps/mine", token)) as {
          apps?: Array<{ id: string; store: string; category: string; oneliner: string; appUrl: string; repoUrl: string }>;
          error?: string;
        };
        if (data.error) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }] };
        const apps = data.apps ?? [];
        if (apps.length === 0) return { content: [{ type: "text" as const, text: "No apps published yet." }] };
        const lines = apps.map(
          (a) => `- **${a.id}** (${a.category}) — ${a.oneliner}\n  Live: ${a.appUrl} | Repo: ${a.repoUrl}`
        );
        return { content: [{ type: "text" as const, text: `${apps.length} app(s):\n\n${lines.join("\n")}` }] };
      }
    );

    // ── deploy_status ──────────────────────────────────────────
    this.server.tool(
      "deploy_status",
      "Check the deploy status of an app (last 5 GitHub Actions runs). No auth needed for public repos.",
      { app_id: z.string().describe("App ID (e.g. 'timer', 'pdfreader')") },
      async ({ app_id }) => {
        const runs = await getDeployStatus(this.env.GITHUB_ORG, app_id);
        if ("error" in runs) return { content: [{ type: "text" as const, text: `Error: ${(runs as { error: string }).error}` }] };
        if ((runs as Array<unknown>).length === 0)
          return { content: [{ type: "text" as const, text: `No workflow runs found for ${app_id}.` }] };
        const lines = (runs as Array<{ name: string; status: string; updatedAt: string; sha: string; url: string }>).map(
          (r) => `- ${r.status === "success" ? "✅" : r.status === "failure" ? "❌" : "⏳"} ${r.name} (${r.sha}) — ${r.updatedAt}\n  ${r.url}`
        );
        return { content: [{ type: "text" as const, text: `Deploy history for **${app_id}**:\n\n${lines.join("\n")}` }] };
      }
    );

    // ── app_info ───────────────────────────────────────────────
    this.server.tool(
      "app_info",
      "Get info about any app on FreeAppStore — live URL, repo, store listing.",
      { app_id: z.string().describe("App ID (e.g. 'timer', 'pdfreader')") },
      async ({ app_id }) => {
        const domain = "freeappstore.online";
        const org = this.env.GITHUB_ORG;
        const liveUrl = `https://${app_id}.${domain}`;
        const repoUrl = `https://github.com/${org}/${app_id}`;
        const listingUrl = `https://${domain}/apps/${app_id}`;

        // Check if app is actually live
        const check = await fetch(liveUrl, { method: "HEAD" });
        const status = check.ok ? "Live (200)" : `Down (${check.status})`;

        return {
          content: [{
            type: "text" as const,
            text: [
              `**${app_id}**`,
              `Status: ${status}`,
              `Live: ${liveUrl}`,
              `Repo: ${repoUrl}`,
              `Listing: ${listingUrl}`,
              `Deploy: push to main auto-deploys via GitHub Actions → R2`,
            ].join("\n"),
          }],
        };
      }
    );

    // ── platform_guide ─────────────────────────────────────────
    this.server.tool(
      "platform_guide",
      "Get the FreeAppStore platform guide (SKILLS.md) for AI-assisted development. Returns the full guide that tells you how to build apps on the platform.",
      {},
      async () => {
        const res = await fetch("https://freeappstore.online/skills.md");
        if (!res.ok) return { content: [{ type: "text" as const, text: "Failed to fetch SKILLS.md" }] };
        const text = await res.text();
        return { content: [{ type: "text" as const, text }] };
      }
    );

    // ── sdk_reference ──────────────────────────────────────────
    this.server.tool(
      "sdk_reference",
      "Quick reference for @freeappstore/sdk — imports, features, and usage patterns for auth, KV, counters, collections, rooms, proxy, hooks, and UI components.",
      { feature: z.enum(["all", "auth", "kv", "counters", "collections", "rooms", "proxy", "hooks", "ui"]).optional().describe("Specific feature to look up, or 'all' for the full reference") },
      async ({ feature }) => {
        const sections: Record<string, string> = {
          auth: `## Auth
\`\`\`tsx
import { initApp } from '@freeappstore/sdk'
const fas = initApp({ appId: 'my-app' })
// fas.auth.signIn()  — GitHub OAuth
// fas.auth.signOut()
// fas.auth.token     — current session token (string | null)
// fas.auth.user      — current user ({ id, login, avatarUrl } | null)
\`\`\``,
          kv: `## Per-user KV Storage
\`\`\`tsx
await fas.kv.set('key', { any: 'json' })
const val = await fas.kv.get('key')
await fas.kv.delete('key')
const keys = await fas.kv.list()                // all keys
const filtered = await fas.kv.list({ prefix: 'draft:' })
const many = await fas.kv.getMany(['k1', 'k2']) // batch read
\`\`\`
Limits: 1MB/user, 100 active users/day, 1k ops/min.`,
          counters: `## Shared Counters
\`\`\`tsx
const count = await fas.counters.get('likes')        // public, no auth
await fas.counters.increment('likes')                 // +1, requires auth
await fas.counters.increment('score', 10)             // +10
await fas.counters.increment('lives', -1)             // decrement
const all = await fas.counters.list()                 // all counters
const filtered = await fas.counters.list({ prefix: 'vote:' })
\`\`\`
Not user-scoped. Atomic. Use for votes, views, leaderboards.`,
          collections: `## Collections (Document Database)
\`\`\`tsx
const doc = await fas.collections.create('posts', { title: 'Hello', body: '...' })
const post = await fas.collections.get('posts', doc.id)
const all = await fas.collections.list('posts')
const mine = await fas.collections.list('posts', { mine: true })
await fas.collections.update('posts', doc.id, { title: 'Updated' })
await fas.collections.delete('posts', doc.id)
\`\`\`
Firestore-style. Public queryable JSON documents with ownership.`,
          rooms: `## Real-time Rooms (WebSocket)
\`\`\`tsx
const room = fas.rooms.join('my-room')
room.onMessage((msg) => console.log(msg.from.login, msg.data))
room.onPeers((peers) => console.log('peers:', peers))
room.onState((state) => console.log('connection:', state))
room.send({ type: 'move', x: 10, y: 20 })
room.leave()
\`\`\`
Limits: 5 rooms x 25 peers x 50 user-hours/day per app.`,
          proxy: `## Secret-injecting API Proxy
\`\`\`tsx
const result = await fas.proxy.call('openai', {
  path: '/v1/chat/completions',
  method: 'POST',
  body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hello' }] }
})
\`\`\`
Calls third-party APIs without exposing keys. Keys configured by platform admin.`,
          hooks: `## React Hooks
\`\`\`tsx
import { useAuth, useTheme } from '@freeappstore/sdk/hooks'

const { user, loading, signIn, signOut, deleteAccount } = useAuth(fas)
const { theme, preference, setPreference } = useTheme()
\`\`\``,
          ui: `## UI Components
\`\`\`tsx
import { FasShell, Avatar, SignInButton, ThemeToggle, ProfileMenu, ProfilePage } from '@freeappstore/sdk/ui'

// Full app wrapper with topbar, auth, footer:
<FasShell app={fas} appName="My App" requireAuth>{children}</FasShell>

// Individual components:
<Avatar user={user} size={32} />
<SignInButton app={fas} label="Get started" />
<ThemeToggle />
<ProfileMenu app={fas} />
<ProfilePage app={fas} />
\`\`\``,
        };

        const selected = feature === "all" || !feature
          ? Object.values(sections).join("\n\n")
          : sections[feature] ?? `Unknown feature: ${feature}`;

        return { content: [{ type: "text" as const, text: `# @freeappstore/sdk Reference\n\n${selected}` }] };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        "FreeAppStore MCP Server\n\nConnect: npx mcp-remote https://mcp.freeappstore.online/mcp\n\nTools: list_apps, deploy_status, app_info, platform_guide, sdk_reference\n",
        { headers: { "content-type": "text/plain" } }
      );
    }

    return FreeAppStoreMCP.serve("/mcp").fetch(request, env, ctx);
  },
};
