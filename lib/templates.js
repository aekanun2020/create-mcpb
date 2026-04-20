// Manifest + server-code templates for create-mcpb.
// Every manifest sets tools_generated:true and prompts_generated:true so the
// user is never asked to enumerate their server's tools or prompts — Claude
// Desktop introspects those at runtime via the MCP handshake.

/**
 * Build manifest.json for a stdio (executable) MCP server.
 * @param {object} o
 * @param {string} o.name slug, e.g. "my-extension"
 * @param {string} o.displayName
 * @param {string} o.version
 * @param {string} o.description
 * @param {string} o.authorName
 * @param {string} o.authorEmail
 * @param {string} o.license
 * @param {string} o.entryPoint relative path in bundle, e.g. "bin/my-server" or "bin/my-server.exe"
 * @param {string[]} o.args extra CLI args after the binary (can reference ${user_config.KEY})
 * @param {object} o.env env vars (values can reference ${user_config.KEY})
 * @param {object[]} o.userConfig list of user_config entries (key + spec)
 * @param {string[]} o.platforms subset of ["darwin","win32","linux"]
 */
export function buildStdioManifest(o) {
  const userConfigObj = {};
  for (const f of o.userConfig) userConfigObj[f.key] = f.spec;

  const manifest = {
    manifest_version: '0.3',
    name: o.name,
    display_name: o.displayName,
    version: o.version,
    description: o.description,
    author: {
      name: o.authorName,
      ...(o.authorEmail ? { email: o.authorEmail } : {}),
    },
    license: o.license,
    server: {
      type: 'binary',
      entry_point: o.entryPoint,
      mcp_config: {
        command: `\${__dirname}/${o.entryPoint}`,
        args: o.args,
        ...(Object.keys(o.env).length ? { env: o.env } : {}),
      },
    },
    tools_generated: true,
    prompts_generated: true,
    ...(Object.keys(userConfigObj).length ? { user_config: userConfigObj } : {}),
    compatibility: {
      claude_desktop: '>=0.11.0',
      platforms: o.platforms,
    },
  };

  return manifest;
}

/**
 * Build manifest.json for a remote MCP server (SSE or streamable HTTP).
 *
 * Claude Desktop's extension host only spawns extensions whose server.type is
 * `node` or `python` (with a real entry_point file on disk); `binary` + a
 * bare `npx` command silently falls back to "basic execution" which never
 * actually launches the bridge. Verified in Claude Desktop main.log:
 *   "Using basic execution for extension ...: not a Node.js server or a
 *    Python server or no entry point specified"
 *
 * So instead we ship a tiny Node.js bridge (`server/index.cjs`) that spawns
 * `npx -y mcp-remote <url> ...` with inherited stdio. Claude Desktop runs the
 * bridge as a proper UtilityProcess and everything just works.
 *
 * The bridge uses the `.cjs` extension on purpose: if the bundle happens to
 * live under a parent folder whose `package.json` sets `"type": "module"`
 * (e.g. iCloud Drive / Dropbox roots with a stray package.json), a plain `.js`
 * file would be treated as ESM and the `require(...)` calls inside the bridge
 * would blow up with `ReferenceError: require is not defined in ES module
 * scope`. `.cjs` forces CommonJS regardless of ancestor package.json files.
 *
 * Users need Node.js >= 18 on their machine (for npx). Custom headers get
 * translated into `--header "Name: Value"` flags that mcp-remote forwards.
 */
export function buildRemoteManifest(o) {
  const userConfigObj = {};
  for (const f of o.userConfig) userConfigObj[f.key] = f.spec;

  const env = {
    MCP_REMOTE_URL: o.url,
    MCP_REMOTE_TRANSPORT: o.transport === 'http' ? 'http-only' : 'sse-only',
    MCP_REMOTE_ALLOW_HTTP: /^http:\/\//i.test(o.url) ? '1' : '0',
  };
  // Absolute path to npx baked in at scaffold time so Claude Desktop's
  // built-in Node runtime (which has a trimmed PATH) can still find it.
  if (o.npxPath) {
    env.NPX_PATH = o.npxPath;
  }
  // Forward user-supplied headers as a JSON blob the bridge parses.
  if (Object.keys(o.headers || {}).length) {
    env.MCP_REMOTE_HEADERS = JSON.stringify(o.headers);
  }

  const manifest = {
    manifest_version: '0.3',
    name: o.name,
    display_name: o.displayName,
    version: o.version,
    description: o.description,
    author: {
      name: o.authorName,
      ...(o.authorEmail ? { email: o.authorEmail } : {}),
    },
    license: o.license,
    server: {
      type: 'node',
      entry_point: 'server/index.cjs',
      mcp_config: {
        // Absolute path baked in at scaffold time. Claude Desktop's
        // UtilityProcess uses env(1) to exec this string and on macOS the
        // spawn environment has a trimmed PATH that excludes /opt/homebrew/bin
        // and /usr/local/bin — a bare 'node' resolves to "env: node: No such
        // file or directory" and the extension aborts after ~0.1s.
        command: o.nodePath || 'node',
        args: ['${__dirname}/server/index.cjs'],
        env,
      },
    },
    tools_generated: true,
    prompts_generated: true,
    ...(Object.keys(userConfigObj).length ? { user_config: userConfigObj } : {}),
    compatibility: {
      claude_desktop: '>=0.11.0',
      platforms: ['darwin', 'win32', 'linux'],
    },
  };

  return manifest;
}

