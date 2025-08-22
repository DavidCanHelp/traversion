class StatusBar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.status = 'disconnected';
    this.versionCount = 0;
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
          justify-content: space-between;
          align-items: center;
          padding: 0 1rem;
          height: 24px;
          background: var(--bg-primary, #0a0a0a);
          border-top: 1px solid var(--border-color, #333);
          font-size: 0.75rem;
          color: var(--text-secondary, #a0a0a0);
        }
        
        .status-left {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-secondary, #a0a0a0);
          transition: all 0.3s;
        }
        
        .status-dot.connected {
          background: var(--success, #4ade80);
          animation: pulse 2s infinite;
        }
        
        .status-dot.error {
          background: var(--error, #f87171);
        }
        
        .version-info {
          color: var(--text-primary, #fff);
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      </style>
      
      <div class="status-left">
        <div class="status-indicator">
          <div class="status-dot" id="status-dot"></div>
          <span id="status-text">Connecting...</span>
        </div>
        <span id="version-count">0 versions</span>
      </div>
      
      <div class="status-right">
        <span id="selected-info">No version selected</span>
      </div>
    `;
  }

  setupEventListeners() {
    window.addEventListener('status-changed', (e) => {
      this.status = e.detail;
      this.updateStatus();
    });
    
    window.addEventListener('versions-updated', (e) => {
      this.versionCount = e.detail.versions.length;
      this.updateVersionCount();
    });
    
    window.addEventListener('selected-version-changed', (e) => {
      this.selectedVersion = e.detail;
      this.updateSelectedInfo();
    });
  }

  updateStatus() {
    const dot = this.shadowRoot.getElementById('status-dot');
    const text = this.shadowRoot.getElementById('status-text');
    
    dot.className = 'status-dot';
    
    switch (this.status) {
      case 'connected':
        dot.classList.add('connected');
        text.textContent = 'Recording';
        break;
      case 'error':
        dot.classList.add('error');
        text.textContent = 'Error';
        break;
      case 'disconnected':
        text.textContent = 'Disconnected';
        break;
      default:
        text.textContent = 'Connecting...';
    }
  }

  updateVersionCount() {
    const count = this.shadowRoot.getElementById('version-count');
    count.textContent = `${this.versionCount} versions`;
  }

  updateSelectedInfo() {
    const info = this.shadowRoot.getElementById('selected-info');
    
    if (this.selectedVersion) {
      const fileName = this.selectedVersion.file_path.split('/').pop();
      info.innerHTML = `
        <span class="version-info">
          Viewing: ${fileName} 
          <span style="color: var(--text-secondary, #a0a0a0); margin-left: 0.5rem;">
            v${this.selectedVersion.id}
          </span>
        </span>
      `;
    } else {
      info.textContent = 'No version selected';
    }
  }
}

customElements.define('status-bar', StatusBar);