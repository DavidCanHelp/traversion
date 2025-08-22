# Traversion API Documentation

## Overview

Traversion provides both REST API endpoints and WebSocket connections for real-time updates. The API is designed to be simple, fast, and developer-friendly.

## Base URL

```
http://localhost:3333/api
```

## WebSocket URL

```
ws://localhost:3334
```

## Authentication

Currently, Traversion runs locally and doesn't require authentication. Future versions will support API keys for cloud features.

---

## REST API Endpoints

### Timeline Operations

#### Get Complete Timeline

```http
GET /api/timeline
```

Returns all versions in chronological order.

**Response:**
```json
[
  {
    "id": 1,
    "session_id": 1,
    "file_path": "src/app.js",
    "content": "const app = express();",
    "content_hash": "abc123...",
    "timestamp": "2024-01-20T10:30:00.000Z",
    "event_type": "save",
    "output": null,
    "error": null,
    "performance_metrics": "{}",
    "vibe_tags": "[\"minimal\", \"async\"]",
    "branch_id": "main",
    "parent_version_id": null,
    "session_description": "Morning coding session"
  }
]
```

**Query Parameters:**
- `start` (ISO 8601 date) - Start of time range
- `end` (ISO 8601 date) - End of time range
- `file` (string) - Filter by file path
- `limit` (number) - Maximum results to return
- `offset` (number) - Pagination offset

**Example:**
```bash
curl "http://localhost:3333/api/timeline?file=src/app.js&limit=10"
```

---

### Version Operations

#### Get Specific Version

```http
GET /api/version/:id
```

Returns a single version by ID.

**Parameters:**
- `id` (number) - Version ID

**Response:**
```json
{
  "id": 42,
  "file_path": "src/utils.js",
  "content": "export const utils = {};",
  "timestamp": "2024-01-20T10:45:00.000Z",
  "vibe_tags": "[\"refactor\", \"clean\"]",
  "branch_id": "main"
}
```

**Example:**
```bash
curl "http://localhost:3333/api/version/42"
```

---

#### Get File Versions

```http
GET /api/versions/:file
```

Returns all versions for a specific file.

**Parameters:**
- `file` (string) - URL-encoded file path

**Response:**
```json
[
  {
    "id": 1,
    "timestamp": "2024-01-20T10:00:00.000Z",
    "content": "initial content"
  },
  {
    "id": 5,
    "timestamp": "2024-01-20T10:15:00.000Z",
    "content": "updated content"
  }
]
```

**Example:**
```bash
curl "http://localhost:3333/api/versions/src%2Fapp.js"
```

---

#### Get Recent Versions

```http
GET /api/recent
```

Returns the most recent versions across all files.

**Query Parameters:**
- `limit` (number, default: 50) - Number of versions to return

**Response:**
```json
[
  {
    "id": 99,
    "file_path": "src/new-feature.js",
    "timestamp": "2024-01-20T11:30:00.000Z",
    "vibe_tags": "[\"wip\", \"experimental\"]"
  }
]
```

---

### Comparison Operations

#### Compare Two Versions

```http
POST /api/compare
```

Compares two versions and returns diff information.

**Request Body:**
```json
{
  "versionAId": 10,
  "versionBId": 20
}
```

**Response:**
```json
{
  "changes": [
    {
      "count": 5,
      "value": "const app = express();\n",
      "added": false,
      "removed": false
    },
    {
      "count": 1,
      "value": "app.use(cors());\n",
      "added": true,
      "removed": false
    }
  ],
  "similarity": 0.87,
  "versionA": {
    "id": 10,
    "file_path": "src/app.js",
    "timestamp": "2024-01-20T10:00:00.000Z"
  },
  "versionB": {
    "id": 20,
    "file_path": "src/app.js",
    "timestamp": "2024-01-20T10:30:00.000Z"
  }
}
```

**Example:**
```bash
curl -X POST "http://localhost:3333/api/compare" \
  -H "Content-Type: application/json" \
  -d '{"versionAId": 10, "versionBId": 20}'
```

