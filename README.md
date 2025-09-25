# 🕵️ Traversion

**Open Source Incident Analysis Platform - Real-time Git forensics for faster incident resolution**

Stop guessing what caused your production incidents. Traversion analyzes your Git history, detects risky commits, and provides real-time insights through a beautiful dashboard interface.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)

## 🚀 One-Line Setup

```bash
git clone https://github.com/davidcanhelp/traversion && cd traversion && ./setup.sh
```

That's it! The setup script handles everything - dependencies, environment, secrets, and database initialization.

## 🎯 What Problem Does It Solve?

When production breaks, you need answers fast:
- **Which recent changes could have caused this?**
- **What was risky about that deployment?**
- **Who should we involve in the investigation?**
- **What patterns led to this incident?**

Traversion provides instant answers through:
- 🔍 **Automated Git forensics** - Analyzes commits with multi-factor risk scoring
- 📊 **Real-time dashboard** - WebSocket-powered live incident monitoring
- 🤖 **Causality detection** - Identifies root causes and blame chains
- 🛡️ **Security-first** - JWT auth, rate limiting, input validation built-in
- 📈 **Visual analytics** - Beautiful charts showing risk distribution and timeline

## ✨ Key Features

### Real-Time Dashboard
- **Live incident feed** with WebSocket updates
- **Risk distribution charts** using Chart.js
- **Git activity monitoring** in real-time
- **System metrics** and health monitoring
- **Beautiful gradient UI** with Tailwind CSS

### Advanced Analysis Engine
- **Multi-factor risk scoring** (timing, changes, context)
- **Causality detection** with root cause analysis
- **Pattern recognition** for recurring issues
- **Historical timeline analysis**
- **File impact assessment**

### Enterprise-Ready Security
- **JWT authentication** with bcrypt hashing
- **Multi-tier rate limiting** (100/15min default)
- **Input validation** with Joi schemas
- **Helmet security headers**
- **CORS configuration**
- **Secret rotation support**

### Developer Experience
- **One-line setup** with automatic configuration
- **RESTful API** with Swagger documentation
- **WebSocket support** for real-time updates
- **Docker support** for containerization
- **Comprehensive logging** with winston
- **Environment validation**

## 📊 Dashboard Preview

```
╔══════════════════════════════════════════════════════════╗
║  🕵️ Traversion - Real-time Incident Analysis            ║
╠══════════════════════════════════════════════════════════╣
║  Active Incidents: 3    High Risk: 1    Connected: 5    ║
║                                                          ║
║  📈 Risk Distribution        🔴 High    15%             ║
║      [████████████████]      🟡 Medium  35%             ║
║                               🟢 Low     50%             ║
║                                                          ║
║  📡 Live Incident Feed                                  ║
║  ├─ INC-2024-001 • Risk: 85% • 2 commits • 2:34 PM    ║
║  ├─ INC-2024-002 • Risk: 45% • 1 commit  • 2:15 PM    ║
║  └─ INC-2024-003 • Risk: 20% • 3 commits • 1:45 PM    ║
╚══════════════════════════════════════════════════════════╝
```

## 🎯 Quick Start

### 1. Clone and Setup (30 seconds)
```bash
# Clone the repository
git clone https://github.com/davidcanhelp/traversion
cd traversion

# Run the setup script - handles everything!
./setup.sh
```

### 2. Start the Application
```bash
npm start
# Application runs on http://localhost:3335
```

### 3. Access the Dashboard
Open your browser to: http://localhost:3335/dashboard

### 4. View API Documentation
Swagger docs available at: http://localhost:3335/api-docs

## 🔧 API Examples

### Register User
```bash
curl -X POST http://localhost:3335/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"Demo123456","email":"demo@example.com"}'
```

### Login and Get Token
```bash
curl -X POST http://localhost:3335/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"Demo123456"}'
```

### Analyze Incident
```bash
curl -X POST http://localhost:3335/api/incidents/analyze \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"commitHash":"HEAD","branch":"main"}'
```

### WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:3335/ws');

ws.on('open', () => {
    // Subscribe to incidents
    ws.send(JSON.stringify({
        type: 'subscribe',
        data: { channel: 'incidents' }
    }));
});

