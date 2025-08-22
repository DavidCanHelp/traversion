import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { createNodeMiddleware } from '@octokit/webhooks';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { GitHubIntegration } from '../integrations/githubIntegration.js';

export class TraversionGitHubApp {
  constructor(options = {}) {
    this.appId = options.appId || process.env.GITHUB_APP_ID;
    this.privateKey = options.privateKey || process.env.GITHUB_PRIVATE_KEY;
    this.webhookSecret = options.webhookSecret || process.env.GITHUB_WEBHOOK_SECRET;
    this.port = options.port || 3002;

    if (!this.appId || !this.privateKey || !this.webhookSecret) {
      throw new Error('GITHUB_APP_ID, GITHUB_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET are required');
    }

    // If privateKey is a file path, read it
    if (this.privateKey.startsWith('/') || this.privateKey.startsWith('./')) {
      this.privateKey = readFileSync(this.privateKey, 'utf8');
    }

    this.integration = new GitHubIntegration();
    this.setupWebhooks();
  }

  setupWebhooks() {
    this.webhooks = createNodeMiddleware({
      secret: this.webhookSecret,
      path: '/webhooks'
    });

    // Handle pull request events
    this.webhooks.on('pull_request.opened', this.handlePROpened.bind(this));
    this.webhooks.on('pull_request.synchronize', this.handlePRSynchronized.bind(this));
    this.webhooks.on('pull_request.ready_for_review', this.handlePRReadyForReview.bind(this));

    // Handle issue events (for incident tracking)
    this.webhooks.on('issues.opened', this.handleIssueOpened.bind(this));
    this.webhooks.on('issues.labeled', this.handleIssueLabeled.bind(this));

    // Handle push events (for deployment risk)
    this.webhooks.on('push', this.handlePush.bind(this));

    // Handle release events
    this.webhooks.on('release.published', this.handleReleasePublished.bind(this));
  }

