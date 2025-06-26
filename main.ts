import { App, Plugin, ItemView, WorkspaceLeaf, TFile, PluginSettingTab, Setting, Modal, ButtonComponent, TextComponent, Notice } from 'obsidian';
import { postGroqChatCompletion } from './groqApi';

interface CanvasData {
	nodes: any[];
	edges: any[];
	[key: string]: any;
}

interface CanvasNodeData {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
	type?: string;
	[key: string]: any;
}

interface CanvasNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
	type?: string;
	file?: string;
	subpath?: string;
	text?: string;
	url?: string;
	label?: string;
	background?: string;
	backgroundStyle?: string;
	[key: string]: any;
}

// サイドバービューのタイプ定数
const CANVAS_NODES_VIEW_TYPE = 'canvas-nodes-view';

// Groqノード履歴型
interface GroqNodeHistoryEntry {
	text: string;
	timestamp: number;
}

// 設定インターフェース
interface GroqDefaultMessage {
	id: string;
	label: string;
	message: string;
}

interface CanvasExSettings {
	groqApiKey: string;
	groqDefaultMessages?: GroqDefaultMessage[];
	groqDefaultMessageId?: string;
	groqNodeHistory?: GroqNodeHistoryEntry[];
	groqModel?: string;
	groqExtractJsonOnly?: boolean;
	groqExtractFields?: string;
}

const DEFAULT_SETTINGS: CanvasExSettings = {
	groqApiKey: '',
	groqDefaultMessages: [
		{ id: 'default', label: 'Default', message: '' }
	],
	groqDefaultMessageId: 'default',
	groqNodeHistory: [],
	groqModel: 'llama3-8b-8192',
	groqExtractJsonOnly: false,
	groqExtractFields: '',
};

// 1. models.jsonの型
interface GroqModelOption {
	value: string;
	label: string;
}

export default class CanvasExPlugin extends Plugin {
	private isInitialized = false;
	private nodesView: CanvasNodesView | null = null;
	settings: CanvasExSettings;

