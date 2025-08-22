import { create } from 'zustand';

export const useVersionStore = create((set, get) => ({
  versions: [],
  recentVersions: [],
  timeline: [],
  ws: null,

  loadTimeline: async () => {
    try {
      const response = await fetch('/api/timeline');
      const data = await response.json();
      set({ 
        versions: data,
        timeline: data 
      });
    } catch (error) {
      console.error('Failed to load timeline:', error);
    }
  },

  loadRecent: async () => {
    try {
      const response = await fetch('/api/recent');
      const data = await response.json();
      set({ recentVersions: data });
    } catch (error) {
      console.error('Failed to load recent versions:', error);
    }
  },

  connectWebSocket: () => {
    const ws = new WebSocket('ws://localhost:3334');
    
    ws.onopen = () => {
      console.log('Connected to Traversion watcher');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'init':
          set({ 
            versions: message.data.timeline,
            recentVersions: message.data.recent,
            timeline: message.data.timeline
          });
          break;
          
        case 'version':
          set((state) => ({
            versions: [...state.versions, message.data],
            recentVersions: [message.data, ...state.recentVersions.slice(0, 49)],
            timeline: [...state.timeline, message.data]
          }));
          break;
          
        case 'delete':
          // Handle file deletion if needed
          break;
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Disconnected from Traversion watcher');
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        get().connectWebSocket();
      }, 3000);
    };

    set({ ws });
    return ws;
  },

  searchByVibe: async (vibe) => {
    try {
      const response = await fetch('/api/search-vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vibe })
      });
      const results = await response.json();
      
      // For now, just filter the current versions
      // In production, this would use AI
      const filtered = get().versions.filter(v => {
        const tags = JSON.parse(v.vibe_tags || '[]');
        const content = v.content.toLowerCase();
        const vibeWords = vibe.toLowerCase().split(' ');
        
        return vibeWords.some(word => 
          tags.some(tag => tag.includes(word)) ||
          content.includes(word)
        );
      });
      
      return filtered;
    } catch (error) {
      console.error('Failed to search by vibe:', error);
      return [];
    }
  },

  compareVersions: async (versionAId, versionBId) => {
    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionAId, versionBId })
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to compare versions:', error);
      return null;
    }
  }
}));