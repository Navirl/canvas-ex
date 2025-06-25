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

// 設定インターフェース
interface CanvasExSettings {
	groqApiKey: string;
	groqDefaultMessage?: string;
}

const DEFAULT_SETTINGS: CanvasExSettings = {
	groqApiKey: '',
	groqDefaultMessage: '',
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

		// 定期的にノード一覧を更新（canvasが開いている間は常に表示し続けるため）
		this.registerInterval(
			window.setInterval(() => {
				this.updateNodesView();
			}, 2000) // 2秒ごとに更新
		);

		// コマンド登録
		this.addCommand({
			id: 'post-groq-chat-completion',
			name: 'Groq Chat Completion (API POST)',
			callback: async () => {
				const apiKey = this.settings.groqApiKey;
				const defaultMsg = this.settings.groqDefaultMessage || '';
				if (!apiKey) {
					new Notice('Groq APIキーが設定されていません。プラグイン設定画面からAPIキーを入力してください。');
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
						new Notice('Groq API レスポンスをコンソールに出力しました');
					} catch (e) {
						console.error('Groq APIエラー:', e);
						new Notice('Groq APIエラー: ' + e);
					}
				}, defaultMsg).open();
			}
		});
	}

	addStyles() {
		const styleEl = document.head.createEl('style');
		styleEl.textContent = `
			.canvas-nodes-container {
				padding: 10px;
			}

			.canvas-nodes-count {
				font-weight: bold;
				color: var(--text-accent);
				margin-bottom: 15px;
				padding: 8px;
				background: var(--background-secondary);
				border-radius: 4px;
			}

			.canvas-nodes-empty {
				color: var(--text-muted);
				font-style: italic;
				text-align: center;
				padding: 20px;
			}

			.canvas-nodes-list {
				display: flex;
				flex-direction: column;
				gap: 10px;
			}

			.canvas-node-item {
				border: 1px solid var(--background-modifier-border);
				border-radius: 6px;
				padding: 10px;
				background: var(--background-primary);
				transition: all 0.2s ease;
			}

			.canvas-node-item:hover {
				border-color: var(--interactive-accent);
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
			}

			.canvas-node-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 8px;
				padding-bottom: 5px;
				border-bottom: 1px solid var(--background-modifier-border);
			}

			.canvas-node-type {
				font-weight: bold;
				color: var(--text-accent);
			}

			.canvas-node-id {
				font-size: 0.8em;
				color: var(--text-muted);
				font-family: monospace;
			}

			.canvas-node-details {
				display: flex;
				flex-direction: column;
				gap: 3px;
				font-size: 0.9em;
			}

			.canvas-node-position,
			.canvas-node-size,
			.canvas-node-color,
			.canvas-node-file,
			.canvas-node-subpath,
			.canvas-node-text,
			.canvas-node-url,
			.canvas-node-label,
			.canvas-node-background {
				color: var(--text-normal);
			}

			.canvas-node-text-content {
				color: var(--text-accent);
				font-style: italic;
			}

			.canvas-node-file {
				color: var(--text-accent-hover);
			}

			.canvas-node-url {
				color: var(--text-accent);
				word-break: break-all;
			}

			.canvas-node-label {
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

				console.log('Canvas Ex プラグインが読み込まれました');
				console.log('以下の関数が利用可能になりました:');
				console.log('- getCanvasNodes(): 現在のcanvasの全てのノードを取得');
				console.log('- getCanvasData(): 現在のcanvasの完全なデータを取得');
				console.log('- logCanvasNodes(): ノード情報をコンソールに出力');
			}
		} catch (error) {
			console.error('Canvas Ex プラグインの初期化でエラーが発生しました:', error);
		}
	}

	onunload() {
		try {
			this.isInitialized = false;
			console.log('Canvas Ex プラグインがアンロードされました');
			
			// グローバル関数を削除
			if (typeof window !== 'undefined') {
				delete (window as any).getCanvasNodes;
				delete (window as any).getCanvasData;
				delete (window as any).logCanvasNodes;
			}
		} catch (error) {
			console.error('Canvas Ex プラグインのアンロードでエラーが発生しました:', error);
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
				console.log('ノードが見つかりませんでした');
				return;
			}

			console.log(`=== Canvas ノード情報 (${nodes.length}個) ===`);
			
			nodes.forEach((node, index) => {
				console.log(`\n--- ノード ${index + 1} ---`);
				console.log(`ID: ${node.id}`);
				console.log(`タイプ: ${node.type || '不明'}`);
				console.log(`位置: (${node.x}, ${node.y})`);
				console.log(`サイズ: ${node.width} x ${node.height}`);
				
				if (node.color) {
					console.log(`色: ${node.color}`);
				}

				// タイプ別の追加情報
				switch (node.type) {
					case 'file':
						console.log(`ファイル: ${node.file}`);
						if (node.subpath) {
							console.log(`サブパス: ${node.subpath}`);
						}
						break;
					case 'text':
						console.log(`テキスト: ${node.text}`);
						break;
					case 'link':
						console.log(`URL: ${node.url}`);
						break;
					case 'group':
						if (node.label) {
							console.log(`ラベル: ${node.label}`);
						}
						if (node.background) {
							console.log(`背景画像: ${node.background}`);
						}
						if (node.backgroundStyle) {
							console.log(`背景スタイル: ${node.backgroundStyle}`);
						}
						break;
				}
			});

			// エッジ情報も取得
			const canvasData = this.getCanvasData();
			if (canvasData && canvasData.edges && canvasData.edges.length > 0) {
				console.log(`\n=== エッジ情報 (${canvasData.edges.length}個) ===`);
				canvasData.edges.forEach((edge, index) => {
					console.log(`\n--- エッジ ${index + 1} ---`);
					console.log(`ID: ${edge.id}`);
					console.log(`From: ${edge.fromNode} (${edge.fromSide})`);
					console.log(`To: ${edge.toNode} (${edge.toSide})`);
					if (edge.label) {
						console.log(`ラベル: ${edge.label}`);
					}
					if (edge.color) {
						console.log(`色: ${edge.color}`);
					}
				});
			}
		} catch (error) {
			console.error('logCanvasNodesでエラーが発生しました:', error);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// Canvasノード一覧を表示するサイドバービュー
class CanvasNodesView extends ItemView {
	private plugin: CanvasExPlugin;
	private nodesContainer: HTMLElement;

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
		container.createEl('h4', { text: 'Canvas ノード一覧' });

		// ノード一覧のコンテナ
		this.nodesContainer = container.createEl('div', {
			cls: 'canvas-nodes-container'
		});

		// 初期ノード一覧を表示
		this.updateNodes();
	}

	async onClose() {
		// クリーンアップ
	}

	updateNodes() {
		if (!this.nodesContainer) return;

		this.nodesContainer.empty();

		const nodes = this.plugin.getCanvasNodes();
		
		if (nodes.length === 0) {
			// canvasが開いているかどうかをチェック
			const hasCanvasOpen = this.plugin.hasCanvasOpen();
			if (hasCanvasOpen) {
				this.nodesContainer.createEl('p', {
					text: 'Canvasは開いていますが、ノードが見つかりません',
					cls: 'canvas-nodes-empty'
				});
			} else {
				this.nodesContainer.createEl('p', {
					text: 'Canvasが開かれていません',
					cls: 'canvas-nodes-empty'
				});
			}
			return;
		}

		// ノード数を表示
		this.nodesContainer.createEl('p', {
			text: `ノード数: ${nodes.length}`,
			cls: 'canvas-nodes-count'
		});

		// ノード一覧を作成
		const nodesList = this.nodesContainer.createEl('div', {
			cls: 'canvas-nodes-list'
		});

		nodes.forEach((node, index) => {
			const nodeEl = nodesList.createEl('div', {
				cls: 'canvas-node-item'
			});

			// ノードヘッダー
			const headerEl = nodeEl.createEl('div', {
				cls: 'canvas-node-header'
			});

			headerEl.createEl('span', {
				text: `${index + 1}. ${node.type || '不明'}`,
				cls: 'canvas-node-type'
			});

			headerEl.createEl('span', {
				text: `ID: ${node.id}`,
				cls: 'canvas-node-id'
			});

			// ノード詳細
			const detailsEl = nodeEl.createEl('div', {
				cls: 'canvas-node-details'
			});

			detailsEl.createEl('div', {
				text: `位置: (${node.x}, ${node.y})`,
				cls: 'canvas-node-position'
			});

			detailsEl.createEl('div', {
				text: `サイズ: ${node.width} x ${node.height}`,
				cls: 'canvas-node-size'
			});

			if (node.color) {
				detailsEl.createEl('div', {
					text: `色: ${node.color}`,
					cls: 'canvas-node-color'
				});
			}

			// タイプ別の追加情報
			switch (node.type) {
				case 'file':
					if (node.file) {
						detailsEl.createEl('div', {
							text: `ファイル: ${node.file}`,
							cls: 'canvas-node-file'
						});
					}
					if (node.subpath) {
						detailsEl.createEl('div', {
							text: `サブパス: ${node.subpath}`,
							cls: 'canvas-node-subpath'
						});
					}
					break;
				case 'text':
					if (node.text) {
						const textEl = detailsEl.createEl('div', {
							cls: 'canvas-node-text'
						});
						textEl.createEl('span', { text: 'テキスト: ' });
						textEl.createEl('span', { 
							text: node.text.length > 50 ? node.text.substring(0, 50) + '...' : node.text,
							cls: 'canvas-node-text-content'
						});
					}
					break;
				case 'link':
					if (node.url) {
						detailsEl.createEl('div', {
							text: `URL: ${node.url}`,
							cls: 'canvas-node-url'
						});
					}
					break;
				case 'group':
					if (node.label) {
						detailsEl.createEl('div', {
							text: `ラベル: ${node.label}`,
							cls: 'canvas-node-label'
						});
					}
					if (node.background) {
						detailsEl.createEl('div', {
							text: `背景: ${node.background}`,
							cls: 'canvas-node-background'
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
					itemList.textContent = 'グループ内テキストノード一覧を出力';
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
							new Notice('グループ内にテキストノードはありません');
							return;
						}
						let msg = 'グループ内テキストノード一覧:\n';
						texts.forEach(t => {
							msg += `ID: ${t.id}\n内容: ${t.text}\n---\n`;
						});
						console.log(msg);
						new Notice('グループ内テキストノード一覧をコンソールに出力しました');
					};
					menu.appendChild(itemList);

					// 2. GroqにPOST
					const itemPost = document.createElement('div');
					itemPost.textContent = 'GroqにPOST';
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
						const defaultMsg = this.plugin.settings.groqDefaultMessage || '';
						// groupノードの範囲内にあるtextノードをY→X昇順で抽出
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
						).sort((a, b) => a.y - b.y || a.x - b.x);
						let content = '';
						if (defaultMsg) {
							content = applyGroupTemplate(defaultMsg, texts);
						} else {
							content = texts.map(t => t.text).join('\n');
						}
						if (!apiKey) {
							new Notice('Groq APIキーが設定されていません。プラグイン設定画面からAPIキーを入力してください。');
							return;
						}
						new Notice('GroqにPOST中...');
						try {
							const res = await postGroqChatCompletion(apiKey, {
								model: 'llama3-8b-8192',
								messages: [
									{ role: 'user', content }
								]
							});
							console.log('Groq API レスポンス:', res);
							new Notice('Groq API レスポンスをコンソールに出力しました');
						} catch (e) {
							console.error('Groq APIエラー:', e);
							new Notice('Groq APIエラー: ' + e);
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
	}
}

// 設定タブクラス
class CanvasExSettingTab extends PluginSettingTab {
	plugin: CanvasExPlugin;

	constructor(app: App, plugin: CanvasExPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Canvas Ex プラグイン設定' });

		new Setting(containerEl)
			.setName('Groq APIキー')
			.setDesc('https://console.groq.com/ から取得したAPIキーを入力してください')
			.addText(text =>
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.groqApiKey)
					.onChange(async (value) => {
						this.plugin.settings.groqApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		// 追加: デフォルトメッセージ設定
		new Setting(containerEl)
			.setName('Groq APIデフォルトメッセージ')
			.setDesc('コマンドや右クリックでGroq APIに送るデフォルトメッセージ')
			.addTextArea(text =>
				text
					.setPlaceholder('ここにデフォルトメッセージを入力')
					.setValue(this.plugin.settings.groqDefaultMessage || '')
					.onChange(async (value) => {
						this.plugin.settings.groqDefaultMessage = value;
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

		let model = 'llama3-8b-8192';
		let message = this.defaultMessage || '';

		// モデル名入力
		new Setting(contentEl)
			.setName('モデル名')
			.setDesc('例: llama3-8b-8192')
			.addText((text) => {
				text.setValue(model)
					.onChange((value) => { model = value; });
			});

		// メッセージ入力
		new Setting(contentEl)
			.setName('メッセージ')
			.addTextArea((text) => {
				text.setPlaceholder('ユーザーのメッセージを入力')
					.setValue(message)
					.onChange((value) => { message = value; });
			});

		// 実行ボタン
		const buttonSetting = new Setting(contentEl);
		buttonSetting.addButton((btn) =>
			btn.setButtonText('送信')
				.setCta()
				.onClick(() => {
					if (!model || !message) {
						new Notice('モデル名とメッセージは必須です');
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