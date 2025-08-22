import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

const Timeline = ({ 
  versions = [], 
  currentTime, 
  onTimeChange, 
  selectedVersion,
  compareVersions = [null, null],
  compareMode = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState(null);
  const timelineRef = useRef(null);
  const [timeRange, setTimeRange] = useState({ start: 0, end: Date.now() });

  useEffect(() => {
    if (versions.length > 0) {
      const timestamps = versions.map(v => new Date(v.timestamp).getTime());
      setTimeRange({
        start: Math.min(...timestamps),
        end: Math.max(...timestamps, Date.now())
      });
    }
  }, [versions]);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    handleTimeUpdate(e);
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      handleTimeUpdate(e);
    } else {
      updateHoverTime(e);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTimeUpdate = (e) => {
    if (!timelineRef.current) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = timeRange.start + (timeRange.end - timeRange.start) * percentage;
    
    onTimeChange(newTime);
  };

  const updateHoverTime = (e) => {
    if (!timelineRef.current) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const time = timeRange.start + (timeRange.end - timeRange.start) * percentage;
    
    setHoverTime(time);
  };

  const getPositionForTime = (timestamp) => {
    const time = new Date(timestamp).getTime();
    return ((time - timeRange.start) / (timeRange.end - timeRange.start)) * 100;
  };

  const currentPosition = ((currentTime - timeRange.start) / (timeRange.end - timeRange.start)) * 100;

  // Group versions by file for visualization
  const fileGroups = versions.reduce((acc, version) => {
    if (!acc[version.file_path]) {
      acc[version.file_path] = [];
    }
    acc[version.file_path].push(version);
    return acc;
  }, {});

  const fileColors = [
    'from-cyan-500 to-blue-500',
    'from-purple-500 to-pink-500',
    'from-yellow-500 to-orange-500',
    'from-green-500 to-teal-500',
    'from-red-500 to-rose-500'
  ];

  return (
    <div className="h-full flex flex-col p-4">
      {/* File Tracks */}
      <div className="flex-1 relative mb-4">
        {Object.entries(fileGroups).slice(0, 5).map(([filePath, fileVersions], fileIndex) => (
          <div key={filePath} className="relative h-8 mb-2">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 text-xs text-gray-500 w-48 truncate">
              {filePath.split('/').pop()}
            </div>
            <div className="ml-52 relative h-full">
              {/* Track background */}
              <div className="absolute inset-0 bg-gray-800/30 rounded-full" />
              
              {/* Version markers */}
              {fileVersions.map((version) => {
                const position = getPositionForTime(version.timestamp);
                const isSelected = selectedVersion?.id === version.id;
                const isCompareA = compareVersions[0]?.id === version.id;
                const isCompareB = compareVersions[1]?.id === version.id;
                
                return (
                  <motion.div
                    key={version.id}
                    className={`absolute top-1/2 -translate-y-1/2 cursor-pointer`}
                    style={{ left: `${position}%` }}
                    whileHover={{ scale: 1.5 }}
                    onClick={() => onTimeChange(new Date(version.timestamp).getTime())}
                  >
                    <div className={`
                      w-3 h-3 rounded-full 
                      ${isSelected ? 'ring-4 ring-cyan-400' : ''}
                      ${isCompareA ? 'ring-4 ring-purple-400' : ''}
                      ${isCompareB ? 'ring-4 ring-yellow-400' : ''}
                      bg-gradient-to-r ${fileColors[fileIndex % fileColors.length]}
                    `} />
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Main Timeline Slider */}
      <div className="relative h-16">
        <div 
          ref={timelineRef}
          className="relative h-full bg-gray-800/50 rounded-lg overflow-hidden cursor-pointer"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            handleMouseUp();
            setHoverTime(null);
          }}
        >
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-900/20 via-purple-900/20 to-yellow-900/20" />
          
          {/* Version density heatmap */}
          <div className="absolute inset-0">
            {versions.map((version) => {
              const position = getPositionForTime(version.timestamp);
              return (
                <div
                  key={version.id}
                  className="absolute top-0 bottom-0 w-1 bg-white/10"
                  style={{ left: `${position}%` }}
                />
              );
            })}
          </div>

          {/* Current time indicator */}
          <motion.div
            className="absolute top-0 bottom-0 w-1 bg-cyan-400 glow"
            style={{ left: `${currentPosition}%` }}
            animate={{ opacity: isDragging ? 0.5 : 1 }}
          >
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 px-2 py-1 rounded text-xs text-cyan-400 whitespace-nowrap">
              {format(currentTime, 'HH:mm:ss')}
            </div>
          </motion.div>

          {/* Hover time indicator */}
          {hoverTime && !isDragging && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/30"
              style={{ left: `${((hoverTime - timeRange.start) / (timeRange.end - timeRange.start)) * 100}%` }}
            >
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 px-2 py-1 rounded text-xs text-gray-400 whitespace-nowrap">
                {format(hoverTime, 'HH:mm:ss')}
              </div>
            </div>
          )}

          {/* Compare mode markers */}
          {compareMode && compareVersions[0] && (
            <div
              className="absolute top-0 bottom-0 w-1 bg-purple-400"
              style={{ left: `${getPositionForTime(compareVersions[0].timestamp)}%` }}
            />
          )}
          {compareMode && compareVersions[1] && (
            <div
              className="absolute top-0 bottom-0 w-1 bg-yellow-400"
              style={{ left: `${getPositionForTime(compareVersions[1].timestamp)}%` }}
            />
          )}
        </div>

        {/* Time labels */}
        <div className="absolute -bottom-6 left-0 right-0 flex justify-between text-xs text-gray-500">
          <span>{format(timeRange.start, 'HH:mm')}</span>
          <span>Now</span>
        </div>
      </div>
    </div>
  );
};

export default Timeline;