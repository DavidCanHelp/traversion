import fetch from 'node-fetch';

export class IssueTrackingIntegration {
  constructor(options = {}) {
    this.type = options.type || 'jira'; // 'jira', 'linear', 'github'
    this.config = options.config || {};
    this.setupProvider();
  }

  setupProvider() {
    switch (this.type) {
      case 'jira':
        this.provider = new JiraProvider(this.config);
        break;
      case 'linear':
        this.provider = new LinearProvider(this.config);
        break;
      case 'github':
        this.provider = new GitHubIssuesProvider(this.config);
        break;
      default:
        throw new Error(`Unsupported issue tracking provider: ${this.type}`);
    }
  }

  async createIncidentIssue(incident) {
    return await this.provider.createIncident(incident);
  }

  async updateIncidentIssue(issueId, update) {
    return await this.provider.updateIncident(issueId, update);
  }

  async linkAnalysisToIssue(issueId, analysis) {
    return await this.provider.linkAnalysis(issueId, analysis);
  }

  async getIncidentHistory(filters = {}) {
    return await this.provider.getIncidentHistory(filters);
  }

  async closeIncident(issueId, resolution) {
    return await this.provider.closeIncident(issueId, resolution);
  }
}

class JiraProvider {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.projectKey = config.projectKey || 'INC';
    
