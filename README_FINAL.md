# 🌀 Traversion: Time Machine for Vibe Coders

<p align="center">
  <em>Traverse through your code versions without the friction of git</em>
</p>

<p align="center">
  🚀 <strong>CURRENTLY RUNNING</strong> → <a href="http://localhost:3333">Open Traversion UI</a>
</p>

---

## ⚡ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start Traversion
npm run dev

# 3. Open http://localhost:3333
# 4. Start coding - every save is captured!
```

## ✨ What Makes This Special

- **Zero friction** - Just save your files, we capture everything
- **Web Components UI** - Modern, fast, no React bloat
- **Time travel slider** - Scrub through your code like a video
- **Vibe search** - Find versions by description: "when it was clean"
- **Real-time updates** - See changes instantly
- **SQLite storage** - Local, fast, reliable

## 🎯 Perfect For

- **Rapid prototypers** who try 50 versions in an hour
- **Creative coders** experimenting with wild ideas  
- **Debugging sessions** - "It worked 5 minutes ago"
- **Learning/teaching** - Show code evolution
- **Live coding** - Record your journey

## 🎮 How to Use

### Basic Operations
```bash
npm run dev          # Start Traversion
npm run stop         # Stop Traversion  
npm run status       # Check if running
npm run clean        # Reset all data
npm run logs         # View logs
```

### Web Interface
1. **Timeline Slider** - Drag to navigate through time
2. **Recent Activity** - Quick access to latest changes
3. **Compare Mode** - Side-by-side version comparison
4. **Vibe Search** - Natural language search

### Automatic Tracking
Supported file types: `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.go`, `.rs`, `.css`, `.html`

## 🔧 Configuration

### Environment Variables
```bash
TRAVERSION_PORT=3333              # Web server port
TRAVERSION_WS_PORT=3334           # WebSocket port  
TRAVERSION_EXTENSIONS=".js,.py"   # File types to track
```

### Config File (`.traversionrc`)
```json
{
  "port": 3333,
  "extensions": [".js", ".jsx", ".ts", ".tsx", ".py"],
  "ignore": ["node_modules", ".git", "dist"]
}
```

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   File Watcher  │ -> │  Version Store  │ -> │   Web UI        │
│   (Chokidar)    │    │   (SQLite)      │    │ (Web Components)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                         WebSocket Updates
```

## 🚨 Troubleshooting

**Port in use?**
```bash
lsof -i :3333
kill <PID>
```

**Not tracking files?**
- Check file extension is supported
- Restart: `Ctrl+C` then `npm run dev`

**High memory?**
```bash
npm run clean  # ⚠️ Deletes all history
```

## 📁 What Gets Created

```
.traversion/
├── versions.db       # Your code history (SQLite)
├── backups/          # Automatic backups
└── logs/             # Debug logs
```

## 🎵 Examples

### The "It Worked 5 Minutes Ago" Fix
1. Notice code is broken
2. Drag timeline back 5 minutes  
3. See exactly what was different
4. Copy the working version

### Rapid Prototyping Session
1. Try multiple approaches quickly
2. Use compare mode to see all attempts
3. Pick the best parts from each
4. Merge into final version

### Learning Session
1. Watch yourself solve a problem
2. See decision points in timeline
3. Share journey with others
4. Learn from the process

## 🔗 Documentation

- **[RUNNING.md](RUNNING.md)** - Quick operations guide
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** - Complete operations manual
- **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** - Development guide
- **[docs/API.md](docs/API.md)** - API documentation
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System design

## 🤝 Contributing

```bash
git clone https://github.com/yourusername/traversion.git
cd traversion
npm install
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 📜 License

MIT - see [LICENSE](LICENSE) file

---

<p align="center">
  <strong>Remember: It's not about perfect commits, it's about capturing the journey!</strong>
</p>

<p align="center">
  Made with 💜 by developers who lose perfect code in the chaos
</p>