	async onload() {
		// 設定の読み込み
		await this.loadSettings();

		// 設定タブを追加
		this.addSettingTab(new CanvasExSettingTab(this.app, this));

		// CSSスタイルを追加
		this.addStyles();

		// サイドバービューを登録
		this.registerView(
			CANVAS_NODES_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => (this.nodesView = new CanvasNodesView(leaf, this))
		);

		// 右サイドバーにビューを追加
		this.addRibbonIcon('canvas', 'Canvas Nodes', () => {
			this.activateView();
		});

		// プラグインの読み込みを遅延させ、他のプラグインの初期化を待つ
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				if (!this.isInitialized) {
					setTimeout(() => {
						this.initializePlugin();
						// 初期化後に自動的にビューを表示（遅延を追加）
						setTimeout(() => {
							this.activateView();
						}, 1000);
					}, 2000);
				}
			})
		);

		// フォールバック: 5秒後に初期化
		setTimeout(() => {
			if (!this.isInitialized) {
				this.initializePlugin();
				// 初期化後に自動的にビューを表示（遅延を追加）
				setTimeout(() => {
					this.activateView();
				}, 1000);
			}
		}, 5000);

		// ファイルが開かれたときにノード一覧を更新
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				// ファイルが開かれた後に少し遅延してから更新
				setTimeout(() => {
					this.updateNodesView();
				}, 500);
			})
		);

		// アクティブなリーフが変更されたときにノード一覧を更新
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				// アクティブなリーフが変更された後に少し遅延してから更新
				setTimeout(() => {
					this.updateNodesView();
				}, 500);
			})
		);

		// === MutationObserverによるCanvasノード変化監視 ===
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				setTimeout(() => {
					this.addCanvasMutationObserver();
				}, 1000);
			})
		);

		// コマンド登録
		this.addCommand({
			id: 'post-groq-chat-completion',
			name: 'Groq Chat Completion (API POST)',
			callback: async () => {
				const apiKey = this.settings.groqApiKey;
				const msgObj = (this.settings.groqDefaultMessages || []).find(m => m.id === this.settings.groqDefaultMessageId) || { message: '' };
				const defaultMsg = msgObj.message || '';
				if (!apiKey) {
					new Notice('Groq API key is not set. Please enter your API key in the plugin settings.');
					return;
				}
				new GroqChatModal(this.app, this, async (model, userMessage) => {
					try {
						const res = await postGroqChatCompletion(apiKey, {
							model,
							messages: [
								{ role: 'user', content: userMessage }
							]
						});
						console.log('Groq API レスポンス:', res);
						new Notice('Groq API response has been output to the console');

						let responseText = res.choices?.[0]?.message?.content || res.choices?.[0]?.text || JSON.stringify(res);
						let nodeTexts: string[] = [];
						if (this.settings.groqExtractJsonOnly) {
							const extracted = extractFirstJson(responseText);
							if (extracted) {
								if (this.settings.groqExtractFields) {
									// フィールドごとに分割
									try {
										const obj = JSON.parse(extracted);
										const fieldList = this.settings.groqExtractFields.split(',').map(f => f.trim()).filter(f => f);
										if (Array.isArray(obj)) {
											// 配列の場合、各要素ごとにTextノード
											for (const item of obj) {
												const text = fieldList.map(f => formatField(item, f)).join('\n');
												if (text.trim()) nodeTexts.push(text);
											}
										} else if (typeof obj === 'object' && obj) {
											// オブジェクトの場合、フィールドが配列なら分割
											let pushed = false;
											for (const f of fieldList) {
												const v = obj[f];
												if (Array.isArray(v)) {
													for (const vv of v) {
														if (typeof vv === 'object') {
															nodeTexts.push(`${f}: ${JSON.stringify(vv)}`);
														} else {
															nodeTexts.push(`${f}: ${vv}`);
														}
													}
													pushed = true;
												} 
											}
											if (!pushed) {
												nodeTexts.push(fieldList.map(f => formatField(obj, f)).join('\n'));
											}
										} else {
											nodeTexts.push(extracted);
										}
									} catch {
										nodeTexts.push(extracted);
									}
								} else {
									nodeTexts.push(extracted);
								}
							}
						} else {
							nodeTexts.push(responseText);
						}
						// 履歴追加
						const history: GroqNodeHistoryEntry[] = this.settings.groqNodeHistory || [];
						nodeTexts.forEach(text => {
							history.unshift({
								text,
								timestamp: Date.now()
							});
						});
						if (history.length > 100) history.length = 100;
						this.settings.groqNodeHistory = history;
						await this.saveSettings();
					} catch (e) {
						console.error('Groq API error:', e);
						new Notice('Groq API error: ' + e);
					}
				}, defaultMsg).open();
			}
		});

		// Canvasへのドロップイベント追加
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				setTimeout(() => {
					this.addCanvasDropListener();
				}, 1000);
			})
		);
	}

	addStyles() {
		const styleEl = document.head.createEl('style');
		styleEl.textContent = `
			.canvas-ex-nodes-container {
				padding: 10px;
			}

			.canvas-ex-nodes-count {
				font-weight: bold;
				color: var(--text-accent);
				margin-bottom: 15px;
				padding: 8px;
				background: var(--background-secondary);
				border-radius: 4px;
			}

			.canvas-ex-nodes-empty {
				color: var(--text-muted);
				font-style: italic;
				text-align: center;
				padding: 20px;
			}

			.canvas-ex-nodes-list {
				display: flex;
				flex-direction: column;
				gap: 10px;
			}

			.canvas-ex-node-item {
				border: 1px solid var(--background-modifier-border);
				border-radius: 6px;
				padding: 10px;
				background: var(--background-primary);
				transition: all 0.2s ease;
			}

			.canvas-ex-node-item:hover {
				border-color: var(--interactive-accent);
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
			}

			.canvas-ex-node-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 8px;
				padding-bottom: 5px;
				border-bottom: 1px solid var(--background-modifier-border);
			}

			.canvas-ex-node-type {
				font-weight: bold;
				color: var(--text-accent);
			}

			.canvas-ex-node-id {
				font-size: 0.8em;
				color: var(--text-muted);
				font-family: monospace;
			}

			.canvas-ex-node-details {
				display: flex;
				flex-direction: column;
				gap: 3px;
				font-size: 0.9em;
			}

			.canvas-ex-node-position,
			.canvas-ex-node-size,
			.canvas-ex-node-color,
			.canvas-ex-node-file,
			.canvas-ex-node-subpath,
			.canvas-ex-node-text,
			.canvas-ex-node-url,
			.canvas-ex-node-label,
			.canvas-ex-node-background {
				color: var(--text-normal);
				position: static !important;
			}

			.canvas-ex-node-text-content {
				color: var(--text-accent);
				font-style: italic;
			}

			.canvas-ex-node-file {
				color: var(--text-accent-hover);
			}

			.canvas-ex-node-url {
				color: var(--text-accent);
				word-break: break-all;
			}

			.canvas-ex-node-label {
				font-weight: bold;
				color: var(--text-accent);
			}
		`;
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(CANVAS_NODES_VIEW_TYPE)[0];

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf.setViewState({
				type: CANVAS_NODES_VIEW_TYPE,
				active: true,
			});
		}

		workspace.revealLeaf(leaf);
	}

	updateNodesView() {
		if (this.nodesView) {
			// 常にノード一覧を更新（canvasが開いているかどうかはupdateNodes内でチェック）
			this.nodesView.updateNodes();
		}
	}

	/**
	 * canvasが開いているかどうかをチェック
	 */
	hasCanvasOpen(): boolean {
		try {
			// 全てのリーフをチェックしてcanvasが開いているかどうかを確認
			const leaves = this.app.workspace.getLeavesOfType('canvas');
			return leaves.length > 0;
		} catch (error) {
			return false;
		}
	}

	async initializePlugin() {
		if (this.isInitialized) return;

		try {
			// 他のプラグインとの競合を避けるため、安全に初期化
			if (typeof window !== 'undefined') {
				// 既存の関数が存在する場合は削除
				if ((window as any).getCanvasNodes) {
					delete (window as any).getCanvasNodes;
				}
				if ((window as any).getCanvasData) {
					delete (window as any).getCanvasData;
				}
				if ((window as any).logCanvasNodes) {
					delete (window as any).logCanvasNodes;
				}

				// 新しい関数を登録
				(window as any).getCanvasNodes = this.getCanvasNodes.bind(this);
				(window as any).getCanvasData = this.getCanvasData.bind(this);
				(window as any).logCanvasNodes = this.logCanvasNodes.bind(this);

				this.isInitialized = true;

				console.log('Canvas Ex plugin has been loaded');
				console.log('The following functions are now available:');
				console.log('- getCanvasNodes(): Get all nodes of the current canvas');
				console.log('- getCanvasData(): Get complete data of the current canvas');
				console.log('- logCanvasNodes(): Output node information to the console');
			}
		} catch (error) {
			console.error('Canvas Ex plugin initialization error:', error);
		}
	}

	onunload() {
		try {
			this.isInitialized = false;
			console.log('Canvas Ex plugin has been unloaded');
			
			// グローバル関数を削除
			if (typeof window !== 'undefined') {
				delete (window as any).getCanvasNodes;
				delete (window as any).getCanvasData;
				delete (window as any).logCanvasNodes;
			}
		} catch (error) {
			console.error('Canvas Ex plugin unload error:', error);
		}
	}

	/**
	 * 現在開いているcanvasの全てのノードを取得
	 */
	getCanvasNodes(): CanvasNodeData[] {
		try {
			// まず、アクティブなビューがcanvasかどうかをチェック
			const activeLeaf = this.app.workspace.activeLeaf;
			let canvasView = null;

			if (activeLeaf && activeLeaf.view) {
				const viewType = activeLeaf.view.getViewType ? activeLeaf.view.getViewType() : null;
				if (viewType === 'canvas') {
					canvasView = activeLeaf.view;
				}
			}

			// アクティブなビューがcanvasでない場合は、開いているcanvasを探す
			if (!canvasView) {
				const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
				if (canvasLeaves.length > 0) {
					canvasView = canvasLeaves[0].view;
				}
			}

			if (!canvasView) {
				return [];
			}

			// canvasオブジェクトを取得
			const canvas = (canvasView as any).canvas;
			if (!canvas) {
				return [];
			}

			// 複数のアプローチでノードを取得
			let nodes: CanvasNode[] = [];

			// アプローチ1: canvas.nodesから直接取得
			if (canvas.nodes && Array.isArray(canvas.nodes)) {
				nodes = (canvas.nodes as CanvasNode[]).filter((node: CanvasNode) => node && node.id);
			}

			// アプローチ2: canvas.data.nodesから取得
			if (nodes.length === 0 && canvas.data && canvas.data.nodes && Array.isArray(canvas.data.nodes)) {
				nodes = (canvas.data.nodes as CanvasNode[]).filter((node: CanvasNode) => node && node.id);
			}

			// アプローチ3: canvas.getData()から取得
			if (nodes.length === 0 && typeof canvas.getData === 'function') {
				try {
					const data = canvas.getData();
					if (data && data.nodes && Array.isArray(data.nodes)) {
						nodes = (data.nodes as CanvasNode[]).filter((node: CanvasNode) => node && node.id);
					}
				} catch (e) {
					// エラーを無視
				}
			}

			// アプローチ4: canvas.viewから取得
			if (nodes.length === 0 && canvas.view && canvas.view.nodes && Array.isArray(canvas.view.nodes)) {
				nodes = (canvas.view.nodes as CanvasNode[]).filter((node: CanvasNode) => node && node.id);
			}
			
			if (nodes.length === 0) {
				return [];
			}

			const result = nodes.map(node => ({
				id: node.id,
				x: node.x,
				y: node.y,
				width: node.width,
				height: node.height,
				color: node.color,
				type: node.type,
				// ノードタイプに応じた追加情報
				...(node.type === 'file' && { file: node.file, subpath: node.subpath }),
				...(node.type === 'text' && { text: node.text }),
				...(node.type === 'link' && { url: node.url }),
				...(node.type === 'group' && { 
					label: node.label, 
					background: node.background, 
					backgroundStyle: node.backgroundStyle 
				})
			}));

			return result;
		} catch (error) {
			return [];
		}
	}

	/**
	 * 現在開いているcanvasの完全なデータを取得
	 */
	getCanvasData(): CanvasData | null {
		try {
			// より安全な方法でアクティブなビューを取得
			const activeLeaf = this.app.workspace.activeLeaf;
			if (!activeLeaf) {
				return null;
			}

			const activeView = activeLeaf.view;
			if (!activeView) {
				return null;
			}

			// ビュータイプを安全に確認
			const viewType = activeView.getViewType ? activeView.getViewType() : null;
			if (viewType !== 'canvas') {
				return null;
			}

			// canvasオブジェクトを取得
			const canvas = (activeView as any).canvas;
			if (!canvas) {
				return null;
			}

			// canvasデータを取得
			const data = canvas.data;
			if (!data) {
				return null;
			}

			return {
				nodes: data.nodes || [],
				edges: data.edges || [],
				...data
			};
		} catch (error) {
			// エラーをコンソールに出力しない（警告を減らすため）
			return null;
		}
	}

	/**
	 * ノード情報をコンソールに詳細に出力
	 */
	logCanvasNodes(): void {
		try {
			const nodes = this.getCanvasNodes();
			
			if (nodes.length === 0) {
				console.log('No nodes found');
				return;
			}

			console.log(`=== Canvas node information (${nodes.length} nodes) ===`);
			
			nodes.forEach((node, index) => {
				console.log(`\n--- Node ${index + 1} ---`);
				console.log(`ID: ${node.id}`);
				console.log(`Type: ${node.type || 'Unknown'}`);
				console.log(`Position: (${node.x}, ${node.y})`);
				console.log(`Size: ${node.width} x ${node.height}`);
				
				if (node.color) {
					console.log(`Color: ${node.color}`);
				}

				// タイプ別の追加情報
				switch (node.type) {
					case 'file':
						console.log(`File: ${node.file}`);
						if (node.subpath) {
							console.log(`Subpath: ${node.subpath}`);
						}
						break;
					case 'text':
						console.log(`Text: ${node.text}`);
						break;
					case 'link':
						console.log(`URL: ${node.url}`);
						break;
					case 'group':
						if (node.label) {
							console.log(`Label: ${node.label}`);
						}
						if (node.background) {
							console.log(`Background: ${node.background}`);
						}
						if (node.backgroundStyle) {
							console.log(`Background Style: ${node.backgroundStyle}`);
						}
						break;
				}
			});

			// エッジ情報も取得
			const canvasData = this.getCanvasData();
			if (canvasData && canvasData.edges && canvasData.edges.length > 0) {
				console.log(`\n=== Edge information (${canvasData.edges.length} edges) ===`);
				canvasData.edges.forEach((edge, index) => {
					console.log(`\n--- Edge ${index + 1} ---`);
					console.log(`ID: ${edge.id}`);
					console.log(`From: ${edge.fromNode} (${edge.fromSide})`);
					console.log(`To: ${edge.toNode} (${edge.toSide})`);
					if (edge.label) {
						console.log(`Label: ${edge.label}`);
					}
					if (edge.color) {
						console.log(`Color: ${edge.color}`);
					}
				});
			}
		} catch (error) {
			console.error('logCanvasNodes error:', error);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Canvas DOMにドロップリスナーを追加
	addCanvasDropListener() {
		const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
		if (canvasLeaves.length === 0) return;
		const view = canvasLeaves[0].view as any;
		if (!view || !view.canvas) return;
		const canvasEl = view.canvas.containerEl || view.canvas.el || document.querySelector('.canvas-container');
		if (!canvasEl) return;
		if ((canvasEl as any)._canvasExDropAdded) return; // 二重登録防止
		(canvasEl as any)._canvasExDropAdded = true;

		canvasEl.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			e.dataTransfer!.dropEffect = 'copy';
		});
		canvasEl.addEventListener('drop', async (e: DragEvent) => {
			e.preventDefault();
			const text = e.dataTransfer?.getData('text/plain');
			if (!text) return;
			// ドロップ座標をCanvas座標に変換
			const rect = (canvasEl as HTMLElement).getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			// Canvasファイル取得
			const activeLeaf = this.app.workspace.activeLeaf;
			let canvasFile: TFile | null = null;
			if (activeLeaf && activeLeaf.view && (activeLeaf.view as any).file) {
				canvasFile = (activeLeaf.view as any).file as TFile;
			}
			if (!canvasFile) {
				const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
				if (canvasLeaves.length > 0 && (canvasLeaves[0].view as any).file) {
					canvasFile = (canvasLeaves[0].view as any).file as TFile;
				}
			}
			if (!canvasFile) {
				new Notice('Canvas file not found.');
				return;
			}
			const fileContent = await this.app.vault.read(canvasFile);
			let json: any;
			try {
				json = JSON.parse(fileContent);
			} catch (e) {
				new Notice('Failed to parse Canvas file JSON');
				return;
			}
			if (!Array.isArray(json.nodes)) {
				json.nodes = [];
			}
			const newNode = {
				id: 'node-' + Date.now() + '-' + Math.random().toString(36).slice(2),
				type: 'text',
				text,
				x,
				y,
				width: 300,
				height: 120
			};
			json.nodes.push(newNode);
			await this.app.vault.modify(canvasFile, JSON.stringify(json, null, 2));
			new Notice('History node added to Canvas. Please reload.');
		});
	}

	// === MutationObserver追加 ===
	addCanvasMutationObserver() {
		const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
		if (canvasLeaves.length === 0) return;
		const view = canvasLeaves[0].view as any;
		if (!view || !view.canvas) return;
		const canvasEl = view.canvas.containerEl || view.canvas.el || document.querySelector('.canvas-container');
		if (!canvasEl) return;
		if ((canvasEl as any)._canvasExObserverAdded) return; // 二重登録防止
		(canvasEl as any)._canvasExObserverAdded = true;

		const observer = new MutationObserver(() => {
			this.updateNodesView();
		});
		observer.observe(canvasEl, { childList: true, subtree: true });
	}
}