    this.auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/rest/api/3/${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  async createIncident(incident) {
    const severity = this.mapSeverity(incident.severity);
    const priority = this.mapPriority(incident.priority);

    const issueData = {
      fields: {
        project: { key: this.projectKey },
        issuetype: { name: 'Incident' },
        summary: incident.title || `Incident at ${new Date(incident.timestamp).toLocaleString()}`,
        description: {
          type: 'doc',
          version: 1,
          content: [{
            type: 'paragraph',
            content: [{
              type: 'text',
              text: this.formatIncidentDescription(incident)
            }]
          }]
        },
        priority: { name: priority },
        labels: ['traversion', 'automated', severity],
        customfield_10001: incident.timestamp, // Incident time custom field
        customfield_10002: incident.affectedSystems?.join(', '), // Affected systems
      }
    };

    const response = await this.request('issue', {
      method: 'POST',
      body: JSON.stringify(issueData)
    });

    return {
      id: response.key,
      url: `${this.baseUrl}/browse/${response.key}`,
      provider: 'jira'
    };
  }

  async updateIncident(issueKey, update) {
    const updateData = {
      update: {
        comment: [{
          add: {
            body: {
              type: 'doc',
              version: 1,
              content: [{
                type: 'paragraph',
                content: [{
                  type: 'text',
                  text: update.comment
                }]
              }]
            }
          }
        }]
      }
    };

    if (update.status) {
      updateData.transition = { id: this.getTransitionId(update.status) };
    }

    await this.request(`issue/${issueKey}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });

    return { success: true };
  }

  async linkAnalysis(issueKey, analysis) {
    const analysisComment = this.formatAnalysisComment(analysis);
    
    await this.updateIncident(issueKey, {
      comment: analysisComment
    });

    // Add analysis as attachment if detailed
    if (analysis.suspiciousCommits && analysis.suspiciousCommits.length > 0) {
      const analysisJson = JSON.stringify(analysis, null, 2);
      await this.addAttachment(issueKey, 'traversion-analysis.json', analysisJson);
    }

    return { success: true };
  }

  async getIncidentHistory(filters = {}) {
    let jql = `project = ${this.projectKey} AND issuetype = Incident`;
    
    if (filters.since) {
      jql += ` AND created >= "${filters.since}"`;
    }
    
    if (filters.severity) {
      jql += ` AND labels in (${filters.severity})`;
    }

    jql += ' ORDER BY created DESC';

    const response = await this.request(`search?jql=${encodeURIComponent(jql)}&maxResults=100`);

    return response.issues.map(issue => ({
      id: issue.key,
      title: issue.fields.summary,
      status: issue.fields.status.name,
      created: issue.fields.created,
      resolved: issue.fields.resolutiondate,
      priority: issue.fields.priority?.name,
      labels: issue.fields.labels,
      url: `${this.baseUrl}/browse/${issue.key}`
    }));
  }

  async closeIncident(issueKey, resolution) {
    await this.updateIncident(issueKey, {
      status: 'Resolved',
      comment: `🎉 **Incident Resolved**\n\n${resolution.summary}\n\n**Resolution Time:** ${resolution.duration} minutes\n**Root Cause:** ${resolution.rootCause}\n\n*Automatically closed by Traversion*`
    });

    return { success: true };
  }

  formatIncidentDescription(incident) {
    let description = `🚨 **Incident Detected**\n\n`;
    description += `**Time:** ${new Date(incident.timestamp).toLocaleString()}\n`;
    description += `**Severity:** ${incident.severity || 'Unknown'}\n`;
    
    if (incident.affectedSystems) {
      description += `**Affected Systems:** ${incident.affectedSystems.join(', ')}\n`;
    }
    
    if (incident.description) {
      description += `**Description:** ${incident.description}\n`;
    }
    
    description += `\n**Automatic Analysis:**\n`;
    description += `• Traversion is analyzing recent commits for potential causes\n`;
    description += `• Analysis results will be posted as comments\n`;
    description += `• Use \`trav incident --time "${incident.timestamp}"\` for manual analysis\n`;
    
    if (incident.suspiciousCommits && incident.suspiciousCommits.length > 0) {
      description += `\n**Preliminary Suspects (${incident.suspiciousCommits.length} commits):**\n`;
      incident.suspiciousCommits.slice(0, 3).forEach((commit, index) => {
        description += `${index + 1}. \`${commit.shortHash}\` ${commit.message} (${(commit.riskScore * 100).toFixed(0)}% risk)\n`;
      });
    }

    return description;
  }

  formatAnalysisComment(analysis) {
    let comment = `🕵️ **Traversion Forensic Analysis Complete**\n\n`;
    
    comment += `**Analysis Summary:**\n`;
    comment += `• Suspicious Commits: ${analysis.suspiciousCommits?.length || 0}\n`;
    comment += `• High Risk Commits: ${analysis.impactAnalysis?.highRiskCommits || 0}\n`;
    comment += `• Authors Involved: ${analysis.impactAnalysis?.authorsInvolved || 0}\n`;

    if (analysis.suspiciousCommits && analysis.suspiciousCommits.length > 0) {
      comment += `\n**🎯 Top Suspects:**\n`;
      
      analysis.suspiciousCommits.slice(0, 5).forEach((commit, index) => {
        const riskEmoji = commit.riskScore > 0.7 ? '🚨' : commit.riskScore > 0.4 ? '⚠️' : '🟡';
        comment += `${index + 1}. ${riskEmoji} \`${commit.shortHash}\` ${commit.message}\n`;
        comment += `   👤 ${commit.author} | ⏰ ${new Date(commit.date).toLocaleString()}\n`;
        comment += `   📊 Risk: ${(commit.riskScore * 100).toFixed(0)}% | Files: ${commit.filesChanged?.length || 0}\n`;
        if (commit.riskFactors && commit.riskFactors.length > 0) {
          comment += `   🏷️ ${commit.riskFactors.join(', ')}\n`;
        }
        comment += `\n`;
      });
    }

    if (analysis.recommendations && analysis.recommendations.length > 0) {
      comment += `**💡 Recommendations:**\n`;
      analysis.recommendations.forEach(rec => {
        const emoji = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵';
        comment += `${emoji} **${rec.category.toUpperCase()}:** ${rec.message}\n`;
      });
    }

    if (analysis.patternInsights && analysis.patternInsights.length > 0) {
      comment += `\n**🧠 Pattern Insights:**\n`;
      analysis.patternInsights.forEach(insight => {
        const emoji = insight.level === 'warning' ? '⚠️' : insight.level === 'error' ? '🚨' : 'ℹ️';
        comment += `${emoji} ${insight.message}\n`;
      });
    }

    comment += `\n---\n*Generated by Traversion v${process.env.npm_package_version || '0.1.0'} at ${new Date().toLocaleString()}*`;

    return comment;
  }

  mapSeverity(severity) {
    const severityMap = {
      'critical': 'critical',
      'high': 'high',
      'medium': 'medium',
      'low': 'low'
    };
    return severityMap[severity] || 'medium';
  }

  mapPriority(priority) {
    const priorityMap = {
      'critical': 'Highest',
      'high': 'High',
      'medium': 'Medium',
      'low': 'Low'
    };
    return priorityMap[priority] || 'Medium';
  }

  getTransitionId(status) {
    // These would need to be configured based on your Jira workflow
    const transitions = {
      'In Progress': '21',
      'Resolved': '31',
      'Closed': '41'
    };
    return transitions[status] || '21';
  }

  async addAttachment(issueKey, filename, content) {
    // Create form data for file upload
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', Buffer.from(content), filename);

    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'X-Atlassian-Token': 'no-check'
      },
      body: form
    });

