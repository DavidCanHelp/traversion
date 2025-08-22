import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';

const RecentActivity = ({ versions = [], onSelect, selectedVersion }) => {
  const getFileIcon = (filePath) => {
    const ext = filePath.split('.').pop();
    const iconMap = {
      js: '📜',
      jsx: '⚛️',
      ts: '💙',
      tsx: '⚛️',
      py: '🐍',
      go: '🐹',
      rs: '🦀',
      css: '🎨',
      html: '🌐',
      json: '📋',
      md: '📝'
    };
    return iconMap[ext] || '📄';
  };

  const getVibeColor = (tags) => {
    const tagList = JSON.parse(tags || '[]');
    if (tagList.includes('vibing')) return 'from-purple-600 to-pink-600';
    if (tagList.includes('debug')) return 'from-red-600 to-orange-600';
    if (tagList.includes('async')) return 'from-blue-600 to-cyan-600';
    if (tagList.includes('complex')) return 'from-yellow-600 to-amber-600';
    return 'from-gray-600 to-gray-700';
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-gray-300">Recent Activity</h2>
        <p className="text-xs text-gray-500 mt-1">Your latest code iterations</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <AnimatePresence>
          {versions.map((version, index) => {
            const isSelected = selectedVersion?.id === version.id;
            const fileName = version.file_path.split('/').pop();
            const vibeTags = JSON.parse(version.vibe_tags || '[]');
            
            return (
              <motion.div
                key={version.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => onSelect(version)}
                className={`
                  mb-2 p-3 rounded-lg cursor-pointer transition-all
                  ${isSelected 
                    ? 'bg-gradient-to-r from-cyan-900/50 to-purple-900/50 border border-cyan-600/50' 
                    : 'bg-gray-800/30 hover:bg-gray-800/50 border border-transparent'
                  }
                `}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">{getFileIcon(version.file_path)}</span>
                    <div>
                      <div className="text-sm text-white font-medium">
                        {fileName}
                      </div>
                      <div className="text-xs text-gray-500">
                        v{version.id} • {formatDistanceToNow(new Date(version.timestamp), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Vibe indicator bar */}
                <div className={`h-0.5 bg-gradient-to-r ${getVibeColor(version.vibe_tags)} rounded-full mb-2`} />

                {/* Tags */}
                {vibeTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {vibeTags.slice(0, 3).map((tag, i) => (
                      <span 
                        key={i}
                        className="px-1.5 py-0.5 bg-gray-700/50 rounded text-xs text-gray-400"
                      >
                        {tag}
                      </span>
                    ))}
                    {vibeTags.length > 3 && (
                      <span className="text-xs text-gray-500">
                        +{vibeTags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {versions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <div className="text-3xl mb-2">🎵</div>
            <p className="text-sm">No vibes yet...</p>
            <p className="text-xs mt-1">Start coding and watch your journey unfold</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecentActivity;