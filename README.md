# FreeAppStore MCP Server

Remote [MCP](https://modelcontextprotocol.io/) server for AI agents to interact with the [FreeAppStore](https://freeappstore.online) platform.

**Endpoint:** `https://mcp.freeappstore.online/mcp`

## Connect

### Claude Code

```bash
claude mcp add freeappstore -- npx mcp-remote https://mcp.freeappstore.online/mcp
```

### Codex

```bash
codex mcp add freeappstore --url https://mcp.freeappstore.online/mcp
```

### Cursor

Settings > MCP > Add Server: `npx mcp-remote https://mcp.freeappstore.online/mcp`

### Project-local `.mcp.json`

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

### Any MCP client

Streamable HTTP transport at `https://mcp.freeappstore.online/mcp`

## Tools

### Build (write code yourself)

| Tool | Auth | Description |
|------|------|-------------|
| `create_app` | FAS token | Provision repo + hosting + listing, scaffold template, deploy live |
| `update_files` | Owner | Write/overwrite files in your app's repo; auto-redeploys |

### Build (let the VibeCode agent write code)

| Tool | Auth | Description |
|------|------|-------------|
| `agent_build` | FAS token + vaulted AI key | Hand a prompt to the VibeCode agent; it writes + deploys |
| `agent_status` | FAS token | Poll an agent_build session for progress + live URL |

### Read

| Tool | Auth | Description |
|------|------|-------------|
| `list_files` | None | List files in an app's repo |
| `read_file` | None | Read a file from an app's repo |

### Inspect

| Tool | Auth | Description |
|------|------|-------------|
| `list_apps` | FAS token | List your published apps |
| `app_info` | None | Live URL, repo, store listing, up/down status |
| `deploy_status` | None | Check last 5 GitHub Actions runs for any app |
| `app_logs` | Owner | Recent errors/warnings/SDK calls/build info |
| `platform_guide` | None | Fetch full SKILLS.md (the complete platform guide) |
| `sdk_reference` | None | SDK docs for auth, KV, counters, collections, rooms, proxy, keys, UI |

## Discovery

- MCP Registry: [`io.github.freeappstore-online/mcp`](https://registry.modelcontextprotocol.io)
- Auto-discovery: [`freeappstore.online/.well-known/mcp.json`](https://freeappstore.online/.well-known/mcp.json)
- Platform guide: [`freeappstore.online/llms.txt`](https://freeappstore.online/llms.txt)
- Docs: [`freeappstore.online/docs/mcp`](https://freeappstore.online/docs/mcp)

## Architecture

Cloudflare Worker with a SQLite-backed Durable Object (`FasMcpAgent`), using the [`agents`](https://www.npmjs.com/package/agents) SDK. Deployed via GitHub Actions.

## Development

```bash
npm install
npm run dev    # local dev server
npm run deploy # deploy to CF Workers
```

## License

MIT.
