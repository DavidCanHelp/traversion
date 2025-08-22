import React from 'react';
import Editor from '@monaco-editor/react';
import { motion } from 'framer-motion';

const CodeViewer = ({ version, compareMode, compareSlot }) => {
  if (!version) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <motion.div
            className="text-6xl mb-4"
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          >
            ⏰
          </motion.div>
          <p className="text-gray-500">
            {compareMode 
              ? `Select version for slot ${compareSlot}`
              : 'Select a version from the timeline'}
          </p>
        </div>
      </div>
    );
  }

  const getLanguage = (filePath) => {
    const ext = filePath.split('.').pop();
    const langMap = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      go: 'go',
      rs: 'rust',
      css: 'css',
      html: 'html',
      json: 'json',
      md: 'markdown'
    };
    return langMap[ext] || 'plaintext';
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-black/50 backdrop-blur-md border-b border-gray-800 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-400">
              {version.file_path}
            </span>
            <span className="text-xs text-gray-600">
              v{version.id}
            </span>
            <span className="text-xs text-gray-600">
              {new Date(version.timestamp).toLocaleTimeString()}
            </span>
          </div>
          
          {/* Vibe tags */}
          <div className="flex items-center space-x-2">
            {JSON.parse(version.vibe_tags || '[]').map((tag, i) => (
              <span 
                key={i}
                className="px-2 py-1 bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded text-xs text-purple-400 border border-purple-600/30"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1">
        <Editor
          height="100%"
          language={getLanguage(version.file_path)}
          value={version.content}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: 'JetBrains Mono, Fira Code, monospace',
            fontLigatures: true,
            renderWhitespace: 'selection',
            scrollBeyondLastLine: false,
            wordWrap: 'on'
          }}
        />
      </div>
    </div>
  );
};

export default CodeViewer;