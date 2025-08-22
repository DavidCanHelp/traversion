class RecentActivity extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.versions = [];
    this.selectedVersion = null;
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
        }
        
        .header {
          padding: 1rem;
          border-bottom: 1px solid var(--border-color, #333);
        }
        
        .title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary, #fff);
          margin-bottom: 0.25rem;
        }
        
        .subtitle {
          font-size: 0.75rem;
          color: var(--text-secondary, #a0a0a0);
        }
        
        .activity-list {
          flex: 1;
          overflow-y: auto;
          padding: 0.5rem;
        }
        
        .version-card {
          padding: 0.75rem;
          margin-bottom: 0.5rem;
          background: var(--bg-tertiary, #2a2a2a);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid transparent;
          animation: slideIn 0.3s ease-out;
        }
        
        .version-card:hover {
          background: rgba(0, 255, 204, 0.05);
          border-color: var(--accent-cyan, #00ffcc);
        }
        
        .version-card.selected {
          background: linear-gradient(135deg, rgba(0, 255, 204, 0.1), rgba(255, 0, 255, 0.1));
          border-color: var(--accent-cyan, #00ffcc);
        }
        
        .file-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        
        .file-icon {
          font-size: 1.2rem;
        }
        
        .file-name {
          font-size: 0.875rem;
          color: var(--text-primary, #fff);
          font-weight: 500;
        }
        
        .version-meta {
          display: flex;
          justify-content: space-between;
          font-size: 0.7rem;
          color: var(--text-secondary, #a0a0a0);
        }
        
        .vibe-indicator {
          height: 2px;
          margin: 0.5rem 0;
          border-radius: 1px;
          background: linear-gradient(90deg, var(--accent-cyan, #00ffcc), var(--accent-purple, #ff00ff));
        }
        
        .tags {
          display: flex;
          gap: 0.25rem;
          flex-wrap: wrap;
        }
        
        .tag {
          padding: 0.125rem 0.375rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
          font-size: 0.65rem;
          color: var(--text-secondary, #a0a0a0);
        }
        
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-secondary, #a0a0a0);
          text-align: center;
          padding: 2rem;
        }
        
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      </style>
      
      <div class="header">
        <div class="title">Recent Activity</div>
        <div class="subtitle">Your latest code iterations</div>
      </div>
      
      <div class="activity-list" id="activity-list">
        <div class="empty-state">
          <div style="font-size: 2rem; margin-bottom: 1rem;">🎵</div>
          <div>No vibes yet...</div>
          <div style="font-size: 0.75rem; margin-top: 0.5rem;">Start coding and watch your journey unfold</div>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    window.addEventListener('versions-updated', (e) => {
      this.versions = e.detail.recent || [];
      this.updateList();
    });
    
    window.addEventListener('selected-version-changed', (e) => {
      this.selectedVersion = e.detail;
      this.updateSelection();
    });
  }

  updateList() {
    const list = this.shadowRoot.getElementById('activity-list');
    
    if (this.versions.length === 0) {
      return; // Keep empty state
    }
    
    list.innerHTML = this.versions.map(version => {
      const fileName = version.file_path.split('/').pop();
      const icon = this.getFileIcon(version.file_path);
      const tags = JSON.parse(version.vibe_tags || '[]');
      const time = this.formatTime(version.timestamp);
      
      return `
        <div class="version-card" data-version-id="${version.id}">
          <div class="file-info">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${fileName}</span>
          </div>
          <div class="version-meta">
            <span>v${version.id}</span>
            <span>${time}</span>
          </div>
          <div class="vibe-indicator"></div>
          ${tags.length > 0 ? `
            <div class="tags">
              ${tags.slice(0, 3).map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
    
    // Add click handlers
    list.querySelectorAll('.version-card').forEach(card => {
      card.addEventListener('click', () => {
        const versionId = parseInt(card.dataset.versionId);
        const version = this.versions.find(v => v.id === versionId);
        if (version) {
          window.dispatchEvent(new CustomEvent('version-selected', { detail: version }));
        }
      });
    });
  }

  updateSelection() {
    const cards = this.shadowRoot.querySelectorAll('.version-card');
    cards.forEach(card => {
      const versionId = parseInt(card.dataset.versionId);
      card.classList.toggle('selected', this.selectedVersion?.id === versionId);
    });
  }

  getFileIcon(filePath) {
    const ext = filePath.split('.').pop();
    const iconMap = {
      js: '📜',
      jsx: '⚛️',
      ts: '💙',
      tsx: '⚛️',
      py: '🐍',
      css: '🎨',
      html: '🌐',
      json: '📋'
    };
    return iconMap[ext] || '📄';
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleTimeString();
  }
}

customElements.define('recent-activity', RecentActivity);