// Canvasノード一覧を表示するサイドバービュー
class CanvasNodesView extends ItemView {
	private plugin: CanvasExPlugin;
	private nodesContainer: HTMLElement;
	private tabContainer: HTMLElement;
	private currentTab: 'nodes' | 'history' = 'nodes';
	private filterType: string = 'all';
	private labelQuery: string = '';
	private _filterContainer: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: CanvasExPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CANVAS_NODES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Canvas Nodes';
	}

	getIcon(): string {
		return 'canvas';
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.createEl('h4', { text: 'Canvas Node List/History' });

		// タブUI
		this.tabContainer = container.createEl('div', { cls: 'canvas-nodes-tab-container' });
		const tabNodes = this.tabContainer.createEl('button', { text: 'Node List', cls: 'canvas-nodes-tab' });
		const tabHistory = this.tabContainer.createEl('button', { text: 'History', cls: 'canvas-nodes-tab' });
		tabNodes.onclick = () => { this.currentTab = 'nodes'; this.updateNodes(); };
		tabHistory.onclick = () => { this.currentTab = 'history'; this.updateNodes(); };
		tabNodes.classList.add('active');

		// === 追加: フィルターUI ===
		const filterContainer = container.createEl('div', { cls: 'canvas-nodes-filter-container', attr: { style: 'display:flex;gap:8px;align-items:center;margin:8px 0;' } });
		this._filterContainer = filterContainer;
		// タイプ選択
		filterContainer.createEl('span', { text: 'Type:' });
		const typeSelect = filterContainer.createEl('select');
		['all', 'group', 'text', 'file', 'link'].forEach(type => {
			const opt = typeSelect.createEl('option', { text: type === 'all' ? 'All' : type });
			opt.value = type;
		});
		typeSelect.value = this.filterType;
		typeSelect.onchange = (e) => {
			this.filterType = (e.target as HTMLSelectElement).value;
			this.updateNodes();
		};
		// Groupラベル検索
		filterContainer.createEl('span', { text: 'Search by Group Label:' });
		const labelInput = filterContainer.createEl('input', { type: 'text', placeholder: 'Search by Group Label' });
		labelInput.value = this.labelQuery;
		labelInput.oninput = (e) => {
			this.labelQuery = (e.target as HTMLInputElement).value;
			this.updateNodes();
		};
		// group以外選択時は無効化
		const updateLabelInputState = () => {
			labelInput.disabled = this.filterType !== 'group';
			if (labelInput.disabled) labelInput.value = '';
		};
		typeSelect.addEventListener('change', updateLabelInputState);
		updateLabelInputState();

		// ノード一覧のコンテナ
		this.nodesContainer = container.createEl('div', {
			cls: 'canvas-ex-nodes-container'
		});

		this.updateNodes();
	}

	async onClose() {
		// クリーンアップ
	}

	updateNodes() {
		if (!this.nodesContainer) return;
		this.nodesContainer.empty();

		// フィルターUIの表示/非表示
		if (this._filterContainer) {
			if (this.currentTab === 'nodes') {
				this._filterContainer.style.display = '';
			} else {
				this._filterContainer.style.display = 'none';
			}
		}

		// タブのactive切り替え
		const tabs = this.tabContainer.querySelectorAll('button');
		tabs.forEach(btn => btn.classList.remove('active'));
		if (this.currentTab === 'nodes') tabs[0].classList.add('active');
		if (this.currentTab === 'history') tabs[1].classList.add('active');

		if (this.currentTab === 'nodes') {
			let nodes = this.plugin.getCanvasNodes();
			// === 追加: タイプフィルター ===
			if (this.filterType !== 'all') {
				nodes = nodes.filter(n => n.type === this.filterType);
			}
			// === 追加: Groupラベル検索 ===
			if (this.filterType === 'group' && this.labelQuery.trim() !== '') {
				nodes = nodes.filter(n => typeof n.label === 'string' && n.label.includes(this.labelQuery.trim()));
			}
			if (nodes.length === 0) {
				const hasCanvasOpen = this.plugin.hasCanvasOpen();
				if (hasCanvasOpen) {
					this.nodesContainer.createEl('p', {
						text: 'No nodes matching the criteria found',
						cls: 'canvas-ex-nodes-empty'
					});
				} else {
					this.nodesContainer.createEl('p', {
						text: 'No Canvas is open',
						cls: 'canvas-ex-nodes-empty'
					});
				}
				return;
			}
			this.nodesContainer.createEl('p', {
				text: `Node count: ${nodes.length}`,
				cls: 'canvas-ex-nodes-count'
			});
			const nodesList = this.nodesContainer.createEl('div', {
				cls: 'canvas-ex-nodes-list'
			});
			nodes.forEach((node, index) => {
				const nodeEl = nodesList.createEl('div', {
					cls: 'canvas-ex-node-item'
				});

				// ノードヘッダー
				const headerEl = nodeEl.createEl('div', {
					cls: 'canvas-ex-node-header'
				});

				headerEl.createEl('span', {
					text: `${index + 1}. ${node.type || 'Unknown'}`,
					cls: 'canvas-ex-node-type'
				});

				headerEl.createEl('span', {
					text: `ID: ${node.id}`,
					cls: 'canvas-ex-node-id'
				});

				// ノード詳細
				const detailsEl = nodeEl.createEl('div', {
					cls: 'canvas-ex-node-details'
				});

				detailsEl.createEl('div', {
					text: `Position: (${node.x}, ${node.y})`,
					cls: 'canvas-ex-node-position'
				});

				detailsEl.createEl('div', {
					text: `Size: ${node.width} x ${node.height}`,
					cls: 'canvas-ex-node-size'
				});

				if (node.color) {
					detailsEl.createEl('div', {
						text: `Color: ${node.color}`,
						cls: 'canvas-ex-node-color'
					});
				}

				// タイプ別の追加情報
				switch (node.type) {
					case 'file':
						if (node.file) {
							detailsEl.createEl('div', {
								text: `File: ${node.file}`,
								cls: 'canvas-ex-node-file'
							});
						}
						if (node.subpath) {
							detailsEl.createEl('div', {
								text: `Subpath: ${node.subpath}`,
								cls: 'canvas-ex-node-subpath'
							});
						}
						break;
					case 'text':
						if (node.text) {
							const textEl = detailsEl.createEl('div', {
								cls: 'canvas-ex-node-text'
							});
							textEl.createEl('span', { text: 'Text: ' });
							textEl.createEl('span', { 
								text: node.text.length > 50 ? node.text.substring(0, 50) + '...' : node.text,
								cls: 'canvas-ex-node-text-content'
							});
						}
						break;
					case 'link':
						if (node.url) {
							detailsEl.createEl('div', {
								text: `URL: ${node.url}`,
								cls: 'canvas-ex-node-url'
							});
						}
						break;
					case 'group':
						if (node.label) {
							detailsEl.createEl('div', {
								text: `Label: ${node.label}`,
								cls: 'canvas-ex-node-label'
							});
						}
						if (node.background) {
							detailsEl.createEl('div', {
								text: `Background: ${node.background}`,
								cls: 'canvas-ex-node-background'
							});
						}
						break;
				}

				// グループノード用右クリックメニュー
				if (node.type === 'group') {
					nodeEl.addEventListener('contextmenu', async (e) => {
						e.preventDefault();
						document.querySelectorAll('.canvasex-context-menu').forEach(el => el.remove());

						// メニュー作成
						const menu = document.createElement('div');
						menu.className = 'canvasex-context-menu';
						menu.style.position = 'fixed';
						menu.style.zIndex = '9999';
						menu.style.left = `${e.clientX}px`;
						menu.style.top = `${e.clientY}px`;
						menu.style.background = 'var(--background-primary, #222)';
						menu.style.border = '1px solid var(--background-modifier-border, #444)';
						menu.style.borderRadius = '6px';
						menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
						menu.style.padding = '4px 0';
						menu.style.minWidth = '220px';

						// 1. グループ内テキストノード一覧を出力
						const itemList = document.createElement('div');
						itemList.textContent = 'Output list of text nodes in the group';
						itemList.style.padding = '8px 16px';
						itemList.style.cursor = 'pointer';
						itemList.style.color = 'var(--text-normal, #fff)';
						itemList.addEventListener('mouseenter', () => {
							itemList.style.background = 'var(--background-secondary, #333)';
						});
						itemList.addEventListener('mouseleave', () => {
							itemList.style.background = '';
						});
						itemList.onclick = () => {
							menu.remove();
							// groupノードの範囲内にあるtextノードを抽出
							const allNodes = this.plugin.getCanvasNodes();
							const group = node;
							const texts = allNodes.filter(n =>
								n.type === 'text' &&
								typeof n.x === 'number' && typeof n.y === 'number' &&
								typeof n.width === 'number' && typeof n.height === 'number' &&
								n.x >= group.x &&
								n.y >= group.y &&
								(n.x + n.width) <= (group.x + group.width) &&
								(n.y + n.height) <= (group.y + group.height)
							);
							if (texts.length === 0) {
								new Notice('No text nodes in the group');
								return;
							}
							let msg = 'List of text nodes in the group:\n';
							texts.forEach(t => {
								msg += `ID: ${t.id}\nContent: ${t.text}\n---\n`;
							});
							console.log(msg);
							new Notice('List of text nodes in the group has been output to the console');
						};
						menu.appendChild(itemList);

						// 2. POST to Groq
						const itemPost = document.createElement('div');
						itemPost.textContent = 'POST to Groq';
						itemPost.style.padding = '8px 16px';
						itemPost.style.cursor = 'pointer';
						itemPost.style.color = 'var(--text-normal, #fff)';
						itemPost.addEventListener('mouseenter', () => {
							itemPost.style.background = 'var(--background-secondary, #333)';
						});
						itemPost.addEventListener('mouseleave', () => {
							itemPost.style.background = '';
						});
						itemPost.onclick = async () => {
							menu.remove();
							const apiKey = this.plugin.settings.groqApiKey;
							const msgObj = (this.plugin.settings.groqDefaultMessages || []).find(m => m.id === this.plugin.settings.groqDefaultMessageId) || { message: '' };
							const defaultMsg = msgObj.message || '';
							const group = node;
							const allNodes = this.plugin.getCanvasNodes();
							const texts = allNodes.filter(n =>
								n.type === 'text' &&
								typeof n.x === 'number' && typeof n.y === 'number' &&
								typeof n.width === 'number' && typeof n.height === 'number' &&
								n.x >= group.x &&
								n.y >= group.y &&
								(n.x + n.width) <= (group.x + group.width) &&
								(n.y + n.height) <= (group.y + group.height)
							).sort((a, b) => a.y - b.y || a.x - b.x);
							let content = '';
							if (defaultMsg) {
								content = applyGroupTemplate(defaultMsg, texts);
							} else {
								content = texts.map(t => t.text).join('\n');
							}
							if (!apiKey) {
								new Notice('Groq API key is not set. Please enter your API key in the plugin settings.');
								return;
							}
							new Notice('Posting to Groq...');
							try {
								const res = await postGroqChatCompletion(apiKey, {
									model: this.plugin.settings.groqModel || 'llama3-8b-8192',
									messages: [
										{ role: 'user', content }
									]
								});
								console.log('Groq API response:', res);
								new Notice('Groq API response has been output to the console');

								let responseText = res.choices?.[0]?.message?.content || res.choices?.[0]?.text || JSON.stringify(res);
								let nodeTexts: string[] = [];
								if (this.plugin.settings.groqExtractJsonOnly) {
									const extracted = extractFirstJson(responseText);
									if (extracted) {
										if (this.plugin.settings.groqExtractFields) {
											try {
												const obj = JSON.parse(extracted);
												const fieldList = this.plugin.settings.groqExtractFields.split(',').map(f => f.trim()).filter(f => f);
												if (Array.isArray(obj)) {
													for (const item of obj) {
														const text = fieldList.map(f => formatField(item, f)).join('\n');
														if (text.trim()) nodeTexts.push(text);
													}
												} else if (typeof obj === 'object' && obj) {
													let pushed = false;
													for (const f of fieldList) {
														const v = obj[f];
														if (Array.isArray(v)) {
															for (const vv of v) {
																if (typeof vv === 'object') {
																	nodeTexts.push(`${f}: ${JSON.stringify(vv)}`);
																} else {
																	nodeTexts.push(`${f}: ${vv}`);
																}
															}
															pushed = true;
														}
													}
													if (!pushed) {
														nodeTexts.push(fieldList.map(f => formatField(obj, f)).join('\n'));
													}
												} else {
													nodeTexts.push(extracted);
												}
											} catch {
												nodeTexts.push(extracted);
											}
										} else {
											nodeTexts.push(extracted);
										}
									}
								} else {
									nodeTexts.push(responseText);
								}
								// 現在開いているcanvasファイルを取得
								const activeLeaf = this.plugin.app.workspace.activeLeaf;
								let canvasFile: TFile | null = null;
								if (activeLeaf && activeLeaf.view && typeof activeLeaf.view.file === 'object') {
									canvasFile = activeLeaf.view.file as TFile;
								}
								if (!canvasFile) {
									const canvasLeaves = this.plugin.app.workspace.getLeavesOfType('canvas');
									if (canvasLeaves.length > 0 && typeof canvasLeaves[0].view.file === 'object') {
										canvasFile = canvasLeaves[0].view.file as TFile;
									}
								}
								if (!canvasFile) {
									new Notice('Canvas file not found.');
									return;
								}
								const fileContent = await this.plugin.app.vault.read(canvasFile);
								let json: any;
								try {
									json = JSON.parse(fileContent);
								} catch (e) {
									new Notice('Failed to parse Canvas file JSON');
									return;
								}
								if (!Array.isArray(json.nodes)) {
									json.nodes = [];
								}
								// ノードを複数追加
								let baseX = group.x + group.width + 40;
								let baseY = group.y + group.height - 60;
								nodeTexts.forEach((text, idx) => {
									const newNode = {
										id: 'node-' + Date.now() + '-' + Math.random().toString(36).slice(2),
										type: 'text',
										text,
										x: baseX,
										y: baseY + idx * 130,
										width: 300,
										height: 120
									};
									json.nodes.push(newNode);
								});
								// 履歴に追加
								const history: GroqNodeHistoryEntry[] = this.plugin.settings.groqNodeHistory || [];
								nodeTexts.forEach(text => {
									history.unshift({
										text,
										timestamp: Date.now()
									});
								});
								if (history.length > 100) history.length = 100;
								this.plugin.settings.groqNodeHistory = history;
								await this.plugin.saveSettings();
								await this.plugin.app.vault.modify(canvasFile, JSON.stringify(json, null, 2));
								new Notice('Groq response added to Canvas file. Please reload.');
							} catch (e) {
								console.error('Groq API error:', e);
								new Notice('Groq API error: ' + e);
							}
						};
						menu.appendChild(itemPost);

						document.body.appendChild(menu);

						// メニュー外クリックで消す
						const removeMenu = (ev: MouseEvent) => {
							if (!menu.contains(ev.target as Node)) {
								menu.remove();
								document.removeEventListener('mousedown', removeMenu);
							}
						};
						setTimeout(() => {
							document.addEventListener('mousedown', removeMenu);
						}, 0);
					});
				}
			});
		} else {
			// === 履歴タブ ===
			const history: GroqNodeHistoryEntry[] = this.plugin.settings.groqNodeHistory || [];
			if (history.length === 0) {
				this.nodesContainer.createEl('p', {
					text: 'No node history added via Groq',
					cls: 'canvas-ex-nodes-empty'
				});
				return;
			}
			this.nodesContainer.createEl('p', {
				text: `History count: ${history.length}`,
				cls: 'canvas-ex-nodes-count'
			});
			const historyList = this.nodesContainer.createEl('div', {
				cls: 'canvas-ex-nodes-list'
			});
			history.forEach((entry, idx) => {
				const item = historyList.createEl('div', { cls: 'canvas-ex-node-item' });
				item.createEl('div', { text: `${idx + 1}. ${entry.text.length > 40 ? entry.text.substring(0, 40) + '...' : entry.text}` });
				item.createEl('div', { text: `Added at: ${new Date(entry.timestamp).toLocaleString()}` });

				// --- ドラッグ＆ドロップ用 ---
				item.setAttr('draggable', 'true');
				item.addEventListener('dragstart', (e: DragEvent) => {
					if (e.dataTransfer) {
						e.dataTransfer.setData('text/plain', entry.text);
						e.dataTransfer.effectAllowed = 'copy';
					}
				});
			});
		}
	}
}

