# Contributing to Traversion

First off, thank you for considering contributing to Traversion! It's people like you that make Traversion such a great tool for vibe coders everywhere.

## 🎯 Vision & Values

Before contributing, please understand our core values:

1. **Simplicity First** - Features should be intuitive and frictionless
2. **Performance Matters** - Every millisecond counts when capturing versions
3. **Developer Joy** - The tool should spark joy, not frustration
4. **Vibe Preservation** - Respect the creative flow of coding

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- Git for version control (ironic, we know)
- A passion for making developer tools better

### Setting Up Your Development Environment

1. **Fork the Repository**
   ```bash
   # Click "Fork" on GitHub, then:
   git clone https://github.com/YOUR_USERNAME/traversion.git
   cd traversion
   ```

2. **Install Dependencies**
   ```bash
   npm install
   cd ui && npm install && cd ..
   ```

3. **Create a Branch**
   ```bash
   git checkout -b feature/your-amazing-feature
   # or
   git checkout -b fix/that-annoying-bug
   ```

4. **Start Development Mode**
   ```bash
   npm run dev
   ```

5. **Make Your Changes**
   - Write code
   - Add tests
   - Update documentation

6. **Test Your Changes**
   ```bash
   npm test
   ```

7. **Submit a Pull Request**
   - Push to your fork
   - Create a PR with a clear description
   - Wait for review and feedback

## 📝 Code Style Guide

### JavaScript/TypeScript

```javascript
// ✅ Good - Clear and concise
const captureVersion = async (filePath, content) => {
  const version = await store.save(filePath, content);
  broadcast({ type: 'version', data: version });
  return version;
};

// ❌ Bad - Unclear naming and structure
const cv = async (f, c) => {
  const v = await store.save(f, c);
  broadcast({type:'version',data:v});
  return v;
};
```

### React Components

```jsx
// ✅ Good - Functional component with clear props
const VersionCard = ({ version, isSelected, onSelect }) => {
  return (
    <motion.div
      className={`version-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(version)}
    >
      {/* content */}
    </motion.div>
  );
};

// ❌ Bad - Class component for simple UI
class VersionCard extends React.Component {
  // unnecessary complexity
}
```

### CSS/Tailwind

```css
/* ✅ Good - Semantic and reusable */
.timeline-slider {
  @apply bg-gray-800 rounded-lg p-2;
}

/* ❌ Bad - Inline everything */
<div className="bg-gray-800 rounded-lg p-2 hover:bg-gray-700 transition-all duration-200 cursor-pointer">
```

## 🏗️ Architecture Guidelines

### File Organization

```
src/
├── watcher/       # File system monitoring
├── engine/        # Core version logic
├── api/          # REST endpoints
└── db/           # Database operations

ui/src/
├── components/   # Reusable UI components
├── store/        # State management
├── hooks/        # Custom React hooks
└── utils/        # Helper functions
```

### Component Principles

1. **Single Responsibility** - Each component does one thing well
2. **Composition over Inheritance** - Build complex UIs from simple parts
3. **Props over State** - Prefer stateless components when possible
4. **Performance First** - Use React.memo, useMemo, useCallback wisely

## 🧪 Testing

### Writing Tests

```javascript
// Test file: src/engine/versionStore.test.js
describe('VersionStore', () => {
  it('should capture file changes', async () => {
    const store = new VersionStore();
    const versionId = await store.saveVersion('test.js', 'console.log("hello")');
    
    expect(versionId).toBeDefined();
    expect(store.getVersion(versionId)).toMatchObject({
      file_path: 'test.js',
      content: 'console.log("hello")'
    });
  });
});
```

### Test Categories

- **Unit Tests** - Test individual functions and components
- **Integration Tests** - Test component interactions
- **E2E Tests** - Test complete user workflows

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Specific test file
npm test -- versionStore.test.js
```

## 🎨 UI/UX Contributions

### Design Principles

