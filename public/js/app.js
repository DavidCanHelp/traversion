// Main application state
export const state = {
  versions: [],
  recentVersions: [],
  selectedVersion: null,
  compareMode: false,
  compareVersions: [null, null],
  currentTime: Date.now(),
  ws: null
};

// Import components
import './components/TimeSlider.js';
import './components/CodeViewer.js';
import './components/RecentActivity.js';
import './components/VibeSearch.js';
import './components/StatusBar.js';

// WebSocket connection
function connectWebSocket() {
  const ws = new WebSocket('ws://localhost:3334');
  
  ws.onopen = () => {
    console.log('Connected to Traversion');
    updateStatus('connected');
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleWSMessage(message);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateStatus('error');
  };
  
  ws.onclose = () => {
    console.log('Disconnected from Traversion');
    updateStatus('disconnected');
    // Reconnect after 3 seconds
    setTimeout(connectWebSocket, 3000);
  };
  
  state.ws = ws;
}

// Handle WebSocket messages
function handleWSMessage(message) {
  switch (message.type) {
    case 'init':
      state.versions = message.data.timeline || [];
      state.recentVersions = message.data.recent || [];
      updateAllComponents();
      break;
      
    case 'version':
      state.versions.push(message.data);
      state.recentVersions.unshift(message.data);
      state.recentVersions = state.recentVersions.slice(0, 50);
      updateAllComponents();
      break;
      
    case 'delete':
      // Handle file deletion
      break;
  }
}

// Update all components
function updateAllComponents() {
  // Dispatch custom events that components can listen to
  window.dispatchEvent(new CustomEvent('versions-updated', { 
    detail: { versions: state.versions, recent: state.recentVersions }
  }));
}

// Update status
function updateStatus(status) {
  window.dispatchEvent(new CustomEvent('status-changed', { detail: status }));
}

// Load initial data
async function loadTimeline() {
  try {
    const response = await fetch('/api/timeline');
    const data = await response.json();
    state.versions = data;
    updateAllComponents();
  } catch (error) {
    console.error('Failed to load timeline:', error);
  }
}

// Compare mode toggle
document.getElementById('compare-mode-btn').addEventListener('click', () => {
  state.compareMode = !state.compareMode;
  state.compareVersions = [null, null];
  
  const btn = document.getElementById('compare-mode-btn');
  btn.classList.toggle('active', state.compareMode);
  btn.textContent = state.compareMode ? 'Exit Compare' : 'Compare Mode';
  
  window.dispatchEvent(new CustomEvent('compare-mode-changed', { 
    detail: state.compareMode 
  }));
});

// Global event listeners
window.addEventListener('version-selected', (e) => {
  const version = e.detail;
  
  if (state.compareMode) {
    if (!state.compareVersions[0]) {
      state.compareVersions[0] = version;
    } else if (!state.compareVersions[1]) {
      state.compareVersions[1] = version;
    } else {
      state.compareVersions = [version, null];
    }
    
    window.dispatchEvent(new CustomEvent('compare-versions-changed', {
      detail: state.compareVersions
    }));
  } else {
    state.selectedVersion = version;
    window.dispatchEvent(new CustomEvent('selected-version-changed', {
      detail: version
    }));
  }
});

window.addEventListener('time-changed', (e) => {
  state.currentTime = e.detail;
  
  // Find closest version
  if (state.versions.length > 0) {
    const closest = state.versions.reduce((prev, curr) => {
      const prevDiff = Math.abs(new Date(prev.timestamp) - state.currentTime);
      const currDiff = Math.abs(new Date(curr.timestamp) - state.currentTime);
      return currDiff < prevDiff ? curr : prev;
    });
    
    state.selectedVersion = closest;
    window.dispatchEvent(new CustomEvent('selected-version-changed', {
      detail: closest
    }));
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadTimeline();
  connectWebSocket();
});

// Export for use in components
window.traversionState = state;