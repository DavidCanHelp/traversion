class DiffViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.versionA = null;
    this.versionB = null;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          background: var(--bg-secondary, #1a1a1a);
          border-radius: 12px;
          overflow: hidden;
        }
        
        .diff-container {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        
        .diff-header {
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .diff-title {
          font-size: 0.9rem;
          color: var(--text-secondary, #a0a0a0);
        }
        
        .diff-stats {
          display: flex;
          gap: 1rem;
          font-size: 0.85rem;
        }
        
        .stat-added {
          color: #10b981;
        }
        
        .stat-removed {
          color: #ef4444;
        }
        
        .stat-modified {
          color: #f59e0b;
        }
        
        .diff-view-toggle {
          display: flex;
          gap: 0.5rem;
        }
        
        .toggle-btn {
          padding: 0.25rem 0.75rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: var(--text-secondary, #a0a0a0);
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .toggle-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        
        .toggle-btn.active {
          background: var(--accent-cyan, #00ffcc);
          color: #000;
          border-color: var(--accent-cyan, #00ffcc);
        }
        
        .diff-content {
          flex: 1;
          overflow: auto;
          padding: 1rem;
          font-family: 'Monaco', 'Menlo', monospace;
          font-size: 0.85rem;
          line-height: 1.6;
        }
        
        .diff-split {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        
        .diff-side {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          padding: 1rem;
          overflow-x: auto;
        }
        
        .diff-side-header {
          font-size: 0.75rem;
          color: var(--text-secondary, #a0a0a0);
          margin-bottom: 0.5rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .diff-line {
          display: flex;
          min-height: 1.5rem;
          white-space: pre-wrap;
          word-break: break-all;
        }
        
        .line-number {
          width: 3rem;
          padding-right: 0.5rem;
          color: rgba(255, 255, 255, 0.3);
          text-align: right;
          user-select: none;
        }
        
        .line-content {
          flex: 1;
          padding: 0 0.5rem;
        }
        
        .line-added {
          background: rgba(16, 185, 129, 0.1);
          border-left: 3px solid #10b981;
        }
        
        .line-removed {
          background: rgba(239, 68, 68, 0.1);
          border-left: 3px solid #ef4444;
        }
        
        .line-modified {
          background: rgba(245, 158, 11, 0.1);
          border-left: 3px solid #f59e0b;
        }
        
        .diff-inline .line-added {
          background: rgba(16, 185, 129, 0.2);
        }
        
        .diff-inline .line-removed {
          background: rgba(239, 68, 68, 0.2);
          text-decoration: line-through;
          opacity: 0.7;
        }
        
        .char-added {
          background: rgba(16, 185, 129, 0.3);
          font-weight: bold;
        }
        
        .char-removed {
          background: rgba(239, 68, 68, 0.3);
          font-weight: bold;
        }
        
        .no-changes {
          text-align: center;
          color: var(--text-secondary, #a0a0a0);
          padding: 2rem;
        }
        
        .loading {
          text-align: center;
          color: var(--text-secondary, #a0a0a0);
          padding: 2rem;
        }
        
        .similarity-badge {
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: bold;
        }
        
        .similarity-high {
          background: rgba(16, 185, 129, 0.2);
          color: #10b981;
        }
        
        .similarity-medium {
          background: rgba(245, 158, 11, 0.2);
          color: #f59e0b;
        }
        
        .similarity-low {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }
      </style>
      
      <div class="diff-container">
        <div class="diff-header">
          <div class="diff-title">
            <span id="diff-title">Select two versions to compare</span>
          </div>
          <div class="diff-stats" id="diff-stats"></div>
          <div class="diff-view-toggle">
            <button class="toggle-btn active" data-view="unified">Unified</button>
            <button class="toggle-btn" data-view="split">Split</button>
            <button class="toggle-btn" data-view="inline">Inline</button>
          </div>
        </div>
        <div class="diff-content" id="diff-content">
          <div class="no-changes">Select versions to see differences</div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    // View toggle buttons
    this.shadowRoot.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.shadowRoot.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderDiff(btn.dataset.view);
      });
    });

    // Listen for version selection events
    window.addEventListener('compare-versions-changed', (e) => {
      const [versionA, versionB] = e.detail;
      if (versionA && versionB) {
        this.compareVersions(versionA, versionB);
      }
    });
  }

  async compareVersions(versionA, versionB) {
    this.versionA = versionA;
    this.versionB = versionB;
    
    const content = this.shadowRoot.getElementById('diff-content');
    content.innerHTML = '<div class="loading">Calculating differences...</div>';
    
    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionAId: versionA.id,
          versionBId: versionB.id
        })
      });
      
      const data = await response.json();
      this.diffData = data;
      
      // Update header
      const title = this.shadowRoot.getElementById('diff-title');
      title.textContent = `${versionA.file_path} - v${versionA.id} → v${versionB.id}`;
      
      // Calculate and show stats
      this.updateStats(data.changes);
      
      // Render diff with default view
      this.renderDiff('unified');
      
    } catch (error) {
      content.innerHTML = `<div class="no-changes">Error loading diff: ${error.message}</div>`;
    }
  }

  updateStats(changes) {
    let added = 0, removed = 0, modified = 0;
    
    changes.forEach(change => {
      if (change.added) {
        added += change.count || change.value.split('\n').length;
      } else if (change.removed) {
        removed += change.count || change.value.split('\n').length;
      }
    });
    
    const stats = this.shadowRoot.getElementById('diff-stats');
    const similarity = this.diffData?.similarity || 0;
    const similarityClass = similarity > 0.8 ? 'similarity-high' : 
                           similarity > 0.5 ? 'similarity-medium' : 'similarity-low';
    
    stats.innerHTML = `
      <span class="stat-added">+${added}</span>
      <span class="stat-removed">-${removed}</span>
      <span class="similarity-badge ${similarityClass}">
        ${Math.round(similarity * 100)}% similar
      </span>
    `;
  }

  renderDiff(viewType = 'unified') {
    const content = this.shadowRoot.getElementById('diff-content');
    
    if (!this.diffData) {
      content.innerHTML = '<div class="no-changes">No diff data available</div>';
      return;
    }
    
    switch (viewType) {
      case 'split':
        this.renderSplitView(content);
        break;
      case 'inline':
        this.renderInlineView(content);
        break;
      default:
        this.renderUnifiedView(content);
    }
  }

  renderUnifiedView(container) {
    const changes = this.diffData.changes;
    let html = '<div class="diff-unified">';
    let lineNumber = 1;
    
    changes.forEach(change => {
      const lines = change.value.split('\n').filter(line => line !== '');
      
      lines.forEach(line => {
        let className = '';
        let prefix = ' ';
        
        if (change.added) {
          className = 'line-added';
          prefix = '+';
        } else if (change.removed) {
          className = 'line-removed';
          prefix = '-';
        }
        
        html += `
          <div class="diff-line ${className}">
            <span class="line-number">${lineNumber++}</span>
            <span class="line-content">${this.escapeHtml(prefix + line)}</span>
          </div>
        `;
      });
    });
    
    html += '</div>';
    container.innerHTML = html;
  }

  renderSplitView(container) {
    const versionA = this.diffData.versionA;
    const versionB = this.diffData.versionB;
    
    container.innerHTML = `
      <div class="diff-split">
        <div class="diff-side">
          <div class="diff-side-header">Version ${versionA.id} - ${new Date(versionA.timestamp).toLocaleString()}</div>
          <pre>${this.escapeHtml(versionA.content)}</pre>
        </div>
        <div class="diff-side">
          <div class="diff-side-header">Version ${versionB.id} - ${new Date(versionB.timestamp).toLocaleString()}</div>
          <pre>${this.escapeHtml(versionB.content)}</pre>
        </div>
      </div>
    `;
  }

  renderInlineView(container) {
    const changes = this.diffData.changes;
    let html = '<div class="diff-inline">';
    
    changes.forEach(change => {
      if (change.added) {
        html += `<span class="char-added">${this.escapeHtml(change.value)}</span>`;
      } else if (change.removed) {
        html += `<span class="char-removed">${this.escapeHtml(change.value)}</span>`;
      } else {
        html += this.escapeHtml(change.value);
      }
    });
    
    html += '</div>';
    container.innerHTML = html;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

customElements.define('diff-viewer', DiffViewer);