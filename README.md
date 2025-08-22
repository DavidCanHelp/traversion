# 🕵️ Traversion

**Post-incident forensics and impact analysis for development teams**

Stop guessing what caused your production incidents. Traversion analyzes your Git history to identify suspicious commits, assess pull request risks, and provide actionable insights for faster incident resolution.

## 🎯 What Problem Does It Solve?

When production breaks, you need answers fast:
- **Which recent changes could have caused this?**
- **What was risky about that deployment?** 
- **Who should we involve in the investigation?**
- **What patterns led to this incident?**

Traditional Git tools show *what* changed, but not *why* it might be problematic. Traversion analyzes commits using risk factors to highlight the most likely culprits.

## ⚡ Quick Start

```bash
# Install globally
npm install -g traversion

# Analyze an incident from 2 hours ago
trav incident --time "2 hours ago" --hours 24

# Analyze a risky PR before merging  
trav pr microsoft/vscode/1234 --comment

# Start web interface for team use
npm start
```

## 🔍 Core Features

### 1. **Incident Forensics**
Quickly identify suspicious commits around incident time:

```bash
trav incident --time "2023-12-01T15:30:00Z" --hours 48 --files "server.js,database.js"
```

**Risk Scoring Based On:**
- Off-hours deployments (weekends, nights)
- Configuration and infrastructure changes  
- Large or widespread code changes
- Vague commit messages ("fix", "update")
- Changes to affected files
- Database migrations and schema changes

### 2. **Pull Request Impact Analysis**
Assess risk before merging:

```bash
trav pr owner/repo/123 --comment
```

**Analyzes:**
- File change patterns and risk areas
- Deployment complexity and testing needs  
- Scope and potential blast radius
- Automated risk scoring and recommendations

### 3. **Interactive Web Interface**
Perfect for team incident response:

```bash
npm start  # Visit http://localhost:3335
```

- Visual incident timeline analysis
- PR risk assessment dashboard
- Team-friendly reports and recommendations
- No technical Git knowledge required

## 📊 Example Output

### Incident Analysis:
```
🚨 INCIDENT FORENSICS REPORT
═══════════════════════════════════════════════════════════
🕐 Incident Time: 2023-12-01T15:30:00Z
📅 Analysis Window: 24 hours  
🔍 Suspicious Commits: 3

🎯 TOP SUSPECTS:
1. 🚨 a1b2c3d4 hotfix: update database connection timeout
   👤 john.doe | ⏰ 12/01/2023, 2:15:00 PM
   📊 Risk: 85% | Files: 2 | +15/-3
   🏷️ Off-hours deployment, Configuration changes, Urgent/fix commit

2. ⚠️ e5f6g7h8 refactor user authentication module  
   👤 jane.smith | ⏰ 12/01/2023, 11:30:00 AM
   📊 Risk: 65% | Files: 8 | +234/-156
   🏷️ Security changes, Large code changes

💡 RECOMMENDATIONS:
🔴 INVESTIGATION: Start with commit a1b2c3d4 - highest risk score
🔴 ROLLBACK: Consider rolling back 1 high-risk commit if safe
🟡 CONFIG: Configuration changes detected - verify environment variables
```

### PR Analysis:
```
📋 PULL REQUEST ANALYSIS  
═══════════════════════════════════════════════════════════
🚨 PR #1234: Implement user session management
👤 Author: contributor
📊 Risk Score: 72%
📈 Changes: +445 -123 (12 files)

📊 IMPACT ASSESSMENT:
   Scope: Medium - affects multiple components
   Complexity: Medium-High - security changes
   Risk Areas: Security, Configuration, Database

🧪 TESTING RECOMMENDATIONS:
   • Security regression testing
   • Authentication/authorization testing  
   • Full regression testing
   • Performance testing

💡 RECOMMENDATIONS:
🔴 REVIEW: High-risk PR - require multiple senior reviewers
🔴 SECURITY: Require security team review for auth changes
🟡 PROCESS: Add detailed description explaining security implications
```

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 18+
- Git repository
- GitHub token (optional, for PR analysis)

### Install
```bash
npm install -g traversion

# Or run locally  
git clone https://github.com/your-org/traversion
cd traversion
npm install
```

### Configuration
```bash
# Set GitHub token for PR analysis (optional)
export GITHUB_TOKEN=your_github_token

# Configure custom risk patterns (optional)
export TRAVERSION_CONFIG=/path/to/config.json
```

## 📋 CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `trav incident` | Analyze incident timeline | `trav incident --time "2 hours ago"` |
| `trav pr` | Analyze pull request | `trav pr owner/repo/123 --comment` |
| `trav analyze` | Analyze specific commits | `trav analyze --commits "abc123,def456"` |
| `trav forensics` | Interactive incident mode | `trav forensics` |