  async getInstallationOctokit(installationId) {
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: this.appId,
        privateKey: this.privateKey,
        installationId
      }
    });

    return octokit;
  }

  async handlePROpened(event) {
    const { pull_request: pr, repository, installation } = event.payload;
    
    console.log(`🔍 Analyzing opened PR #${pr.number} in ${repository.full_name}`);

    try {
      const octokit = await this.getInstallationOctokit(installation.id);
      
      // Override the integration's octokit with our app-authenticated one
      this.integration.octokit = octokit;
      
      const analysis = await this.integration.analyzePullRequest(
        repository.owner.login,
        repository.name,
        pr.number
      );

      await this.postAnalysisComment(octokit, repository, pr, analysis);
      
      // Add risk label if needed
      if (analysis.riskScore > 0.7) {
        await this.addRiskLabel(octokit, repository, pr, 'high-risk');
      } else if (analysis.riskScore > 0.4) {
        await this.addRiskLabel(octokit, repository, pr, 'medium-risk');
      }

      // Request additional reviewers for high-risk PRs
      if (analysis.riskScore > 0.6) {
        await this.requestAdditionalReviewers(octokit, repository, pr, analysis);
      }

    } catch (error) {
      console.error(`Error analyzing PR #${pr.number}:`, error);
      
      // Post error comment
      const octokit = await this.getInstallationOctokit(installation.id);
      await octokit.issues.createComment({
        owner: repository.owner.login,
        repo: repository.name,
        issue_number: pr.number,
        body: `🚨 **Traversion Analysis Failed**\n\nError: ${error.message}\n\n*Please run manual analysis or check configuration.*`
      });
    }
  }

  async handlePRSynchronized(event) {
    const { pull_request: pr, repository, installation } = event.payload;
    
    console.log(`🔄 Re-analyzing updated PR #${pr.number} in ${repository.full_name}`);

    // Re-run analysis for updated PR
    await this.handlePROpened(event);
  }

  async handlePRReadyForReview(event) {
    const { pull_request: pr, repository, installation } = event.payload;
    
    console.log(`👀 PR #${pr.number} ready for review in ${repository.full_name}`);

    // Run analysis when PR moves from draft to ready
    await this.handlePROpened(event);
  }

  async handleIssueOpened(event) {
    const { issue, repository, installation } = event.payload;
    
    // Check if this is an incident-related issue
    const incidentKeywords = /incident|outage|down|error|bug|critical|urgent|production/i;
    const isIncident = incidentKeywords.test(issue.title) || incidentKeywords.test(issue.body || '');

    if (isIncident) {
      console.log(`🚨 Potential incident issue #${issue.number} in ${repository.full_name}`);
      
      try {
        const octokit = await this.getInstallationOctokit(installation.id);
        await this.handleIncidentIssue(octokit, repository, issue);
      } catch (error) {
        console.error(`Error handling incident issue #${issue.number}:`, error);
      }
    }
  }

  async handleIssueLabeled(event) {
    const { issue, label, repository, installation } = event.payload;
    
    // React to incident labels
    const incidentLabels = ['incident', 'outage', 'critical', 'p0', 'production'];
    if (incidentLabels.includes(label.name.toLowerCase())) {
      console.log(`🚨 Incident label "${label.name}" added to issue #${issue.number}`);
      
      try {
        const octokit = await this.getInstallationOctokit(installation.id);
        await this.handleIncidentIssue(octokit, repository, issue);
      } catch (error) {
        console.error(`Error handling labeled incident issue #${issue.number}:`, error);
      }
    }
  }

  async handlePush(event) {
    const { repository, ref, commits, installation } = event.payload;
    
    // Only analyze pushes to main/master branches
    const mainBranches = ['refs/heads/main', 'refs/heads/master', 'refs/heads/production'];
    if (!mainBranches.includes(ref)) {
      return;
    }

    console.log(`📦 Analyzing push to ${ref} in ${repository.full_name} (${commits.length} commits)`);

    try {
      const octokit = await this.getInstallationOctokit(installation.id);
      await this.analyzeDeploymentRisk(octokit, repository, commits);
    } catch (error) {
      console.error(`Error analyzing deployment risk:`, error);
    }
  }

  async handleReleasePublished(event) {
    const { release, repository, installation } = event.payload;
    
    console.log(`🎉 Release ${release.tag_name} published in ${repository.full_name}`);

    try {
      const octokit = await this.getInstallationOctokit(installation.id);
      await this.analyzeReleaseRisk(octokit, repository, release);
    } catch (error) {
      console.error(`Error analyzing release risk:`, error);
    }
  }

  async postAnalysisComment(octokit, repository, pr, analysis) {
    const comment = this.integration.formatAnalysisComment(analysis);
    
    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pr.number,
      body: comment
    });
  }

  async addRiskLabel(octokit, repository, pr, riskLevel) {
    const labelName = `traversion:${riskLevel}`;
    
    // Ensure the label exists
    try {
      await octokit.issues.getLabel({
        owner: repository.owner.login,
        repo: repository.name,
        name: labelName
      });
    } catch (error) {
      if (error.status === 404) {
        // Create the label
        const colors = {
          'high-risk': 'B60205',
          'medium-risk': 'FBCA04',
          'low-risk': '0E8A16'
        };

        await octokit.issues.createLabel({
          owner: repository.owner.login,
          repo: repository.name,
          name: labelName,
          color: colors[riskLevel] || 'CCCCCC',
          description: `Traversion ${riskLevel.replace('-', ' ')} assessment`
        });
      }
    }

    // Add the label to the PR
    await octokit.issues.addLabels({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pr.number,
      labels: [labelName]
    });
  }

  async requestAdditionalReviewers(octokit, repository, pr, analysis) {
    // Get repository collaborators to find potential reviewers
    const { data: collaborators } = await octokit.repos.listCollaborators({
      owner: repository.owner.login,
      repo: repository.name,
      permission: 'push'
    });

    // Filter out the PR author and existing reviewers
    const availableReviewers = collaborators
      .filter(collab => collab.login !== pr.user.login)
      .map(collab => collab.login)
      .slice(0, 2); // Request up to 2 additional reviewers

    if (availableReviewers.length > 0) {
      try {
        await octokit.pulls.requestReviewers({
          owner: repository.owner.login,
          repo: repository.name,
          pull_number: pr.number,
          reviewers: availableReviewers
        });

        // Comment about the additional review request
        await octokit.issues.createComment({
          owner: repository.owner.login,
          repo: repository.name,
          issue_number: pr.number,
          body: `🔴 **High-risk PR detected** - requesting additional reviewers: ${availableReviewers.map(r => `@${r}`).join(', ')}\n\nRisk factors: ${analysis.impactAssessment.riskAreas.join(', ')}`
        });
      } catch (error) {
        console.error('Failed to request additional reviewers:', error);
      }
    }
  }

  async handleIncidentIssue(octokit, repository, issue) {
    // Extract potential incident time from issue creation
    const incidentTime = new Date(issue.created_at);
    
    // Create incident analysis comment
    const analysisComment = `## 🕵️ Traversion Incident Analysis

**Incident detected:** ${issue.title}
**Time:** ${incidentTime.toISOString()}

### Quick Actions:
- 🔍 Run CLI analysis: \`trav incident --time "${incidentTime.toISOString()}" --hours 24\`
- 📊 [Analyze in dashboard](https://your-traversion-instance.com/incident?time=${incidentTime.getTime()})
- 🤖 Use Slack: \`/trav incident --time "${incidentTime.toISOString()}"\`

### Automated Analysis Starting...
I'll analyze recent commits for potential causes and update this issue with findings.

---
*This analysis was automatically generated by Traversion. [Learn more](https://github.com/your-org/traversion)*`;

    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issue.number,
      body: analysisComment
    });

    // Add incident label
    await octokit.issues.addLabels({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issue.number,
      labels: ['traversion:incident']
    });

    // TODO: Trigger background analysis and update issue with results
    this.scheduleIncidentAnalysis(repository, issue, incidentTime);
  }

  async analyzeDeploymentRisk(octokit, repository, commits) {
    // Analyze the risk of commits being deployed
    let totalRisk = 0;
    let riskFactors = new Set();

    for (const commit of commits) {
      // Simple risk analysis based on commit message and files
      const message = commit.message.toLowerCase();
      
      if (message.includes('hotfix') || message.includes('critical') || message.includes('urgent')) {
        totalRisk += 0.3;
        riskFactors.add('Urgent/hotfix commits');
      }
      
      if (message.includes('config') || message.includes('env')) {
        totalRisk += 0.2;
        riskFactors.add('Configuration changes');
      }
      
      // Check commit time (off-hours deployment)
      const commitTime = new Date(commit.timestamp);
      const hour = commitTime.getUTCHours();
      const day = commitTime.getUTCDay();
      
      if (day === 0 || day === 6 || hour < 9 || hour > 17) {
        totalRisk += 0.2;
        riskFactors.add('Off-hours deployment');
      }
    }

    const avgRisk = totalRisk / commits.length;

    if (avgRisk > 0.4) {
      // Create a deployment risk issue
      const riskLevel = avgRisk > 0.7 ? '🚨 HIGH' : '⚠️ MEDIUM';
      
      await octokit.issues.create({
        owner: repository.owner.login,
        repo: repository.name,
        title: `${riskLevel} Deployment Risk Alert - ${commits.length} commits`,
        body: `## 🚨 Deployment Risk Assessment

**Risk Score:** ${(avgRisk * 100).toFixed(0)}%
**Commits:** ${commits.length}
**Risk Factors:** ${Array.from(riskFactors).join(', ')}

### Recent Commits:
${commits.map(c => `- \`${c.id.substring(0, 8)}\` ${c.message} - ${c.author.name}`).join('\n')}

### Recommendations:
${avgRisk > 0.7 ? '🔴 Consider additional testing before deployment' : '🟡 Monitor deployment closely'}
${riskFactors.has('Configuration changes') ? '🔧 Verify environment-specific configurations' : ''}
${riskFactors.has('Off-hours deployment') ? '⏰ Ensure adequate coverage for off-hours support' : ''}

---
*Automated risk assessment by Traversion*`,
        labels: ['traversion:deployment-risk', avgRisk > 0.7 ? 'high-priority' : 'medium-priority']
      });
    }
  }

  async analyzeReleaseRisk(octokit, repository, release) {
    // Analyze the risk associated with a release
    const releaseComment = `## 🎉 Release Analysis: ${release.tag_name}

**Release:** ${release.name || release.tag_name}
**Published:** ${new Date(release.published_at).toLocaleString()}

### 🔍 Traversion Analysis:
- 📊 [View detailed analysis](https://your-traversion-instance.com/release/${repository.full_name}/${release.tag_name})
- 🚨 [Check for incident patterns](https://your-traversion-instance.com/incidents?after=${release.published_at})

### Post-Release Monitoring:
I'll monitor for any incidents in the next 24 hours and correlate them with this release.

---
*Automated by Traversion - The incident forensics tool*`;

    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: release.id,
      body: releaseComment
    });
  }

  scheduleIncidentAnalysis(repository, issue, incidentTime) {
    // Schedule background analysis (simplified - in production would use a queue)
    setTimeout(async () => {
      try {
        // This would integrate with the IncidentAnalyzer
        console.log(`Running scheduled analysis for incident issue #${issue.number}`);
        // TODO: Implement actual analysis and update issue
      } catch (error) {
        console.error('Scheduled incident analysis failed:', error);
      }
    }, 30000); // Run analysis in 30 seconds
  }

  start() {
    const server = createServer(this.webhooks);
    
    server.listen(this.port, () => {
      console.log(`🤖 Traversion GitHub App listening on port ${this.port}`);
      console.log('📦 Ready to analyze PRs and incidents automatically!');
    });

    return server;
  }

  // Health check endpoint
  async healthCheck() {
    try {
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: this.appId,
          privateKey: this.privateKey
        }
      });

      await octokit.apps.getAuthenticated();
      return { status: 'healthy', app: 'traversion-github-app' };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }
}