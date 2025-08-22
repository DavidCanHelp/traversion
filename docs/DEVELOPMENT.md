# Traversion Development Guide

## Development Workflow

### Setting Up Development Environment

```bash
# Clone the repository
git clone https://github.com/yourusername/traversion.git
cd traversion

# Install dependencies
npm install

# Start development mode
npm run dev

# In another terminal, start development UI (if needed)
npm run ui:dev
```

### Development Commands

| Command | Purpose | Details |
|---------|---------|---------|
| `npm run dev` | Start file watcher | Starts core Traversion service |
| `npm run watch` | Start with nodemon | Auto-restart on file changes |
| `npm test` | Run test suite | All unit and integration tests |
| `npm run lint` | Code linting | ESLint with custom rules |
| `npm run build` | Build for production | Compile and optimize |
| `npm run clean` | Clean build artifacts | Remove dist, .traversion, logs |

### Project Structure Deep Dive

```
traversion/
├── src/                          # Core source code
│   ├── watcher/                  # File watching service
│   │   ├── index.js             # Main watcher entry point
│   │   ├── fileWatcher.js       # Chokidar wrapper
│   │   └── eventProcessor.js    # File change processing
│   ├── engine/                  # Core version tracking
│   │   ├── versionStore.js      # Database operations
│   │   ├── diffEngine.js        # Diff calculation
│   │   ├── vibeDetector.js      # Vibe tag detection
│   │   └── searchEngine.js      # Search functionality
│   ├── api/                     # REST API layer
│   │   ├── routes/              # API route handlers
│   │   ├── middleware/          # Express middleware
│   │   └── websocket.js         # WebSocket handlers
│   └── db/                      # Database utilities
│       ├── migrations/          # Schema migrations
│       ├── seeds/               # Test data
│       └── schema.sql           # Database schema
├── public/                       # Static web assets
│   ├── js/                      # Web Components
│   │   ├── components/          # UI components
│   │   └── app.js               # Main application
│   ├── styles.css               # Global styles
│   └── index.html               # Main HTML page
├── test/                        # Test files
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── fixtures/                # Test data
├── docs/                        # Documentation
├── scripts/                     # Build and utility scripts
└── config/                      # Configuration files
```

---

## Code Architecture

### Core Classes

#### TraversionWatcher
```javascript
// Main orchestrator class
class TraversionWatcher {
  constructor(watchPath, options) {
    this.watchPath = watchPath;
    this.options = options;
    this.store = new VersionStore();
    this.server = new ApiServer();
  }

  start() {
    // Initialize components
    // Start file watching
    // Start web server
    // Start WebSocket server
  }

  stop() {
    // Graceful shutdown
    // Close database connections
    // Stop servers
  }
}
```

#### VersionStore
```javascript
// Database operations and version management
class VersionStore {
  saveVersion(filePath, content, metadata) {
    // Validate input
    // Calculate hash
    // Check for duplicates
    // Store in database
    // Return version ID
  }

  getTimeline(filters) {
    // Query versions
    // Apply filters
    // Sort by timestamp
    // Return paginated results
  }

  compareVersions(idA, idB) {
    // Fetch versions
    // Calculate diff
    // Compute similarity
    // Cache results
    // Return comparison
  }
}
```

### Data Flow Architecture

```
File Change Event
       ↓
┌─────────────────┐
│  File Watcher   │ ← chokidar events
└─────────────────┘
       ↓
┌─────────────────┐
│ Event Processor │ ← filter, validate, debounce
└─────────────────┘
       ↓
┌─────────────────┐
│  Vibe Detector  │ ← analyze content, extract tags
└─────────────────┘
       ↓
┌─────────────────┐
│ Version Store   │ ← save to SQLite
└─────────────────┘
       ↓
┌─────────────────┐
│ WebSocket Broadcast │ ← notify connected clients
└─────────────────┘
       ↓
┌─────────────────┐
│   UI Update     │ ← update timeline, recent activity
└─────────────────┘
```

---

## Web Components Architecture

### Component Hierarchy

```
App (index.html)
├── Header
│   ├── Logo
│   ├── VibeSearch
│   └── CompareModeToggle
├── Layout
│   ├── Sidebar
│   │   └── RecentActivity
│   └── MainContent
│       └── CodeViewer
├── TimeSlider
└── StatusBar
```

### Component Communication

```javascript
// Event-driven architecture
window.addEventListener('version-selected', (e) => {
  const version = e.detail;
  // Update UI state
});

window.dispatchEvent(new CustomEvent('version-selected', {
  detail: versionData
}));
```

### Component Lifecycle

```javascript
class TraversalComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.subscribeToStateChanges();
  }

  disconnectedCallback() {
    this.cleanup();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      this.handleAttributeChange(name, newValue);
    }
  }
}
```

---

## Database Design

### Schema Design Patterns

```sql
-- Temporal table pattern
CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- other fields
);

-- Soft delete pattern
ALTER TABLE versions ADD COLUMN deleted_at DATETIME;
CREATE INDEX idx_versions_active ON versions(id) WHERE deleted_at IS NULL;

-- JSON fields for flexibility
ALTER TABLE versions ADD COLUMN metadata JSON;

-- Efficient indexing
CREATE INDEX idx_versions_file_time ON versions(file_path, timestamp DESC);
```

