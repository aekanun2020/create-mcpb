# คู่มือ create-mcpb v1.2.8 (สำหรับผู้ใช้งาน)

คู่มือนี้ใช้ `create-mcpb` scaffolder บน macOS เพื่อสร้างส่วนขยาย (.mcpb) ติดตั้งลง Claude Desktop โดยไม่ต้องเขียนโค้ด

---

## 1. สิ่งที่ต้องมีก่อนเริ่ม

1. macOS + Homebrew Node (จะอยู่ที่ `/opt/homebrew/bin/node`)
2. Claude Desktop ติดตั้งแล้ว
3. ไฟล์ `create-mcpb-1.2.8.tar` (รับจากผู้พัฒนา)

ตรวจ Node:

```bash
which node
node --version
```

ต้องเห็น path ขึ้นต้นด้วย `/opt/homebrew/bin/node` หรือ `/usr/local/bin/node`

---

## 2. ติดตั้ง create-mcpb

วางไฟล์ `.tar` ไว้ใน `~/Downloads` แล้วรัน:

```bash
cd ~ && npm install -g ~/Downloads/create-mcpb-1.2.8.tar
```

> สำคัญ: ติดตั้งจากไฟล์ `.tar` ตรงๆ **ห้ามเปลี่ยนนามสกุลเป็น `.tgz`** เพราะ Safari/iCloud จะทำให้ไฟล์เสีย

ตรวจว่าลงสำเร็จ:

```bash
which create-mcpb
```

ต้องเห็น path เช่น `/opt/homebrew/bin/create-mcpb`

---

## 3. สร้างส่วนขยาย

แต่ละส่วนขยายต้องอยู่คนละโฟลเดอร์ และตั้ง **slug ไม่ซ้ำกัน** (ติดตั้ง .mcpb ใหม่จะทับอันเก่าถ้า slug เหมือนกัน)

ขั้นตอนร่วมสำหรับทุก transport:

```bash
mkdir -p ~/Downloads/<ชื่อ>-ext
cd ~/Downloads/<ชื่อ>-ext
create-mcpb . --transport <sse|http|stdio>
```

ตอบ prompt:

- **Extension slug**: ตัวพิมพ์เล็ก a-z 0-9 - เท่านั้น (ต้องไม่ซ้ำกับตัวที่ลงไว้แล้ว)
- **Display name / description / version**: กด Enter ใช้ค่า default ได้
- **Author name**: ใส่ชื่อจริง (เช่น `Aekanun`) — จะถูกใช้เป็นส่วนหนึ่งของ slug folder ใน Claude
- **Server URL** (เฉพาะ sse/http): URL ของ MCP server
- ตัวเลือกอื่น: กด Enter ใช้ default

หลัง scaffold เสร็จ ตรวจว่า node path ถูกฝังใน manifest:

```bash
grep -A 3 '"command"' manifest.json
```

ต้องเห็น `"command": "/opt/homebrew/bin/node"` (ห้ามเป็นแค่ `"node"`)

---

## 4. Pack + ติดตั้ง

```bash
npx -y @anthropic-ai/mcpb pack . <ชื่อ>-1.0.0.mcpb
open <ชื่อ>-1.0.0.mcpb
```

Claude Desktop จะเด้งหน้าต่าง Install — กด Install

---

## 5. ทดสอบ restart

ปัญหาใหญ่ที่ v1.2.8 แก้คือ "ปิด-เปิด Claude แล้วส่วนขยายพัง" ทดสอบด้วย:

```bash
osascript -e 'quit app "Claude"'; sleep 3; killall Claude 2>/dev/null; sleep 2; open -a Claude
```

รอ Claude เปิดเต็ม แล้วลองสั่งใช้ tool — ต้องทำงานได้เหมือนเดิม

---

## 6. ตัวอย่าง: 3 transport

### 6.1 SSE (remote MCP, Server-Sent Events)

ตัวอย่าง: modbus-plc-collector

```bash
mkdir -p ~/Downloads/modbus-ext
cd ~/Downloads/modbus-ext
create-mcpb . --transport sse
# slug: modbus
# URL:  http://192.168.1.123:8001/sse
# author: Aekanun

grep -A 3 '"command"' manifest.json     # ตรวจ /opt/homebrew/bin/node
npx -y @anthropic-ai/mcpb pack . modbus-1.0.0.mcpb
open modbus-1.0.0.mcpb
```

### 6.2 Streamable HTTP (remote MCP)

ตัวอย่าง: office-creator

```bash
mkdir -p ~/Downloads/office-ext
cd ~/Downloads/office-ext
create-mcpb . --transport http
# slug: office
# URL:  http://192.168.1.123:8200/mcp
# author: Aekanun

grep -A 3 '"command"' manifest.json
npx -y @anthropic-ai/mcpb pack . office-1.0.0.mcpb
open office-1.0.0.mcpb
```

### 6.3 stdio (local executable)

stdio ใช้สำหรับ MCP server ที่รันในเครื่องเดียวกัน (ไม่ใช่ HTTP/SSE) — template สร้าง skeleton ไว้ให้ คุณต้องแก้ไขเองเพื่อให้ชี้ไปที่ binary ของ MCP server ของคุณ