ws.on('message', (data) => {
    const message = JSON.parse(data);
    console.log('Received:', message);
});
```

## 🏗️ Architecture

```
traversion/
├── src/
│   ├── app.js                 # Main application with WebSocket
│   ├── middleware/
│   │   ├── auth.js           # JWT authentication
│   │   ├── rateLimiter.js    # Rate limiting
│   │   └── validation.js     # Input validation
│   ├── services/
│   │   ├── riskAnalyzer.js   # Risk scoring engine
│   │   └── causality.js      # Root cause detection
│   ├── engine/
│   │   └── causalityEngine.js # Advanced analysis
│   └── config/
│       └── environment.js     # Environment validation
├── public/
│   └── dashboard.html         # Real-time dashboard UI
└── setup.sh                   # One-line setup script
```

## 🔍 How Risk Scoring Works

Traversion uses a sophisticated multi-factor risk assessment:

### Risk Factors (Score: 0.0 - 1.0)

**🕐 Timing Risk (20%)**
- Weekend deployments (+0.3)
- Off-hours commits (+0.2)
- Holiday periods (+0.4)

**📁 File Risk (40%)**
- Configuration changes (+0.5)
- Database migrations (+0.6)
- Security files (+0.7)
- Infrastructure (+0.5)

**📝 Context Risk (40%)**
- Urgent keywords (+0.4)
- Vague messages (+0.3)
- Large changes (+0.3)
- Multiple files (+0.2)

### Example Analysis Output
```json
{
  "incidentId": "INC-2024-001",
  "topRisk": 0.85,
  "suspiciousCommits": 3,
  "rootCause": {
    "commit": "a1b2c3d",
    "file": "database/config.js",
    "reason": "Off-hours configuration change"
  },
  "recommendations": [
    "Review database configuration changes",
    "Check connection pool settings",
    "Verify environment variables"
  ]
}
```

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t traversion .

# Run with Docker Compose
docker-compose up -d

# Access at http://localhost:3335
```

## 🔒 Security Features

- **Authentication**: JWT-based with configurable expiry
- **Password Security**: Bcrypt hashing with salt rounds
- **Rate Limiting**: Configurable per-endpoint limits
- **Input Validation**: Joi schemas for all inputs
- **Headers Security**: Helmet for security headers
- **CORS**: Configurable cross-origin policies
- **Secret Management**: Automatic rotation support
- **Environment Validation**: Startup configuration checks

## 📈 Performance

- **WebSocket Support**: Real-time updates without polling
- **Efficient Algorithms**: O(n log n) risk scoring
- **Database**: SQLite for simplicity, PostgreSQL ready
- **Caching Ready**: Redis integration points
- **Lazy Loading**: On-demand module loading
- **Connection Pooling**: Optimized database connections

## 🛠️ Configuration

### Environment Variables (.env)
```bash
# Application
PORT=3335
NODE_ENV=production

# Security
JWT_SECRET=auto-generated-on-setup
SESSION_SECRET=auto-generated-on-setup

# Database
DATABASE_URL=sqlite://traversion.db
# DATABASE_URL=postgresql://user:pass@localhost/traversion

# Features
ENABLE_WEBSOCKET=true
ENABLE_RATE_LIMITING=true
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup
```bash
# Install dependencies
npm install

# Run tests
npm test

# Run in development mode
npm run dev

# Run linting
npm run lint
```

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 🆘 Support

- 📖 [Documentation](https://github.com/davidcanhelp/traversion/wiki)
- 💬 [Discussions](https://github.com/davidcanhelp/traversion/discussions)
- 🐛 [Issues](https://github.com/davidcanhelp/traversion/issues)

## 🙏 Acknowledgments

Built with powerful open source technologies:
- Node.js & Express for the backend
- WebSocket for real-time communication
- Chart.js for beautiful visualizations
- Tailwind CSS for styling
- SQLite/PostgreSQL for data persistence

---

**Stop playing detective with your incidents. Let Traversion do the investigating.**

🔍 *The best open source incident analysis tool - now with real-time monitoring!*