### Incident Analysis Options
```bash
trav incident [options]
  -t, --time <time>     Incident time (ISO string or "X hours ago")
  -h, --hours <hours>   Hours to look back (default: 24)  
  -f, --files <files>   Comma-separated affected files
```

### PR Analysis Options  
```bash
trav pr <owner>/<repo>/<number> [options]
  --comment             Post analysis as PR comment
```

## 🎯 Use Cases

### 1. **Post-Incident Analysis**
When production breaks, immediately run:
```bash  
trav incident --time "30 minutes ago" --hours 24
```
Get a ranked list of suspicious commits to investigate first.

### 2. **Pre-Deployment Risk Assessment**  
Before merging high-risk PRs:
```bash
trav pr your-org/your-repo/456 --comment  
```
Automatically comment with risk assessment and testing recommendations.

### 3. **Code Review Enhancement**
Add Traversion analysis to your PR template or CI pipeline to surface risks that human reviewers might miss.

### 4. **Incident Response Training**
Use historical incidents to train teams on pattern recognition and investigation techniques.

## ⚙️ How It Works

### Risk Scoring Algorithm
Commits are scored (0-1.0) based on:

**Timing Factors (0.2)**
- Weekend/off-hours deployments
- Holiday deployments  

**Change Factors (0.4)**  
- Configuration files (`config`, `env`, `.yml`)
- Database changes (`migration`, `schema`, `.sql`)
- Infrastructure (`Dockerfile`, `k8s/`, `deploy/`)
- Security code (`auth`, `login`, `security`)
- Large changesets (>500 lines)

**Context Factors (0.4)**
- Urgent keywords (`hotfix`, `critical`, `emergency`)
- Vague commit messages  
- Changes to incident-affected files
- Multiple files modified

### PR Risk Assessment
Evaluates:
- **File change patterns** - What types of files were modified
- **Scope analysis** - How many components are affected  
- **Complexity assessment** - Database, security, infrastructure changes
- **Testing requirements** - What types of testing are needed
- **Deployment risks** - Potential issues during rollout

## 🚀 Integration

### GitHub Actions
```yaml
- name: Analyze PR Risk
  run: |
    npx traversion pr ${{ github.repository }}/${{ github.event.number }} --comment
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Slack/Discord Webhooks
```bash  
trav incident --time "1 hour ago" --json | curl -X POST -H 'Content-type: application/json' --data @- YOUR_WEBHOOK_URL
```

### Monitoring Integration
```javascript
// When incident detected
const analysis = await traversion.analyzeIncident(new Date(), 24, affectedFiles);
await alertManager.send(`Top suspect: ${analysis.suspiciousCommits[0].shortHash}`);
```

## 🎛️ Configuration

### Custom Risk Patterns
Create `traversion.config.js`:
```javascript
export default {
  riskPatterns: {
    'Payment System': /payment|billing|stripe|paypal/i,
    'User Data': /user|profile|account|personal/i,
    'Critical API': /api\/(auth|payment|user)/i
  },
  riskWeights: {
    offHours: 0.3,
    largeChanges: 0.4,  
    configChanges: 0.5
  },
  excludeFiles: ['*.test.js', '*.spec.js', 'docs/']
};
```

### Team Notification Rules
```javascript
export default {
  notifications: {
    highRisk: ['security-team@company.com'],
    database: ['dba-team@company.com'],
    infrastructure: ['devops-team@company.com']
  }
};
```

## 🔮 Advanced Features

### Machine Learning Enhancement (Coming Soon)
- Historical incident pattern learning
- Team-specific risk factor weighting  
- Anomaly detection for unusual patterns

### Integration Ecosystem (Coming Soon)
- Jira incident linking
- PagerDuty integration
- DataDog/NewRelic correlation
- Slack incident bot

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup
```bash
git clone https://github.com/your-org/traversion
cd traversion  
npm install
npm test
npm run dev
```

### Architecture
- `src/forensics/` - Core analysis algorithms
- `src/integrations/` - GitHub, Slack, etc. integrations
- `src/cli/` - Command-line interface
- `src/web/` - Web interface for teams

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 🆘 Support

- 📖 [Documentation](https://traversion.dev/docs)  
- 💬 [GitHub Discussions](https://github.com/your-org/traversion/discussions)
- 🐛 [Report Issues](https://github.com/your-org/traversion/issues)
- 📧 Support: support@traversion.dev

---

**Stop playing detective with your incidents. Let Traversion do the investigating.**

🔍 *Made with ❤️ for development teams who deserve better incident response.*