1. **Dark Theme First** - Optimize for long coding sessions
2. **Smooth Animations** - Use Framer Motion for fluid transitions
3. **Responsive Design** - Works on all screen sizes
4. **Accessibility** - Keyboard navigation and screen reader support

### Adding New Components

```jsx
// New component template
import React from 'react';
import { motion } from 'framer-motion';

const YourComponent = ({ prop1, prop2 }) => {
  // Component logic
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Component content */}
    </motion.div>
  );
};

export default YourComponent;
```

## 📚 Documentation

### Where to Document

- **Code Comments** - Explain complex logic
- **README** - User-facing features and setup
- **API.md** - Endpoint documentation
- **ARCHITECTURE.md** - System design decisions

### Documentation Style

```javascript
/**
 * Captures a version of a file with metadata
 * @param {string} filePath - Relative path to the file
 * @param {string} content - File content to store
 * @param {Object} metadata - Additional version metadata
 * @returns {Promise<number>} Version ID
 */
async function captureVersion(filePath, content, metadata = {}) {
  // Implementation
}
```

## 🐛 Reporting Issues

### Before Reporting

1. Check existing issues
2. Try latest version
3. Verify it's reproducible

### Issue Template

```markdown
**Description**
Clear description of the issue

**Steps to Reproduce**
1. Start Traversion
2. Do this
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- OS: macOS/Windows/Linux
- Node version: 18.x
- Traversion version: 1.0.0
```

## 💡 Feature Requests

### Good Feature Requests

- Align with Traversion's vision
- Solve real developer problems
- Include use cases and examples

### Feature Proposal Template

```markdown
**Problem**
What problem does this solve?

**Solution**
How would this feature work?

**Alternatives**
Other ways to solve this

**Use Cases**
1. When doing X, I want Y
2. During Z, this would help by...
```

## 🔄 Pull Request Process

### PR Checklist

- [ ] Code follows style guide
- [ ] Tests pass locally
- [ ] Documentation updated
- [ ] Commits are descriptive
- [ ] PR description is clear

### PR Title Format

```
type: Brief description

Examples:
feat: Add keyboard shortcuts for timeline navigation
fix: Resolve memory leak in file watcher
docs: Update API documentation
style: Format code with prettier
test: Add tests for version comparison
```

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Performance improvement

## Testing
- [ ] Unit tests pass
- [ ] Manual testing completed
- [ ] No console errors

## Screenshots (if applicable)
[Add screenshots for UI changes]
```

## 🎯 Areas for Contribution

### High Priority

1. **Performance Optimization** - Make version capture even faster
2. **VS Code Extension** - Native IDE integration
3. **Cloud Sync** - Optional cloud backup of timelines
4. **AI Vibe Detection** - Better semantic understanding

### Good First Issues

Look for issues labeled `good-first-issue`:
- Adding file type support
- UI polish and animations
- Documentation improvements
- Test coverage expansion

### Advanced Contributions

- Database optimization
- WebSocket performance
- Cross-platform support
- Plugin architecture

## 🤝 Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Accept constructive criticism gracefully
- Focus on what's best for the community

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Public or private harassment
- Publishing private information

## 📬 Communication

### Where to Get Help

- **GitHub Issues** - Bug reports and features
- **Discussions** - General questions and ideas
- **Discord** - Real-time chat with community
- **Twitter** - Updates and announcements

### Response Times

- **Critical Bugs**: Within 24 hours
- **Features**: Within 1 week
- **Questions**: Within 3 days

## 🏆 Recognition

Contributors are recognized in:
- README.md contributors section
- Release notes
- Special Discord role
- Contributor badge (coming soon)

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙏 Thank You!

Your contributions make Traversion better for thousands of developers. Whether it's fixing a typo, adding a feature, or improving performance, every contribution matters.

Remember: Good vibes make good code! 🎵✨

---

**Questions?** Open an issue or reach out on Discord. We're here to help!

**Ready to contribute?** Pick an issue, make your changes, and let's make time travel for code even better!