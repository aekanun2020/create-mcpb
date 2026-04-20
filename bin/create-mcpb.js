#!/usr/bin/env node
// create-mcpb — minimal scaffolder for Claude Desktop MCP Bundles.
// Unlike `mcpb init`, it NEVER asks you to enumerate your server's tools or
// prompts; it sets tools_generated:true so Claude Desktop discovers them via
// the MCP handshake at runtime.

import { mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { argv, cwd, exit, stdout } from 'node:process';

// Detect the absolute path to npx on the machine running the scaffold. We
// bake this into manifest.env.NPX_PATH so Claude Desktop's built-in Node
// runtime (which runs with a trimmed PATH on macOS) can still locate npx.
// On Windows we try `where npx.cmd`; on POSIX we try `which npx`. Return
// null if detection fails — the bridge falls back to a bare PATH lookup.
function detectNpxPath() {
  try {
    const cmd = process.platform === 'win32' ? 'where npx.cmd' : 'which npx';
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

// Detect the absolute path to node on the machine running the scaffold.
// Claude Desktop's UtilityProcess launcher uses `env` to exec the command
// string from manifest.mcp_config.command with a TRIMMED PATH on macOS
// (verified in Claude main.log: "env: node: No such file or directory").
// Baking the absolute node binary into the manifest avoids PATH lookup.
function detectNodePath() {
  try {
    const cmd = process.platform === 'win32' ? 'where node.exe' : 'which node';
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

import { ask, askValidated, confirm, select, closePrompts, color as c } from '../lib/prompts.js';
import {
  buildStdioManifest,
  buildRemoteManifest,
  MCPB_IGNORE,
  REMOTE_BRIDGE_JS,
  readmeFor,
} from '../lib/templates.js';

const HELP = `${c.bold}create-mcpb${c.reset} — scaffold a Claude Desktop MCP Bundle (.mcpb) project

${c.bold}Usage${c.reset}
  npx create-mcpb [directory] [options]
  npm create mcpb [directory]

${c.bold}Arguments${c.reset}
  directory            Folder to create. Defaults to current directory.

${c.bold}Options${c.reset}
  --transport <type>   stdio | sse | http  (skips the transport prompt)
  --name <slug>        Pre-set the extension slug
  --quick              Accept sensible defaults; ask only the essentials
  --yes, -y            Alias for --quick
  --help, -h           Show this help

${c.bold}Why not mcpb init?${c.reset}
  mcpb init forces you to list every tool/prompt up front. With MCP servers
  the tool list is owned by the server code, not the manifest, so that's
  noise. create-mcpb sets tools_generated:true and moves on.
`;

function parseArgs(argv2) {
  const args = { positional: [], flags: {} };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === '--help' || a === '-h') args.flags.help = true;
    else if (a === '--quick' || a === '--yes' || a === '-y') args.flags.quick = true;
    else if (a === '--transport') args.flags.transport = argv2[++i];
    else if (a === '--name') args.flags.name = argv2[++i];
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args.flags[k] = v ?? true;
    } else args.positional.push(a);
  }
  return args;
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'my-extension';
}

async function askUserConfigLoop() {
  const fields = [];
  const add = await confirm(
    'Add any user-config fields (API keys, directories, toggles)?',
    false,
  );
  if (!add) return fields;

  stdout.write(`${c.gray}Press enter on "Field key" when done.${c.reset}\n`);
  while (true) {
    const key = (await ask('  Field key (snake_case, blank to finish)', '')).trim();
    if (!key) break;
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      stdout.write(`${c.red}  Key must be snake_case, starting with a letter.${c.reset}\n`);
      continue;
    }
    const type = await select('  Field type', [
      { label: 'string',    hint: 'free text' },
      { label: 'directory', hint: 'folder picker' },
      { label: 'file',      hint: 'file picker' },
      { label: 'boolean',   hint: 'toggle' },
      { label: 'number',    hint: 'numeric' },
    ], 0);
    const title = await ask('  Title shown in UI', key.replace(/_/g, ' '));
    // description is REQUIRED by the mcpb manifest schema — auto-fill if blank.
    const description = await ask('  Description', `The ${title}.`);
    const required = await confirm('  Required?', true);
    const sensitive = type.label === 'string'
      ? await confirm('  Sensitive (hide input, e.g. API key)?', false)
      : false;
    const multiple = (type.label === 'directory' || type.label === 'file')
      ? await confirm('  Allow multiple?', false)
      : false;

    const spec = {
      type: type.label,
      title,
      description: description || `The ${title}.`,
      ...(required ? { required: true } : {}),
      ...(sensitive ? { sensitive: true } : {}),
      ...(multiple ? { multiple: true } : {}),
    };
    fields.push({ key, spec });
    stdout.write(`${c.green}  ✓ added ${key}${c.reset}\n`);
  }
  return fields;
}

async function main() {
  const { positional, flags } = parseArgs(argv.slice(2));
  if (flags.help) {
    stdout.write(HELP);
    return;
  }

  const targetRel = positional[0] || '.';
  const targetDir = path.resolve(cwd(), targetRel);
  const quick = !!flags.quick;

  stdout.write(`\n${c.bold}create-mcpb${c.reset} — scaffold a Claude Desktop MCP Bundle\n`);
  stdout.write(`${c.gray}target: ${targetDir}${c.reset}\n\n`);

  // ── Transport
  const transportFlag = flags.transport;
  let transport;
  if (transportFlag && ['stdio', 'sse', 'http'].includes(transportFlag)) {
    transport = transportFlag;
  } else {
    const chosen = await select('How does Claude Desktop talk to your MCP server?', [
      { label: 'stdio',             hint: 'local executable launched by Claude' },
      { label: 'streamable http',   hint: 'remote HTTP URL (MCP streamable)' },
      { label: 'sse',               hint: 'remote Server-Sent Events URL' },
    ], 0);
    transport = chosen.label === 'streamable http' ? 'http' : chosen.label;
  }

  // ── Core metadata
  const defaultSlug = flags.name || slugify(path.basename(targetDir === cwd() ? 'my-extension' : targetDir));
  const name = await askValidated(
    'Extension slug (lowercase, a-z 0-9 -)',
    (v) => SLUG_RE.test(v),
    defaultSlug,
    'Must match /^[a-z][a-z0-9-]{1,63}$/',
  );
  const displayName = await ask('Display name', name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()));
  const description = await ask('One-line description', `${displayName} MCP server`);
  const version = quick
    ? '1.0.0'
    : await askValidated('Version (semver)', (v) => SEMVER_RE.test(v), '1.0.0', 'Must be semver, e.g. 1.0.0');
  const authorName = await ask('Author name', quick ? 'Your Name' : '');
  const authorEmail = quick ? '' : await ask('Author email (optional)', '');
  const license = quick ? 'MIT' : await ask('License', 'MIT');

  // ── Transport-specific prompts
  let serverSpec;
  if (transport === 'stdio') {
    const entryPoint = await ask(
      'Path to the server executable inside the bundle',
      'bin/server',
    );
    const argsRaw = quick
      ? ''
      : await ask('Extra CLI args (space-separated, optional)', '');
    const args = argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : [];
    const platforms = quick
      ? ['darwin', 'win32', 'linux']
      : (await ask(
          'Platforms (comma-separated: darwin,win32,linux)',
          'darwin,win32,linux',
        )).split(',').map((s) => s.trim()).filter(Boolean);

    const userConfig = quick ? [] : await askUserConfigLoop();
    const env = {};
    // If there are user_config entries, wire each one to an env var by default.
    for (const f of userConfig) {
      env[f.key.toUpperCase()] = `\${user_config.${f.key}}`;
    }

    serverSpec = { transport, entryPoint, args, env, platforms, userConfig };
  } else {
    const url = await askValidated(
      `Server URL (${transport})`,
      (v) => URL_RE.test(v),
      '',
      'Must start with http:// or https://',
    );
    const addHeaders = !quick && (await confirm('Add custom HTTP headers (e.g. Authorization)?', false));
    const headers = {};
    if (addHeaders) {
      while (true) {
        const key = (await ask('  Header name (blank to finish)', '')).trim();
        if (!key) break;
        const val = await ask(`  Value for ${key} (can use \${user_config.KEY})`, '');
        headers[key] = val;
      }
    }
    const userConfig = quick ? [] : await askUserConfigLoop();
    serverSpec = { transport, url, headers, userConfig };
  }

  // ── Build the manifest object
  const common = {
    name,
    displayName,
    version,
    description,
    authorName,
    authorEmail,
    license,
    userConfig: serverSpec.userConfig,
  };

  const manifest =
    transport === 'stdio'
      ? buildStdioManifest({
          ...common,
          entryPoint: serverSpec.entryPoint,
          args: serverSpec.args,
          env: serverSpec.env,
          platforms: serverSpec.platforms,
        })
      : buildRemoteManifest({
          ...common,
          transport,
          url: serverSpec.url,
          headers: serverSpec.headers,
          npxPath: detectNpxPath(),
          nodePath: detectNodePath(),
        });

  // ── Write files
  if (!existsSync(targetDir)) await mkdir(targetDir, { recursive: true });

  const manifestPath = path.join(targetDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const ok = await confirm(
      `${c.yellow}manifest.json already exists. Overwrite?${c.reset}`,
      false,
    );
    if (!ok) {
      stdout.write(`${c.red}Aborted.${c.reset}\n`);
      exit(1);
    }
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  await writeFile(path.join(targetDir, '.mcpbignore'), MCPB_IGNORE);

  const readmeContent = readmeFor({
    displayName,
    description,
    transport,
    name,
    version,
    entryPoint: transport === 'stdio' ? serverSpec.entryPoint : null,
    url: transport !== 'stdio' ? serverSpec.url : null,
  });
  await writeFile(path.join(targetDir, 'README.md'), readmeContent);

  // For stdio, create an empty placeholder bin directory with a stub script so
  // users see exactly where the executable should go.
  if (transport === 'stdio') {
    const entryAbs = path.join(targetDir, serverSpec.entryPoint);
    const binDir = path.dirname(entryAbs);
    if (!existsSync(binDir)) await mkdir(binDir, { recursive: true });
    if (!existsSync(entryAbs)) {
      const stub = `#!/usr/bin/env sh\n# Replace this stub with your real MCP server binary.\necho "MCP server stub: drop your real executable here at $0" >&2\nexit 1\n`;
      await writeFile(entryAbs, stub);
      try { await chmod(entryAbs, 0o755); } catch {}
    }
  } else {
    // For http/sse, Claude Desktop needs a real Node.js entry_point file to
    // launch the extension as a UtilityProcess. Ship a tiny bridge that
    // spawns `npx -y mcp-remote <url> ...` with inherited stdio. See
    // buildRemoteManifest in lib/templates.js for the full rationale.
    const bridgeAbs = path.join(targetDir, 'server', 'index.cjs');
    if (!existsSync(path.dirname(bridgeAbs))) {
      await mkdir(path.dirname(bridgeAbs), { recursive: true });
    }
    if (!existsSync(bridgeAbs)) {
      await writeFile(bridgeAbs, REMOTE_BRIDGE_JS);
      try { await chmod(bridgeAbs, 0o755); } catch {}
    }
  }

  // ── Report
  stdout.write(`\n${c.green}✓ Scaffolded ${name}@${version}${c.reset}\n`);
  stdout.write(`${c.gray}  ${targetDir}${c.reset}\n\n`);
  stdout.write(`${c.bold}Next steps${c.reset}\n`);
  if (targetRel !== '.') stdout.write(`  cd ${targetRel}\n`);
  if (transport === 'stdio') {
    stdout.write(`  # drop your real executable at ${serverSpec.entryPoint}\n`);
  }
  stdout.write(`  npx -y @anthropic-ai/mcpb pack . ${name}-${version}.mcpb\n`);
  stdout.write(`  # double-click the .mcpb to install in Claude Desktop\n\n`);
}

main()
  .then(() => closePrompts())
  .catch((err) => {
    closePrompts();
    console.error(`\n${c.red}Error:${c.reset} ${err?.message || err}`);
    exit(1);
  });
