# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Running the Application
- `npm start` - Start the web interface on port 3335
- `npm run dev` - Start development server with hot reload
- `npm run enterprise` - Start enterprise platform with full features
- `npm run dashboard` - Start real-time dashboard on port 3340

### Testing
- `npm test` - Run all tests with Jest (uses NODE_OPTIONS for ES modules)
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate coverage report
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- Running a single test file: `NODE_OPTIONS=--experimental-vm-modules jest path/to/test.js`

### CLI Commands
- `npm run forensics` - Interactive forensics mode
- `npm run incident` - Analyze incident timeline
- `npm run analyze` - Analyze specific commits
- `npm run health` - Check if service is running

### Utility Commands
- `npm run clean` - Clean .traversion directory
- `npm run status` - Check port 3333 status

## High-Level Architecture

### Core Forensics Engine
The system is built around a sophisticated forensics analysis engine that examines Git commits to identify potential incident causes:

**Key Components:**
- **CausalityEngine** (`src/engine/causalityEngine.js`) - Tracks cause-and-effect relationships between events in distributed systems. Uses graph-based storage with temporal and service indexes to build causality chains.
- **ForensicsAnalyzer** (`src/forensics/analyzer.js`) - Analyzes Git commits using risk scoring algorithms that evaluate timing, change patterns, and context factors.
- **TemporalQueryEngine** (`src/engine/temporalQueryEngine.js`) - Handles time-based queries and incident correlation.

### Multi-Mode Operation
The application supports multiple deployment modes:
- **Web Interface** - Express-based server with real-time WebSocket support
- **CLI Tool** - Command-line interface for quick forensics analysis
- **Enterprise Platform** - Full-featured platform with advanced analytics
- **Dashboard** - Real-time monitoring and visualization

### Security Architecture
- **Authentication**: JWT-based auth with bcrypt password hashing (`src/auth/authService.js`)
- **Middleware**: Helmet, CORS, rate limiting configured (`src/security/authMiddleware.js`)
- **Secure Interfaces**: SecureWebInterface and SecureGitIntegration classes handle protected operations

### Data Storage
- **SQLite**: Default storage using better-sqlite3 for local deployments
- **PostgreSQL**: Production database support via pg client
- **Redis**: Optional caching layer with ioredis

### Integration Points
- **GitHub**: Deep integration via Octokit for PR analysis and webhook processing
- **Slack**: Event API and Web API for notifications and incident alerts
- **WebRTC**: Real-time collaboration features for incident response teams

### Risk Analysis System
The forensics analyzer uses a multi-factor risk scoring system:
- **Timing Factors** (20%): Weekend, off-hours, holiday deployments
- **Change Factors** (40%): Config files, database migrations, infrastructure changes
- **Context Factors** (40%): Urgent keywords, vague messages, affected files

### Event Processing Pipeline
1. Events collected via EventCollector (`src/collectors/eventCollector.js`)
2. Processed through CausalityEngine for relationship mapping
3. Analyzed by ForensicsAnalyzer for risk assessment
4. Results presented via web interface or CLI

## Key Patterns and Conventions

- **ES Modules**: Project uses ES modules (`type: "module"` in package.json)
- **Class-based Architecture**: Core components use ES6 classes with EventEmitter
- **Async/Await**: All async operations use modern async/await patterns
- **Error Handling**: Comprehensive try-catch blocks with detailed error messages
- **Configuration**: Environment-based config with .env support

## Important Files and Directories

- `src/forensics/` - Core analysis algorithms
- `src/engine/` - Causality and temporal query engines
- `src/cli/` - Command-line interface implementation
- `src/web/` - Web interface components
- `src/security/` - Authentication and security middleware
- `src/integrations/` - External service integrations
- `test/` - Test suites organized by unit/integration