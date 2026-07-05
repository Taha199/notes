# Taha Note — macOS Desktop App

The desktop app is a lightweight **Electron** wrapper around the Taha Note web app. It does not duplicate app logic — the UI runs from the live site or the local Vite dev server.

## Why Electron (not Tauri)

| Approach | Notes |
|----------|-------|
| **Electron** (chosen) | No Rust toolchain required; ideal for loading `https://tahanote.com` or `localhost` in a native window. |
| Tauri 2 | Smaller binaries, but needs Rust/Cargo and is better suited when bundling local assets as the primary target. |

## Load modes

| Command / env | What loads |
|---------------|------------|
| `npm run desktop:dev` | `http://localhost:5173` (Vite dev server) |
| `npm run desktop:build` (default) | `https://tahanote.com` (production) |
| `DESKTOP_BUNDLE=1 npm run desktop:build:offline` | Bundled `dist/` via `file://` (offline UI only; Firebase/APIs still need network) |

## Prerequisites

- macOS (for building `.app` / `.dmg`)
- Node.js 20+
- `npm install` at the repo root

## Development

Starts Vite and opens the app window pointed at localhost:

```bash
npm run desktop:dev
```

## Build

Build the web app, then package the macOS app:

```bash
npm run desktop:build
```

Output is written to `release/`:

- `release/mac/Taha Note.app` — application bundle
- `release/Taha Note-<version>.dmg` — disk image installer

### Offline / bundled build

```bash
DESKTOP_BUNDLE=1 npm run desktop:build:offline
```

> **Note:** Bundled mode serves static files from `dist/`. History-based routing may be limited without a local server; production URL mode is recommended for normal use.

## App identity

- **Name:** Taha Note
- **Bundle ID:** `com.tahanote.app`
- **Icon:** upscaled from `public/logo.png` (512×512)

## Project layout

```
electron/
  main.cjs      # Main process — window, URL loading
  preload.cjs   # Preload script (reserved for future APIs)
  icons/        # macOS app icon (.icns)
```

Web app code under `src/` is unchanged. Desktop config lives only under `electron/` plus `package.json` build settings.
