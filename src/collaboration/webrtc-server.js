import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import logger from '../utils/logger.js';

export class WebRTCSignalingServer extends EventEmitter {
  constructor(port = 3335) {
    super();
    this.port = port;
    this.rooms = new Map(); // roomId -> Set of peers
    this.peers = new Map(); // peerId -> peer info
    this.wss = null;
  }
  
  start() {
    this.wss = new WebSocketServer({ port: this.port });
    
    this.wss.on('connection', (ws, req) => {
      const peerId = this.generatePeerId();
      
      const peer = {
        id: peerId,
        ws: ws,
        room: null,
        username: null,
        color: this.generateColor(),
        cursor: { x: 0, y: 0, file: null },
        selection: null,
        activeFile: null,
        status: 'online',
        joinedAt: Date.now()
      };
      
      this.peers.set(peerId, peer);
      
      // Send peer their ID and initial info
      ws.send(JSON.stringify({
        type: 'connected',
        peerId: peerId,
        color: peer.color
      }));
      
      logger.info('Peer connected to WebRTC signaling', { peerId });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(peerId, message);
        } catch (error) {
          logger.error('Invalid WebRTC message', { error: error.message, peerId });
        }
      });
      
      ws.on('close', () => {
        this.handleDisconnect(peerId);
      });
      