// 設定タブクラス
class CanvasExSettingTab extends PluginSettingTab {
	plugin: CanvasExPlugin;
	modelOptions: GroqModelOption[] = [
		{ value: 'llama3-8b-8192', label: 'llama3-8b-8192' },
		{ value: 'llama3-70b-8192', label: 'llama3-70b-8192' },
		{ value: 'mixtral-8x7b-32768', label: 'mixtral-8x7b-32768' },
		{ value: 'gemma-7b-it', label: 'gemma-7b-it' },
	];

	constructor(app: App, plugin: CanvasExPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.loadModelOptions();
	}

	async loadModelOptions() {
		try {
			// プラグインディレクトリの絶対パスを取得
			const pluginId = this.plugin.manifest.id;
			const configDir = this.plugin.app.vault.configDir;
			const modelsPath = `${configDir}/plugins/${pluginId}/models.json`;
			const jsonStr = await this.plugin.app.vault.adapter.read(modelsPath);
			const json = JSON.parse(jsonStr);
			if (Array.isArray(json) && json.every(m => m.value && m.label)) {
				this.modelOptions = json;
			}
		} catch (e) {
			// 読み込み失敗時はデフォルトリスト
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Canvas Ex plugin settings' });

		new Setting(containerEl)
			.setName('Groq API key')
			.setDesc('Enter your API key from https://console.groq.com/')
			.addText(text =>
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.groqApiKey)
					.onChange(async (value) => {
						this.plugin.settings.groqApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		// モデル選択UI（models.jsonから）
		new Setting(containerEl)
			.setName('Groq model')
			.setDesc('Select the model to use with Groq API')
			.addDropdown(drop => {
				this.modelOptions.forEach(opt => drop.addOption(opt.value, opt.label));
				drop.setValue(this.plugin.settings.groqModel || 'llama3-8b-8192');
				drop.onChange(async (value) => {
					this.plugin.settings.groqModel = value;
					await this.plugin.saveSettings();
				});
			});

		// === Input: Groq API Default Message Management ===
		containerEl.createEl('h3', { text: 'Groq API Default Message Management (Input Template)' });
		const msgList = this.plugin.settings.groqDefaultMessages || [];
		const msgId = this.plugin.settings.groqDefaultMessageId || (msgList[0]?.id ?? '');

		// 選択UI
		new Setting(containerEl)
			.setName('Select default message')
			.setDesc('Choose the message template to send to Groq API')
			.addDropdown(drop => {
				msgList.forEach(m => drop.addOption(m.id, m.label));
				drop.setValue(msgId);
				drop.onChange(async (value) => {
					this.plugin.settings.groqDefaultMessageId = value;
					await this.plugin.saveSettings();
				});
			});

		// メッセージ一覧・編集UI
		msgList.forEach((msg, idx) => {
			const s = new Setting(containerEl)
				.setName(`Message: ${msg.label}`)
				.addText(text => text.setValue(msg.label).onChange(async (v) => {
					msg.label = v;
					await this.plugin.saveSettings();
				}))
				.addTextArea(text => text.setValue(msg.message).onChange(async (v) => {
					msg.message = v;
					await this.plugin.saveSettings();
				}));
			// 削除ボタン
			if (msgList.length > 1) {
				s.addExtraButton(btn => btn.setIcon('trash').setTooltip('Delete').onClick(async () => {
					this.plugin.settings.groqDefaultMessages = msgList.filter(m => m.id !== msg.id);
					if (this.plugin.settings.groqDefaultMessageId === msg.id) {
						this.plugin.settings.groqDefaultMessageId = this.plugin.settings.groqDefaultMessages[0]?.id ?? '';
					}
					await this.plugin.saveSettings();
					this.display();
				}));
			}
		});
		// 追加ボタン
		new Setting(containerEl)
			.addButton(btn => btn.setButtonText('Add new message').onClick(async () => {
				const newId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2);
				const newMsg = { id: newId, label: 'New Message', message: '' };
				this.plugin.settings.groqDefaultMessages = [...msgList, newMsg];
				this.plugin.settings.groqDefaultMessageId = newId;
				await this.plugin.saveSettings();
				this.display();
			}));

		// === Output: Groq API Response Extraction Settings ===
		containerEl.createEl('hr');
		containerEl.createEl('h3', { text: 'Groq API Response Extraction Settings (Output)' });

		new Setting(containerEl)
			.setName('Extract only JSON and use for output')
			.setDesc('Only the first JSON part found in the Groq API output will be reflected in history and nodes.')
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.groqExtractJsonOnly || false)
				.onChange(async (value) => {
					this.plugin.settings.groqExtractJsonOnly = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Extract fields (comma separated)')
			.setDesc('Specify the field names to extract from JSON and use for Text nodes, separated by commas (e.g., name,objective)')
			.addText(text =>
				text.setPlaceholder('Example: name,objective')
				.setValue(this.plugin.settings.groqExtractFields || '')
				.onChange(async (value) => {
					this.plugin.settings.groqExtractFields = value;
					await this.plugin.saveSettings();
				})
			);
	}
}

// Groqチャット用モーダル
class GroqChatModal extends Modal {
	plugin: CanvasExPlugin;
	onSubmit: (model: string, message: string) => void;
	defaultMessage: string;

	constructor(app: App, plugin: CanvasExPlugin, onSubmit: (model: string, message: string) => void, defaultMessage = '') {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
		this.defaultMessage = defaultMessage;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Groq Chat Completion' });

		let model = this.plugin.settings.groqModel || 'llama3-8b-8192';
		let message = this.defaultMessage || '';

		// モデル名入力
		new Setting(contentEl)
			.setName('Model name')
			.setDesc('Example: llama3-8b-8192')
			.addText((text) => {
				text.setValue(model)
					.onChange((value) => { model = value; });
			});

		// メッセージ入力
		new Setting(contentEl)
			.setName('Message')
			.addTextArea((text) => {
				text.setPlaceholder('User message input')
					.setValue(message)
					.onChange((value) => { message = value; });
			});

		// 実行ボタン
		const buttonSetting = new Setting(contentEl);
		buttonSetting.addButton((btn) =>
			btn.setButtonText('Send')
				.setCta()
				.onClick(() => {
					if (!model || !message) {
						new Notice('Model name and message are required');
						return;
					}
					this.close();
					this.onSubmit(model, message);
				})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

// テンプレート置換関数
function applyTemplate(template: string, node: any): string {
	// {{text1}} → node.text
	return template.replace(/\{\{\s*text1\s*\}\}/g, node.text ?? '');
}

// テンプレート置換関数（複数text対応）
function applyGroupTemplate(template: string, textNodes: any[]): string {
	let result = template;
	for (let i = 0; i < textNodes.length; i++) {
		const re = new RegExp(`\\{\\{\\s*text${i+1}\\s*\\}}`, 'g');
		result = result.replace(re, textNodes[i]?.text ?? '');
	}
	return result;
}

// === ユーティリティ: JSON抽出関数 ===
function extractFirstJson(text: string): string | null {
	const arrMatch = text.match(/\[([\s\S]*?)]/);
	if (arrMatch) {
		try {
			const json = JSON.parse(arrMatch[0]);
			return JSON.stringify(json, null, 2);
		} catch {}
	}
	const objMatch = text.match(/\{([\s\S]*?)}/);
	if (objMatch) {
		try {
			const json = JSON.parse(objMatch[0]);
			return JSON.stringify(json, null, 2);
		} catch {}
	}
	return null;
}

// === ユーティリティ: JSONフィールド抽出関数 ===
function extractFieldsFromJson(jsonStr: string, fields: string): string {
	if (!fields || !jsonStr) return jsonStr;
	let obj: any;
	try {
		obj = JSON.parse(jsonStr);
	} catch {
		return jsonStr;
	}
	const fieldList = fields.split(',').map(f => f.trim()).filter(f => f);
	if (Array.isArray(obj)) {
		return obj.map(item => fieldList.map(f => formatField(item, f)).join('\n')).join('\n---\n');
	} else if (typeof obj === 'object' && obj) {
		return fieldList.map(f => formatField(obj, f)).join('\n');
	}
	return jsonStr;
}

function formatField(item: any, field: string): string {
	if (!item || !field) return '';
	const value = item[field];
	if (Array.isArray(value)) {
		return `${field}:\n- ` + value.map(v => v.toString()).join('\n- ');
	} else if (typeof value === 'object' && value) {
		return `${field}: ` + JSON.stringify(value);
	} else if (value !== undefined) {
		return `${field}: ${value}`;
	}
	return '';
}