    return response.ok;
  }
}

class LinearProvider {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.teamId = config.teamId;
    this.baseUrl = 'https://api.linear.app/graphql';
  }

  async request(query, variables = {}) {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });

    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`Linear API error: ${result.errors[0].message}`);
    }

    return result.data;
  }

  async createIncident(incident) {
    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          issue {
            id
            identifier
            url
          }
        }
      }
    `;

    const priority = this.mapPriority(incident.severity);
    const labels = await this.getOrCreateLabels(['incident', 'traversion', incident.severity]);

    const input = {
      teamId: this.teamId,
      title: incident.title || `Incident at ${new Date(incident.timestamp).toLocaleString()}`,
      description: this.formatIncidentDescription(incident),
      priority,
      labelIds: labels.map(l => l.id)
    };

    const result = await this.request(mutation, { input });
    const issue = result.issueCreate.issue;

    return {
      id: issue.identifier,
      url: issue.url,
      provider: 'linear'
    };
  }

  async updateIncident(issueId, update) {
    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          issue {
            id
          }
        }
      }
    `;

    const input = {};
    
    if (update.comment) {
      // Linear doesn't have comments, so we append to description
      input.description = await this.appendToDescription(issueId, update.comment);
    }

    if (update.status) {
      const stateId = await this.getStateId(update.status);
      input.stateId = stateId;
    }

    await this.request(mutation, { id: issueId, input });
    return { success: true };
  }

  async linkAnalysis(issueId, analysis) {
    const analysisComment = this.formatAnalysisComment(analysis);
    await this.updateIncident(issueId, { comment: analysisComment });
    return { success: true };
  }

  async getIncidentHistory(filters = {}) {
    const query = `
      query GetIssues($filter: IssueFilter) {
        issues(filter: $filter) {
          nodes {
            id
            identifier
            title
            state {
              name
            }
            createdAt
            completedAt
            priority
            labels {
              nodes {
                name
              }
            }
            url
          }
        }
      }
    `;

    const filter = {
      team: { id: { eq: this.teamId } },
      labels: { some: { name: { eq: 'incident' } } }
    };

    if (filters.since) {
      filter.createdAt = { gte: new Date(filters.since) };
    }

    const result = await this.request(query, { filter });

    return result.issues.nodes.map(issue => ({
      id: issue.identifier,
      title: issue.title,
      status: issue.state.name,
      created: issue.createdAt,
      resolved: issue.completedAt,
      priority: issue.priority,
      labels: issue.labels.nodes.map(l => l.name),
      url: issue.url
    }));
  }

  formatIncidentDescription(incident) {
    // Similar to Jira but in Markdown format for Linear
    let description = `## 🚨 Incident Detected\n\n`;
    description += `**Time:** ${new Date(incident.timestamp).toLocaleString()}\n`;
    description += `**Severity:** ${incident.severity || 'Unknown'}\n\n`;
    
    if (incident.description) {
      description += `**Description:** ${incident.description}\n\n`;
    }
    
    description += `### Automatic Analysis\n`;
    description += `- Traversion is analyzing recent commits for potential causes\n`;
    description += `- Analysis results will be updated in this issue\n`;
    description += `- Use \`trav incident --time "${incident.timestamp}"\` for manual analysis\n\n`;

    return description;
  }

  formatAnalysisComment(analysis) {
    // Convert Jira format to Markdown
    return this.formatIncidentDescription(analysis).replace(/\*\*/g, '**');
  }

  mapPriority(severity) {
    const priorityMap = {
      'critical': 1, // Urgent
      'high': 2,     // High
      'medium': 3,   // Medium
      'low': 4       // Low
    };
    return priorityMap[severity] || 3;
  }

  async getOrCreateLabels(labelNames) {
    // This is a simplified version - in practice you'd want to cache labels
    // and create them only if they don't exist
    return labelNames.map(name => ({ id: `label-${name}`, name }));
  }

  async getStateId(statusName) {
    // Map status names to Linear state IDs
    // This would need to be configured based on your Linear workspace
    const stateMap = {
      'In Progress': 'state-in-progress',
      'Resolved': 'state-done',
      'Closed': 'state-closed'
    };
    return stateMap[statusName] || 'state-in-progress';
  }

  async appendToDescription(issueId, comment) {
    // Get current description and append comment
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          description
        }
      }
    `;

    const result = await this.request(query, { id: issueId });
    const currentDescription = result.issue.description || '';
    
    return `${currentDescription}\n\n---\n\n${comment}`;
  }
}

class GitHubIssuesProvider {
  constructor(config) {
    this.octokit = config.octokit; // Assumes Octokit instance is passed in
    this.owner = config.owner;
    this.repo = config.repo;
  }

  async createIncident(incident) {
    const labels = ['incident', 'traversion', `severity:${incident.severity || 'medium'}`];

    const issue = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: incident.title || `Incident at ${new Date(incident.timestamp).toLocaleString()}`,
      body: this.formatIncidentDescription(incident),
      labels
    });

    return {
      id: issue.data.number,
      url: issue.data.html_url,
      provider: 'github'
    };
  }

  async updateIncident(issueNumber, update) {
    if (update.comment) {
      await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body: update.comment
      });
    }

    if (update.status) {
      const state = update.status === 'Resolved' ? 'closed' : 'open';
      await this.octokit.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        state
      });
    }

    return { success: true };
  }

  async linkAnalysis(issueNumber, analysis) {
    const analysisComment = this.formatAnalysisComment(analysis);
    await this.updateIncident(issueNumber, { comment: analysisComment });
    return { success: true };
  }

  async getIncidentHistory(filters = {}) {
    const params = {
      owner: this.owner,
      repo: this.repo,
      labels: 'incident',
      state: 'all',
      sort: 'created',
      direction: 'desc',
      per_page: 100
    };

    if (filters.since) {
      params.since = new Date(filters.since).toISOString();
    }

    const issues = await this.octokit.issues.list(params);

    return issues.data.map(issue => ({
      id: issue.number,
      title: issue.title,
      status: issue.state,
      created: issue.created_at,
      resolved: issue.closed_at,
      labels: issue.labels.map(l => l.name),
      url: issue.html_url
    }));
  }

  formatIncidentDescription(incident) {
    let description = `## 🚨 Incident Detected\n\n`;
    description += `**Time:** ${new Date(incident.timestamp).toLocaleString()}\n`;
    description += `**Severity:** ${incident.severity || 'Unknown'}\n\n`;
    
    if (incident.description) {
      description += `**Description:** ${incident.description}\n\n`;
    }
    
    description += `### Automatic Analysis\n`;
    description += `- Traversion is analyzing recent commits for potential causes\n`;
    description += `- Analysis results will be posted as comments\n`;
    description += `- Use \`trav incident --time "${incident.timestamp}"\` for manual analysis\n\n`;

    return description;
  }

  formatAnalysisComment(analysis) {
    // GitHub uses Markdown, similar to Linear
    return this.formatIncidentDescription(analysis);
  }
}