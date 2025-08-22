import { EventEmitter } from 'events';

export class WebRTCCollaborationClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.signalingUrl = options.signalingUrl || 'ws://localhost:3335';
    this.roomId = options.roomId || null;
    this.username = options.username || `User${Math.floor(Math.random() * 1000)}`;
    
    this.ws = null;
    this.peerId = null;
    this.color = null;
    this.peers = new Map(); // peerId -> RTCPeerConnection
    this.dataChannels = new Map(); // peerId -> RTCDataChannel
    this.remotePeers = new Map(); // peerId -> peer info
    
    this.iceServers = options.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
    
    this.isConnected = false;
    this.isScreenSharing = false;
    this.localStream = null;
  }
  
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.signalingUrl);
      
      this.ws.onopen = () => {
        console.log('Connected to WebRTC signaling server');
        this.isConnected = true;
        resolve();
      };
      
      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleSignalingMessage(message);
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
        reject(error);
      };
      
      this.ws.onclose = () => {
        console.log('Disconnected from signaling server');
        this.isConnected = false;
        this.emit('disconnected');
        this.cleanup();
      };
    });
  }
  
  async joinRoom(roomId, metadata = {}) {
    if (!this.isConnected) {
      throw new Error('Not connected to signaling server');
    }
    
    this.roomId = roomId;
    
    this.send({
      type: 'join-room',
      roomId: roomId,
      username: this.username,
      metadata: metadata
    });
  }
  
  leaveRoom() {
    if (this.roomId) {
      this.send({
        type: 'leave-room'
      });
      
      this.roomId = null;
      this.cleanup();
    }
  }
  
  handleSignalingMessage(message) {
    switch (message.type) {
      case 'connected':
        this.peerId = message.peerId;
        this.color = message.color;
        this.emit('connected', { peerId: this.peerId, color: this.color });
        break;
        
      case 'room-joined':
        this.handleRoomJoined(message);
        break;
        
      case 'peer-joined':
        this.handlePeerJoined(message);
        break;
        
      case 'peer-left':
        this.handlePeerLeft(message);
        break;
        
      case 'offer':
        this.handleOffer(message);
        break;
        
      case 'answer':
        this.handleAnswer(message);
        break;
        
      case 'ice-candidate':
        this.handleIceCandidate(message);
        break;
        
      case 'cursor-move':
        this.emit('cursor-move', message);
        break;
        
      case 'selection-change':
        this.emit('selection-change', message);
        break;
        
      case 'file-change':
        this.emit('file-change', message);
        break;
        
      case 'typing':
        this.emit('typing', message);
        break;
        
      case 'presence-update':
        this.emit('presence-update', message);
        break;
        
      case 'chat-message':
        this.emit('chat-message', message);
        break;
        
      case 'screen-share':
        this.emit('screen-share', message);
        break;
    }
  }
  
  async handleRoomJoined(message) {
    console.log(`Joined room ${message.roomId} with ${message.peers.length} peers`);
    
    // Store remote peer info
    for (const peer of message.peers) {
      this.remotePeers.set(peer.id, peer);
    }
    
    // Create peer connections for existing peers
    for (const peer of message.peers) {
      await this.createPeerConnection(peer.id, true);
    }
    
    this.emit('room-joined', {
      roomId: message.roomId,
      peers: message.peers
    });
  }
  
  async handlePeerJoined(message) {
    console.log(`Peer ${message.peer.username} joined`);
    
    this.remotePeers.set(message.peer.id, message.peer);
    
    // Wait for them to create offer
    // (They will initiate since they joined after us)
    
    this.emit('peer-joined', message.peer);
  }
  
  handlePeerLeft(message) {
    console.log(`Peer ${message.peerId} left`);
    
    this.closePeerConnection(message.peerId);
    this.remotePeers.delete(message.peerId);
    
    this.emit('peer-left', { peerId: message.peerId });
  }
  
  async createPeerConnection(peerId, createOffer = false) {
    if (this.peers.has(peerId)) {
      return this.peers.get(peerId);
    }
    
    console.log(`Creating peer connection with ${peerId}`);
    
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });
    
    this.peers.set(peerId, pc);
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          type: 'ice-candidate',
          targetPeerId: peerId,
          candidate: event.candidate
        });
      }
    };
    
    // Create data channel for low-latency communication
    const dataChannel = pc.createDataChannel('collaboration', {
      ordered: true,
      maxRetransmits: 3
    });
    
    dataChannel.onopen = () => {
      console.log(`Data channel opened with ${peerId}`);
      this.dataChannels.set(peerId, dataChannel);
      this.emit('peer-connected', { peerId });
    };
    
    dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(peerId, event.data);
    };
    
    dataChannel.onclose = () => {
      console.log(`Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
    };
    
    // Handle incoming data channels
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      
      channel.onopen = () => {
        console.log(`Received data channel from ${peerId}`);
        this.dataChannels.set(peerId, channel);
      };
      
      channel.onmessage = (event) => {
        this.handleDataChannelMessage(peerId, event.data);
      };
    };
    
    // Add local stream if available (for screen sharing)
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }
    
    // Handle remote stream
    pc.ontrack = (event) => {
      this.emit('remote-stream', {
        peerId: peerId,
        stream: event.streams[0]
      });
    };
    
    // Create offer if we're the initiator
    if (createOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      this.send({
        type: 'offer',
        targetPeerId: peerId,
        offer: offer
      });
    }
    
    return pc;
  }
  
  async handleOffer(message) {
    const { fromPeerId, offer } = message;
    
    const pc = await this.createPeerConnection(fromPeerId, false);
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    this.send({
      type: 'answer',
      targetPeerId: fromPeerId,
      answer: answer
    });
  }
  
  async handleAnswer(message) {
    const { fromPeerId, answer } = message;
    
    const pc = this.peers.get(fromPeerId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }
  
  async handleIceCandidate(message) {
    const { fromPeerId, candidate } = message;
    
    const pc = this.peers.get(fromPeerId);
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
  
  handleDataChannelMessage(peerId, data) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'cursor':
          this.emit('peer-cursor', {
            peerId: peerId,
            ...message.data
          });
          break;
          
        case 'selection':
          this.emit('peer-selection', {
            peerId: peerId,
            ...message.data
          });
          break;
          
        case 'edit':
          this.emit('peer-edit', {
            peerId: peerId,
            ...message.data
          });
          break;
          
        case 'sync':
          this.emit('peer-sync', {
            peerId: peerId,
            ...message.data
          });
          break;
      }
    } catch (error) {
      console.error('Error handling data channel message:', error);
    }
  }
  
  closePeerConnection(peerId) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }
    
    const dc = this.dataChannels.get(peerId);
    if (dc) {
      dc.close();
      this.dataChannels.delete(peerId);
    }
  }
  
  // Send methods for collaboration features
  
  sendCursorPosition(x, y, file) {
    this.send({
      type: 'cursor-move',
      x: x,
      y: y,
      file: file
    });
    
    // Also send via data channel for low latency
    this.broadcastToDataChannels({
      type: 'cursor',
      data: { x, y, file }
    });
  }
  
  sendSelection(selection, file) {
    this.send({
      type: 'selection-change',
      selection: selection,
      file: file
    });
    
    this.broadcastToDataChannels({
      type: 'selection',
      data: { selection, file }
    });
  }
  
  sendFileChange(file, content, version, operation) {
    this.send({
      type: 'file-change',
      file: file,
      content: content,
      version: version,
      operation: operation
    });
  }
  
  sendTypingIndicator(isTyping, file, position) {
    this.send({
      type: 'typing',
      isTyping: isTyping,
      file: file,
      position: position
    });
  }
  
  sendPresenceUpdate(status, activeFile) {
    this.send({
      type: 'presence-update',
      status: status,
      activeFile: activeFile
    });
  }
  
  sendChatMessage(text) {
    this.send({
      type: 'chat-message',
      text: text,
      timestamp: Date.now()
    });
  }
  
  async startScreenShare() {
    try {
      this.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      
      // Add tracks to all peer connections
      for (const [peerId, pc] of this.peers) {
        this.localStream.getTracks().forEach(track => {
          pc.addTrack(track, this.localStream);
        });
      }
      
      this.isScreenSharing = true;
      
      this.send({
        type: 'screen-share',
        isSharing: true,
        streamId: this.localStream.id
      });
      
      // Handle stream end
      this.localStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };
      
      this.emit('screen-share-started', this.localStream);
      
    } catch (error) {
      console.error('Error starting screen share:', error);
      throw error;
    }
  }
  
  stopScreenShare() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    this.isScreenSharing = false;
    
    this.send({
      type: 'screen-share',
      isSharing: false
    });
    
    this.emit('screen-share-stopped');
  }
  
  broadcastToDataChannels(message) {
    const data = JSON.stringify(message);
    
    for (const [peerId, channel] of this.dataChannels) {
      if (channel.readyState === 'open') {
        channel.send(data);
      }
    }
  }
  
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  cleanup() {
    // Close all peer connections
    for (const [peerId, pc] of this.peers) {
      pc.close();
    }
    this.peers.clear();
    
    // Close all data channels
    for (const [peerId, dc] of this.dataChannels) {
      dc.close();
    }
    this.dataChannels.clear();
    
    // Clear remote peers
    this.remotePeers.clear();
    
    // Stop screen share if active
    if (this.isScreenSharing) {
      this.stopScreenShare();
    }
  }
  
  disconnect() {
    if (this.ws) {
      this.cleanup();
      this.ws.close();
      this.ws = null;
    }
  }
}

export default WebRTCCollaborationClient;