import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const VibeSearch = ({ onSearch }) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const vibeExamples = [
    'when it was fast',
    'purple and electric',
    'minimal and clean',
    'before the bug',
    'when it worked',
    'async vibes',
    'complex logic',
    'that perfect version'
  ];

  const handleSearch = () => {
    if (query.trim()) {
      onSearch(query);
      setQuery('');
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-purple-600 rounded-lg text-white hover:from-cyan-500 hover:to-purple-500 transition-all"
      >
        ✨ Vibe Search
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-12 right-0 w-80 bg-gray-900/95 backdrop-blur-xl rounded-lg border border-gray-800 shadow-2xl p-4 z-50"
          >
            <div className="mb-3">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Describe the vibe..."
                className="w-full px-3 py-2 bg-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                autoFocus
              />
            </div>

            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-2">Try searching for:</p>
              <div className="flex flex-wrap gap-2">
                {vibeExamples.map((example, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(example);
                      onSearch(example);
                      setIsOpen(false);
                    }}
                    className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400 hover:text-white transition-all"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleSearch}
              className="w-full py-2 bg-gradient-to-r from-cyan-600 to-purple-600 rounded-lg text-white hover:from-cyan-500 hover:to-purple-500 transition-all"
            >
              Search Vibes
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VibeSearch;