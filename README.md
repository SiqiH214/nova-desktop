# nova-desktop

Pika desktop app — native macOS wrapper for [pika.me](https://pika.me)

## Download

Get the latest release: https://github.com/SiqiH214/nova-desktop/releases

**Install:**
1. Download the `.zip` for your Mac:
   - `Pika-*-arm64-mac.zip` → Apple Silicon (M1/M2/M3)
   - `Pika-*-mac.zip` → Intel Mac
2. Unzip it
3. Drag **Pika.app** to your Applications folder
4. Launch Pika

**Note:** Since the app is unsigned, macOS will show a security warning on first launch. Right-click the app → **Open** to bypass.

## Features

- Native macOS window with traffic light controls
- Dark mode support
- Menu bar icon (click to show/hide)
- Keyboard shortcuts (⌘R reload, ⌘+/- zoom, etc.)
- Deep link support (`pika://` URLs)
- Auto-retry on connection failure

## Dev

```bash
npm install
npm start        # dev mode
npm run build:mac    # build .zip
```

## Stack

- Electron 34
- electron-builder

## License

MIT
