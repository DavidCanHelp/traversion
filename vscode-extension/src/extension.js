const vscode = require('vscode');
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

let statusBarItem;
let timelineProvider;
let decorationType;
let ws;
let currentVersions = new Map();

class TraversionExtension {
    constructor(context) {
        this.context = context;
        this.serverUrl = vscode.workspace.getConfiguration('traversion').get('serverUrl');
        this.isConnected = false;
        this.timeTravelMode = false;
        this.currentFile = null;
    }

    async activate() {
        console.log('Traversion extension is now active!');
        
        // Initialize components
        this.initializeStatusBar();
        this.initializeDecorations();
        this.registerCommands();
        this.initializeTreeView();
        
        // Connect to server
        await this.connectToServer();
        
        // Start WebSocket connection
        this.connectWebSocket();
        
        // Watch for active editor changes
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this.updateCurrentFile(editor.document.fileName);
            }
        });
        
        // Watch for document changes
        vscode.workspace.onDidChangeTextDocument(event => {
            if (this.isConnected) {
                this.handleDocumentChange(event);
            }
        });
    }
    
    initializeStatusBar() {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'traversion.showTimeline';
        this.updateStatusBar('Connecting...');
        statusBarItem.show();
        this.context.subscriptions.push(statusBarItem);
    }
    
    initializeDecorations() {
        decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 1em',
                textDecoration: 'none'
            }
        });
    }
    
    registerCommands() {
        // Show Timeline Command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('traversion.showTimeline', async () => {
                await this.showTimeline();
            })
        );
        
        // Compare with Previous Version
        this.context.subscriptions.push(
            vscode.commands.registerCommand('traversion.compareWithPrevious', async () => {
                await this.compareWithPrevious();
            })
        );
        
        // Rollback to Version
        this.context.subscriptions.push(
            vscode.commands.registerCommand('traversion.rollbackToVersion', async () => {
                await this.rollbackToVersion();
            })
        );
        
        // Search by Vibe
        this.context.subscriptions.push(
            vscode.commands.registerCommand('traversion.searchByVibe', async () => {
                await this.searchByVibe();
            })
        );
        
        // Show Statistics
        this.context.subscriptions.push(
            vscode.commands.registerCommand('traversion.showStats', async () => {
                await this.showStats();
            })
        );
        
        // Toggle Time Travel Mode
        this.context.subscriptions.push(
            vscode.commands.registerCommand('traversion.toggleTimeTravel', () => {
                this.toggleTimeTravel();
            })
        );
        
        // Export History
        this.context.subscriptions.push(
            vscode.commands.registerCommand('traversion.exportHistory', async () => {
                await this.exportHistory();
            })
        );
        
        // Show Current File Tags
        this.context.subscriptions.push(
            vscode.commands.registerCommand('traversion.showCurrentFileTags', async () => {
                await this.showCurrentFileTags();
            })
        );
    }
    
    initializeTreeView() {
        timelineProvider = new TimelineTreeProvider(this);
        vscode.window.createTreeView('traversion.timeline', {
            treeDataProvider: timelineProvider,
            showCollapseAll: true
        });
    }
    
    async connectToServer() {
        try {
            const response = await axios.get(`${this.serverUrl}/api/timeline`, {
                timeout: 3000
            });
            
            this.isConnected = true;
            this.updateStatusBar('Connected');
            vscode.window.showInformationMessage('Connected to Traversion server');
            
            // Load initial timeline
            if (timelineProvider) {
                timelineProvider.refresh();
            }
            
        } catch (error) {
            this.isConnected = false;
            this.updateStatusBar('Disconnected');
            vscode.window.showWarningMessage('Cannot connect to Traversion server. Make sure it\'s running.');
        }
    }
    
    connectWebSocket() {
        const wsUrl = this.serverUrl.replace('http', 'ws').replace('3333', '3334');
        ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            console.log('WebSocket connected to Traversion');
        });
        
        ws.on('message', (data) => {
            const message = JSON.parse(data);
            this.handleWebSocketMessage(message);
        });
        
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
        
        ws.on('close', () => {
            console.log('WebSocket disconnected, reconnecting in 3s...');
            setTimeout(() => this.connectWebSocket(), 3000);
        });
    }
    
    handleWebSocketMessage(message) {
        if (message.type === 'version') {
            const version = message.data;
            
            // Update timeline
            if (timelineProvider) {
                timelineProvider.addVersion(version);
            }
            
            // Show notification for current file
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const currentFile = path.relative(vscode.workspace.rootPath || '', activeEditor.document.fileName);
                if (version.file_path === currentFile) {
                    this.updateStatusBar(`v${version.id} saved`);
                    
                    // Update decorations if in time travel mode
                    if (this.timeTravelMode) {
                        this.updateDecorations(activeEditor, version);
                    }
                }
            }
        }
    }
    
    async showTimeline() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showInformationMessage('No active file');
            return;
        }
        
        const filePath = path.relative(vscode.workspace.rootPath || '', activeEditor.document.fileName);
        
        try {
            const response = await axios.get(`${this.serverUrl}/api/timeline`);
            const versions = response.data.filter(v => v.file_path === filePath);
            
            if (versions.length === 0) {
                vscode.window.showInformationMessage('No versions found for this file');
                return;
            }
            
            // Create QuickPick items
            const items = versions.map(v => ({
                label: `v${v.id}`,
                description: new Date(v.timestamp).toLocaleString(),
                detail: `Tags: ${JSON.parse(v.vibe_tags || '[]').slice(0, 5).join(', ')}`,
                version: v
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a version to view',
                canPickMany: false
            });
            
            if (selected) {
                await this.showVersion(selected.version);
            }
            
        } catch (error) {
            vscode.window.showErrorMessage('Failed to load timeline: ' + error.message);
        }
    }
    
    async showVersion(version) {
        // Create a virtual document with the version content
        const uri = vscode.Uri.parse(`traversion:${version.file_path}?version=${version.id}`);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
    }
    
    async compareWithPrevious() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showInformationMessage('No active file');
            return;
        }
        
        const filePath = path.relative(vscode.workspace.rootPath || '', activeEditor.document.fileName);
        
        try {
            const response = await axios.get(`${this.serverUrl}/api/timeline`);
            const versions = response.data
                .filter(v => v.file_path === filePath)
                .sort((a, b) => b.id - a.id);
            
            if (versions.length < 2) {
                vscode.window.showInformationMessage('Not enough versions to compare');
                return;
            }
            
            const current = versions[0];
            const previous = versions[1];
            
            // Use VS Code's built-in diff viewer
            const leftUri = vscode.Uri.parse(`traversion:${previous.file_path}?version=${previous.id}`);
            const rightUri = vscode.Uri.parse(`traversion:${current.file_path}?version=${current.id}`);
            const title = `${previous.file_path} (v${previous.id} ↔ v${current.id})`;
            
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
            
        } catch (error) {
            vscode.window.showErrorMessage('Failed to compare versions: ' + error.message);
        }
    }
    
    async rollbackToVersion() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showInformationMessage('No active file');
            return;
        }
        
        const filePath = path.relative(vscode.workspace.rootPath || '', activeEditor.document.fileName);
        
        try {
            const response = await axios.get(`${this.serverUrl}/api/timeline`);
            const versions = response.data.filter(v => v.file_path === filePath);
            
            if (versions.length === 0) {
                vscode.window.showInformationMessage('No versions found for this file');
                return;
            }
            
            // Create QuickPick items
            const items = versions.map(v => ({
                label: `v${v.id}`,
                description: new Date(v.timestamp).toLocaleString(),
                detail: `Tags: ${JSON.parse(v.vibe_tags || '[]').slice(0, 5).join(', ')}`,
                version: v
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a version to rollback to',
                canPickMany: false
            });
            
            if (selected) {
                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to rollback ${filePath} to version ${selected.version.id}?`,
                    'Yes', 'No'
                );
                
                if (confirm === 'Yes') {
                    await axios.post(`${this.serverUrl}/api/rollback/${selected.version.id}`);
                    vscode.window.showInformationMessage(`Rolled back to version ${selected.version.id}`);
                }
            }
            
        } catch (error) {
            vscode.window.showErrorMessage('Failed to rollback: ' + error.message);
        }
    }
    
    async searchByVibe() {
        const query = await vscode.window.showInputBox({
            prompt: 'Enter vibe/tags to search for',
            placeHolder: 'e.g., react hooks async'
        });
        
        if (!query) return;
        
        try {
            const response = await axios.post(`${this.serverUrl}/api/search-vibe`, {
                vibe: query
            });
            
            const results = response.data;
            
            if (results.length === 0) {
                vscode.window.showInformationMessage('No versions found matching your search');
                return;
            }
            
            // Create QuickPick items
            const items = results.map(v => ({
                label: `${v.file_path} - v${v.id}`,
                description: new Date(v.timestamp).toLocaleString(),
                detail: `Tags: ${JSON.parse(v.vibe_tags || '[]').slice(0, 5).join(', ')}`,
                version: v
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Found ${results.length} versions`,
                canPickMany: false
            });
            
            if (selected) {
                await this.showVersion(selected.version);
            }
            
        } catch (error) {
            vscode.window.showErrorMessage('Search failed: ' + error.message);
        }
    }
    
    async showStats() {
        try {
            const response = await axios.get(`${this.serverUrl}/api/stats`);
            const stats = response.data;
            
            const panel = vscode.window.createWebviewPanel(
                'traversionStats',
                'Traversion Statistics',
                vscode.ViewColumn.One,
                {}
            );
            
            panel.webview.html = this.getStatsHtml(stats);
            
        } catch (error) {
            vscode.window.showErrorMessage('Failed to load statistics: ' + error.message);
        }
    }
    
    getStatsHtml(stats) {
        const topTags = Object.entries(stats.vibeTags || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([tag, count]) => `<li>${tag}: ${count}</li>`)
            .join('');
        
        return `<!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: var(--vscode-font-family); padding: 20px; }
                h1 { color: var(--vscode-foreground); }
                .stat { margin: 10px 0; }
                .label { font-weight: bold; }
                ul { list-style: none; padding: 0; }
                li { padding: 5px 0; }
            </style>
        </head>
        <body>
            <h1>📊 Traversion Statistics</h1>
            <div class="stat">
                <span class="label">Total Versions:</span> ${stats.totalVersions}
            </div>
            <div class="stat">
                <span class="label">Total Files:</span> ${stats.totalFiles}
            </div>
            <div class="stat">
                <span class="label">Sessions:</span> ${stats.sessionsCount}
            </div>
            <div class="stat">
                <span class="label">Avg Versions/File:</span> ${stats.averageVersionsPerFile.toFixed(2)}
            </div>
            <h2>Top Tags</h2>
            <ul>${topTags}</ul>
        </body>
        </html>`;
    }
    
    toggleTimeTravel() {
        this.timeTravelMode = !this.timeTravelMode;
        
        if (this.timeTravelMode) {
            vscode.window.showInformationMessage('Time Travel Mode: ON');
            this.updateStatusBar('Time Travel ON');
            
            // Add time slider to status bar or show custom UI
            this.showTimeSlider();
        } else {
            vscode.window.showInformationMessage('Time Travel Mode: OFF');
            this.updateStatusBar('Connected');
            
            // Clear decorations
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                activeEditor.setDecorations(decorationType, []);
            }
        }
    }
    
    async showTimeSlider() {
        // This would ideally show a custom WebView with a time slider
        // For now, we'll use QuickPick to select a point in time
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return;
        
        const filePath = path.relative(vscode.workspace.rootPath || '', activeEditor.document.fileName);
        
        try {
            const response = await axios.get(`${this.serverUrl}/api/timeline`);
            const versions = response.data.filter(v => v.file_path === filePath);
            
            const items = versions.map(v => ({
                label: new Date(v.timestamp).toLocaleTimeString(),
                description: `v${v.id}`,
                detail: `Tags: ${JSON.parse(v.vibe_tags || '[]').slice(0, 3).join(', ')}`,
                version: v
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a point in time to travel to'
            });
            
            if (selected) {
                await this.showVersion(selected.version);
            }
            
        } catch (error) {
            vscode.window.showErrorMessage('Time travel failed: ' + error.message);
        }
    }
    
    async exportHistory() {
        const format = await vscode.window.showQuickPick(['JSON', 'CSV'], {
            placeHolder: 'Select export format'
        });
        
        if (!format) return;
        
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`traversion-export.${format.toLowerCase()}`),
            filters: format === 'JSON' 
                ? { 'JSON files': ['json'] }
                : { 'CSV files': ['csv'] }
        });
        
        if (!uri) return;
        
        try {
            const endpoint = format === 'CSV' ? '/api/export/csv' : '/api/export/json';
            const response = await axios.get(`${this.serverUrl}${endpoint}`);
            
            fs.writeFileSync(uri.fsPath, 
                format === 'JSON' 
                    ? JSON.stringify(response.data, null, 2)
                    : response.data
            );
            
            vscode.window.showInformationMessage(`History exported to ${uri.fsPath}`);
            
        } catch (error) {
            vscode.window.showErrorMessage('Export failed: ' + error.message);
        }
    }
    
    async showCurrentFileTags() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showInformationMessage('No active file');
            return;
        }
        
        const filePath = path.relative(vscode.workspace.rootPath || '', activeEditor.document.fileName);
        
        try {
            const response = await axios.get(`${this.serverUrl}/api/timeline`);
            const versions = response.data
                .filter(v => v.file_path === filePath)
                .sort((a, b) => b.id - a.id);
            
            if (versions.length === 0) {
                vscode.window.showInformationMessage('No versions found for this file');
                return;
            }
            
            const latestVersion = versions[0];
            const tags = JSON.parse(latestVersion.vibe_tags || '[]');
            
            if (tags.length === 0) {
                vscode.window.showInformationMessage('No tags for this file');
                return;
            }
            
            // Show tags in a nice format
            const tagList = tags.map(tag => `• ${tag}`).join('\n');
            vscode.window.showInformationMessage(`Tags for ${filePath}:\n${tagList}`, { modal: true });
            
        } catch (error) {
            vscode.window.showErrorMessage('Failed to load tags: ' + error.message);
        }
    }
    
    updateCurrentFile(fileName) {
        this.currentFile = fileName;
        // Update timeline view for current file
        if (timelineProvider) {
            timelineProvider.setCurrentFile(fileName);
        }
    }
    
    handleDocumentChange(event) {
        // This could be used to track real-time changes
        // For now, we rely on the Traversion server to track changes
    }
    
    updateDecorations(editor, version) {
        // Add inline annotations showing version info
        const decorations = [];
        const tags = JSON.parse(version.vibe_tags || '[]').slice(0, 3).join(', ');
        
        decorations.push({
            range: new vscode.Range(0, 0, 0, 0),
            renderOptions: {
                after: {
                    contentText: ` v${version.id} | ${tags}`,
                    color: 'rgba(100, 100, 100, 0.5)'
                }
            }
        });
        
        editor.setDecorations(decorationType, decorations);
    }
    
    updateStatusBar(text) {
        if (statusBarItem) {
            statusBarItem.text = `$(history) Traversion: ${text}`;
        }
    }
    
    deactivate() {
        if (ws) {
            ws.close();
        }
    }
}

