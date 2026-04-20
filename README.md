# create-mcpb

เครื่องมือสร้าง **Claude Desktop Extension** (`.mcpb`) สำหรับเชื่อมต่อ MCP server โดยไม่ต้องเขียนโค้ด
A no-code tool for creating **Claude Desktop Extensions** (`.mcpb`) that connect to MCP servers.

รองรับ remote MCP server ผ่าน SSE หรือ Streamable HTTP และยังคงทำงานหลังปิด-เปิด Claude Desktop
Supports remote MCP servers via SSE or Streamable HTTP, and keeps working after Claude Desktop restart.

---

## ภาษาไทย (สำหรับผู้ใช้งาน)

### สิ่งที่ต้องมี

- macOS พร้อม Homebrew Node (`/opt/homebrew/bin/node`)
- Claude Desktop ติดตั้งแล้ว
- git + npm (มีอยู่แล้วในเครื่องที่มี Homebrew Node)

ตรวจ Node:
```bash
which node
```
ต้องเห็น `/opt/homebrew/bin/node` หรือ `/usr/local/bin/node`

### ติดตั้ง create-mcpb

```bash
cd ~/Downloads
git clone https://github.com/aekanun2020/create-mcpb.git
cd create-mcpb
npm install -g .
```

ตรวจว่าลงสำเร็จ:
```bash
which create-mcpb
```
ต้องเห็น path เช่น `/opt/homebrew/bin/create-mcpb`

### สร้าง Extension

แต่ละ extension ต้องอยู่คนละโฟลเดอร์ และตั้ง **slug ไม่ซ้ำกัน** (ถ้า slug ซ้ำ ตัวใหม่จะทับตัวเก่า)

#### ตัวอย่างที่ 1: SSE (เช่น modbus-plc-collector)

```bash
mkdir -p ~/Downloads/modbus-ext
cd ~/Downloads/modbus-ext
create-mcpb . --transport sse
```
ตอบ prompt:
- **slug**: `modbus`
- **Server URL**: `http://192.168.1.123:8001/sse`
- **Author name**: `Aekanun`
- อื่นๆ: กด Enter

Pack + ติดตั้ง:
```bash
npx -y @anthropic-ai/mcpb pack . modbus-1.0.0.mcpb
open modbus-1.0.0.mcpb
```
Claude Desktop จะเด้งหน้าต่าง Install → กด Install

#### ตัวอย่างที่ 2: Streamable HTTP (เช่น office-creator)

```bash
mkdir -p ~/Downloads/office-ext
cd ~/Downloads/office-ext
create-mcpb . --transport http
```
ตอบ prompt:
- **slug**: `office`
- **Server URL**: `http://192.168.1.123:8200/mcp`
- **Author name**: `Aekanun`

```bash
npx -y @anthropic-ai/mcpb pack . office-1.0.0.mcpb
open office-1.0.0.mcpb
```

### ทดสอบ restart (สำคัญ)

ปิด-เปิด Claude Desktop แล้วลองใช้ tool อีกครั้ง — ถ้ายังทำงานได้ = ใช้งานได้จริง
```bash
osascript -e 'quit app "Claude"'; sleep 3; killall Claude 2>/dev/null; sleep 2; open -a Claude
```

### ถอนการติดตั้ง

**ผ่าน Claude Desktop:** Settings → Extensions → เลือก → Uninstall

**แบบ manual (กรณีลบไม่ขาด):**
```bash
rm -rf ~/Library/Application\ Support/Claude/Claude\ Extensions/local.mcpb.<author>.<slug>
```

### ปัญหาที่เคยเจอ

**1. Extension พังทันที 0.1 วินาทีหลังเปิด Claude**
เคยเจอใน v1.2.7 และเก่ากว่า — **v1.2.8 แก้ไปแล้ว** โดยฝัง `/opt/homebrew/bin/node` ลง manifest ถ้ายังเจอ แสดงว่าใช้เวอร์ชันเก่า ให้ upgrade + re-scaffold ใหม่