---

#### Find Similar Versions

```http
POST /api/similar
```

Finds versions similar to a given version.

**Request Body:**
```json
{
  "versionId": 15,
  "threshold": 0.8
}
```

**Response:**
```json
[
  {
    "id": 12,
    "file_path": "src/app.js",
    "similarity": 0.95,
    "timestamp": "2024-01-20T09:45:00.000Z"
  },
  {
    "id": 8,
    "file_path": "src/app.js",
    "similarity": 0.82,
    "timestamp": "2024-01-20T09:30:00.000Z"
  }
]
```

---

### Search Operations

#### Search by Vibe

```http
POST /api/search-vibe
```

Search versions using natural language descriptions.

**Request Body:**
```json
{
  "vibe": "minimal and clean",
  "file": "optional/file/filter.js"
}
```

**Response:**
```json
[
  {
    "id": 23,
    "file_path": "src/utils.js",
    "timestamp": "2024-01-20T10:15:00.000Z",
    "vibe_tags": "[\"minimal\", \"clean\", \"refactored\"]",
    "relevance": 0.92
  }
]
```

**Example:**
```bash
curl -X POST "http://localhost:3333/api/search-vibe" \
  -H "Content-Type: application/json" \
  -d '{"vibe": "when it was fast and async"}'
```

---

#### Search by Content

```http
POST /api/search-content
```

Search versions by code content.

**Request Body:**
```json
{
  "query": "async function",
  "regex": false,
  "caseSensitive": false
}
```

**Response:**
```json
[
  {
    "id": 45,
    "file_path": "src/api.js",
    "matches": [
      {
        "line": 10,
        "content": "async function fetchData() {"
      }
    ]
  }
]
```

---

### Session Operations

#### Get Current Session

```http
GET /api/session/current
```

Returns information about the current coding session.

**Response:**
```json
{
  "id": 5,
  "start_time": "2024-01-20T09:00:00.000Z",
  "description": "Feature development",
  "version_count": 47,
  "files_changed": 12
}
```

---

#### Get Session Versions

```http
GET /api/session/:id/versions
```

Returns all versions from a specific session.

**Parameters:**
- `id` (number) - Session ID

**Response:**
```json
[
  {
    "id": 10,
    "file_path": "src/feature.js",
    "timestamp": "2024-01-20T09:15:00.000Z"
  }
]
```

---

### Branch Operations

#### Create Branch

```http
POST /api/branch
```

Creates a new branch from a specific version.

**Request Body:**
```json
{
  "name": "experiment-1",
  "description": "Trying new approach",
  "parentVersionId": 25
}
```

**Response:**
```json
{
  "id": "branch_1234567890_abc",
  "name": "experiment-1",
  "created_at": "2024-01-20T11:00:00.000Z",
  "diverged_at_version_id": 25
}
```

---

#### List Branches

```http
GET /api/branches
```

Returns all branches.

**Response:**
```json
[
  {
    "id": "main",
    "name": "main",
    "created_at": "2024-01-20T09:00:00.000Z",
    "version_count": 50
  },
  {
    "id": "branch_123_abc",
    "name": "experiment-1",
    "created_at": "2024-01-20T11:00:00.000Z",
    "version_count": 5
  }
]
```

---

## WebSocket API

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3334');

ws.onopen = () => {
  console.log('Connected to Traversion');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};
