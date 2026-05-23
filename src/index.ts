import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { verifySession } from "./session.js";

interface Env {
  API_BASE: string;
  GITHUB_ORG: string;
  SESSION_SIGNING_KEY?: string;
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

export interface McpProps extends Record<string, unknown> {
  userId?: string;
  token?: string;
}

export class FasMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({
    name: "FreeAppStore",
    version: "0.2.0",
  });

  async init() {
    // ── list_apps ──────────────────────────────────────────────
    this.server.tool(
      "list_apps",
      "List your published apps on FreeAppStore. Requires authentication (connect with a FAS session token).",
      {},
      async () => {
        const token = this.props.token;
        if (!token) {
          return { content: [{ type: "text" as const, text: "Not authenticated. Connect with a FAS session token to use this tool." }] };
        }
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

    // ── app_logs ──────────────────────────────────────────────
    this.server.tool(
      "app_logs",
      "Query recent logs for an app — errors, warnings, SDK calls, build info. Requires authentication (app owner).",
      {
        app_id: z.string().describe("App ID"),
        level: z.enum(["debug", "info", "warn", "error"]).optional().describe("Filter by log level"),
        limit: z.number().optional().describe("Max entries to return (default 50, max 500)"),
      },
      async ({ app_id, level, limit }) => {
        const token = this.props.token;
        if (!token) {
          return { content: [{ type: "text" as const, text: "Not authenticated. Connect with a FAS session token to query logs." }] };
        }
        const params = new URLSearchParams();
        if (level) params.set("level", level);
        params.set("limit", String(limit ?? 50));
        const data = (await fasApi(this.env.API_BASE, `/v1/apps/${app_id}/logs?${params}`, token)) as {
          logs?: Array<{ ts: number; level: string; category: string; message: string; data?: unknown; userId: string; build?: Record<string, unknown> }>;
          error?: string;
        };
        if (data.error) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }] };
        const logs = data.logs ?? [];
        if (logs.length === 0) return { content: [{ type: "text" as const, text: `No logs found for ${app_id}.` }] };
        const lines = logs.map(l => {
          const time = new Date(l.ts).toISOString().slice(11, 23);
          const data = l.data ? ` ${JSON.stringify(l.data)}` : "";
          return `${time} [${l.level.toUpperCase().padEnd(5)}] ${l.category}: ${l.message}${data}`;
        });
        // Include build info if present
        const buildEntry = logs.find(l => l.build);
        let buildInfo = "";
        if (buildEntry?.build) {
          const b = buildEntry.build;
          buildInfo = `\n\n**Build:** ${b.appVersion ?? "?"} (${(b.commitSha as string)?.slice(0, 7) ?? "?"}) built ${b.buildDate ?? "?"} | SDK ${b.sdkVersion ?? "?"} | ${b.viewport ?? "?"}`;
        }
        return { content: [{ type: "text" as const, text: `Logs for **${app_id}** (${logs.length} entries):${buildInfo}\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`` }] };
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
      { feature: z.enum(["all", "auth", "kv", "counters", "collections", "rooms", "proxy", "keys", "hooks", "ui", "free-apis"]).optional().describe("Specific feature to look up, or 'all' for the full reference") },
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
const weather = await fas.proxy.fetch('api.openweathermap.org/data/2.5/weather?q=London')
const data = await weather.json()
\`\`\`
Calls third-party APIs without exposing keys. Developer keys configured by platform admin, user keys stored in the key vault.`,
          keys: `## User API Key Vault
\`\`\`tsx
// Check if user has a key
const hasKey = await fas.keys.has('openai')

// Redirect to platform key management page
fas.keys.manage('openai')

// Check all configured providers
const keys = await fas.keys.status()
// [{ provider: 'openai', label: '...', createdAt: ..., lastUsedAt: ... }]
\`\`\`
Users store their API keys on the platform (encrypted AES-256-GCM). Apps never see plaintext keys. Use \`<KeyPrompt>\` component to prompt users when a key is missing. Supported providers: OpenAI, Anthropic, Google AI, OpenRouter, Replicate, Stability AI, ElevenLabs, Stripe.`,
          hooks: `## React Hooks
\`\`\`tsx
import { useAuth, useTheme } from '@freeappstore/sdk/hooks'

const { user, loading, signIn, signOut, deleteAccount } = useAuth(fas)
const { theme, preference, setPreference } = useTheme()
\`\`\``,
          ui: `## UI Components
\`\`\`tsx
import {
  FasShell, Avatar, SignInButton, ThemeToggle, ProfileMenu, ProfilePage,
  Spinner, Badge, Card, Tabs, Modal, ConfirmDialog, EmptyState,
  ProgressBar, SearchInput, ListRow, ErrorBoundary, KeyPrompt,
} from '@freeappstore/sdk/ui'

// Full app wrapper:
<FasShell app={fas} appName="My App" requireAuth>{children}</FasShell>

// Building blocks:
<Spinner size={24} />
<Badge variant="success">Live</Badge>
<Card onClick={handleClick}>content</Card>
<Tabs tabs={[{key:'a',label:'Tab A'},{key:'b',label:'Tab B'}]} active="a" onChange={setTab} />
<Modal open={isOpen} onClose={close} title="Settings">content</Modal>
<ConfirmDialog open={show} onConfirm={ok} onCancel={cancel} title="Delete?" message="Are you sure?" variant="danger" />
<EmptyState message="No items yet" action={<button>Add one</button>} />
<ProgressBar value={75} label="Upload" />
<SearchInput value={query} onChange={setQuery} />
<ListRow title="Item" subtitle="description" onClick={handleClick} />
<ErrorBoundary fallback={<p>Oops</p>}>{children}</ErrorBoundary>
<KeyPrompt app={fas} provider="openai" providerName="OpenAI" />
\`\`\``,
          "free-apis": `## Free Libraries & APIs (no key needed)

**Client-side libraries** (install and use directly):
- **Maps:** Leaflet + OpenStreetMap (\`pnpm add leaflet react-leaflet\`)
- **Charts:** Recharts (\`pnpm add recharts\`)
- **Rich text:** Tiptap (\`pnpm add @tiptap/react @tiptap/starter-kit\`)
- **Date/time:** date-fns (\`pnpm add date-fns\`)
- **Markdown:** react-markdown (\`pnpm add react-markdown\`)
- **PDF:** react-pdf or jsPDF (\`pnpm add @react-pdf/renderer\`)
- **QR codes:** qrcode.react (\`pnpm add qrcode.react\`)
- **Drag & drop:** dnd-kit (\`pnpm add @dnd-kit/core @dnd-kit/sortable\`)
- **Animations:** Framer Motion (\`pnpm add framer-motion\`)
- **Icons:** Lucide React (\`pnpm add lucide-react\`) — 1500+ icons
- **Forms:** React Hook Form (\`pnpm add react-hook-form\`)
- **State:** Zustand (\`pnpm add zustand\`)

**Free APIs** (no key, call directly from browser):
- Weather: Open-Meteo, Geocoding: Nominatim, Routing: OSRM
- Exchange rates: ExchangeRate-API, Countries: REST Countries
- Dictionary: dictionaryapi.dev, Hacker News: hn.algolia.com
- Wikipedia: MediaWiki API, Open Library: openlibrary.org
- Random users: randomuser.me, Images: picsum.photos

Prefer these before using the proxy. No key = no cost = no setup.`,
        };

        const selected = feature === "all" || !feature
          ? Object.values(sections).join("\n\n")
          : sections[feature] ?? `Unknown feature: ${feature}`;

        return { content: [{ type: "text" as const, text: `# @freeappstore/sdk Reference\n\n${selected}` }] };
      }
    );
  }
}

// ── Auth middleware ─────────────────────────────────────────────
// Extract Bearer token from Authorization header, verify it, and
// pass user info into the DO via URL params (which McpAgent reads as props).
async function authenticateRequest(
  request: Request,
  env: Env,
): Promise<{ userId?: string; token?: string }> {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !env.SESSION_SIGNING_KEY) return {};
  const token = auth.slice(7).trim();
  if (!token) return {};
  const payload = await verifySession(token, env.SESSION_SIGNING_KEY);
  if (!payload) return {};
  return { userId: payload.uid, token };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        "FreeAppStore MCP Server\n\nConnect: npx mcp-remote https://mcp.freeappstore.online/mcp\n\nTools: list_apps, deploy_status, app_info, platform_guide, sdk_reference\n\nAuth: pass Authorization: Bearer <FAS session token> for authenticated tools.\n",
        { headers: { "content-type": "text/plain" } }
      );
    }

    // Authenticate and pass user context into the MCP DO via props.
    if (url.pathname.startsWith("/mcp")) {
      const auth = await authenticateRequest(request, env);
      // Pass auth context as query params — McpAgent.serve reads these as props.
      if (auth.userId) {
        url.searchParams.set("userId", auth.userId);
      }
      if (auth.token) {
        url.searchParams.set("token", auth.token);
      }
      const modifiedRequest = new Request(url.toString(), request);
      return FasMcpAgent.serve("/mcp").fetch(modifiedRequest, env, ctx);
    }

    return FasMcpAgent.serve("/mcp").fetch(request, env, ctx);
  },
};
