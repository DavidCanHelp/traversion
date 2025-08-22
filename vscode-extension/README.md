# Traversion for VS Code

## Time Travel Through Your Code - Right in Your Editor! 🚀

Traversion brings the power of time travel debugging directly into VS Code. Navigate through your code's history, compare versions, and restore previous states without leaving your editor.

## Features

### 🕐 **Timeline View**
- See all versions of your current file in the sidebar
- Quick navigation through your code's history
- Smart tags show what type of changes were made

### 🔄 **Instant Comparison**
- Compare current file with any previous version
- Side-by-side diff view with syntax highlighting
- Keyboard shortcut: `Cmd+Alt+P` (Mac) / `Ctrl+Alt+P` (Windows/Linux)

### ⏮️ **One-Click Rollback**
- Restore any previous version instantly
- Preview before rollback
- Safe with confirmation prompts

### 🔍 **Smart Search**
- Search versions by "vibe" - natural language queries
- Find versions by tags like "react", "bugfix", "performance"
- AI-powered tag detection

### 📊 **Statistics Dashboard**
- See coding patterns and trends
- Track most-used tags
- Monitor file change frequency

### ⚡ **Time Travel Mode**
- Toggle time travel mode with `Cmd+Alt+Shift+T`
- Slide through time to see code evolution
- Inline annotations show version info

### 🔗 **Live Updates**
- Real-time WebSocket connection
- See changes as they happen
- Collaborative awareness

## Installation

1. Install the Traversion server:
```bash
npm install -g traversion
```

2. Start Traversion in your project:
```bash
cd your-project
traversion watch
```

3. Install this VS Code extension from the marketplace

4. The extension auto-connects to your local Traversion server

## Commands

All commands are available through the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

- `Traversion: Show Timeline` - View version history
- `Traversion: Compare with Previous Version` - Diff with last version
- `Traversion: Rollback to Version` - Restore a previous version
- `Traversion: Search by Vibe` - Natural language search
- `Traversion: Show Statistics` - View coding statistics
- `Traversion: Toggle Time Travel Mode` - Enable time slider
- `Traversion: Export History` - Save history as JSON/CSV
- `Traversion: Show File Tags` - View current file's smart tags

## Keyboard Shortcuts

| Command | Mac | Windows/Linux |
|---------|-----|---------------|
| Show Timeline | `Cmd+Alt+T` | `Ctrl+Alt+T` |
| Compare with Previous | `Cmd+Alt+P` | `Ctrl+Alt+P` |
| Toggle Time Travel | `Cmd+Alt+Shift+T` | `Ctrl+Alt+Shift+T` |

## Configuration

Configure Traversion in VS Code settings:

```json
{
  "traversion.serverUrl": "http://localhost:3333",
  "traversion.enabled": true,
  "traversion.autoTrack": true,
  "traversion.showInlineAnnotations": true,
  "traversion.timelineLimit": 50,
  "traversion.showTags": true
}
```

## Smart Tags

Traversion automatically detects and tags your code:

- **Frameworks**: `react`, `vue`, `angular`, `express`
- **Code Quality**: `clean-code`, `needs-refactor`, `well-documented`
- **Patterns**: `singleton`, `factory`, `observer`
- **Security**: `auth-code`, `encryption`, `api-keys`
- **Performance**: `optimization`, `caching`, `algorithm`
- **Stage**: `wip`, `debug`, `hotfix`, `feature`, `bugfix`

## Remote Connection

Connect to a remote Traversion server:

1. Update settings:
```json
{
  "traversion.serverUrl": "http://remote-server:3333"
}
```

2. Reload VS Code window

## Requirements

- VS Code 1.74.0 or higher
- Traversion server running (local or remote)
- Node.js 16+ for the server

## Troubleshooting

### Extension not connecting?
1. Check if Traversion server is running: `traversion status`
2. Verify the server URL in settings
3. Check firewall settings for ports 3333-3334

### Timeline not updating?
1. Ensure file watching is enabled in Traversion
2. Check if the file type is supported
3. Reload the VS Code window

### Performance issues?
1. Reduce `traversion.timelineLimit` in settings
2. Disable `traversion.showInlineAnnotations`
3. Use a local Traversion server instead of remote

## Contributing

We welcome contributions! Visit our [GitHub repository](https://github.com/traversion/vscode-extension).

## License

MIT

---

**Made with ❤️ for vibe coders everywhere**