```bash
mkdir -p ~/Downloads/local-ext
cd ~/Downloads/local-ext
create-mcpb . --transport stdio
# slug: <ตามต้องการ>
# author: <ตามต้องการ>
```

หลัง scaffold เปิด `server/index.cjs` แล้วแก้ command/args ให้ชี้ไปที่ MCP server ที่ต้องการเรียก จากนั้น pack + install ตามขั้นตอนข้อ 4

> หมายเหตุ: stdio ไม่ได้ถูกทดสอบในชุด v1.2.8 นี้โดยตรง — ถ้าใช้งานแล้วพบปัญหา แจ้งผู้พัฒนา

---

## 7. การถอนการติดตั้ง

**ลบผ่าน Claude Desktop:**
Settings → Extensions → เลือกตัวที่ต้องการ → Uninstall

**ลบแบบ manual (กรณีลบไม่ขาด):**

```bash
rm -rf ~/Library/Application\ Support/Claude/Claude\ Extensions/local.mcpb.<author>.<slug>
```

แทน `<author>` และ `<slug>` ด้วยค่าที่ตั้งไว้ตอน scaffold

---

## 8. Troubleshooting (ปัญหาที่เคยเจอจริง)

### 8.1 ส่วนขยายพังทันที 0.1 วินาทีหลังเปิด Claude

อาการ: ใช้งานครั้งแรกได้ แต่ปิด-เปิด Claude แล้วส่วนขยาย "failed" ทันที

สาเหตุ: Claude Desktop เรียก node ด้วย PATH ที่ตัดทอน (ไม่มี `/opt/homebrew/bin`) — `main.log` จะเห็น `env: node: No such file or directory`

วิธีแก้: **v1.2.8 แก้ไปแล้ว** โดยฝัง absolute path ของ node ลง manifest ตอน scaffold — ถ้าเจอปัญหานี้แสดงว่าใช้ version เก่า → upgrade เป็น v1.2.8 แล้ว re-scaffold ใหม่

ตรวจว่า manifest ถูกต้อง:

```bash
grep -A 3 '"command"' ~/Library/Application\ Support/Claude/Claude\ Extensions/local.mcpb.<author>.<slug>/manifest.json
```

ต้องเป็น `/opt/homebrew/bin/node` ไม่ใช่แค่ `"node"`

### 8.2 ติดตั้ง .mcpb ใหม่แล้วทับตัวเก่า

สาเหตุ: slug ซ้ำกัน (ทั้ง 2 ตัวเป็น `my-extension` ซึ่งเป็น default)

วิธีแก้: ตั้ง slug ให้ไม่ซ้ำตอน scaffold (เช่น `modbus`, `office`, `mssql`) — slug คือตัวระบุใน Claude Extensions folder

### 8.3 iCloud Drive ทำให้ extension ใช้ไม่ได้

อาการ: scaffold ในโฟลเดอร์ที่อยู่ใต้ iCloud แล้วติดตั้งไม่ผ่าน / เปิดไม่ได้

สาเหตุ: iCloud root (`~/Library/Mobile Documents/com~apple~CloudDocs/`) อาจมี `package.json` ที่กำหนด `"type": "module"` ทำให้ไฟล์ `.cjs` ของเราถูกตีความผิด

วิธีแก้: scaffold นอก iCloud เสมอ — ใช้ `~/Downloads/` หรือ `~/projects/` แทน

### 8.4 ติดตั้ง .tar ไม่ได้ / ไฟล์เสีย

สาเหตุ: Safari/iCloud บางครั้ง strip `.gz` เวลา download → ไฟล์เหลือแค่ tar ภายใน

วิธีแก้: ใช้ชื่อไฟล์ `.tar` ตามที่ได้รับ **ห้ามเปลี่ยนเป็น `.tgz`** คำสั่งที่ถูกต้องคือ:

```bash
npm install -g ~/Downloads/create-mcpb-1.2.8.tar
```

---

## 9. สรุปคำสั่งที่ใช้บ่อย

```bash
# ติดตั้ง create-mcpb
cd ~ && npm install -g ~/Downloads/create-mcpb-1.2.8.tar

# สร้างส่วนขยาย (เลือก transport)
cd ~/Downloads/<ชื่อ>-ext
create-mcpb . --transport sse        # หรือ http หรือ stdio

# ตรวจ node path ใน manifest
grep -A 3 '"command"' manifest.json

# pack + install
npx -y @anthropic-ai/mcpb pack . <ชื่อ>-1.0.0.mcpb
open <ชื่อ>-1.0.0.mcpb

# restart Claude Desktop เพื่อทดสอบ
osascript -e 'quit app "Claude"'; sleep 3; killall Claude 2>/dev/null; sleep 2; open -a Claude

# uninstall แบบ manual
rm -rf ~/Library/Application\ Support/Claude/Claude\ Extensions/local.mcpb.<author>.<slug>
```

---

**เวอร์ชันคู่มือ:** v1.2.8 · **อัปเดต:** 19 เมษายน 2026
