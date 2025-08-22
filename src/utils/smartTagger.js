import path from 'path';

export class SmartTagger {
  constructor() {
    // Pattern definitions for different types of code
    this.patterns = {
      // Architecture patterns
      architecture: {
        'microservice': /\b(microservice|service\s+mesh|api\s+gateway)\b/i,
        'monolithic': /\b(monolith|single\s+application)\b/i,
        'serverless': /\b(lambda|serverless|function\s+as\s+a\s+service|faas)\b/i,
        'event-driven': /\b(event\s+emitter|pub[\s/]?sub|message\s+queue|kafka|rabbitmq)\b/i,
        'mvc': /\b(model|view|controller|mvc)\b/i,
        'microkernel': /\b(plugin|extension|addon)\b/i,
      },
      
      // Code quality
      quality: {
        'clean-code': (content) => {
          const lines = content.split('\n');
          const avgLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
          return avgLineLength < 80 && !content.includes('// TODO');
        },
        'needs-refactor': /\b(TODO|FIXME|HACK|XXX|REFACTOR)\b/,
        'well-documented': (content) => {
          const commentLines = content.split('\n').filter(line => 
            line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')
          ).length;
          const totalLines = content.split('\n').length;
          return (commentLines / totalLines) > 0.15;
        },
        'test-code': /\b(test|spec|jest|mocha|chai|expect|describe|it\(|beforeEach|afterEach)\b/i,
        'production-ready': /\b(production|release|stable)\b/i,
        'experimental': /\b(experimental|beta|alpha|unstable|poc|proof[\s-]of[\s-]concept)\b/i,
      },
      
      // Framework detection
      frameworks: {
        'react': /\b(import\s+React|from\s+['"]react|jsx|useState|useEffect|componentDidMount)\b/,
        'vue': /\b(Vue|v-if|v-for|v-model|mounted\(\)|computed:)\b/,
        'angular': /\b(@Component|@Injectable|NgModule|angular)\b/,
        'express': /\b(express\(\)|app\.(get|post|put|delete|use)|router\.)/,
        'nextjs': /\b(next\/|getServerSideProps|getStaticProps|\_app|\_document)\b/,
        'svelte': /\b(svelte|on:click|\$:)\b/,
        'fastapi': /\b(FastAPI|@app\.(get|post|put|delete)|pydantic)\b/,
        'django': /\b(django|models\.Model|views\.py|urls\.py)\b/,
        'rails': /\b(Rails|ActiveRecord|ActionController)\b/,
      },
      
      // Language features
      features: {
        'async': /\b(async|await|Promise|then|catch|finally)\b/,
        'functional': /\b(map|filter|reduce|forEach|find|some|every|flatMap)\b/,
        'oop': /\b(class|extends|implements|constructor|super|this\.|private|public|protected)\b/,
        'reactive': /\b(Observable|Subject|subscribe|pipe|switchMap|mergeMap|BehaviorSubject)\b/,
        'hooks': /\b(use[A-Z]\w+|useState|useEffect|useMemo|useCallback|useRef)\b/,
        'decorators': /@\w+\(/,
        'generics': /<[A-Z]\w*>/,
        'typescript': /\b(interface|type|enum|as\s+\w+|:\s*\w+(\[\])?[\s;,)])\b/,
      },
      
      // Security concerns
      security: {
        'auth-code': /\b(auth|login|password|token|jwt|oauth|session|cookie)\b/i,
        'encryption': /\b(encrypt|decrypt|hash|bcrypt|crypto|cipher|ssl|tls)\b/i,
        'sql-queries': /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\b/i,
        'api-keys': /\b(api[_-]?key|secret|credential|private[_-]?key)\b/i,
        'security-headers': /\b(cors|csp|helmet|x-frame-options|strict-transport-security)\b/i,
      },
      
      // Performance
      performance: {
        'optimization': /\b(optimize|performance|cache|memo|lazy|debounce|throttle)\b/i,
        'database': /\b(database|db|sql|nosql|mongodb|postgres|mysql|redis)\b/i,
        'algorithm': /\b(algorithm|sort|search|binary|hash|tree|graph|dynamic\s+programming)\b/i,
        'data-structure': /\b(array|list|stack|queue|heap|map|set|tree|graph)\b/i,
      },
      
      // Development stage
      stage: {
        'wip': /\b(WIP|work\s+in\s+progress|TODO|FIXME)\b/i,
        'debug': /\b(console\.(log|error|warn|debug)|debugger|print|println|fmt\.Print)\b/,
        'hotfix': /\b(hotfix|quick[\s-]?fix|urgent|emergency)\b/i,
        'feature': /\b(feature|new|implement|add)\b/i,
        'bugfix': /\b(fix|bug|issue|problem|error|mistake)\b/i,
      },
      
      // Code style
      style: {
        'minimal': (content) => content.length < 200,
        'complex': (content) => content.length > 2000,
        'one-liner': (content) => content.split('\n').filter(l => l.trim()).length === 1,
        'heavily-nested': (content) => {
          const maxIndent = Math.max(...content.split('\n').map(line => 
            line.match(/^(\s*)/)?.[0].length || 0
          ));
          return maxIndent > 24; // 6 levels of indentation
        },
        'modular': /\b(export|import|module|require)\b/,
      },
      
      // Special patterns
      special: {
        'vibing': /[🔥✨🚀💯🎉🎯💪🏆]/,
        'config': /\.(config|conf|cfg|ini|env|yaml|yml|json)$/i,
        'documentation': /\b(README|DOCS|documentation|@param|@returns|@throws)\b/i,
        'api-endpoint': /\b(app\.(get|post|put|delete|patch)|@(Get|Post|Put|Delete|Patch)Mapping)\b/,
        'error-handling': /\b(try|catch|finally|throw|Error|Exception)\b/,
        'validation': /\b(validate|validator|schema|joi|yup|zod)\b/i,
        'migration': /\b(migration|migrate|upgrade|downgrade|schema\s+change)\b/i,
        'dependency-injection': /\b(inject|provider|dependency|IoC|DI)\b/i,
      }
    };
  }
  
  analyzeCode(content, filePath) {
    const tags = new Set();
    const fileExt = path.extname(filePath).toLowerCase();
    
    // Add file type tags
    this.addFileTypeTags(fileExt, tags);
    
    // Analyze content with patterns
    for (const [category, patterns] of Object.entries(this.patterns)) {
      for (const [tag, pattern] of Object.entries(patterns)) {
        if (typeof pattern === 'function') {
          if (pattern(content)) {
            tags.add(tag);
          }
        } else if (pattern.test(content)) {
          tags.add(tag);
        }
      }
    }
    
    // Add complexity analysis
    this.analyzeComplexity(content, tags);
    
    // Add code metrics
    this.addCodeMetrics(content, tags);
    
    // Detect design patterns
    this.detectDesignPatterns(content, tags);
    
    // Analyze imports/dependencies
    this.analyzeDependencies(content, tags);
    
    return Array.from(tags);
  }
  
  addFileTypeTags(ext, tags) {
    const typeMap = {
      '.js': ['javascript', 'frontend'],
      '.jsx': ['javascript', 'react', 'frontend'],
      '.ts': ['typescript', 'frontend'],
      '.tsx': ['typescript', 'react', 'frontend'],
      '.py': ['python', 'backend'],
      '.go': ['golang', 'backend'],
      '.rs': ['rust', 'systems'],
      '.java': ['java', 'backend'],
      '.cpp': ['cpp', 'systems'],
      '.c': ['c', 'systems'],
      '.css': ['styling', 'frontend'],
      '.scss': ['styling', 'sass', 'frontend'],
      '.html': ['markup', 'frontend'],
      '.sql': ['database', 'sql'],
      '.json': ['config', 'data'],
      '.yaml': ['config', 'data'],
      '.yml': ['config', 'data'],
      '.md': ['documentation'],
      '.test.js': ['testing', 'javascript'],
      '.spec.js': ['testing', 'javascript'],
    };
    
    for (const [extension, fileTags] of Object.entries(typeMap)) {
      if (ext === extension || ext.endsWith(extension)) {
        fileTags.forEach(tag => tags.add(tag));
      }
    }
  }
  
  analyzeComplexity(content, tags) {
    const lines = content.split('\n');
    const loc = lines.filter(l => l.trim() && !l.trim().startsWith('//')).length;
    
    // Cyclomatic complexity approximation
    const conditions = (content.match(/\b(if|else|switch|case|while|for|do|catch|\?|&&|\|\|)\b/g) || []).length;
    
    if (conditions > 20) tags.add('high-complexity');
    else if (conditions > 10) tags.add('medium-complexity');
    else if (conditions < 5) tags.add('low-complexity');
    
    // Lines of code
    if (loc > 500) tags.add('large-file');
    else if (loc > 200) tags.add('medium-file');
    else if (loc < 50) tags.add('small-file');
    
    // Function count
    const functions = (content.match(/function\s+\w+|=>\s*{|async\s+\w+/g) || []).length;
    if (functions > 10) tags.add('many-functions');
    if (functions === 1) tags.add('single-function');
  }
  
  addCodeMetrics(content, tags) {
    // Comment ratio
    const lines = content.split('\n');
    const commentLines = lines.filter(l => 
      l.trim().startsWith('//') || l.trim().startsWith('/*') || l.trim().startsWith('*')
    ).length;
    
    const ratio = commentLines / (lines.length || 1);
    if (ratio > 0.3) tags.add('heavily-commented');
    else if (ratio < 0.05) tags.add('needs-comments');
    
    // Variable naming style
    if (/[a-z][A-Z]/.test(content)) tags.add('camelCase');
    if (/_[a-z]/.test(content)) tags.add('snake_case');
    if (/[A-Z][A-Z]/.test(content)) tags.add('CONSTANTS');
    
    // Modern JS features
    if (/\?\.|\?\?\.|\?\?\s/.test(content)) tags.add('modern-js');
    if (/const\s+\[.*\]\s*=/.test(content)) tags.add('destructuring');
    if (/`.*\${.*}`/.test(content)) tags.add('template-literals');
    if (/\.\.\.\w+/.test(content)) tags.add('spread-operator');
  }
  
  detectDesignPatterns(content, tags) {
    // Singleton
    if (/getInstance|singleton|instance\s*==?\s*null/i.test(content)) {
      tags.add('pattern-singleton');
    }
    
    // Factory
    if (/factory|create\w+|build\w+/i.test(content)) {
      tags.add('pattern-factory');
    }
    
    // Observer
    if (/observer|subscribe|unsubscribe|emit|addEventListener/i.test(content)) {
      tags.add('pattern-observer');
    }
    
    // Strategy
    if (/strategy|algorithm|policy/i.test(content)) {
      tags.add('pattern-strategy');
    }
    
    // Repository
    if (/repository|findAll|findById|save|delete|update/i.test(content)) {
      tags.add('pattern-repository');
    }
  }
  
  analyzeDependencies(content, tags) {
    // Count imports/requires
    const imports = (content.match(/import\s+.*from|require\(/g) || []).length;
    
    if (imports > 20) tags.add('many-dependencies');
    else if (imports > 10) tags.add('moderate-dependencies');
    else if (imports === 0) tags.add('no-dependencies');
    
    // Common libraries
    if (/lodash|underscore/.test(content)) tags.add('uses-lodash');
    if (/axios|fetch/.test(content)) tags.add('http-client');
    if (/moment|dayjs|date-fns/.test(content)) tags.add('date-library');
    if (/socket\.io|ws/.test(content)) tags.add('websocket');
    if (/redux|mobx|zustand/.test(content)) tags.add('state-management');
  }
  
  suggestTags(content, filePath, existingTags = []) {
    const analyzedTags = this.analyzeCode(content, filePath);
    const newTags = analyzedTags.filter(tag => !existingTags.includes(tag));
    
    // Prioritize tags by relevance
    const priorityMap = {
      'needs-refactor': 10,
      'security': 9,
      'performance': 8,
      'testing': 7,
      'documentation': 6,
    };
    
    return newTags.sort((a, b) => {
      const aPriority = priorityMap[a] || 0;
      const bPriority = priorityMap[b] || 0;
      return bPriority - aPriority;
    });
  }
}

export default new SmartTagger();