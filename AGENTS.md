# Agent Instructions — FreeAppStore

Use FreeAppStore **only** through the configured MCP server.

```
Endpoint: https://mcp.freeappstore.online/mcp
```

## Rules

- Do not call the REST API (`api.freeappstore.online`) directly.
- Do not use the web UI (console, admin, publisher portals).
- First inspect available MCP tools before taking action.
- Prefer read-only tools (`app_info`, `list_files`, `deploy_status`) unless the task explicitly requires changes.
- Confirm before destructive actions (`update_files` overwrites files, `create_app` provisions infrastructure).

## Setup

Claude Code:
```bash
claude mcp add freeappstore -- npx mcp-remote https://mcp.freeappstore.online/mcp
```

Codex:
```bash
codex mcp add freeappstore --url https://mcp.freeappstore.online/mcp
```

Project-local (`.mcp.json`):
```json
{
  "mcpServers": {
    "freeappstore": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.freeappstore.online/mcp"]
    }
  }
}
```

## Workflow Recipes

### Create and deploy a new app
```
1. create_app       — provision repo + hosting + store listing
2. list_files       — see the scaffolded template
3. read_file        — read web/src/App.tsx (main entry point)
4. update_files     — write your code (auto-deploys in ~30-60s)
5. deploy_status    — confirm it's live
```

### Improve an existing app
```
1. list_apps        — find the app you own
2. list_files       — see current files
3. read_file        — read the file(s) to change
4. update_files     — push new code (auto-deploys)
5. deploy_status    — confirm deploy succeeded
```

### Let the VibeCode agent build it
```
1. agent_build      — describe what to build in plain English
2. agent_status     — poll for progress + live URL
```

### Debug a failing deploy
```
1. deploy_status    — check recent GitHub Actions runs
2. app_logs         — read errors/warnings/build info
3. read_file        — inspect the problematic file
4. update_files     — push a fix
```

## Capabilities

Read (no auth):
- app_info — live URL, repo, store listing, status
- deploy_status — last 5 GitHub Actions runs
- list_files — file tree of any app repo
- read_file — file contents from any app repo
- platform_guide — full SKILLS.md platform guide
- sdk_reference — SDK docs (auth, kv, counters, collections, rooms, proxy, keys, ui)

Read (auth required):
- list_apps — your published apps
- app_logs — errors, warnings, SDK calls, build info

Write (auth + ownership):
- create_app — provision + scaffold + deploy a new app
- update_files — push file changes to an app you own

Agent (auth + vaulted AI key):
- agent_build — hand a prompt to the VibeCode agent
- agent_status — poll build progress

Not supported via MCP:
- Deleting apps or repos
- Changing DNS or domain configuration
- Billing or subscription changes
- User account management
- Modifying platform compliance rules
- Direct database access

## Security

- **Read-only mode**: Send `X-FAS-Read-Only: true` header or `?read_only=1` query param to block all write tools.
- **Dry-run**: Pass `dry_run: true` to `create_app` or `update_files` to validate inputs without executing.
- **Scoped tokens**: write tools verify per-app ownership, not blanket access.
- **Session isolation**: `agent_build` sessions are namespaced per user.
- **Audit logging**: all write tool calls are logged with user ID, tool name, and timestamp.
- **No generic proxy**: every tool has a specific, bounded purpose.
