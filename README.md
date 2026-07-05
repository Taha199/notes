# Mina Anteckningar

A modern notes app — React + TypeScript + Tailwind CSS, with Firebase Authentication (email/password + Google) and Realtime Database sync. Supports Arabic/English/Swedish, dark mode, rich-text notes, favorites, archive, and trash.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output goes to `dist/`. Deploys on Vercel with zero config (Vite framework auto-detected).

## macOS Desktop App

A native Mac wrapper loads [tahanote.com](https://tahanote.com) in an Electron window (dev mode uses the local Vite server).

```bash
npm run desktop:dev      # Vite + Electron window (localhost:5173)
npm run desktop:build    # Package .app and .dmg → release/
```

See [docs/desktop.md](docs/desktop.md) for load modes, offline bundling, and build details.
