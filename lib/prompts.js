// Minimal readline-based prompt helpers. No dependencies.
//
// Implementation notes:
// We buffer `line` events ourselves instead of using rl.question, because
// rl.question loses already-emitted lines when the answer is awaited between
// calls (common when stdin is piped — all lines arrive before the first
// prompt resolves). The buffer pattern below handles both interactive TTY use
// and piped/heredoc input identically.

import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const ESC = '\x1b[';
const c = {
  reset: `${ESC}0m`,
  dim: `${ESC}2m`,
  bold: `${ESC}1m`,
  cyan: `${ESC}36m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  red: `${ESC}31m`,
  gray: `${ESC}90m`,
};

export const color = c;

let rl = null;
let streamClosed = false;
const lineQueue = [];
const waiters = [];

function ensureRL() {
  if (rl) return rl;
  rl = createInterface({ input: stdin, output: stdout, terminal: false });
  rl.on('line', (line) => {
    if (waiters.length) waiters.shift()(line);
    else lineQueue.push(line);
  });
  rl.on('close', () => {
    streamClosed = true;
    while (waiters.length) waiters.shift()(null); // signal EOF to pending
  });
  return rl;
}

/** Read one line from stdin. Resolves to null on EOF. */
function readLine() {
  ensureRL();
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  if (streamClosed) return Promise.resolve(null);
  return new Promise((res) => waiters.push(res));
}

export function closePrompts() {
  if (rl) {
    try { rl.close(); } catch {}
    rl = null;
  }
}

/**
 * Ask a free-text question. Returns trimmed answer or `def` if empty/EOF.
 */
export async function ask(question, def = '') {
  const suffix = def ? `${c.gray} (${def})${c.reset}` : '';
  stdout.write(`${c.cyan}? ${c.reset}${c.bold}${question}${c.reset}${suffix} `);
  const line = await readLine();
  if (line === null) {
    stdout.write('\n');
    return def;
  }
  const trimmed = line.trim();
  return trimmed || def;
}

/** Ask yes/no. Returns boolean. */
export async function confirm(question, def = true) {
  const hint = def ? 'Y/n' : 'y/N';
  const ans = (await ask(`${question} [${hint}]`, '')).toLowerCase();
  if (!ans) return def;
  return ans[0] === 'y';
}

/** Pick one from a list. Returns the chosen item. */
export async function select(question, choices, def = 0) {
  stdout.write(`${c.cyan}? ${c.reset}${c.bold}${question}${c.reset}\n`);
  choices.forEach((choice, i) => {
    const label = typeof choice === 'string' ? choice : choice.label;
    const hint = typeof choice === 'string' ? '' : choice.hint || '';
    const marker = i === def ? `${c.green}●${c.reset}` : `${c.gray}○${c.reset}`;
    const hintText = hint ? ` ${c.gray}— ${hint}${c.reset}` : '';
    stdout.write(`  ${marker} ${i + 1}. ${label}${hintText}\n`);
  });
  const raw = await ask(`  Choose 1-${choices.length}`, String(def + 1));
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1 || n > choices.length) {
    stdout.write(`${c.red}Invalid choice, using default.${c.reset}\n`);
    return choices[def];
  }
  return choices[n - 1];
}

/** Ask until the validator accepts. Throws if stdin closes and default is invalid. */
export async function askValidated(question, validator, def = '', errorMsg = 'Invalid') {
  while (true) {
    const ans = await ask(question, def);
    if (validator(ans)) return ans;
    stdout.write(`${c.red}${errorMsg}${c.reset}\n`);
    if (streamClosed) {
      throw new Error(`${errorMsg} (no more input; got '${ans}')`);
    }
  }
}
