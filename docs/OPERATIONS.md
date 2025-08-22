# Traversion Operations Guide

## Quick Reference

| Operation | Command | Description |
|-----------|---------|-------------|
| **Start** | `npm run dev` | Start file watcher and web server |
| **Stop** | `Ctrl+C` or `npm run stop` | Stop all services |
| **Status** | `lsof -i :3333` | Check if running |
| **Logs** | `tail -f .traversion/logs/watcher.log` | View live logs |
| **Reset** | `rm -rf .traversion` | Clear all data |

---

## Starting Traversion

### Method 1: npm Scripts (Recommended)

```bash
# Start in development mode
npm run dev

# Or start directly
npm start

# Start with custom options
TRAVERSION_PORT=4000 npm run dev
```

### Method 2: Direct Node.js

```bash
# Basic start
node src/watcher/index.js

# With custom directory
node src/watcher/index.js /path/to/your/project

# With environment variables
TRAVERSION_PORT=4000 TRAVERSION_WS_PORT=4001 node src/watcher/index.js
```

### Method 3: CLI Tool

```bash
# Make executable (one time)
chmod +x traversion.js

# Start watching current directory
./traversion.js watch

# Watch specific directory
./traversion.js watch /path/to/project

# With options
./traversion.js watch --port 4000 --extensions .js,.ts,.py
```

### Startup Sequence

When you start Traversion, this happens:

1. **Database Initialization**
   ```
   Creating .traversion/ directory
   Initializing SQLite database
   Creating tables and indexes
   ```

2. **File Watcher Setup**
   ```
   Scanning directory for existing files
   Setting up chokidar watchers
   Applying ignore patterns
   ```

3. **Server Startup**
   ```
   Starting Express server on port 3333
   Starting WebSocket server on port 3334
   Serving static files from /public
   ```

4. **Ready State**
   ```
   ⚡ Traversion - Time Machine for Vibe Coders ⚡
   
   Watching: /your/project/path
   Port: 3333
   Extensions: .js, .jsx, .ts, .tsx, .py, .go, .rs, .css, .html
   
   ✨ Traversion is ready! Your code journey is being recorded...
   
   🌐 Open http://localhost:3333 to see your timeline
   ```

---

## Stopping Traversion

### Method 1: Graceful Shutdown

```bash
# In the terminal where Traversion is running
Ctrl+C

# You'll see:
👋 Traversion stopped. Your journey is saved!
```

### Method 2: Kill Process

```bash
# Find the process
lsof -i :3333

# Kill by PID
kill <PID>

# Or kill all node processes (careful!)
pkill node
```

### Method 3: npm Script

```bash
# If you have a stop script configured
npm run stop
```

### Shutdown Sequence

1. **Signal Handler**: Catches SIGINT/SIGTERM
2. **Database Cleanup**: Closes SQLite connections safely
3. **File Watcher**: Stops chokidar watchers
4. **Server Shutdown**: Closes HTTP and WebSocket servers
5. **Process Exit**: Clean exit with code 0

---

## Restarting Traversion

### Development Restart (with nodemon)

```bash
# Install nodemon globally
npm install -g nodemon

# Start with auto-restart
nodemon src/watcher/index.js

# Auto-restart watches these files:
# - src/**/*.js
# - package.json
# - .env files
```

### Manual Restart

```bash
# Stop current instance
Ctrl+C

# Start again
npm run dev
```

### Production Restart (with PM2)

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start src/watcher/index.js --name "traversion"

# Restart
pm2 restart traversion

# Stop
pm2 stop traversion

# View logs
pm2 logs traversion
```

---

## Process Management

### Checking Status

```bash
# Check if ports are in use
lsof -i :3333 :3334

# Check process details
ps aux | grep "src/watcher/index.js"

# Check memory usage
top -p $(pgrep -f "src/watcher/index.js")
```

### Health Check

```bash
# API health check
curl http://localhost:3333/api/timeline

# WebSocket health check
wscat -c ws://localhost:3334