```

### Message Types

#### Initial State (Server → Client)

Sent immediately after connection.

```json
{
  "type": "init",
  "data": {
    "timeline": [...],
    "recent": [...],
    "session": {
      "id": 5,
      "start_time": "2024-01-20T09:00:00.000Z"
    }
  }
}
```

#### New Version (Server → Client)

Sent when a file is saved.

```json
{
  "type": "version",
  "data": {
    "id": 100,
    "file_path": "src/app.js",
    "timestamp": "2024-01-20T11:45:00.000Z",
    "content": "...",
    "vibe_tags": "[\"refactor\"]"
  }
}
```

#### File Deleted (Server → Client)

Sent when a tracked file is deleted.

```json
{
  "type": "delete",
  "data": {
    "filePath": "src/old-file.js",
    "timestamp": "2024-01-20T11:45:00.000Z"
  }
}
```

#### Branch Switch (Server → Client)

Sent when the active branch changes.

```json
{
  "type": "branch-switch",
  "data": {
    "branchId": "experiment-1",
    "branchName": "Experimental Feature"
  }
}
```

#### Performance Metrics (Server → Client)

Sent with performance data when code is executed.

```json
{
  "type": "metrics",
  "data": {
    "versionId": 101,
    "executionTime": 145,
    "memoryUsage": 52428800,
    "output": "Success!"
  }
}
```

### Client Commands (Client → Server)

#### Subscribe to File

```json
{
  "type": "subscribe",
  "data": {
    "filePath": "src/specific-file.js"
  }
}
```

#### Unsubscribe from File

```json
{
  "type": "unsubscribe",
  "data": {
    "filePath": "src/specific-file.js"
  }
}
```

#### Request Refresh

```json
{
  "type": "refresh",
  "data": {}
}
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": {
    "code": "VERSION_NOT_FOUND",
    "message": "Version with ID 999 not found",
    "details": {}
  }
}
```

### Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `VERSION_NOT_FOUND` | Requested version doesn't exist | 404 |
| `INVALID_REQUEST` | Malformed request body | 400 |
| `DATABASE_ERROR` | Database operation failed | 500 |
| `FILE_NOT_TRACKED` | File is not being tracked | 404 |
| `BRANCH_NOT_FOUND` | Branch doesn't exist | 404 |
| `COMPARISON_FAILED` | Unable to compare versions | 500 |

---

## Rate Limiting

Local API has no rate limiting. Future cloud version will have:

- 1000 requests per hour for free tier
- 10000 requests per hour for pro tier
- Unlimited for enterprise

---

## Examples

### JavaScript/Node.js

```javascript
// Fetch timeline
const response = await fetch('http://localhost:3333/api/timeline');
const timeline = await response.json();

// Compare versions
const comparison = await fetch('http://localhost:3333/api/compare', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ versionAId: 10, versionBId: 20 })
});
const diff = await comparison.json();

// WebSocket connection
const ws = new WebSocket('ws://localhost:3334');
ws.on('message', (data) => {
  const message = JSON.parse(data);
  if (message.type === 'version') {
    console.log('New version:', message.data);
  }
});
```

### Python

```python
import requests
import websocket
import json

# Fetch timeline
response = requests.get('http://localhost:3333/api/timeline')
timeline = response.json()

# Compare versions
comparison = requests.post(
    'http://localhost:3333/api/compare',
    json={'versionAId': 10, 'versionBId': 20}
)
diff = comparison.json()

# WebSocket connection
def on_message(ws, message):
    data = json.loads(message)
    if data['type'] == 'version':
        print(f"New version: {data['data']}")

ws = websocket.WebSocketApp('ws://localhost:3334',
                            on_message=on_message)
ws.run_forever()
```

### curl

```bash
# Get timeline
curl http://localhost:3333/api/timeline

# Get specific version
curl http://localhost:3333/api/version/42

# Search by vibe
curl -X POST http://localhost:3333/api/search-vibe \
  -H "Content-Type: application/json" \
  -d '{"vibe": "clean and minimal"}'

# Compare versions
curl -X POST http://localhost:3333/api/compare \
  -H "Content-Type: application/json" \
  -d '{"versionAId": 10, "versionBId": 20}'
```

---

## SDK Support (Coming Soon)

Official SDKs planned for:
- JavaScript/TypeScript
- Python
- Go
- Rust

---

## API Versioning

Current version: `v1`

Future versions will be available at:
- `/api/v2/...`
- `/api/v3/...`

The unversioned `/api/...` will always point to the latest stable version.