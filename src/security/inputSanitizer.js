/**
 * Input Sanitization Module
 * Prevents injection attacks by sanitizing user inputs
 */

export class InputSanitizer {
  
  /**
   * Sanitize file paths to prevent directory traversal
   */
  static sanitizeFilePath(filePath) {
    if (typeof filePath !== 'string') {
      throw new Error('File path must be a string');
    }
    
    // Remove dangerous characters
    const sanitized = filePath
      .replace(/\.\.\//g, '') // Remove directory traversal
      .replace(/\.\.\\/g, '') // Remove Windows directory traversal  
      .replace(/[;&|`$(){}[\]]/g, '') // Remove shell metacharacters
      .replace(/\x00/g, '') // Remove null bytes
      .trim();
    
    // Validate path format
    if (sanitized.length === 0) {
      throw new Error('Invalid file path');
    }
    
    if (sanitized.startsWith('/') || sanitized.includes(':') || sanitized.startsWith('etc/') || sanitized.startsWith('usr/') || sanitized.startsWith('var/')) {
      throw new Error('Absolute paths and system directories not allowed');
    }
    
    return sanitized;
  }

  /**
   * Sanitize shell command arguments
   */
  static sanitizeShellArg(arg) {
    if (typeof arg !== 'string') {
      throw new Error('Shell argument must be a string');
    }
    
    // Remove dangerous shell metacharacters
    const sanitized = arg
      .replace(/[;&|`$(){}[\]<>]/g, '')
      .replace(/\x00/g, '') // Remove null bytes
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    // Additional validation
    if (sanitized.length === 0) {
      throw new Error('Invalid shell argument');
    }
    
    // Block known dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf/i,
      /sudo/i,
      /chmod/i,
      /chown/i,
      /curl.*http/i,
      /wget/i,
      /nc\s/i,
      /netcat/i
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        throw new Error('Potentially dangerous command detected');
      }
    }
    
    return sanitized;
  }

  /**
   * Sanitize HTML content to prevent XSS
   */
  static sanitizeHTML(html) {
    if (typeof html !== 'string') {
      return '';
    }
    
    return html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Sanitize JSON input
   */
  static sanitizeJSON(input) {
    if (typeof input !== 'string') {
      throw new Error('JSON input must be a string');
    }
    
    try {
      const parsed = JSON.parse(input);
      return JSON.stringify(parsed); // Re-serialize to ensure clean format
    } catch (error) {
      throw new Error('Invalid JSON input');
    }
  }

  /**
   * Validate and sanitize commit hashes
   */
  static sanitizeCommitHash(hash) {
    if (typeof hash !== 'string') {
      throw new Error('Commit hash must be a string');
    }
    
    // Git commit hashes are 40 character hex strings
    const sanitized = hash.replace(/[^a-f0-9]/gi, '').toLowerCase();
    
    if (sanitized.length !== 40 && sanitized.length !== 7 && sanitized.length !== 8) {
      throw new Error('Invalid commit hash format');
    }
    
    return sanitized;
  }

  /**
   * Sanitize branch names
   */
  static sanitizeBranchName(branch) {
    if (typeof branch !== 'string') {
      throw new Error('Branch name must be a string');
    }
    
    // Git branch name rules
    const sanitized = branch
      .replace(/[^a-zA-Z0-9.\-_/]/g, '')
      .replace(/\.\./g, '')
      .replace(/\/$/, '')
      .trim();
    
    if (sanitized.length === 0) {
      throw new Error('Invalid branch name');
    }
    
    return sanitized;
  }

  /**
   * Validate ISO date strings
   */
  static sanitizeISODate(dateString) {
    if (typeof dateString !== 'string') {
      throw new Error('Date must be a string');
    }
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date format');
    }
    
    return date.toISOString();
  }

  /**
   * Sanitize tenant IDs (UUIDs)
   */
  static sanitizeTenantId(tenantId) {
    if (typeof tenantId !== 'string') {
      throw new Error('Tenant ID must be a string');
    }
    
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidPattern.test(tenantId)) {
      throw new Error('Invalid tenant ID format');
    }
    
    return tenantId.toLowerCase();
  }

  /**
   * Sanitize SQL identifiers (table names, column names)
   */
  static sanitizeSQLIdentifier(identifier) {
    if (typeof identifier !== 'string') {
      throw new Error('SQL identifier must be a string');
    }
    
    // Only allow alphanumeric and underscores
    const sanitized = identifier.replace(/[^a-zA-Z0-9_]/g, '');
    
    if (sanitized.length === 0) {
      throw new Error('Invalid SQL identifier');
    }
    
    // Must start with letter or underscore
    if (!/^[a-zA-Z_]/.test(sanitized)) {
      throw new Error('SQL identifier must start with letter or underscore');
    }
    
    return sanitized;
  }

  /**
   * Validate and sanitize integers
   */
  static sanitizeInteger(value, min = null, max = null) {
    const num = parseInt(value, 10);
    
    if (isNaN(num)) {
      throw new Error('Invalid integer value');
    }
    
    if (min !== null && num < min) {
      throw new Error(`Value must be at least ${min}`);
    }
    
    if (max !== null && num > max) {
      throw new Error(`Value must be at most ${max}`);
    }
    
    return num;
  }

  /**
   * Validate and sanitize URLs
   */
  static sanitizeURL(url) {
    if (typeof url !== 'string') {
      throw new Error('URL must be a string');
    }
    
    try {
      const parsed = new URL(url);
      
      // Only allow specific protocols
      const allowedProtocols = ['http:', 'https:', 'git:'];
      if (!allowedProtocols.includes(parsed.protocol)) {
        throw new Error('Invalid URL protocol');
      }
      
      return parsed.href;
    } catch (error) {
      throw new Error('Invalid URL format');
    }
  }

  /**
   * Rate limiting key sanitization
   */
  static sanitizeRateLimitKey(key) {
    if (typeof key !== 'string') {
      throw new Error('Rate limit key must be a string');
    }
    
    return key
      .replace(/[^a-zA-Z0-9.\-_:]/g, '')
      .slice(0, 100) // Limit length
      .toLowerCase();
  }
}