**2. ติดตั้ง .mcpb ใหม่ทับของเก่า**
เพราะ slug ซ้ำกัน (default เป็น `my-extension` ทุกครั้ง) — แก้โดยตั้ง slug ให้ต่างกัน

**3. iCloud Drive ทำให้ extension ใช้ไม่ได้**
iCloud root มี `package.json` ที่กำหนด `"type": "module"` ทำให้ไฟล์ `.cjs` เพี้ยน — scaffold นอก iCloud เช่น `~/Downloads/`

---

## English (for end users)

### Requirements

- macOS with Homebrew Node (`/opt/homebrew/bin/node`)
- Claude Desktop installed
- git + npm

### Install create-mcpb

```bash
cd ~/Downloads
git clone https://github.com/aekanun2020/create-mcpb.git
cd create-mcpb
npm install -g .
```

Verify:
```bash
which create-mcpb
```

### Create an Extension

Each extension needs its own folder and a **unique slug** — installing a new `.mcpb` with the same slug overwrites the old one.

#### Example 1 — SSE remote server

```bash
mkdir -p ~/Downloads/my-ext && cd ~/Downloads/my-ext
create-mcpb . --transport sse
# slug: my-ext
# URL:  https://your-server/sse
# author: your name
npx -y @anthropic-ai/mcpb pack . my-ext-1.0.0.mcpb
open my-ext-1.0.0.mcpb
```

#### Example 2 — Streamable HTTP

```bash
mkdir -p ~/Downloads/my-ext && cd ~/Downloads/my-ext
create-mcpb . --transport http
# slug: my-ext
# URL:  https://your-server/mcp
npx -y @anthropic-ai/mcpb pack . my-ext-1.0.0.mcpb
open my-ext-1.0.0.mcpb
```

### Verify restart resilience

```bash
osascript -e 'quit app "Claude"'; sleep 3; killall Claude 2>/dev/null; sleep 2; open -a Claude
```
Open Claude again and invoke a tool — it should still work.

### Uninstall

**From Claude Desktop:** Settings → Extensions → Uninstall

**Manual (if the above doesn't clean up):**
```bash
rm -rf ~/Library/Application\ Support/Claude/Claude\ Extensions/local.mcpb.<author>.<slug>
```

### Troubleshooting

**Extension fails 0.1s after Claude restart** — fixed in v1.2.8 (absolute node path baked into manifest). If you still see this, you're on an older version. Upgrade and re-scaffold.

**New install overwrites old extension** — slug collision. Give each extension a unique slug.

**iCloud Drive breaks extensions** — iCloud root contains a `package.json` with `"type": "module"` that corrupts `.cjs` loading. Scaffold outside iCloud (e.g. `~/Downloads/`).

---

## Verified working

Verified on macOS 14, Claude Desktop with Node v24.14.0, against the following remote servers:

- Modbus PLC collector (SSE, FastMCP)
- Office Creator (Streamable HTTP)

Both survived Claude Desktop restart after the v1.2.8 fix.

---

## Changelog

- **1.2.8** — Bake absolute `node` path into manifest at scaffold time. Fixes extensions failing 0.1s after Claude Desktop restart on macOS (trimmed PATH in UtilityProcess).
- **1.2.7** — Bridge writes one JSON object per stdout call (Claude parser treats each write as one JSON-RPC message).
- **1.2.5–1.2.6** — NDJSON reframer for servers that emit glued/partial JSON.
- **1.2.4** — Removed `{ end: false }` from stdout pipe (caused shutdown hang).
- **1.2.3** — `process.stdin.pipe(child.stdin, { end: false })` so stdin close from Claude doesn't kill the child.
- **1.2.2** — Explicit `stdio: ['pipe','pipe','pipe']` for bridge child process.
- **1.2.1** — Auto-detect `NPX_PATH` via `which npx` (same pattern as 1.2.8 for node).
- **1.2.0** — Bridge file uses `.cjs` extension to run as CommonJS even when ancestor directory has `"type": "module"` (iCloud ESM contamination).

---

## License

MIT