      ws.on('error', (error) => {
        logger.error('WebRTC WebSocket error', { error: error.message, peerId });
      });
    });
    
    logger.info('WebRTC signaling server started', { port: this.port });
    console.log(`🎥 WebRTC signaling server running on port ${this.port}`);
  }
  
  handleMessage(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    
    switch (message.type) {
      case 'join-room':
        this.handleJoinRoom(peerId, message);
        break;
        
      case 'leave-room':
        this.handleLeaveRoom(peerId);
        break;
        
      case 'offer':
        this.handleOffer(peerId, message);
        break;
        
      case 'answer':
        this.handleAnswer(peerId, message);
        break;
        
      case 'ice-candidate':
        this.handleIceCandidate(peerId, message);
        break;
        
      case 'cursor-move':
        this.handleCursorMove(peerId, message);
        break;
        
      case 'selection-change':
        this.handleSelectionChange(peerId, message);
        break;
        
      case 'file-change':
        this.handleFileChange(peerId, message);
        break;
        
      case 'typing':
        this.handleTyping(peerId, message);
        break;
        
      case 'presence-update':
        this.handlePresenceUpdate(peerId, message);
        break;
        
      case 'chat-message':
        this.handleChatMessage(peerId, message);
        break;
        
      case 'screen-share':
        this.handleScreenShare(peerId, message);
        break;
        
      default:
        logger.warn('Unknown WebRTC message type', { type: message.type, peerId });
    }
  }
  
  handleJoinRoom(peerId, message) {
    const { roomId, username, metadata } = message;
    const peer = this.peers.get(peerId);
    
    if (!peer) return;
    
    // Leave previous room if any
    if (peer.room) {
      this.handleLeaveRoom(peerId);
    }
    
    // Create room if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
      logger.info('Created collaboration room', { roomId });
    }
    
    // Add peer to room
    const room = this.rooms.get(roomId);
    room.add(peerId);
    
    // Update peer info
    peer.room = roomId;
    peer.username = username || `User ${peerId.slice(0, 6)}`;
    if (metadata) {
      peer.metadata = metadata;
    }
    
    // Notify peer of existing room members
    const existingPeers = [];
    for (const otherId of room) {
      if (otherId !== peerId) {
        const otherPeer = this.peers.get(otherId);
        if (otherPeer) {
          existingPeers.push({
            id: otherId,
            username: otherPeer.username,
            color: otherPeer.color,
            cursor: otherPeer.cursor,
            selection: otherPeer.selection,
            activeFile: otherPeer.activeFile,
            status: otherPeer.status
          });
        }
      }
    }
    
    peer.ws.send(JSON.stringify({
      type: 'room-joined',
      roomId: roomId,
      peers: existingPeers
    }));
    
    // Notify other peers in room
    this.broadcastToRoom(roomId, {
      type: 'peer-joined',
      peer: {
        id: peerId,
        username: peer.username,
        color: peer.color,
        status: peer.status
      }
    }, peerId);
    
    logger.info('Peer joined room', { peerId, roomId, username: peer.username });
  }
  
  handleLeaveRoom(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.room) return;
    
    const roomId = peer.room;
    const room = this.rooms.get(roomId);
    
    if (room) {
      room.delete(peerId);
      
      // Delete room if empty
      if (room.size === 0) {
        this.rooms.delete(roomId);
        logger.info('Deleted empty room', { roomId });
      } else {
        // Notify other peers
        this.broadcastToRoom(roomId, {
          type: 'peer-left',
          peerId: peerId
        }, peerId);
      }
    }
    
    peer.room = null;
    logger.info('Peer left room', { peerId, roomId });
  }
  
  handleOffer(peerId, message) {
    const { targetPeerId, offer } = message;
    const targetPeer = this.peers.get(targetPeerId);
    
    if (targetPeer && targetPeer.ws.readyState === 1) {
      targetPeer.ws.send(JSON.stringify({
        type: 'offer',
        fromPeerId: peerId,
        offer: offer
      }));
      
      logger.debug('Relayed offer', { from: peerId, to: targetPeerId });
    }
  }
  
  handleAnswer(peerId, message) {
    const { targetPeerId, answer } = message;
    const targetPeer = this.peers.get(targetPeerId);
    
    if (targetPeer && targetPeer.ws.readyState === 1) {
      targetPeer.ws.send(JSON.stringify({
        type: 'answer',
        fromPeerId: peerId,
        answer: answer
      }));
      
      logger.debug('Relayed answer', { from: peerId, to: targetPeerId });
    }
  }
  
  handleIceCandidate(peerId, message) {
    const { targetPeerId, candidate } = message;
    const targetPeer = this.peers.get(targetPeerId);
    
    if (targetPeer && targetPeer.ws.readyState === 1) {
      targetPeer.ws.send(JSON.stringify({
        type: 'ice-candidate',
        fromPeerId: peerId,
        candidate: candidate
      }));
      
      logger.debug('Relayed ICE candidate', { from: peerId, to: targetPeerId });
    }
  }
  
  handleCursorMove(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.room) return;
    
    const { x, y, file } = message;
    peer.cursor = { x, y, file };
    
    // Broadcast to room
    this.broadcastToRoom(peer.room, {
      type: 'cursor-move',
      peerId: peerId,
      cursor: peer.cursor
    }, peerId);
  }
  
  handleSelectionChange(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.room) return;
    
    const { selection, file } = message;
    peer.selection = selection;
    peer.activeFile = file;
    
    // Broadcast to room
    this.broadcastToRoom(peer.room, {
      type: 'selection-change',
      peerId: peerId,
      selection: selection,
      file: file
    }, peerId);
  }
  
  handleFileChange(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.room) return;
    
    const { file, content, version, operation } = message;
    
    // Broadcast to room for real-time sync
    this.broadcastToRoom(peer.room, {
      type: 'file-change',
      peerId: peerId,
      file: file,
      content: content,
      version: version,
      operation: operation,
      timestamp: Date.now()
    }, peerId);
    
    logger.debug('File change broadcast', { peerId, file, operation });
  }
  
  handleTyping(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.room) return;
    
    const { isTyping, file, position } = message;
    
    // Broadcast typing indicator
    this.broadcastToRoom(peer.room, {
      type: 'typing',
      peerId: peerId,
      username: peer.username,
      isTyping: isTyping,
      file: file,
      position: position
    }, peerId);
  }
  
  handlePresenceUpdate(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    
    const { status, activeFile } = message;
    peer.status = status || peer.status;
    peer.activeFile = activeFile || peer.activeFile;
    
    if (peer.room) {
      this.broadcastToRoom(peer.room, {
        type: 'presence-update',
        peerId: peerId,
        status: peer.status,
        activeFile: peer.activeFile
      }, peerId);
    }
  }
  
  handleChatMessage(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.room) return;
    
    const { text, timestamp } = message;
    
    // Broadcast chat message
    this.broadcastToRoom(peer.room, {
      type: 'chat-message',
      peerId: peerId,
      username: peer.username,
      color: peer.color,
      text: text,
      timestamp: timestamp || Date.now()
    }, peerId);
  }
  
  handleScreenShare(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.room) return;
    
    const { isSharing, streamId } = message;
    
    // Broadcast screen share status
    this.broadcastToRoom(peer.room, {
      type: 'screen-share',
      peerId: peerId,
      username: peer.username,
      isSharing: isSharing,
      streamId: streamId
    }, peerId);
  }
  
  handleDisconnect(peerId) {
    const peer = this.peers.get(peerId);
    
    if (peer) {
      if (peer.room) {
        this.handleLeaveRoom(peerId);
      }
      
      this.peers.delete(peerId);
      logger.info('Peer disconnected', { peerId });
    }
  }
  
  broadcastToRoom(roomId, message, excludePeerId = null) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    const messageStr = JSON.stringify(message);
    
    for (const peerId of room) {
      if (peerId === excludePeerId) continue;
      
      const peer = this.peers.get(peerId);
      if (peer && peer.ws.readyState === 1) {
        peer.ws.send(messageStr);
      }
    }
  }
  
  generatePeerId() {
    return crypto.randomBytes(16).toString('hex');
  }
  
  generateColor() {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FECA57', '#FF9FF3', '#54A0FF', '#48DBFB',
      '#FF6B9D', '#C44569', '#FFC93C', '#6C5CE7'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
  
  getRoomInfo(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    const peers = [];
    for (const peerId of room) {
      const peer = this.peers.get(peerId);
      if (peer) {
        peers.push({
          id: peerId,
          username: peer.username,
          color: peer.color,
          status: peer.status,
          activeFile: peer.activeFile,
          joinedAt: peer.joinedAt
        });
      }
    }
    
    return {
      roomId: roomId,
      peerCount: room.size,
      peers: peers
    };
  }
  
  getAllRooms() {
    const rooms = [];
    
    for (const [roomId, peerSet] of this.rooms) {
      rooms.push({
        roomId: roomId,
        peerCount: peerSet.size
      });
    }
    
    return rooms;
  }
  
  stop() {
    if (this.wss) {
      // Notify all peers
      for (const [peerId, peer] of this.peers) {
        if (peer.ws.readyState === 1) {
          peer.ws.send(JSON.stringify({
            type: 'server-closing'
          }));
        }
      }
      
      this.wss.close();
      this.peers.clear();
      this.rooms.clear();
      
      logger.info('WebRTC signaling server stopped');
    }
  }
}

export default WebRTCSignalingServer;