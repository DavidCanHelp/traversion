class VibeSearch extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isOpen = false;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: relative;
        }
        
        .search-button {
          padding: 0.5rem 1rem;
          background: linear-gradient(135deg, var(--accent-cyan, #00ffcc), var(--accent-purple, #ff00ff));
          color: white;
          border: none;
          border-radius: 0.5rem;
          font-family: inherit;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .search-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 255, 204, 0.3);
        }
        
        .search-dropdown {
          position: absolute;
          top: calc(100% + 0.5rem);
          right: 0;
          width: 320px;
          background: var(--bg-secondary, #1a1a1a);
          border: 1px solid var(--border-color, #333);
          border-radius: 0.5rem;
          padding: 1rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          display: none;
          z-index: 1000;
        }
        
        .search-dropdown.open {
          display: block;
          animation: slideDown 0.2s ease-out;
        }
        
        .search-input {
          width: 100%;
          padding: 0.5rem;
          background: var(--bg-tertiary, #2a2a2a);
          border: 1px solid var(--border-color, #333);
          border-radius: 0.25rem;
          color: var(--text-primary, #fff);
          font-family: inherit;
          font-size: 0.875rem;
          margin-bottom: 0.75rem;
        }
        
        .search-input:focus {
          outline: none;
          border-color: var(--accent-cyan, #00ffcc);
        }
        
        .suggestions-label {
          font-size: 0.75rem;
          color: var(--text-secondary, #a0a0a0);
          margin-bottom: 0.5rem;
        }
        
        .suggestions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }
        
        .suggestion {
          padding: 0.25rem 0.5rem;
          background: var(--bg-tertiary, #2a2a2a);
          border: 1px solid var(--border-color, #333);
          border-radius: 0.25rem;
          color: var(--text-secondary, #a0a0a0);
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .suggestion:hover {
          background: var(--accent-cyan, #00ffcc);
          color: var(--bg-primary, #0a0a0a);
        }
        
        .search-action {
          width: 100%;
          padding: 0.5rem;
          background: linear-gradient(135deg, var(--accent-cyan, #00ffcc), var(--accent-purple, #ff00ff));
          color: white;
          border: none;
          border-radius: 0.25rem;
          font-family: inherit;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .search-action:hover {
          transform: translateY(-1px);
        }
        
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      </style>
      
      <button class="search-button" id="search-btn">
        ✨ Vibe Search
      </button>
      
      <div class="search-dropdown" id="dropdown">
        <input 
          type="text" 
          class="search-input" 
          id="search-input"
          placeholder="Describe the vibe..."
        />
        
        <div class="suggestions-label">Try searching for:</div>
        <div class="suggestions">
          <span class="suggestion">when it was fast</span>
          <span class="suggestion">minimal and clean</span>
          <span class="suggestion">before the bug</span>
          <span class="suggestion">async vibes</span>
          <span class="suggestion">that perfect version</span>
        </div>
        
        <button class="search-action" id="search-action">
          Search Vibes
        </button>
      </div>
    `;
  }

  setupEventListeners() {
    const btn = this.shadowRoot.getElementById('search-btn');
    const dropdown = this.shadowRoot.getElementById('dropdown');
    const input = this.shadowRoot.getElementById('search-input');
    const action = this.shadowRoot.getElementById('search-action');
    const suggestions = this.shadowRoot.querySelectorAll('.suggestion');
    
    btn.addEventListener('click', () => {
      this.isOpen = !this.isOpen;
      dropdown.classList.toggle('open', this.isOpen);
      if (this.isOpen) {
        input.focus();
      }
    });
    
    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!this.contains(e.target)) {
        this.isOpen = false;
        dropdown.classList.remove('open');
      }
    });
    
    // Search action
    action.addEventListener('click', () => this.performSearch());
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });
    
    // Suggestion clicks
    suggestions.forEach(suggestion => {
      suggestion.addEventListener('click', () => {
        input.value = suggestion.textContent;
        this.performSearch();
      });
    });
  }

  async performSearch() {
    const input = this.shadowRoot.getElementById('search-input');
    const query = input.value.trim();
    
    if (!query) return;
    
    try {
      const response = await fetch('/api/search-vibe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vibe: query })
      });
      
      const results = await response.json();
      
      // Dispatch event with results
      window.dispatchEvent(new CustomEvent('vibe-search-results', { 
        detail: { query, results }
      }));
      
      // Close dropdown
      this.isOpen = false;
      this.shadowRoot.getElementById('dropdown').classList.remove('open');
      input.value = '';
      
    } catch (error) {
      console.error('Search failed:', error);
    }
  }
}

customElements.define('vibe-search', VibeSearch);