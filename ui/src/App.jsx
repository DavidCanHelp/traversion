import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Timeline from './components/Timeline';
import CodeViewer from './components/CodeViewer';
import ComparisonView from './components/ComparisonView';
import VibeSearch from './components/VibeSearch';
import RecentActivity from './components/RecentActivity';
import { useVersionStore } from './store/versionStore';

function App() {
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareVersions, setCompareVersions] = useState([null, null]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  const { 
    versions, 
    recentVersions, 
    loadTimeline, 
    connectWebSocket,
    searchByVibe 
  } = useVersionStore();

  useEffect(() => {
    loadTimeline();
    const ws = connectWebSocket();
    
    return () => {
      if (ws) ws.close();
    };
  }, []);

  const handleVersionSelect = (version) => {
    if (compareMode) {
      if (!compareVersions[0]) {
        setCompareVersions([version, null]);
      } else if (!compareVersions[1]) {
        setCompareVersions([compareVersions[0], version]);
      } else {
        setCompareVersions([version, null]);
      }
    } else {
      setSelectedVersion(version);
    }
  };

  const handleTimeChange = (timestamp) => {
    setCurrentTime(timestamp);
    // Find the version closest to this timestamp
    const closestVersion = versions.reduce((prev, curr) => {
      const prevDiff = Math.abs(new Date(prev.timestamp) - timestamp);
      const currDiff = Math.abs(new Date(curr.timestamp) - timestamp);
      return currDiff < prevDiff ? curr : prev;
    });
    setSelectedVersion(closestVersion);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 backdrop-blur-xl bg-black/30">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <motion.h1 
              className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-yellow-400 bg-clip-text text-transparent"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              TRAVERSION
            </motion.h1>
            <span className="text-gray-500 text-sm">Time Machine for Vibe Coders</span>
          </div>
          
          <div className="flex items-center space-x-4">
            <VibeSearch onSearch={searchByVibe} />
            
            <button
              onClick={() => {
                setCompareMode(!compareMode);
                setCompareVersions([null, null]);
              }}
              className={`px-4 py-2 rounded-lg transition-all ${
                compareMode 
                  ? 'bg-purple-600 text-white glow-purple' 
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {compareMode ? 'Exit Compare' : 'Compare Mode'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-80px)]">
        {/* Sidebar - Recent Activity */}
        <div className="w-80 border-r border-gray-800 bg-black/20 backdrop-blur-md overflow-y-auto">
          <RecentActivity 
            versions={recentVersions}
            onSelect={handleVersionSelect}
            selectedVersion={selectedVersion}
          />
        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col">
          {/* Code Viewer / Comparison */}
          <div className="flex-1 overflow-hidden">
            {compareMode && compareVersions[0] && compareVersions[1] ? (
              <ComparisonView 
                versionA={compareVersions[0]}
                versionB={compareVersions[1]}
              />
            ) : (
              <CodeViewer 
                version={selectedVersion}
                compareMode={compareMode}
                compareSlot={compareVersions[0] ? 2 : 1}
              />
            )}
          </div>

          {/* Timeline */}
          <div className="h-48 border-t border-gray-800 bg-black/30 backdrop-blur-md">
            <Timeline 
              versions={versions}
              currentTime={currentTime}
              onTimeChange={handleTimeChange}
              selectedVersion={selectedVersion}
              compareVersions={compareVersions}
              compareMode={compareMode}
            />
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="fixed bottom-0 left-0 right-0 h-6 bg-black/50 backdrop-blur-md border-t border-gray-800 px-4 flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center space-x-4">
          <span className="flex items-center">
            <span className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></span>
            Recording
          </span>
          <span>{versions.length} versions</span>
          <span>{recentVersions.length} recent changes</span>
        </div>
        <div>
          {selectedVersion && (
            <span>
              Viewing: {selectedVersion.file_path} 
              <span className="text-gray-600 ml-2">
                v{selectedVersion.id}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;