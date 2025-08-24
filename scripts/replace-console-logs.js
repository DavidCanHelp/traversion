#!/usr/bin/env node

/**
 * Script to replace console.log with proper logger usage
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const EXCLUDE_DIRS = ['node_modules', '.git', 'coverage', 'dist', 'build', '.traversion'];
const EXCLUDE_FILES = ['logger.js', 'replace-console-logs.js'];

// Files that should use logger
const filesToUpdate = [];

function findJsFiles(dir) {
  const files = readdirSync(dir);
  
  for (const file of files) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(file)) {
        findJsFiles(fullPath);
      }
    } else if (stat.isFile()) {
      if (extname(file) === '.js' && !EXCLUDE_FILES.includes(file)) {
        const content = readFileSync(fullPath, 'utf8');
        if (content.includes('console.log') || content.includes('console.error') || content.includes('console.warn')) {
          filesToUpdate.push(fullPath);
        }
      }
    }
  }
}

function updateFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  let modified = false;
  
  // Skip test files
  if (filePath.includes('/test/') || filePath.includes('.test.js') || filePath.includes('.spec.js')) {
    return false;
  }
  
  // Skip documentation and config files
  if (filePath.includes('/docs/') || filePath.includes('jest.config.js') || filePath.includes('vite.config.js')) {
    return false;
  }
  
  // Check if logger is already imported
  const hasLoggerImport = content.includes("from './logger") || 
                          content.includes('from "../logger') ||
                          content.includes('from "../../utils/logger') ||
                          content.includes('from "../utils/logger') ||
                          content.includes('from "./utils/logger');
  
  // Replace console methods with logger
  const originalContent = content;
  
  // Replace console.log with logger.info
  content = content.replace(/console\.log\(/g, (match, offset) => {
    // Check if it's in a comment
    const lineStart = content.lastIndexOf('\n', offset);
    const line = content.substring(lineStart, offset);
    if (line.includes('//') || line.includes('/*')) {
      return match;
    }
    modified = true;
    return 'logger.info(';
  });
  
  // Replace console.error with logger.error
  content = content.replace(/console\.error\(/g, (match, offset) => {
    const lineStart = content.lastIndexOf('\n', offset);
    const line = content.substring(lineStart, offset);
    if (line.includes('//') || line.includes('/*')) {
      return match;
    }
    modified = true;
    return 'logger.error(';
  });
  
  // Replace console.warn with logger.warn
  content = content.replace(/console\.warn\(/g, (match, offset) => {
    const lineStart = content.lastIndexOf('\n', offset);
    const line = content.substring(lineStart, offset);
    if (line.includes('//') || line.includes('/*')) {
      return match;
    }
    modified = true;
    return 'logger.warn(';
  });
  
  // Add logger import if needed and file was modified
  if (modified && !hasLoggerImport) {
    // Determine the correct import path based on file location
    const depth = filePath.split('/src/')[1]?.split('/').length - 1 || 0;
    let importPath = './utils/logger.js';
    
    if (depth === 1) {
      importPath = '../utils/logger.js';
    } else if (depth === 2) {
      importPath = '../../utils/logger.js';
    } else if (depth > 2) {
      importPath = '../'.repeat(depth) + 'utils/logger.js';
    }
    
    // Special case for files in src/utils
    if (filePath.includes('/src/utils/') && !filePath.endsWith('logger.js')) {
      importPath = './logger.js';
    }
    
    // Add import at the top of the file
    const importStatement = `import { logger } from '${importPath}';\n`;
    
    // Find the right place to insert the import
    const firstImportIndex = content.search(/^import /m);
    if (firstImportIndex !== -1) {
      // Add after other imports
      const afterImports = content.indexOf('\n', firstImportIndex) + 1;
      content = content.slice(0, afterImports) + importStatement + content.slice(afterImports);
    } else {
      // Add at the beginning of the file
      const afterComments = content.search(/^(?!\/\*|\/\/)/m);
      if (afterComments > 0) {
        content = content.slice(0, afterComments) + importStatement + '\n' + content.slice(afterComments);
      } else {
        content = importStatement + '\n' + content;
      }
    }
  }
  
  if (modified) {
    writeFileSync(filePath, content);
    return true;
  }
  
  return false;
}

// Main execution
console.log('🔍 Finding JavaScript files with console.log statements...\n');
findJsFiles('src');

console.log(`Found ${filesToUpdate.length} files to update:\n`);

let updatedCount = 0;
for (const file of filesToUpdate) {
  const relativePath = file.replace(process.cwd() + '/', '');
  const updated = updateFile(file);
  if (updated) {
    console.log(`✅ Updated: ${relativePath}`);
    updatedCount++;
  } else {
    console.log(`⏭️  Skipped: ${relativePath} (test/doc/config file)`);
  }
}

console.log(`\n✨ Successfully updated ${updatedCount} files!`);
console.log('📝 Note: Test files, documentation, and config files were intentionally skipped.');