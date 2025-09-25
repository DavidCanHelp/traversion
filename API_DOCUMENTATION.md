# Traversion API Documentation

## Overview

The Traversion API provides comprehensive post-incident forensics and impact analysis for development teams. This document outlines the available endpoints, authentication methods, and usage examples.

## Base URL

- **Development**: `http://localhost:3335`
- **Production**: `https://api.traversion.com`

## Interactive Documentation

**Swagger UI**: Available at `/api-docs` on any running instance
- Local development: http://localhost:3335/api-docs
- Interactive API testing and exploration
- Complete schema definitions and examples

## Authentication

Traversion supports two authentication methods:

### 1. JWT Bearer Token

1. Register a new user or login to get a JWT token
2. Include the token in the `Authorization` header:
   ```
   Authorization: Bearer <your-jwt-token>
   ```

### 2. API Key

1. Generate an API key through the `/api/auth/api-key` endpoint
2. Include the key in the `x-api-key` header:
   ```
   x-api-key: <your-api-key>
   ```

## Rate Limiting

The API implements multi-tier rate limiting:

- **General API**: 100 requests per 15 minutes per IP
- **Authentication**: 5 attempts per 15 minutes per IP
- **Analysis**: 20 requests per 10 minutes per IP (CPU intensive)
- **Read Operations**: 60 requests per 5 minutes per IP

Rate limit information is included in response headers:
- `X-RateLimit-Limit`: Request limit for the time window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when the rate limit resets

## Endpoints Overview

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/health` | Health check - returns service status |
| GET    | `/api/info` | Application information and status |

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/api/auth/register` | Register new user account |
| POST   | `/api/auth/login` | Login and receive JWT token |
| POST   | `/api/auth/logout` | Logout and invalidate session |
| GET    | `/api/auth/me` | Get current user information |
| POST   | `/api/auth/api-key` | Generate API key for programmatic access |

### Analysis Endpoints (Authenticated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/api/timeline` | Get recent commits with risk analysis |
| POST   | `/api/incident` | Analyze incident and find suspicious commits |
| GET    | `/api/incidents` | List recently analyzed incidents |

## Common Response Formats

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2024-01-15T14:30:00.000Z"
}
```

### Error Response
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": [
    {
      "field": "fieldName",
      "message": "Validation error message"
    }
  ]
}
```

### Rate Limit Response
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": "15 minutes",
  "limit": 100,
  "remaining": 0
}
```

## Usage Examples

### 1. Register and Login

```bash
# Register new user
curl -X POST http://localhost:3335/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "email": "john@example.com",
    "password": "SecurePass123"
  }'

# Login
curl -X POST http://localhost:3335/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "password": "SecurePass123"
  }'
```

### 2. Get Timeline with Authentication

```bash
# Using JWT token
curl -X GET http://localhost:3335/api/timeline \
  -H "Authorization: Bearer <your-jwt-token>"

# Using API key
curl -X GET http://localhost:3335/api/timeline \
  -H "x-api-key: <your-api-key>"
```

### 3. Analyze Incident

```bash
curl -X POST http://localhost:3335/api/incident \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "time": "2024-01-15T14:30:00Z",
    "hours": 24,
    "files": ["src/app.js", "src/api/routes.js"]
  }'
```

## Data Models

### User
```json
{
  "id": "user_1234567890_abc123",
  "username": "johndoe",
  "email": "john@example.com",
  "role": "user"
}
```

### Commit Analysis
```json
{
  "hash": "a1b2c3d4e5f6",
  "message": "Fix critical bug in authentication",
  "author": "John Doe",
  "date": "2024-01-15T14:30:00Z",
  "risk": 0.75,
  "riskFactors": [
    "off_hours_commit",
    "critical_keyword_usage",
    "weekend_deployment"
  ]
}
```

### Incident Analysis Result
```json
{
  "incidentId": "inc_1705327800000",
  "incidentTime": "2024-01-15T14:30:00Z",
  "suspiciousCommits": [
    {
      "hash": "a1b2c3d4e5f6",
      "message": "Hotfix authentication bug",
      "author": "John Doe",
      "date": "2024-01-15T14:25:00Z",
      "risk": 0.85,
      "riskScore": 0.95
    }
  ],
  "recommendations": [
    {
      "priority": "high",
      "action": "investigate",
      "description": "Review commit a1b2c3d: Hotfix authentication bug"
    }
  ]
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Internal server error |

## SDK and Integration

### JavaScript/Node.js Example

```javascript
class TraversionClient {
  constructor(baseURL, apiKey) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
  }

  async analyzeIncident(time, hours = 24) {
    const response = await fetch(`${this.baseURL}/api/incident`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey
      },
      body: JSON.stringify({ time, hours })
    });

    return response.json();
  }

  async getTimeline() {
    const response = await fetch(`${this.baseURL}/api/timeline`, {
      headers: {
        'x-api-key': this.apiKey
      }
    });

    return response.json();
  }
}

// Usage
const client = new TraversionClient('http://localhost:3335', 'your-api-key');
const timeline = await client.getTimeline();
```

### Python Example

```python
import requests
import json
from datetime import datetime

class TraversionClient:
    def __init__(self, base_url, api_key):
        self.base_url = base_url
        self.headers = {
            'Content-Type': 'application/json',
            'x-api-key': api_key
        }

    def analyze_incident(self, time=None, hours=24):
        if not time:
            time = datetime.utcnow().isoformat() + 'Z'

        data = {
            'time': time,
            'hours': hours
        }

        response = requests.post(
            f'{self.base_url}/api/incident',
            headers=self.headers,
            data=json.dumps(data)
        )

        return response.json()

    def get_timeline(self):
        response = requests.get(
            f'{self.base_url}/api/timeline',
            headers=self.headers
        )

        return response.json()

# Usage
client = TraversionClient('http://localhost:3335', 'your-api-key')
timeline = client.get_timeline()
```

## Contributing

When adding new endpoints:

1. Update the OpenAPI specification in `swagger.yaml`
2. Add proper validation using the validation middleware
3. Implement appropriate rate limiting
4. Include authentication where required
5. Add tests for new endpoints
6. Update this documentation

## Support

- **Swagger UI**: http://localhost:3335/api-docs
- **Health Check**: http://localhost:3335/health
- **API Info**: http://localhost:3335/api/info