/**
 * Node.js bridge that Claude Desktop runs as the extension's entry point.
 * It re-execs `npx -y mcp-remote <url> --transport ... --allow-http
 * --header "K: V" ...` and manually pipes stdin/stdout/stderr.
 *
 * Why manual pipes instead of `stdio: 'inherit'`:
 *   Claude Desktop (verified on v1.3109) runs extensions under its built-in
 *   Node runtime. Under that runtime, `stdio: 'inherit'` does NOT forward
 *   the parent's stdin fd through to the grandchild (`npx` → `mcp-remote`).
 *   The SSE handshake completes, then mcp-remote sees EOF on its stdin and
 *   cleanly exits within ~0.5s ("Shutting down..."), which Claude reports as
 *   "Server transport closed unexpectedly". Forwarding manually with
 *   `process.stdin.pipe(child.stdin, { end: false })` (and symmetric stdout)
 *   fixes it.
 *
 * Why `{ end: false }` on the stdin pipe:
 *   Claude Desktop's built-in Node sometimes delivers EOF on the bridge's
 *   stdin before Claude writes the first JSON-RPC message. Without
 *   `{ end: false }` the default stream behavior closes the grandchild's
 *   stdin on parent EOF, and mcp-remote (which only reads JSON-RPC from
 *   stdin) shuts down immediately. Keeping the child stdin open across a
 *   parent EOF lets the client start writing whenever it's ready.
 *
 * Why NPX_PATH:
 *   Claude Desktop's built-in Node may run with a reduced PATH that does not
 *   include /opt/homebrew/bin or /usr/local/bin where `npx` lives. The env
 *   var lets the scaffolder bake in the absolute path detected at generation
 *   time, and still falls back to a PATH lookup on machines that don't need
 *   it (or on Windows where npx.cmd is usually resolvable).
 */