# Database health check
sqlite3 .traversion/versions.db "SELECT COUNT(*) FROM versions;"
```

### Performance Monitoring

```bash
# Watch resource usage
watch "ps -o pid,ppid,cmd,%cpu,%mem --sort=-%mem -C node"

# Monitor file descriptors
lsof -p $(pgrep -f "src/watcher/index.js") | wc -l

# Database size
du -h .traversion/versions.db
```

---

## Configuration

### Environment Variables

```bash
# Server configuration
export TRAVERSION_PORT=3333
export TRAVERSION_WS_PORT=3334

# File watching
export TRAVERSION_EXTENSIONS=".js,.jsx,.ts,.tsx,.py"
export TRAVERSION_IGNORE_PATTERNS="node_modules,.git,dist,build"

# Database
export TRAVERSION_DB_PATH=".traversion/versions.db"

# Logging
export TRAVERSION_LOG_LEVEL="info"
export TRAVERSION_LOG_FILE=".traversion/logs/watcher.log"
```

### Configuration File

Create `.traversionrc` in your project root:

```json
{
  "port": 3333,
  "wsPort": 3334,
  "extensions": [".js", ".jsx", ".ts", ".tsx", ".py", ".css"],
  "ignore": ["node_modules", ".git", "dist", "build", "*.log"],
  "database": {
    "path": ".traversion/versions.db",
    "pragma": {
      "journal_mode": "WAL",
      "synchronous": "NORMAL"
    }
  },
  "features": {
    "autoCapture": true,
    "vibeSearch": true,
    "branches": true,
    "metrics": false
  }
}
```

---

## Logs and Debugging

### Log Locations

```bash
# Main log file
.traversion/logs/watcher.log

# Error logs
.traversion/logs/error.log

# Access logs
.traversion/logs/access.log

