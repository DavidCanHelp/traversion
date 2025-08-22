import WebRTCCollaborationClient from '../../src/collaboration/webrtc-client.js';

class CollaborationPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.client = null;
    this.roomId = null;
    this.peers = new Map();
    this.cursors = new Map();
    this.isCollaborating = false;
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
          position: fixed;
          top: 60px;
          right: 20px;
          width: 320px;
          max-height: 600px;
          background: var(--bg-secondary, #1a1a1a);
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          z-index: 1000;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        
        :host(.collapsed) {
          width: 60px;
          height: 60px;
        }
        
        .panel-header {
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .panel-title {
          font-size: 0.9rem;
          font-weight: bold;
          color: var(--text-primary, #fff);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #888;
          animation: pulse 2s infinite;
        }
        
        .status-indicator.connected {
          background: #10b981;
        }
        
        .status-indicator.connecting {
          background: #f59e0b;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        .panel-controls {
          display: flex;
          gap: 0.5rem;
        }
        
        .control-btn {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--text-secondary, #a0a0a0);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .control-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary, #fff);
        }
        
        .control-btn.active {
          background: var(--accent-cyan, #00ffcc);
          color: #000;
        }
        
        .panel-content {
          padding: 1rem;
          max-height: 500px;
          overflow-y: auto;
        }
        
        .room-section {
          margin-bottom: 1.5rem;
        }
        
        .room-input-group {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        
        .room-input {
          flex: 1;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: var(--text-primary, #fff);
          font-size: 0.85rem;
        }
        
        .room-input::placeholder {
          color: var(--text-secondary, #666);
        }
        
        .join-btn {
          padding: 0.5rem 1rem;
          background: var(--accent-cyan, #00ffcc);
          color: #000;
          border: none;
          border-radius: 6px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .join-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 255, 204, 0.3);
        }
        
        .join-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .room-info {
          padding: 0.75rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
          margin-bottom: 1rem;
        }
        
        .room-id {
          font-size: 0.75rem;
          color: var(--text-secondary, #a0a0a0);
          margin-bottom: 0.25rem;
        }
        
        .room-name {
          font-size: 0.9rem;
          font-weight: bold;
          color: var(--text-primary, #fff);
        }
        
        .peers-section {
          margin-bottom: 1.5rem;
        }
        
        .section-title {
          font-size: 0.8rem;
          text-transform: uppercase;
          color: var(--text-secondary, #a0a0a0);
          margin-bottom: 0.75rem;
          letter-spacing: 0.05em;
        }
        
        .peers-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        
        .peer-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          transition: all 0.2s;
        }
        
        .peer-item:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        
        .peer-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 0.8rem;
          color: #000;
        }
        
        .peer-info {
          flex: 1;
        }
        
        .peer-name {
          font-size: 0.85rem;
          color: var(--text-primary, #fff);
        }
        
        .peer-status {
          font-size: 0.7rem;
          color: var(--text-secondary, #a0a0a0);
        }
        
        .peer-indicators {
          display: flex;
          gap: 0.25rem;
        }
        
        .indicator {
          width: 20px;
          height: 20px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.65rem;
        }
        
        .indicator.active {
          background: var(--accent-cyan, #00ffcc);
          color: #000;
        }
        
        .chat-section {
          margin-bottom: 1rem;
        }
        
        .chat-messages {
          height: 150px;
          overflow-y: auto;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 6px;
          padding: 0.5rem;
          margin-bottom: 0.5rem;
        }
        
        .chat-message {
          margin-bottom: 0.5rem;
          font-size: 0.8rem;
        }
        
        .chat-author {
          font-weight: bold;
          margin-right: 0.25rem;
        }
        
        .chat-text {
          color: var(--text-secondary, #a0a0a0);
        }
        
        .chat-input-group {
          display: flex;
          gap: 0.5rem;
        }
        
        .chat-input {
          flex: 1;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: var(--text-primary, #fff);
          font-size: 0.8rem;
        }
        
        .send-btn {
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          border-radius: 6px;
          color: var(--text-primary, #fff);
          cursor: pointer;
        }
        
        .send-btn:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        
        .features-section {
          display: flex;
          gap: 0.5rem;
          margin-top: 1rem;
        }
        
        .feature-btn {
          flex: 1;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: var(--text-secondary, #a0a0a0);
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
          text-align: center;
        }
        
        .feature-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary, #fff);
        }
        
        .feature-btn.active {
          background: var(--accent-cyan, #00ffcc);
          color: #000;
        }
        
        /* Remote cursors overlay */
        .cursors-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 999;
        }
        
        .remote-cursor {
          position: absolute;
          width: 20px;
          height: 20px;
          transition: all 0.1s ease-out;
        }
        
        .cursor-pointer {
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 10px solid;
          transform: rotate(45deg);
          transform-origin: center;
        }
        
        .cursor-label {
          position: absolute;
          top: 12px;
          left: 12px;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.65rem;
          font-weight: bold;
          white-space: nowrap;
          color: #000;
        }
      </style>
      
      <div class="panel-header">
        <div class="panel-title">
          <span class="status-indicator"></span>
          <span>Collaboration</span>
        </div>
        <div class="panel-controls">
          <button class="control-btn" id="screen-share-btn" title="Share Screen">📺</button>
          <button class="control-btn" id="minimize-btn" title="Minimize">−</button>
        </div>
      </div>
      
      <div class="panel-content">
        <div class="room-section">
          <div class="room-input-group" id="join-room-group">
            <input type="text" class="room-input" id="room-input" placeholder="Enter room ID" />
            <button class="join-btn" id="join-btn">Join</button>
          </div>
          <div class="room-info" id="room-info" style="display: none;">
            <div class="room-id">Room ID</div>
            <div class="room-name" id="room-name"></div>
          </div>
        </div>
        
        <div class="peers-section" id="peers-section" style="display: none;">
          <div class="section-title">Collaborators</div>
          <div class="peers-list" id="peers-list"></div>
        </div>
        
        <div class="chat-section" id="chat-section" style="display: none;">
          <div class="section-title">Chat</div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-group">
            <input type="text" class="chat-input" id="chat-input" placeholder="Type a message..." />
            <button class="send-btn" id="send-btn">→</button>
          </div>
        </div>
        
        <div class="features-section" id="features-section" style="display: none;">
          <button class="feature-btn" id="cursor-tracking-btn">Cursor Tracking</button>
          <button class="feature-btn" id="selection-sync-btn">Selection Sync</button>
          <button class="feature-btn" id="live-edit-btn">Live Edit</button>
        </div>
      </div>
      
      <div class="cursors-overlay" id="cursors-overlay"></div>
    `;
  }
  
  setupEventListeners() {
    const joinBtn = this.shadowRoot.getElementById('join-btn');
    const roomInput = this.shadowRoot.getElementById('room-input');
    const chatInput = this.shadowRoot.getElementById('chat-input');
    const sendBtn = this.shadowRoot.getElementById('send-btn');
    const screenShareBtn = this.shadowRoot.getElementById('screen-share-btn');
    const minimizeBtn = this.shadowRoot.getElementById('minimize-btn');
    
    joinBtn.addEventListener('click', () => this.joinRoom());
    roomInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.joinRoom();
    });
    
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });
    sendBtn.addEventListener('click', () => this.sendChatMessage());
    
    screenShareBtn.addEventListener('click', () => this.toggleScreenShare());
    minimizeBtn.addEventListener('click', () => this.toggleMinimize());
    
    // Feature toggles
    this.shadowRoot.getElementById('cursor-tracking-btn').addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      this.toggleCursorTracking();
    });
    
    this.shadowRoot.getElementById('selection-sync-btn').addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      this.toggleSelectionSync();
    });
    
    this.shadowRoot.getElementById('live-edit-btn').addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      this.toggleLiveEdit();
    });
    
    // Track local cursor
    if (this.cursorTrackingEnabled) {
      document.addEventListener('mousemove', (e) => {
        if (this.client && this.isCollaborating) {
          this.client.sendCursorPosition(e.clientX, e.clientY, window.location.pathname);
        }
      });
    }
  }
  
  async joinRoom() {
    const roomInput = this.shadowRoot.getElementById('room-input');
    const roomId = roomInput.value.trim() || `room-${Math.random().toString(36).substr(2, 9)}`;
    
    if (!roomId) return;
    
    try {
      // Initialize WebRTC client
      this.client = new WebRTCCollaborationClient({
        signalingUrl: 'ws://localhost:3335',
        username: `User${Math.floor(Math.random() * 1000)}`
      });
      
      // Setup event listeners
      this.setupClientListeners();
      
      // Connect and join room
      await this.client.connect();
      await this.client.joinRoom(roomId);
      
      this.roomId = roomId;
      this.isCollaborating = true;
      
      // Update UI
      this.updateUIForCollaboration();
      
    } catch (error) {
      console.error('Failed to join room:', error);
      alert('Failed to join collaboration room');
    }
  }
  
  setupClientListeners() {
    this.client.on('room-joined', (data) => {
      console.log('Joined room with peers:', data.peers);
      
      // Add existing peers to UI
      data.peers.forEach(peer => {
        this.addPeer(peer);
      });
    });
    
    this.client.on('peer-joined', (peer) => {
      console.log('New peer joined:', peer);
      this.addPeer(peer);
      this.showNotification(`${peer.username} joined`);
    });
    
    this.client.on('peer-left', (data) => {
      console.log('Peer left:', data.peerId);
      this.removePeer(data.peerId);
    });
    
    this.client.on('cursor-move', (data) => {
      this.updateRemoteCursor(data.peerId, data.cursor);
    });
    
    this.client.on('selection-change', (data) => {
      this.updateRemoteSelection(data.peerId, data.selection, data.file);
    });
    
    this.client.on('chat-message', (data) => {
      this.addChatMessage(data.username, data.text, data.color);
    });
    
    this.client.on('screen-share', (data) => {
      if (data.isSharing) {
        this.showNotification(`${data.username} is sharing their screen`);
      }
    });
    
    this.client.on('remote-stream', (data) => {
      this.handleRemoteStream(data.peerId, data.stream);
    });
  }
  
  updateUIForCollaboration() {
    // Hide join UI
    this.shadowRoot.getElementById('join-room-group').style.display = 'none';
    
    // Show room info
    const roomInfo = this.shadowRoot.getElementById('room-info');
    roomInfo.style.display = 'block';
    this.shadowRoot.getElementById('room-name').textContent = this.roomId;
    
    // Show collaboration sections
    this.shadowRoot.getElementById('peers-section').style.display = 'block';
    this.shadowRoot.getElementById('chat-section').style.display = 'block';
    this.shadowRoot.getElementById('features-section').style.display = 'block';
    
    // Update status
    const indicator = this.shadowRoot.querySelector('.status-indicator');
    indicator.classList.add('connected');
  }
  
  addPeer(peer) {
    this.peers.set(peer.id, peer);
    
    const peersList = this.shadowRoot.getElementById('peers-list');
    
    const peerItem = document.createElement('div');
    peerItem.className = 'peer-item';
    peerItem.id = `peer-${peer.id}`;
    peerItem.innerHTML = `
      <div class="peer-avatar" style="background: ${peer.color}">
        ${peer.username.charAt(0).toUpperCase()}
      </div>
      <div class="peer-info">
        <div class="peer-name">${peer.username}</div>
        <div class="peer-status">${peer.status || 'online'}</div>
      </div>
      <div class="peer-indicators">
        <span class="indicator" title="Cursor">👆</span>
        <span class="indicator" title="Typing">⌨️</span>
      </div>
    `;
    
    peersList.appendChild(peerItem);
  }
  
  removePeer(peerId) {
    this.peers.delete(peerId);
    
    const peerItem = this.shadowRoot.getElementById(`peer-${peerId}`);
    if (peerItem) {
      peerItem.remove();
    }
    
    // Remove cursor
    this.removeRemoteCursor(peerId);
  }
  
  updateRemoteCursor(peerId, cursor) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    
    let cursorEl = document.getElementById(`cursor-${peerId}`);
    
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.id = `cursor-${peerId}`;
      cursorEl.className = 'remote-cursor';
      cursorEl.innerHTML = `
        <div class="cursor-pointer" style="border-top-color: ${peer.color}"></div>
        <div class="cursor-label" style="background: ${peer.color}">${peer.username}</div>
      `;
      document.body.appendChild(cursorEl);
    }
    
    cursorEl.style.left = `${cursor.x}px`;
    cursorEl.style.top = `${cursor.y}px`;
  }
  
  removeRemoteCursor(peerId) {
    const cursorEl = document.getElementById(`cursor-${peerId}`);
    if (cursorEl) {
      cursorEl.remove();
    }
  }
  
  updateRemoteSelection(peerId, selection, file) {
    // This would highlight text selections in the editor
    console.log(`Peer ${peerId} selected text in ${file}:`, selection);
  }
  
  sendChatMessage() {
    const chatInput = this.shadowRoot.getElementById('chat-input');
    const text = chatInput.value.trim();
    
    if (text && this.client) {
      this.client.sendChatMessage(text);
      this.addChatMessage('You', text, this.client.color);
      chatInput.value = '';
    }
  }
  
  addChatMessage(username, text, color) {
    const chatMessages = this.shadowRoot.getElementById('chat-messages');
    
    const message = document.createElement('div');
    message.className = 'chat-message';
    message.innerHTML = `
      <span class="chat-author" style="color: ${color}">${username}:</span>
      <span class="chat-text">${text}</span>
    `;
    
    chatMessages.appendChild(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  
  async toggleScreenShare() {
    const btn = this.shadowRoot.getElementById('screen-share-btn');
    
    if (this.client && this.client.isScreenSharing) {
      this.client.stopScreenShare();
      btn.classList.remove('active');
    } else if (this.client) {
      try {
        await this.client.startScreenShare();
        btn.classList.add('active');
      } catch (error) {
        console.error('Failed to share screen:', error);
      }
    }
  }
  
  handleRemoteStream(peerId, stream) {
    // Create video element for remote screen share
    const video = document.createElement('video');
    video.id = `stream-${peerId}`;
    video.srcObject = stream;
    video.autoplay = true;
    video.style.position = 'fixed';
    video.style.bottom = '10px';
    video.style.right = '10px';
    video.style.width = '300px';
    video.style.borderRadius = '8px';
    video.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    video.style.zIndex = '998';
    
    document.body.appendChild(video);
    
    stream.onended = () => {
      video.remove();
    };
  }
  
  toggleMinimize() {
    this.classList.toggle('collapsed');
  }
  
  toggleCursorTracking() {
    this.cursorTrackingEnabled = !this.cursorTrackingEnabled;
  }
  
  toggleSelectionSync() {
    this.selectionSyncEnabled = !this.selectionSyncEnabled;
  }
  
  toggleLiveEdit() {
    this.liveEditEnabled = !this.liveEditEnabled;
  }
  
  showNotification(message) {
    // Could integrate with browser notifications or show in-app toast
    console.log('Notification:', message);
  }
  
  disconnectedCallback() {
    if (this.client) {
      this.client.disconnect();
    }
  }
}

customElements.define('collaboration-panel', CollaborationPanel);