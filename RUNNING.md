# 🚀 Traversion Quick Start & Operations

## ⚡ TL;DR - Get Running in 30 Seconds

```bash
# 1. Install dependencies
npm install

# 2. Start Traversion
npm run dev

# 3. Open in browser
open http://localhost:3333

# 4. Start coding - every save is captured!
```

---

## 🎮 Basic Operations

### Start Traversion
```bash
npm run dev                    # Standard start
node src/watcher/index.js      # Direct start
./traversion.js watch          # CLI tool
```

### Stop Traversion
```bash
Ctrl+C                         # Graceful stop
kill $(lsof -ti:3333)         # Force stop
```

### Check Status
```bash
lsof -i :3333                 # Check if running
curl http://localhost:3333/api/timeline  # Test API
```

---

## 📊 What's Running When Started

```
✅ File Watcher    → Monitors your code changes
✅ SQLite Database → Stores version history
✅ Web Server      → http://localhost:3333 (UI)
✅ WebSocket       → ws://localhost:3334 (live updates)
✅ REST API        → /api/* endpoints
```

---

## 🎯 Common Tasks

### View Your Timeline
- Open **http://localhost:3333**
- Drag the timeline slider to navigate
- Click versions in the sidebar

### Search Your Code History
- Click "✨ Vibe Search"
- Try: "when it was minimal", "async code", "before the bug"

### Compare Versions
- Click "Compare Mode"
- Select two versions
- See side-by-side diff

---

## 🔧 Configuration

### Quick Config (Environment Variables)
```bash
TRAVERSION_PORT=4000 npm run dev     # Different port
TRAVERSION_EXTENSIONS=.js,.py npm run dev  # Specific file types
```

### Full Config (Create `.traversionrc`)
```json
{
  "port": 3333,
  "extensions": [".js", ".jsx", ".ts", ".tsx", ".py"],
  "ignore": ["node_modules", ".git", "dist"]
}
```

---

## 🚨 Troubleshooting

### Port Already in Use
```bash
# Find what's using port 3333
lsof -i :3333

# Kill the process
kill <PID>

# Or use different port
TRAVERSION_PORT=4000 npm run dev
```

### Not Tracking Files
- Check file extension is supported (`.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.css`, `.html`)
- Make sure file isn't in ignore patterns
- Restart Traversion

### High Memory Usage
```bash
# Check version count
sqlite3 .traversion/versions.db "SELECT COUNT(*) FROM versions;"

# Clean old versions (keep last 1000)
sqlite3 .traversion/versions.db "DELETE FROM versions WHERE id NOT IN (SELECT id FROM versions ORDER BY timestamp DESC LIMIT 1000);"
```

---

## 📁 File Structure

```
.traversion/           # Traversion data directory
├── versions.db       # SQLite database with your history
├── backups/          # Automatic backups
└── logs/             # Log files

public/               # Web UI files
src/                  # Traversion source code
```

---

## 🎵 Using Traversion

### For Rapid Prototyping
1. Start Traversion
2. Code multiple approaches quickly
3. Use timeline to compare all attempts
4. Pick the best version

### For Debugging
1. Notice something broke
2. Drag timeline back to when it worked
3. Compare versions to find the issue
4. Fix and continue

### For Learning
1. Record your coding session
2. Review your problem-solving process
3. Share timeline with others
4. Learn from the journey

---

## 🔗 Important URLs

- **Main UI**: http://localhost:3333
- **API Docs**: http://localhost:3333/api/timeline
- **Health Check**: `curl http://localhost:3333/api/timeline`

---

## 📚 Full Documentation

- **[OPERATIONS.md](docs/OPERATIONS.md)** - Complete operations guide
- **[DEVELOPMENT.md](docs/DEVELOPMENT.md)** - Development workflow
- **[API.md](docs/API.md)** - API documentation
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture

---

## 🆘 Need Help?

1. **Check the logs**: `tail -f .traversion/logs/watcher.log`
2. **Restart**: Stop with `Ctrl+C`, then `npm run dev`
3. **Reset**: `rm -rf .traversion` (⚠️ deletes all history)
4. **Check GitHub Issues**: [Report problems](https://github.com/traversion/traversion/issues)

---

**Remember: Traversion captures every save automatically. Just code naturally and your journey is recorded!** ✨

Happy Vibing! 🎵