### Database Optimization

```javascript
// Connection optimization
const db = new Database(dbPath, {
  pragma: {
    journal_mode: 'WAL',
    synchronous: 'NORMAL',
    cache_size: 10000,
    temp_store: 'memory'
  }
});

// Query optimization
const stmt = db.prepare(`
  SELECT * FROM versions 
  WHERE file_path = ? 
  AND timestamp BETWEEN ? AND ?
  ORDER BY timestamp DESC
  LIMIT ?
`);
```

---

## Testing Strategy

### Test Categories

1. **Unit Tests** - Individual functions and classes
2. **Integration Tests** - Component interactions
3. **End-to-End Tests** - Full user workflows
4. **Performance Tests** - Load and stress testing

### Test Setup

```javascript
// test/setup.js
import { before, after } from 'mocha';
import { TraversionWatcher } from '../src/watcher/index.js';

let testWatcher;

before(async () => {
  // Setup test database
  testWatcher = new TraversionWatcher('./test/fixtures', {
    dbPath: ':memory:'
  });
  await testWatcher.start();
});

after(async () => {
  await testWatcher.stop();
});
```

### Writing Tests

```javascript
// test/unit/versionStore.test.js
import { describe, it, expect } from 'mocha';
import { VersionStore } from '../../src/engine/versionStore.js';

describe('VersionStore', () => {
  let store;

  beforeEach(() => {
    store = new VersionStore(':memory:');
  });

  it('should save a version', async () => {
    const id = await store.saveVersion('test.js', 'console.log("test")');
    expect(id).to.be.a('number');
    
    const version = store.getVersion(id);
    expect(version.content).to.equal('console.log("test")');
  });

  it('should detect vibe tags', async () => {
    const id = await store.saveVersion('async.js', 'async function test() {}');
    const version = store.getVersion(id);
    
    const tags = JSON.parse(version.vibe_tags);
    expect(tags).to.include('async');
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- test/unit/versionStore.test.js

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run performance tests
npm run test:perf
```

---

## Performance Considerations

### File Watching Optimization

```javascript
// Optimized chokidar configuration
const watcher = chokidar.watch(path, {
  ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**'
  ],
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 100
  },
  // Reduce CPU usage
  usePolling: false,
  interval: 1000,
  binaryInterval: 300
});
```

### Database Performance

```javascript
// Batch insertions for better performance
class BatchInserter {
  constructor(db, batchSize = 100) {
    this.db = db;
    this.batchSize = batchSize;
    this.queue = [];
  }

  add(version) {
    this.queue.push(version);
    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  flush() {
    const transaction = this.db.transaction((versions) => {
      for (const version of versions) {
        this.insertStmt.run(version);
      }
    });
    transaction(this.queue);
    this.queue = [];
  }
}
```

### Memory Management

```javascript
// Memory-efficient diff calculation
function calculateDiff(oldContent, newContent) {
  // For large files, use streaming diff
  if (oldContent.length > 100000 || newContent.length > 100000) {
    return streamingDiff(oldContent, newContent);
  }
  
  // For small files, use in-memory diff
  return diff.diffLines(oldContent, newContent);
}
```

---

## Debugging and Monitoring

### Debug Mode

```bash
# Enable debug logging
DEBUG=traversion:* npm run dev

# Debug specific modules
DEBUG=traversion:watcher,traversion:db npm run dev

# Debug with verbose output
TRAVERSION_LOG_LEVEL=debug npm run dev
```

### Debug Utilities

```javascript
// src/utils/debug.js
export const debug = {
  log: (module, message, data) => {
    if (process.env.DEBUG?.includes(module)) {
      console.log(`[${module}] ${message}`, data);
    }
  },
  
  time: (label) => {
    if (process.env.DEBUG) {
      console.time(label);
    }
  },
  
  timeEnd: (label) => {
    if (process.env.DEBUG) {
      console.timeEnd(label);
    }
  }
};
```

### Performance Monitoring

```javascript
// Built-in performance monitoring
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
  }

  start(operation) {
    this.metrics.set(operation, process.hrtime.bigint());
  }

  end(operation) {
    const start = this.metrics.get(operation);
    const duration = process.hrtime.bigint() - start;
    console.log(`${operation}: ${Number(duration) / 1000000}ms`);
    this.metrics.delete(operation);
  }
}
```

---

## Code Style Guide

### ESLint Configuration

```json
// .eslintrc.json
{
  "extends": ["eslint:recommended"],
  "env": {
    "node": true,
    "es2022": true
  },
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "rules": {
    "no-console": "warn",
    "no-unused-vars": "error",
    "prefer-const": "error",
    "no-var": "error"
  }
}
```

### Code Formatting

```javascript
// Use Prettier for consistent formatting
// .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2
}
```

### Naming Conventions

