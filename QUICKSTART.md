# Traversion Quick Start

## Installation

```bash
# Install dependencies
npm install

# Install UI dependencies
cd ui && npm install && cd ..
```

## Start Traversion

### Option 1: Watch current directory
```bash
npm run dev
```

### Option 2: Watch specific directory
```bash
node src/watcher/index.js /path/to/your/project
```

### Option 3: Use the CLI
```bash
# Make it executable
chmod +x traversion.js

# Watch current directory
./traversion.js watch

# Watch specific directory
./traversion.js watch /path/to/project
```

## How to Use

1. **Start coding** - Every save is automatically captured
2. **Open the UI** - Navigate to http://localhost:3333
3. **Time travel** - Drag the timeline slider to traverse through versions
4. **Compare versions** - Click "Compare Mode" and select two versions
5. **Search by vibe** - Use "Vibe Search" to find versions by description

## Features

### 🎯 Automatic Version Capture
- Every file save is recorded
- No commits needed
- Captures output and errors

### ⏰ Timeline Slider
- Scrub through time like a video
- See your code morph in real-time
- Visual heatmap of activity

### 🔍 Comparison Mode
- Side-by-side diff view
- See what changed between versions
- Track evolution of your code

### ✨ Vibe Search
- "Show me when it was fast"
- "Find the minimal version"
- "When did it work?"

### 📊 Recent Activity
- See your latest changes
- Quick access to recent versions
- Visual vibe indicators

## File Tracking

By default, Traversion tracks:
- `.js`, `.jsx` - JavaScript
- `.ts`, `.tsx` - TypeScript  
- `.py` - Python
- `.go` - Go
- `.rs` - Rust
- `.css` - Stylesheets
- `.html` - Markup

## Data Storage

All version data is stored in `.traversion/versions.db` in your project directory.

## Keyboard Shortcuts (Coming Soon)

- `Space` - Play/pause timeline
- `←/→` - Step through versions
- `Shift + ←/→` - Jump between files
- `C` - Toggle compare mode
- `V` - Open vibe search
- `R` - Reset to latest

## Tips for Vibe Coding

1. **Save often** - Every save is a checkpoint you can return to
2. **Experiment freely** - You can always go back
3. **Use vibe tags** - Add comments like `// vibing` or `// TODO` for better search
4. **Compare approaches** - Try different solutions and compare them
5. **Trust the timeline** - Your perfect version is in there somewhere

## Troubleshooting

### UI not loading?
- Make sure both the watcher and UI are running
- Check ports 3333 (API) and 3334 (WebSocket)

### Not tracking changes?
- Check file extensions are supported
- Verify the watcher is running
- Look for `.traversion` directory in your project

### Database issues?
- Delete `.traversion` directory to reset
- Restart the watcher

## Advanced Usage

### Custom Extensions
```bash
./traversion.js watch --extensions .md,.yaml,.json
```

### Different Port
```bash
./traversion.js watch --port 4444
```

### Ignore Patterns
Add to your `.gitignore` or create `.traversionignore` (coming soon)

---

**Happy Vibing! 🎵✨**

Remember: It's not about the destination, it's about the journey through your code.