class TimeSlider extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isDragging = false;
    this.timeRange = { start: Date.now() - 3600000, end: Date.now() };
    this.currentTime = Date.now();
    this.versions = [];
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
          padding: 1rem;
          background: var(--bg-secondary, #1a1a1a);
        }
        
        .timeline-container {
          height: 80px;
          position: relative;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
        }
        
        .timeline-track {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(90deg, 
            rgba(0, 255, 204, 0.1) 0%, 
            rgba(255, 0, 255, 0.1) 50%, 
            rgba(255, 204, 0, 0.1) 100%);
        }
        
        .version-marker {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: rgba(255, 255, 255, 0.2);
          transition: background 0.2s;
        }
        
        .version-marker:hover {
          background: var(--accent-cyan, #00ffcc);
          width: 2px;
        }
        
        .timeline-cursor {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: var(--accent-cyan, #00ffcc);
          box-shadow: 0 0 10px rgba(0, 255, 204, 0.5);
          pointer-events: none;
        }
        
        .timeline-time {
          position: absolute;
          bottom: -20px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 0.75rem;
          color: var(--text-secondary, #a0a0a0);
          background: var(--bg-primary, #0a0a0a);
          padding: 2px 8px;
          border-radius: 4px;
        }
        
        .time-labels {
          display: flex;
          justify-content: space-between;
          margin-top: 0.5rem;
          font-size: 0.7rem;
          color: var(--text-dim, #606060);
        }
      </style>
      
      <div class="timeline-container" id="timeline">
        <div class="timeline-track"></div>
        <div id="version-markers"></div>
        <div class="timeline-cursor" id="cursor">
          <div class="timeline-time" id="current-time"></div>
        </div>
      </div>
      <div class="time-labels">
        <span id="start-time">--:--</span>
        <span>Timeline</span>
        <span id="end-time">Now</span>
      </div>
    `;
  }

  setupEventListeners() {
    const timeline = this.shadowRoot.getElementById('timeline');
    
    timeline.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    timeline.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    timeline.addEventListener('mouseup', () => this.handleMouseUp());
    timeline.addEventListener('mouseleave', () => this.handleMouseUp());
    
    // Listen for version updates
    window.addEventListener('versions-updated', (e) => {
      this.versions = e.detail.versions;
      this.updateVersionMarkers();
      this.updateTimeRange();
    });
  }

  handleMouseDown(e) {
    this.isDragging = true;
    this.updateTimeFromPosition(e);
  }

  handleMouseMove(e) {
    if (this.isDragging) {
      this.updateTimeFromPosition(e);
    }
  }

  handleMouseUp() {
    this.isDragging = false;
  }

  updateTimeFromPosition(e) {
    const timeline = this.shadowRoot.getElementById('timeline');
    const rect = timeline.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    
    this.currentTime = this.timeRange.start + (this.timeRange.end - this.timeRange.start) * percentage;
    this.updateCursor();
    
    // Dispatch event
    window.dispatchEvent(new CustomEvent('time-changed', { detail: this.currentTime }));
  }

  updateCursor() {
    const cursor = this.shadowRoot.getElementById('cursor');
    const timeLabel = this.shadowRoot.getElementById('current-time');
    const percentage = (this.currentTime - this.timeRange.start) / (this.timeRange.end - this.timeRange.start);
    
    cursor.style.left = `${percentage * 100}%`;
    timeLabel.textContent = new Date(this.currentTime).toLocaleTimeString();
  }

  updateVersionMarkers() {
    const container = this.shadowRoot.getElementById('version-markers');
    container.innerHTML = '';
    
    this.versions.forEach(version => {
      const marker = document.createElement('div');
      marker.className = 'version-marker';
      
      const time = new Date(version.timestamp).getTime();
      const percentage = (time - this.timeRange.start) / (this.timeRange.end - this.timeRange.start);
      marker.style.left = `${percentage * 100}%`;
      
      marker.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('version-selected', { detail: version }));
      });
      
      container.appendChild(marker);
    });
  }

  updateTimeRange() {
    if (this.versions.length > 0) {
      const timestamps = this.versions.map(v => new Date(v.timestamp).getTime());
      this.timeRange = {
        start: Math.min(...timestamps),
        end: Math.max(...timestamps, Date.now())
      };
      
      // Update labels
      const startLabel = this.shadowRoot.getElementById('start-time');
      const endLabel = this.shadowRoot.getElementById('end-time');
      startLabel.textContent = new Date(this.timeRange.start).toLocaleTimeString();
    }
  }
}

customElements.define('time-slider', TimeSlider);