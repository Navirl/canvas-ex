# Canvas Ex Plugin

[日本語版READMEはこちら](./README.ja.md)

> **Note:** Most of this repository was created using [Cursor](https://www.cursor.so/) (an AI pair programming tool).

A multifunctional utility plugin for Obsidian Canvas: get, manage, and utilize node information, and integrate with Groq AI.

## Main Features

- **Canvas Node List & History Sidebar**: View/search/filter current Canvas nodes and Groq-generated history in a sidebar
- **Node Info API**: Use functions like `getCanvasNodes()`, `getCanvasData()`, `logCanvasNodes()` from the developer console
- **Groq API Integration**: Send Canvas nodes or group texts to Groq AI and add the response as new nodes
- **Drag & Drop from History**: Add text nodes to Canvas by dragging from the history tab
- **Right-click Menu**: On group nodes, right-click for actions like "List group texts" or "POST to Groq"
- **Flexible Settings**: Configure Groq API key, model, default message, JSON extraction, and field selection

## Usage

### 1. Installation

1. Clone or download this repository
2. Place it in your Obsidian plugin folder (`.obsidian/plugins/`)
3. Restart Obsidian and enable "Canvas Ex" from Settings → Community Plugins

### 2. Sidebar Usage

- A "Canvas Nodes" icon will appear in the right sidebar
- Use the node list/history tabs to view, search, and filter Canvas nodes and history
- Drag items from the history tab to add them as text nodes to Canvas

### 3. Groq API Integration

- Right-click a group node in the sidebar and select "POST to Groq" to send group texts to Groq AI and add the response as new nodes
- Use the command palette: "Groq Chat Completion (API POST)" to send any message to Groq and save the response to history
- Configure API key, model, default message, JSON extraction, and fields in the settings tab

#### Supported Models (from `models.json`)
- llama3-8b-8192
- llama3-70b-8192
- mixtral-8x7b-32768
- gemma-7b-it
- qwen/qwen3-32b

### 4. Console API

Open the developer tools (F12) and use the following functions:

```js
// Get all nodes
const nodes = getCanvasNodes();
console.log(nodes);

// Get full canvas data
const canvasData = getCanvasData();
console.log(canvasData);

// Log detailed node info
logCanvasNodes();
```

### 5. Node Types

- **file**: File node (`file`, `subpath`)
- **text**: Text node (`text`)
- **link**: Link node (`url`)
- **group**: Group node (`label`, `background`, `backgroundStyle`)

## Settings

- **Groq API Key**: Get your API key from https://console.groq.com/
- **Groq Model**: Select the AI model to use (add more in `models.json`)
- **Default Message**: Template for messages sent to Groq
- **Extract JSON Only**: Use only the first JSON part of the AI response for nodes/history
- **Extract Fields**: Extract specific fields from JSON to use as node text (comma-separated)

## Development & Build

```bash
# Install dependencies
npm install

# Build in development mode
npm run dev

# Production build
npm run build
```

- Uses TypeScript and esbuild
- Main dependencies: obsidian, esbuild, typescript, etc.

## License

MIT License 