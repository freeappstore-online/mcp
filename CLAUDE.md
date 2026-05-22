# FreeAppStore MCP Server

Remote MCP server for AI agents to interact with the FreeAppStore platform.

- Endpoint: `mcp.freeappstore.online/mcp`
- Dev: `npm install && npm run dev`
- Deploy: `git push origin main` (auto-deploys via GitHub Actions)

## Tools

| Tool | Auth | Description |
|------|------|-------------|
| `list_apps` | FAS token | List your published apps |
| `deploy_status` | None | Check GitHub Actions deploy status |
| `app_info` | None | Get app URLs, repo, status |
| `platform_guide` | None | Fetch SKILLS.md (full platform guide) |
| `sdk_reference` | None | Quick SDK reference (auth, kv, counters, rooms, ui) |

## Connect from Claude Code

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