```javascript
// Files: kebab-case
file-watcher.js
version-store.js

// Classes: PascalCase
class VersionStore {}
class TraversionWatcher {}

// Functions: camelCase
function saveVersion() {}
function calculateDiff() {}

// Constants: SCREAMING_SNAKE_CASE
const DEFAULT_PORT = 3333;
const MAX_FILE_SIZE = 1024 * 1024;

// Variables: camelCase
const currentVersion = getVersion();
const fileContent = readFile();
```

---

## Contributing Workflow

### Branch Strategy

```bash
# Main branches
main                    # Production-ready code
develop                 # Integration branch

# Feature branches
feature/timeline-ui     # New features
feature/vibe-search    

# Bug fix branches
fix/memory-leak        # Bug fixes
fix/db-connection     

# Release branches
release/v1.0.0         # Release preparation
```

### Commit Convention

```bash
# Format: type(scope): description

# Types
feat: new feature
fix: bug fix
docs: documentation
style: formatting
refactor: code restructuring
test: adding tests
chore: maintenance

# Examples
feat(watcher): add support for TypeScript files
fix(db): resolve connection timeout issue
docs(api): update endpoint documentation
test(engine): add version comparison tests
```

### Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/awesome-feature
   ```

2. **Make Changes**
   ```bash
   # Write code
   # Add tests
   # Update docs
   ```

3. **Test Changes**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat(scope): add awesome feature"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/awesome-feature
   # Create PR on GitHub
   ```

---

## Release Process

### Version Bumping

```bash
# Patch release (bug fixes)
npm version patch

# Minor release (new features)
npm version minor

# Major release (breaking changes)
npm version major
```

### Build for Release

```bash
# Clean and build
npm run clean
npm run build
npm test

# Package for distribution
npm pack

# Publish to npm (when ready)
npm publish
```

### Release Checklist

- [ ] All tests pass
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] Version bumped
- [ ] Tag created
- [ ] Release notes written
- [ ] Dependencies updated
- [ ] Security scan passed

---

## Extension Points

### Custom Vibe Detectors

```javascript
// Add custom vibe detection
const customDetectors = {
  '.vue': (content) => {
    const tags = [];
    if (content.includes('<script setup>')) tags.push('composition-api');
    if (content.includes('v-for')) tags.push('reactive');
    return tags;
  },
  
  '.py': (content) => {
    const tags = [];
    if (content.includes('class ') && content.includes('(')) tags.push('oop');
    if (content.includes('def ') && content.includes('yield')) tags.push('generator');
    return tags;
  }
};
```

### Plugin Architecture

```javascript
// Plugin interface
class TraversionPlugin {
  constructor(options = {}) {
    this.options = options;
  }

  init(watcher) {
    // Initialize plugin with watcher instance
    this.watcher = watcher;
  }

  onVersionCaptured(version) {
    // Hook: called when version is captured
  }

  onFileDeleted(filePath) {
    // Hook: called when file is deleted
  }

  onServerStart() {
    // Hook: called when server starts
  }
}

// Usage
const slackPlugin = new SlackNotificationPlugin({
  webhook: 'https://hooks.slack.com/...'
});

watcher.addPlugin(slackPlugin);
```

### Custom Storage Backends

```javascript
// Storage interface
class StorageAdapter {
  async saveVersion(version) {
    throw new Error('Not implemented');
  }

  async getVersion(id) {
    throw new Error('Not implemented');
  }

  async getTimeline(filters) {
    throw new Error('Not implemented');
  }
}

// PostgreSQL adapter
class PostgresAdapter extends StorageAdapter {
  constructor(connectionString) {
    super();
    this.pool = new Pool({ connectionString });
  }

  async saveVersion(version) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO versions (file_path, content, timestamp) VALUES ($1, $2, $3) RETURNING id',
        [version.filePath, version.content, version.timestamp]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }
}
```

---

## Deployment Strategies

### Local Development

```bash
# Standard local development
npm run dev

# With custom configuration
TRAVERSION_PORT=4000 npm run dev

# With external database
TRAVERSION_DB_URL=postgresql://... npm run dev
```

### Docker Deployment

```dockerfile
# Multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 3333 3334
CMD ["npm", "start"]
```

### Production Deployment

```bash
# With PM2
pm2 start ecosystem.config.js

# With systemd
sudo systemctl start traversion
sudo systemctl enable traversion

# With Docker Compose
docker-compose up -d
```

---

## Troubleshooting Development Issues

### Common Development Problems

#### Node.js Version Issues
```bash
# Check version
node --version

# Use nvm to switch
nvm use 20
nvm install 20
```

#### Dependency Issues
```bash
# Clear cache
npm cache clean --force

# Delete and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Database Issues
```bash
# Reset development database
rm -rf .traversion
npm run dev

# Check database schema
sqlite3 .traversion/versions.db ".schema"
```

#### Port Conflicts
```bash
# Kill process on port
lsof -ti:3333 | xargs kill

# Use different port
TRAVERSION_PORT=4000 npm run dev
```

### Debug Tools

```bash
# Node.js debugging
node --inspect src/watcher/index.js

# Chrome DevTools
chrome://inspect

# VS Code debugging
# (configured in .vscode/launch.json)
```

Remember: **Good development practices make Traversion better for everyone!** 🚀