class TimelineTreeProvider {
    constructor(extension) {
        this.extension = extension;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.versions = [];
        this.currentFile = null;
    }
    
    refresh() {
        this.loadVersions();
        this._onDidChangeTreeData.fire();
    }
    
    async loadVersions() {
        try {
            const response = await axios.get(`${this.extension.serverUrl}/api/timeline`);
            this.versions = response.data;
            
            if (this.currentFile) {
                const relativePath = path.relative(vscode.workspace.rootPath || '', this.currentFile);
                this.versions = this.versions.filter(v => v.file_path === relativePath);
            }
            
            // Limit to configured amount
            const limit = vscode.workspace.getConfiguration('traversion').get('timelineLimit');
            this.versions = this.versions.slice(-limit);
            
        } catch (error) {
            console.error('Failed to load versions:', error);
            this.versions = [];
        }
    }
    
    addVersion(version) {
        this.versions.push(version);
        this._onDidChangeTreeData.fire();
    }
    
    setCurrentFile(fileName) {
        this.currentFile = fileName;
        this.refresh();
    }
    
    getTreeItem(element) {
        return element;
    }
    
    getChildren(element) {
        if (!element) {
            // Root level - show versions
            return this.versions.map(v => {
                const item = new vscode.TreeItem(
                    `v${v.id} - ${v.file_path}`,
                    vscode.TreeItemCollapsibleState.None
                );
                
                item.description = new Date(v.timestamp).toLocaleTimeString();
                
                const tags = JSON.parse(v.vibe_tags || '[]');
                if (tags.length > 0) {
                    item.tooltip = `Tags: ${tags.slice(0, 5).join(', ')}`;
                }
                
                item.command = {
                    command: 'traversion.showVersion',
                    title: 'Show Version',
                    arguments: [v]
                };
                
                return item;
            });
        }
        
        return [];
    }
}

// Content provider for virtual documents
class TraversionContentProvider {
    constructor(extension) {
        this.extension = extension;
    }
    
    async provideTextDocumentContent(uri) {
        const query = new URLSearchParams(uri.query);
        const versionId = query.get('version');
        
        if (!versionId) {
            return '';
        }
        
        try {
            const response = await axios.get(`${this.extension.serverUrl}/api/version/${versionId}`);
            return response.data.content;
        } catch (error) {
            vscode.window.showErrorMessage('Failed to load version content: ' + error.message);
            return '';
        }
    }
}

function activate(context) {
    const extension = new TraversionExtension(context);
    extension.activate();
    
    // Register content provider for virtual documents
    const provider = new TraversionContentProvider(extension);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('traversion', provider)
    );
    
    // Set context for enabling/disabling commands
    vscode.commands.executeCommand('setContext', 'traversion.enabled', true);
}

function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}

module.exports = {
    activate,
    deactivate
};