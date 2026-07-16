# Getting Started with Fennec

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0 (or npm/yarn as alternative)

## Installation

### Global Install (Recommended)

```bash
npm install -g @plumpslabs/fennec-cli

# Start the MCP server (works without browser engines for terminal/process monitoring)
fennec start
```

> **Optional:** Install Playwright if you need browser automation:
>
> ```bash
> fennec install-browsers
> ```

### From Source

```bash
git clone https://github.com/plumpslabs/fennec.git
cd fennec
pnpm install
pnpm build

# Start the server
node packages/cli/dist/index.js start
```

### Peer Dependency Note

Playwright is an **optional peer dependency**. Features that don't require a browser (terminal watching, process management, log correlation) work without it. Install Playwright only when you need browser automation:

```bash
npm install playwright
fennec install-browsers
```

### Mobile (Android) Requirements

To use Fennec's mobile module for Android device management, you need:

- **ADB (Android Debug Bridge)** from [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools)
- **USB debugging** enabled on your Android device

Verify ADB is working:

```bash
adb devices
# Should show: <device-id> device
```

Fennec uses ADB directly via `child_process` — no additional Node.js packages required.

### Mobile Development (Wireless ADB)

**Sekali setup, selamanya wireless.** Colok USB cuma sekali buat pairing — setelah itu develop dari HP via WiFi tanpa kabel.

#### Step 1: USB Pairing (SEKALI)

```bash
# 1. Colok HP ke PC via USB
# 2. Pastikan USB Debugging ON di Developer Options HP
# 3. Cek apakah HP terdeteksi
adb devices
# Output: <device-id> device

# 4. Switch ADB ke mode TCP/IP (port 5555)
adb tcpip 5555
# Output: restarting in TCP mode port: 5555

# 5. Catet IP WiFi HP (dari Settings > About > Status)
#    Atau pake command:
adb shell ip addr show wlan0 | grep -oP 'inet \K[\d.]+'
# Output: 192.168.1.15 (contoh — ini IP HP lu)
```

#### Step 2: Lepas USB + Konek Wireless

```bash
# 6. LEPAS kabel USB dari HP
# 7. Konek wireless pake IP HP (dari step 5)
adb connect <IP_HP>:5555
# Contoh: adb connect 192.168.1.15:5555
# Output: connected to 192.168.1.15:5555

# 8. Verifikasi — HP harus kedetect
adb devices
# Output: 192.168.1.15:5555 device
```

✅ **Selesai!** Sekarang HP wireless, gaperlu colok USB lagi.

#### Besok-besok (Cukup Step 2)

Kalo mau develop lagi, tinggal:

```bash
adb connect <IP_HP>:5555
```

> **Syarat:** HP dan PC harus dalam **WiFi yang sama**.
> Kalo IP HP berubah, tinggal cek IP baru di Settings > About > Status.

#### Koneksi dari Luar WiFi (Tunnel)

Buat akses dari mana aja (pake data seluler), pake tunnel:

```bash
# Pake ngrok
ngrok http 3000
# Dapet URL: https://abc123.ngrok.io
# Buka URL itu dari HP (bisa pake 4G/5G)

# Atau pake cloudflared (cloudflare tunnel)
cloudflared tunnel --url http://localhost:3000
```

### Mobile Development Workflow (React Native / Expo)

#### Setup Wireless + Dev Server

```bash
# 1. Konek wireless ke HP
adb connect <IP_HP>:5555

# 2a. Kalo pake React Native CLI
npx react-native start
# Scan QR code dari HP via Expo Go atau Metro bundler

# 2b. Kalo pake Expo
npx expo start --tunnel
# Scan QR code dari HP via Expo Go
# --tunnel biar bisa akses dari luar jaringan lokal (pake data)

# 2c. Kalo pake Vite (web app)
npm run dev -- --host 0.0.0.0
# Buka http://<IP_PC>:5173 dari browser HP
```

#### Pantau Pakai Fennec Mobile Tools

Begitu dev server jalan, Fennec bisa monitor dari HP:

```
mobile_list_devices()           → liat device terdeteksi
mobile_screenshot()             → screenshot layar HP
mobile_logcat()                 → log Android realtime
mobile_tap(x, y)                → tap di HP dari PC
mobile_type("text")            → ketik di HP dari PC
mobile_swipe(x1,y1,x2,y2)      → swipe di HP

# Kalo app pake WebView:
mobile_inspect_webview()        → inspect WebView
mobile_get_webview_content()    → ambil konten WebView
mobile_capture_webview_console()→ console.log dari WebView
```

