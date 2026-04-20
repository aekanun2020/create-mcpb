# create-mcpb

A minimal scaffolder for **Claude Desktop MCP Bundles** (`.mcpb`) that never asks you how many tools your server has.

The official `mcpb init` from `@anthropic-ai/mcpb` forces you to enumerate every tool and prompt up front, which is noise — the tool list lives in your server code and Claude Desktop discovers it via the MCP handshake at runtime. `create-mcpb` just sets `tools_generated: true` and `prompts_generated: true` and moves on.

## Install

```bash
# one-shot
npx create-mcpb my-extension

# or global
npm install -g create-mcpb
create-mcpb my-extension
```

Node.js 18 or newer. Zero runtime dependencies.

## Usage

```bash
create-mcpb [directory] [options]
```

### Options

| Flag                   | Effect                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `--transport <type>`   | `stdio` · `sse` · `http` (skip the transport prompt)          |
| `--name <slug>`        | Pre-set the extension slug                                    |
| `--quick`, `--yes`, `-y` | Accept sensible defaults; ask only the essentials            |
| `--help`, `-h`         | Show help                                                     |

### Example — local binary server

```bash
create-mcpb my-binary-mcp --transport stdio
```

```
? Extension slug (lowercase, a-z 0-9 -) (my-binary-mcp)
? Display name (My Binary Mcp) My Binary MCP
? One-line description (My Binary MCP MCP server) A fast local MCP server
? Version (semver) (1.0.0)
? Author name Jane Doe
? Author email (optional)
? License (MIT)
? Path to the server executable inside the bundle (bin/server)
? Extra CLI args (space-separated, optional)
? Platforms (comma-separated: darwin,win32,linux) (darwin,win32,linux)
? Add any user-config fields (API keys, directories, toggles)? [y/N]

✓ Scaffolded my-binary-mcp@1.0.0
```

That produces:

```
my-binary-mcp/
├─ manifest.json          # tools_generated:true, server.type:"binary"
├─ bin/server             # placeholder executable stub (chmod +x)
├─ .mcpbignore
└─ README.md
```

### Example — remote server (SSE / streamable HTTP)

```bash
create-mcpb my-remote-mcp --transport http
```

You'll be asked for the server URL and (optionally) custom HTTP headers — use `${user_config.KEY}` to reference user-configurable fields like API keys.

### Example — quick mode

```bash
create-mcpb my-extension --transport stdio -y
```

Skips version/author/license/platforms/user_config prompts and uses defaults. Only the entry-point path is asked.

### User-config fields

When you answer "yes" to adding user-config fields, you'll be prompted once per field for:

- Key (snake_case)
- Type (`string`, `directory`, `file`, `boolean`, `number`)
- Title, description, required?, sensitive?, multiple?

Each field is auto-wired to an env var by default: key `api_key` becomes `API_KEY=${user_config.api_key}` in `server.mcp_config.env`. Edit `manifest.json` afterwards if you want different wiring.

## Why not `mcpb init`?

`mcpb init` asks you to list every tool and prompt in the manifest. That's duplicate bookkeeping — MCP servers advertise their tools over the protocol at startup. `create-mcpb` sets:

```json
{
  "tools_generated": true,
  "prompts_generated": true
}
```

so Claude Desktop introspects at runtime. You only maintain the tool list in one place: your server code.

## What it generates

### stdio (binary)

```json
{
  "manifest_version": "0.3",
  "server": {
    "type": "binary",
    "entry_point": "bin/server",
    "mcp_config": {
      "command": "${__dirname}/bin/server",
      "args": []
    }
  },
  "tools_generated": true,
  "prompts_generated": true,
  "compatibility": {
    "claude_desktop": ">=0.11.0",
    "platforms": ["darwin", "win32", "linux"]
  }
}
```

### streamable http / sse

```json
{
  "server": {
    "type": "http",
    "mcp_config": {
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${user_config.api_key}" }
    }
  }
}
```

## Next steps after scaffolding

```bash
cd my-extension
# (stdio) drop your real executable at bin/server
npx -y @anthropic-ai/mcpb pack . my-extension-1.0.0.mcpb
# double-click the .mcpb to install in Claude Desktop
```

## Changelog

### 1.2.8
- Bake absolute `node` path into `manifest.mcp_config.command` at scaffold time (detected via `which node`). Fixes extensions silently failing 0.1s after Claude Desktop restart on macOS, where the UtilityProcess launcher uses a trimmed PATH and bare `node` resolves to `env: node: No such file or directory`.

### 1.2.7
- Remote-MCP bridge writes one JSON object per `process.stdout.write` call. Claude Desktop's stdio parser treats one write = one JSON-RPC message, so batched NDJSON was being rejected as invalid.

### 1.2.5 – 1.2.6
- NDJSON reframer for remote servers that send glued or partial JSON payloads (e.g. FastMCP SSE).

### 1.2.4
- Removed `{ end: false }` from stdout pipe (caused hang on server shutdown).

### 1.2.3
- `process.stdin.pipe(child.stdin, { end: false })` so closing stdin from Claude doesn't kill the child prematurely.

### 1.2.2
- Explicit `stdio: ['pipe','pipe','pipe']` for the bridge child process.

### 1.2.1
- Auto-detect `NPX_PATH` via `which npx` and bake into the bridge (same root cause as 1.2.8, for npx).

### 1.2.0
- Bridge file is `.cjs` so it runs as CommonJS even when an ancestor directory (e.g. iCloud Drive root) has `"type": "module"`.

## License

MIT
