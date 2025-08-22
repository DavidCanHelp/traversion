class CodeViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.currentVersion = null;
    this.compareVersions = [null, null];
    this.compareMode = false;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-primary, #0a0a0a);
        }
        
        .viewer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          background: var(--bg-secondary, #1a1a1a);
          border-bottom: 1px solid var(--border-color, #333);
        }
        
        .file-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        
        .file-path {
          color: var(--text-primary, #fff);
          font-size: 0.875rem;
        }
        
        .version-id {
          color: var(--text-secondary, #a0a0a0);
          font-size: 0.75rem;
        }
        
        .vibe-tags {
          display: flex;
          gap: 0.5rem;
        }
        
        .vibe-tag {
          padding: 0.25rem 0.5rem;
          background: rgba(255, 0, 255, 0.2);
          border: 1px solid rgba(255, 0, 255, 0.4);
          border-radius: 4px;
          color: var(--accent-purple, #ff00ff);
          font-size: 0.7rem;
        }
        
        .code-container {
          flex: 1;
          overflow: auto;
          padding: 1rem;
          position: relative;
        }
        
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-secondary, #a0a0a0);
          text-align: center;
        }
        
        .empty-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        
        pre {
          margin: 0;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 0.875rem;
          line-height: 1.5;
        }
        
        .diff-container {
          display: flex;
          height: 100%;
        }
        
        .diff-pane {
          flex: 1;
          overflow: auto;
          padding: 1rem;
        }
        
        .diff-pane:first-child {
          border-right: 1px solid var(--border-color, #333);
        }
        
        .diff-added {
          background: rgba(74, 222, 128, 0.1);
          color: #4ade80;
        }
        
        .diff-removed {
          background: rgba(248, 113, 113, 0.1);
          color: #f87171;
        }
      </style>
      
      <div class="viewer-header" id="header">
        <div class="file-info">
          <span class="file-path" id="file-path">No file selected</span>
          <span class="version-id" id="version-id"></span>
        </div>
        <div class="vibe-tags" id="vibe-tags"></div>
      </div>
      
      <div class="code-container" id="code-container">
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <div>Select a version from the timeline</div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    window.addEventListener('selected-version-changed', (e) => {
      this.currentVersion = e.detail;
      this.displayVersion();
    });
    
    window.addEventListener('compare-mode-changed', (e) => {
      this.compareMode = e.detail;
      this.updateDisplay();
    });
    
    window.addEventListener('compare-versions-changed', (e) => {
      this.compareVersions = e.detail;
      this.updateDisplay();
    });
  }

  displayVersion() {
    if (!this.currentVersion) return;
    
    const header = this.shadowRoot.getElementById('header');
    const filePath = this.shadowRoot.getElementById('file-path');
    const versionId = this.shadowRoot.getElementById('version-id');
    const vibeTags = this.shadowRoot.getElementById('vibe-tags');
    const container = this.shadowRoot.getElementById('code-container');
    
    // Update header
    filePath.textContent = this.currentVersion.file_path;
    versionId.textContent = `v${this.currentVersion.id}`;
    
    // Update vibe tags
    const tags = JSON.parse(this.currentVersion.vibe_tags || '[]');
    vibeTags.innerHTML = tags.map(tag => 
      `<span class="vibe-tag">${tag}</span>`
    ).join('');
    
    // Display code with syntax highlighting
    const language = this.getLanguage(this.currentVersion.file_path);
    container.innerHTML = `
      <pre><code class="language-${language}">${this.escapeHtml(this.currentVersion.content)}</code></pre>
    `;
    
    // Apply syntax highlighting if Prism is available
    if (window.Prism) {
      Prism.highlightAllUnder(this.shadowRoot);
    }
  }

  updateDisplay() {
    if (this.compareMode && this.compareVersions[0] && this.compareVersions[1]) {
      this.displayComparison();
    } else {
      this.displayVersion();
    }
  }

  displayComparison() {
    const [versionA, versionB] = this.compareVersions;
    const container = this.shadowRoot.getElementById('code-container');
    
    // Create diff view
    const diffs = this.computeDiff(versionA.content, versionB.content);
    
    container.innerHTML = `
      <div class="diff-container">
        <div class="diff-pane">
          <h3>Version ${versionA.id}</h3>
          <pre>${this.renderDiff(diffs, 'old')}</pre>
        </div>
        <div class="diff-pane">
          <h3>Version ${versionB.id}</h3>
          <pre>${this.renderDiff(diffs, 'new')}</pre>
        </div>
      </div>
    `;
  }

  computeDiff(oldText, newText) {
    if (window.Diff) {
      return Diff.diffLines(oldText, newText);
    }
    return [];
  }

  renderDiff(diffs, side) {
    let html = '';
    diffs.forEach(part => {
      if (part.added && side === 'new') {
        html += `<span class="diff-added">${this.escapeHtml(part.value)}</span>`;
      } else if (part.removed && side === 'old') {
        html += `<span class="diff-removed">${this.escapeHtml(part.value)}</span>`;
      } else if (!part.added && !part.removed) {
        html += this.escapeHtml(part.value);
      }
    });
    return html;
  }

  getLanguage(filePath) {
    const ext = filePath.split('.').pop();
    const langMap = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      css: 'css',
      html: 'html',
      json: 'json'
    };
    return langMap[ext] || 'plaintext';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

customElements.define('code-viewer', CodeViewer);