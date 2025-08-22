import React, { useMemo } from 'react';
import ReactDiffViewer from 'react-diff-viewer';
import { motion } from 'framer-motion';

const ComparisonView = ({ versionA, versionB }) => {
  const diffStats = useMemo(() => {
    if (!versionA || !versionB) return null;
    
    const linesA = versionA.content.split('\n').length;
    const linesB = versionB.content.split('\n').length;
    const sizeDiff = versionB.content.length - versionA.content.length;
    
    return {
      linesA,
      linesB,
      linesDiff: linesB - linesA,
      sizeDiff,
      timeSpan: Math.abs(new Date(versionB.timestamp) - new Date(versionA.timestamp)) / 1000
    };
  }, [versionA, versionB]);

  const formatTimeSpan = (seconds) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  const customStyles = {
    variables: {
      dark: {
        diffViewerBackground: '#1a1a1a',
        diffViewerColor: '#ffffff',
        addedBackground: '#1a4d2e',
        addedColor: '#4ade80',
        removedBackground: '#4d1a1a',
        removedColor: '#f87171',
        wordAddedBackground: '#22c55e',
        wordRemovedBackground: '#ef4444',
        addedGutterBackground: '#1a4d2e',
        removedGutterBackground: '#4d1a1a',
        gutterBackground: '#2a2a2a',
        gutterBackgroundDark: '#1a1a1a',
        highlightBackground: '#3a3a3a',
        highlightGutterBackground: '#3a3a3a',
        codeFoldGutterBackground: '#2a2a2a',
        codeFoldBackground: '#2a2a2a',
        emptyLineBackground: '#1a1a1a',
        gutterColor: '#666666',
        addedGutterColor: '#4ade80',
        removedGutterColor: '#f87171'
      }
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-black/50 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-8">
            {/* Version A */}
            <motion.div 
              className="flex items-center space-x-3"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="w-3 h-3 bg-purple-400 rounded-full glow-purple" />
              <div>
                <span className="text-sm text-purple-400">Version {versionA.id}</span>
                <span className="text-xs text-gray-500 ml-2">
                  {new Date(versionA.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </motion.div>

            {/* Arrow */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2 }}
            >
              →
            </motion.div>

            {/* Version B */}
            <motion.div 
              className="flex items-center space-x-3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="w-3 h-3 bg-yellow-400 rounded-full glow-yellow" />
              <div>
                <span className="text-sm text-yellow-400">Version {versionB.id}</span>
                <span className="text-xs text-gray-500 ml-2">
                  {new Date(versionB.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </motion.div>
          </div>

          {/* Stats */}
          {diffStats && (
            <div className="flex items-center space-x-4 text-xs">
              <span className="text-gray-500">
                Time span: <span className="text-cyan-400">{formatTimeSpan(diffStats.timeSpan)}</span>
              </span>
              <span className="text-gray-500">
                Lines: {diffStats.linesDiff > 0 ? '+' : ''}{diffStats.linesDiff}
              </span>
              <span className="text-gray-500">
                Size: {diffStats.sizeDiff > 0 ? '+' : ''}{diffStats.sizeDiff} bytes
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Diff Viewer */}
      <div className="flex-1 overflow-auto">
        <ReactDiffViewer
          oldValue={versionA.content}
          newValue={versionB.content}
          splitView={true}
          useDarkTheme={true}
          styles={customStyles}
          leftTitle={`v${versionA.id}`}
          rightTitle={`v${versionB.id}`}
        />
      </div>
    </div>
  );
};

export default ComparisonView;