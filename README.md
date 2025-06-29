# Canvas Ex Plugin


https://github.com/user-attachments/assets/83c263c2-f13c-47d4-aaaf-29030d79166e


[日本語版READMEはこちら](./README.ja.md)

> **Note:** Most of this repository was created using [Cursor](https://www.cursor.so/) (an AI pair programming tool).

A multifunctional utility plugin for Obsidian Canvas: get, manage, and utilize node information, and integrate with Groq AI.

## Main Features

- **Canvas Node List & History Sidebar**: View/search/filter current Canvas nodes and Groq-generated history in a sidebar
- **Groq API Integration**: Send Canvas nodes or group texts to Groq AI and add the response as new nodes
- **Drag & Drop from History**: Add text nodes to Canvas by dragging from the history tab
- **Right-click Menu**: On group nodes, right-click for actions like "List group texts" or "POST to Groq"
- **Template System**: Load message/output templates (JSON) from `input/` and `output/` directories to flexibly customize AI prompts and output
- **Node Auto Cleanup**: Automatically remove specific flags/properties from text nodes when saving Canvas files
- **Flexible Settings**: Configure Groq API key, model, default message, template ID, JSON extraction, field selection, debug mode, and more

## Usage

### 1. Installation

1. Clone or download this repository
2. Place it in your Obsidian plugin folder (`.obsidian/plugins/`)
3. Restart Obsidian and enable "Canvas Ex" from Settings → Community Plugins

### 2. Sidebar Usage

- A "Canvas Nodes" icon will appear in the right sidebar
- Use the node list/history tabs to view, search, and filter Canvas nodes and history
- Drag items from the history tab to add them as text nodes to Canvas

### 3. Groq API Integration & Templates

- Right-click a group node in the sidebar and select "POST to Groq" to send group texts to Groq AI and add the response as new nodes
- Use the command palette: "Groq Chat Completion (API POST)" to send any message to Groq and save the response to history
- Configure API key, model, default message, template ID, JSON extraction, etc. in the settings tab
- Add message templates (JSON) to the `input/` directory and output templates (JSON) to the `output/` directory to customize AI prompts and output format

#### Supported Models (from `models.json`)
- llama3-8b-8192
- llama3-70b-8192
- mixtral-8x7b-32768
- gemma-7b-it
- qwen/qwen3-32b

### 4. Node Types

- **file**: File node (`file`, `subpath`)
- **text**: Text node (`text`)
- **link**: Link node (`url`)
- **group**: Group node (`label`, `background`, `backgroundStyle`)

## Settings

- **Groq API Key**: Get your API key from https://console.groq.com/
- **Groq Model**: Select the AI model to use (add more in `models.json`)
- **Default Message**: Initial message template for Groq (specify template ID from `input/`)
- **Output Template ID**: Output format template for AI response (specify template ID from `output/`)
- **Extract JSON Only**: Use only the first JSON part of the AI response for nodes/history
- **Extract Fields**: Extract specific fields from JSON to use as node text (comma-separated)
- **Node Property Auto Cleanup**: Automatically remove specific flags/properties from text nodes when saving Canvas
- **Debug Mode**: Enable detailed log output

## Commands & Right-click Menu

- Use the command palette: "Groq Chat Completion (API POST)" to send any message to Groq
- Right-click a group node in the sidebar for actions like "List group texts" or "POST to Groq"
- Right-click a file node for YAML fence add/cut actions

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