#### Contoh Workflow Lengkap

```bash
# Terminal 1: Jalanin Fennec server
fennec start

# Terminal 2: Jalanin dev server
expo start --tunnel

# Di AI agent:
# 1. mobile_list_devices()      → cek HP connected
# 2. mobile_logcat()            → monitor log
# 3. browser_navigate()         → buka app dari HP
# 4. observe()                  → AI pantau semua status
# 5. Kalo error → ai_diagnose() → AI cari root cause
```

> 💡 **Tips:**
>
> - `adb kill-server` + `adb start-server` kalo koneksi wireless bermasalah
> - `adb disconnect <IP>:5555` buat putusin koneksi
> - Kalo pake Expo, QR code bisa discan dari HP tanpa USB

## Quick Start

### 1. Start the MCP Server

```bash
fennec start
```

This starts the Fennec MCP server with stdio transport. Your AI agent (Claude Desktop, etc.) will communicate with Fennec via this server.

### 2. Configure Your MCP Client

Config format depends on your client:

**OpenCode** (`~/.config/opencode/opencode.json`):

```json
{
  "mcpServers": {
    "fennec": {
      "type": "local",
      "command": ["fennec", "start"],
      "enabled": true
    }
  }
}
```

**Claude Desktop / Cline / Cursor / Windsurf** (standard format):

```json
{
  "mcpServers": {
    "fennec": {
      "command": "fennec",
      "args": ["start"]
    }
  }
}
```

See [`packages/cli/README.md`](https://github.com/plumpslabs/fennec/blob/main/packages/cli/README.md) for per-client examples (SSE, Continue.dev, process permissions, etc.).

### 3. Use Fennec Tools

Once connected, your AI agent can use all Fennec tools. Here's a typical workflow:

```
User: "Check why my login page is broken"
Agent: [uses Fennec tools to investigate]

1. browser_navigate("http://localhost:3000/login")
2. devtools_get_console_logs()
3. network_get_failed_requests()
4. diagnose_fullstack()
```

## Basic Usage Examples

### Browse a Website

```
browser_navigate({ url: "https://example.com" })
browser_screenshot({ fullPage: true })
browser_get_page_text()
```

### Debug JavaScript Errors

```
devtools_get_console_logs({ level: "error" })
devtools_get_js_errors()
```

### Monitor Network Requests

```
network_get_logs({ status: 500 })
network_get_failed_requests()
```

### Authenticate & Save Session

```
auth_fill_login_form({ username: "user@example.com", password: "mypassword", submitAfter: true })
auth_save_session({ name: "myapp-prod" })
```

### Full-Stack Diagnosis

```
diagnose_fullstack({ processId: "dev-server" })
```

### Smart Tools — AI-Powered Interaction

```
// Smart wait with auto-diagnosis on timeout
smart_wait({ selector: "button:has-text(\"Login\")", timeout: 5000 })

// Smart fill form — auto-detect fields by label
smart_fill_form({ fields: { "email": "user@test.com", "password": "secret" }, submitAfter: true })

// Validate form before submit
smart_validate_form({ customRules: { "email": { type: "email", required: true } } })

// Annotated screenshot — numbered badges on elements
browser_screenshot_annotated({ format: "png" })

// Export screenshot as standalone HTML with bounding boxes
browser_screenshot_export({ format: "png" })

// Compare page changes — diff against previous state
browser_screenshot_diff({ baseline: { elements, screenshot } })
```

### Plan & Execute Multi-Step Goals

```
// Plan + execute in one call
planner_execute_goal({ goal: "log in to my app" })

// Preview plan before executing
planner_create_plan({ goal: "debug login issue" })

// Manage plans
planner_list_plans()
planner_get_plan({ planId: "..." })
planner_cancel_plan({ planId: "..." })
```

## Next Steps

- Explore the full [Tool Reference](tools/README.md) — 165+ MCP tools across 18 categories (including Mobile + AI + Debug)
- Learn about [Auth Flows](guides/auth-flows.md)
- Try [Full-Stack Debugging](guides/fullstack-debugging.md)
- Configure Fennec with `fennec init`
```