export const REMOTE_BRIDGE_JS = `#!/usr/bin/env node
// Auto-generated by create-mcpb. Do not edit by hand — re-run create-mcpb
// (or tweak manifest.mcp_config.env) to change the target URL or transport.
//
// This file exists because Claude Desktop's extension host requires a real
// node entry_point file on disk for server.type:"node" extensions. All the
// bridge does is spawn \`npx -y mcp-remote\` with the right flags, manually
// pipe stdio (inherit is unreliable under Claude's built-in Node), and
// forward signals.

const { spawn } = require('node:child_process');

const url = process.env.MCP_REMOTE_URL;
if (!url) {
  console.error('[create-mcpb bridge] MCP_REMOTE_URL is not set.');
  process.exit(2);
}
const transport = process.env.MCP_REMOTE_TRANSPORT || 'sse-only';
const allowHttp = process.env.MCP_REMOTE_ALLOW_HTTP === '1';

let headers = {};
if (process.env.MCP_REMOTE_HEADERS) {
  try { headers = JSON.parse(process.env.MCP_REMOTE_HEADERS) || {}; }
  catch { headers = {}; }
}

const args = ['-y', 'mcp-remote', url, '--transport', transport];
if (allowHttp) args.push('--allow-http');
for (const [k, v] of Object.entries(headers)) {
  args.push('--header', \`\${k}: \${v}\`);
}

// Resolve npx. NPX_PATH is baked in by the scaffolder via \`which npx\` on
// POSIX / \`where npx.cmd\` on Windows so the built-in Node runtime doesn't
// need to hunt through a trimmed PATH. Falls back to a bare 'npx' lookup.
const isWin = process.platform === 'win32';
const npxCmd = process.env.NPX_PATH || (isWin ? 'npx.cmd' : 'npx');
const child = spawn(npxCmd, args, {
  // DO NOT use stdio:'inherit' here — Claude Desktop's built-in Node doesn't
  // forward fds to grandchildren, which makes mcp-remote EOF and exit in
  // under a second. Pipe everything manually instead.
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: isWin,
  env: process.env,
});

// { end: false } on stdin only — do NOT close the child's stdin when our
// stdin hits EOF. Claude's built-in Node occasionally delivers EOF before
// the first JSON-RPC message, and without this guard mcp-remote exits
// cleanly.
process.stdin.pipe(child.stdin, { end: false });

// NDJSON reframer on stdout:
//   MCP stdio transport requires newline-delimited JSON (spec 2025-06-18).
//   Some upstream servers (FastMCP/Python and others) emit two responses
//   back-to-back in a single chunk without a separator. Lenient clients
//   tolerate this; Claude Desktop's parser rejects it as
//   "Invalid JSON-RPC message" and the request times out. We buffer stdout,
//   split on balanced JSON object boundaries, and re-emit each message
//   followed by a newline. Pure compatibility shim: if the server already
//   delimits correctly this is a no-op.
let stdoutBuf = '';
child.stdout.setEncoding('utf8');
// IMPORTANT: Emit one message per stdout.write(). Claude Desktop's parser
// treats each stdout chunk as a single JSON-RPC message, so batching multiple
// NDJSON lines into one write() causes "Invalid JSON-RPC message" errors
// even though the bytes are spec-compliant.
child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  let lastEnd = 0;
  let i = 0;
  for (; i < stdoutBuf.length; i++) {
    const c = stdoutBuf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        process.stdout.write(stdoutBuf.slice(start, i + 1) + '\\n');
        lastEnd = i + 1;
        start = -1;
      }
      continue;
    }
    // Ignore whitespace / newlines between objects.
  }
  // Keep the unconsumed tail (partial object or trailing whitespace).
  if (depth > 0 && start >= 0) stdoutBuf = stdoutBuf.slice(start);
  else stdoutBuf = '';
});
child.stdout.on('end', () => {
  if (stdoutBuf.trim()) process.stdout.write(stdoutBuf);
  process.stdout.end();
});

child.stderr.on('data', (d) => process.stderr.write(d));

child.on('error', (err) => {
  console.error('[create-mcpb bridge] failed to spawn npx:', err.message);
  console.error('[create-mcpb bridge] Is Node.js >= 18 installed and on PATH? Tried: ' + npxCmd);
  process.exit(127);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { try { child.kill(sig); } catch {} });
}
`;

/** Standard .mcpbignore contents — trims node_modules bloat and dev junk. */
export const MCPB_IGNORE = `# create-mcpb default .mcpbignore
.git
.github
.vscode
.idea
*.log
.env
.env.*
.DS_Store
Thumbs.db
tests/
test/
docs/
*.test.js
*.spec.js
coverage/
node_modules/.cache/
node_modules/**/*.md
node_modules/**/*.ts
node_modules/**/*.map
node_modules/**/test/
node_modules/**/tests/
node_modules/**/docs/
node_modules/**/examples/
`;

/** README template (Markdown) for the generated bundle project. */
export function readmeFor(o) {
  const installLines = o.transport === 'stdio'
    ? [
      '1. Place your server executable at `' + o.entryPoint + '` inside this folder.',
      '   - Make sure it is marked executable on macOS/Linux: `chmod +x ' + o.entryPoint + '`',
      '   - On Windows use a `.exe` and update `server.entry_point` accordingly.',
    ]
    : [
      '1. Your MCP server is remote (' + o.transport + ') — make sure it is reachable at `' + o.url + '`.',
      '   - This bundle bridges to it via `node server/index.cjs` → `npx -y mcp-remote` (stdio → HTTP/SSE).',
      '   - End users must have **Node.js >= 18** installed (for `npx`).',
      '   - To change the URL or add headers, edit `manifest.json` > `server.mcp_config.env`.',
    ];

  return `# ${o.displayName}

${o.description}

Scaffolded with **create-mcpb**. You can now:

${installLines.join('\n')}
2. (Optional) Drop an \`icon.png\` next to \`manifest.json\` and add \`"icon": "icon.png"\` to the manifest.
3. Pack it: \`npx @anthropic-ai/mcpb pack . dist/${o.name}-${o.version}.mcpb\`
4. Double-click the \`.mcpb\` to install in Claude Desktop (≥ 0.11.0).

## Manifest

- Transport: \`${o.transport}\`
- \`tools_generated: true\` — Claude discovers tools via MCP handshake, no need to list them here.
- \`prompts_generated: true\` — same for prompts.

Edit \`manifest.json\` to tweak metadata. See the [MCPB spec](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md) for the full field list.
`;
}
