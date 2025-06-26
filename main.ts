import { App, Plugin, ItemView, WorkspaceLeaf, TFile, PluginSettingTab, Setting, Modal, ButtonComponent, TextComponent, Notice } from 'obsidian';
import { postGroqChatCompletion } from './src/groqApi';
import { CanvasNodesView } from './src/CanvasNodesView';
import { CanvasExSettingTab } from './src/CanvasExSettingTab';

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

export default class CanvasExPlugin extends Plugin {
	private isInitialized = false;
	private nodesView: CanvasNodesView | null = null;
	settings: CanvasExSettings;

	async onload() {
		// 設定の読み込み
		await this.loadSettings();

		// 設定タブを追加
		this.addSettingTab(new CanvasExSettingTab(this.app, this));

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
				return null;
			}

			// canvasオブジェクトを取得
			const canvas = (canvasView as any).canvas;
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