# Database logs
.traversion/logs/db.log
```

### Viewing Logs

```bash
# Live tail all logs
tail -f .traversion/logs/*.log

# Filter by level
grep "ERROR" .traversion/logs/watcher.log

# Last 100 lines
tail -100 .traversion/logs/watcher.log

# Search for specific events
grep "version captured" .traversion/logs/watcher.log
```

### Debug Mode

```bash
# Start with debug logging
DEBUG=traversion:* node src/watcher/index.js

# Or with environment variable
TRAVERSION_LOG_LEVEL=debug npm run dev
```

### Common Log Messages

```bash
# Normal operation
📸 filename.js [v123] 4:38:29 PM    # Version captured
➕ newfile.js [new file]             # New file detected
🗑️ oldfile.js [deleted]              # File deleted

# Errors
❌ Failed to capture version: ...     # Capture error
🚨 Database error: ...               # Database issue
⚠️  High memory usage detected       # Performance warning
```

---

## Database Management

### Database Location

```bash
# Default location
.traversion/versions.db

# Backup location
.traversion/backups/versions_YYYY-MM-DD.db
```

### Database Operations

```bash
# View database info
sqlite3 .traversion/versions.db ".schema"

# Count versions
sqlite3 .traversion/versions.db "SELECT COUNT(*) FROM versions;"

# View recent versions
sqlite3 .traversion/versions.db "SELECT id, file_path, timestamp FROM versions ORDER BY timestamp DESC LIMIT 10;"

# Database size
du -h .traversion/versions.db

# Vacuum database (optimize)
sqlite3 .traversion/versions.db "VACUUM;"
```

### Backup and Restore

```bash
# Create backup
cp .traversion/versions.db .traversion/backups/backup_$(date +%Y%m%d_%H%M%S).db

# Restore from backup
cp .traversion/backups/backup_20241220_143022.db .traversion/versions.db

# Export to JSON
curl http://localhost:3333/api/timeline > timeline_backup.json

# Automated daily backup (cron)
0 2 * * * cd /path/to/project && cp .traversion/versions.db .traversion/backups/daily_$(date +\%Y\%m\%d).db
```

---

## Troubleshooting

### Common Issues

#### Port Already in Use

```bash
# Problem
Error: listen EADDRINUSE :::3333

# Solution 1: Find and kill process
lsof -i :3333
kill <PID>

# Solution 2: Use different port
TRAVERSION_PORT=4000 npm run dev

# Solution 3: Check what's using the port
netstat -tulpn | grep 3333
```

#### Permission Denied

```bash
# Problem
Error: EACCES: permission denied, mkdir '.traversion'

# Solution
chmod 755 .
sudo chown $USER:$USER .
```

#### High Memory Usage

```bash
# Problem
Memory usage > 1GB

# Check version count
sqlite3 .traversion/versions.db "SELECT COUNT(*) FROM versions;"

# Solution: Clean old versions
sqlite3 .traversion/versions.db "DELETE FROM versions WHERE timestamp < datetime('now', '-30 days');"
sqlite3 .traversion/versions.db "VACUUM;"
```

#### Database Locked

```bash
# Problem
Error: database is locked

# Solution
# 1. Stop Traversion
Ctrl+C

# 2. Check for hanging processes
lsof .traversion/versions.db

# 3. Kill processes if needed
kill <PID>

# 4. Restart
npm run dev
```

#### Files Not Being Tracked

```bash
# Check ignore patterns
cat .gitignore
cat .traversionignore

# Check file extensions
echo "Supported: .js,.jsx,.ts,.tsx,.py,.go,.rs,.css,.html"

# Test with specific file
touch test.js
echo "console.log('test')" > test.js
# Should see capture message
```

### Debug Commands

```bash
# Test file watcher
node -e "
const chokidar = require('chokidar');
chokidar.watch('.', {ignored: /node_modules/}).on('change', path => console.log('Changed:', path));
"

# Test database connection
sqlite3 .traversion/versions.db "SELECT 'DB OK';"

# Test API endpoints
curl http://localhost:3333/api/timeline
curl http://localhost:3333/api/recent

# Test WebSocket connection
wscat -c ws://localhost:3334
```

---

## Performance Optimization

### System Requirements

```bash
# Minimum
- Node.js 18+
- 512MB RAM
- 100MB disk space

# Recommended
- Node.js 20+
- 2GB RAM
- 1GB disk space
- SSD storage
```

### Performance Tuning

```bash
# Optimize SQLite
sqlite3 .traversion/versions.db "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = 10000;
PRAGMA temp_store = memory;
"

# Node.js optimization
export NODE_OPTIONS="--max-old-space-size=2048"

# File watcher optimization (reduce CPU)
export TRAVERSION_DEBOUNCE=200  # ms
export TRAVERSION_POLL_INTERVAL=1000  # ms
```

### Monitoring Performance

```bash
# CPU usage
top -p $(pgrep -f "src/watcher/index.js")

# Memory usage
ps -o pid,vsz,rss,pmem,comm -p $(pgrep -f "src/watcher/index.js")

# File descriptor count
lsof -p $(pgrep -f "src/watcher/index.js") | wc -l

# Database performance
sqlite3 .traversion/versions.db ".timer on" "SELECT COUNT(*) FROM versions;"
```

---

## Maintenance Tasks

### Daily

```bash
# Check status
lsof -i :3333

# Check logs for errors
grep "ERROR\|WARN" .traversion/logs/watcher.log

# Check disk usage
du -h .traversion/
```

### Weekly

```bash
# Backup database
cp .traversion/versions.db .traversion/backups/weekly_$(date +%Y%m%d).db

# Clean old logs
find .traversion/logs -name "*.log" -mtime +7 -delete

# Optimize database
sqlite3 .traversion/versions.db "VACUUM; ANALYZE;"
```

### Monthly

```bash
# Archive old versions (optional)
sqlite3 .traversion/versions.db "
CREATE TABLE versions_archive AS 
SELECT * FROM versions WHERE timestamp < datetime('now', '-90 days');
DELETE FROM versions WHERE timestamp < datetime('now', '-90 days');
VACUUM;
"

# Update dependencies
npm update

# Check for new Traversion version
# (when available on npm)
```

---

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/traversion.yml
name: Traversion Monitoring
on:
  push:
    branches: [main]

jobs:
  test-traversion:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm install
        
      - name: Start Traversion
        run: |
          npm run dev &
          TRAVERSION_PID=$!
          echo $TRAVERSION_PID > traversion.pid
        
      - name: Wait for startup
        run: sleep 5
        
      - name: Test API
        run: |
          curl -f http://localhost:3333/api/timeline
          
      - name: Stop Traversion
        run: |
          kill $(cat traversion.pid)
```

### Docker

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3333 3334

CMD ["npm", "run", "dev"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  traversion:
    build: .
    ports:
      - "3333:3333"
      - "3334:3334"
    volumes:
      - ./code:/app/code
      - traversion-data:/app/.traversion
    environment:
      - TRAVERSION_PORT=3333
      - TRAVERSION_WS_PORT=3334

volumes:
  traversion-data:
```

---

## Security Considerations

### File System Access

```bash
# Traversion only reads files in watched directory
# No write access to source files
# Database stored in .traversion/ subdirectory

# Recommended: Add to .gitignore
echo ".traversion/" >> .gitignore
```

### Network Security

```bash
# By default, binds to localhost only
# For external access, use:
TRAVERSION_HOST=0.0.0.0 npm run dev

# Use reverse proxy for production:
# nginx, caddy, etc.
```

### Data Privacy

```bash
# PII detection enabled by default
# Automatic masking of:
# - API keys
# - Passwords
# - Email addresses
# - Credit card numbers

# Configure in .traversionrc:
{
  "privacy": {
    "maskPII": true,
    "customPatterns": ["secretKey.*", "password.*"]
  }
}
```

---

## Advanced Usage

### Programmatic Control

```javascript
// start-traversion.js
import { TraversionWatcher } from './src/watcher/index.js';

const watcher = new TraversionWatcher('.', {
  port: 3333,
  extensions: ['.js', '.ts'],
  ignore: ['node_modules', '.git']
});

watcher.start();

// Stop after 1 hour
setTimeout(() => {
  watcher.stop();
}, 3600000);
```

### Custom Extensions

```javascript
// Add support for new file types
// In src/watcher/index.js

const customDetectors = {
  '.vue': (content) => {
    const tags = [];
    if (content.includes('<script setup>')) tags.push('composition-api');
    if (content.includes('defineComponent')) tags.push('vue3');
    return tags;
  }
};
```

### Webhook Integration

```javascript
// webhook-handler.js
app.post('/webhook/version-captured', (req, res) => {
  const { version } = req.body;
  
  // Send to Slack
  slack.send(`New version captured: ${version.file_path} v${version.id}`);
  
  // Update external tracking
  analytics.track('version_captured', {
    file: version.file_path,
    size: version.content.length
  });
  
  res.json({ status: 'ok' });
});
```

---

## Support and Community

### Getting Help

1. **Check Logs**: `tail -f .traversion/logs/watcher.log`
2. **Search Issues**: [GitHub Issues](https://github.com/traversion/traversion/issues)
3. **Discord**: [Join our community](https://discord.gg/traversion)
4. **Stack Overflow**: Tag `traversion`

### Reporting Issues

```bash
# Gather debug info
echo "=== System Info ===" > debug.txt
node --version >> debug.txt
npm --version >> debug.txt
uname -a >> debug.txt

echo "=== Traversion Info ===" >> debug.txt
npm list --depth=0 >> debug.txt
cat package.json >> debug.txt

echo "=== Logs ===" >> debug.txt
tail -50 .traversion/logs/watcher.log >> debug.txt

echo "=== Database Info ===" >> debug.txt
sqlite3 .traversion/versions.db "SELECT COUNT(*) as version_count FROM versions;" >> debug.txt
```

---

Remember: **Traversion is designed to be simple and reliable. Most issues are solved by stopping and restarting the service.** ✨