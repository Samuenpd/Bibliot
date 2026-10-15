## Running the code

### Prerequisites

- Node.js 24+ (LTS recommended) and npm 9+
- Windows 10/11 for `dist:win` builds

### Installation

```bash
npm ci # clean install in CI / reproducible builds
# or
npm install # local development
```

> `postinstall` automatically runs `electron-builder install-app-deps` to rebuild native deps for Electron.

### Development

```bash
# Web only (Vite at http://localhost:5173)
npm run dev

# Desktop app (Vite + Electron)
npm run electron:dev
```

### Testing & Icons

```bash
npm test      # node --test test/*.test.cjs
npm run icons # regenerate build/icons from source icon
```

### Production build

```bash
npm run build    # web-only Vite build -> dist/
npm run dist     # web build + electron-builder package (current OS)
npm run dist:win # web build + Windows NSIS installer (.exe) -> release/
```
