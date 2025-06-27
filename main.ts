import { App, Plugin, ItemView, WorkspaceLeaf, TFile, PluginSettingTab, Setting, Modal, ButtonComponent, TextComponent, Notice } from 'obsidian';
import { postGroqChatCompletion } from './src/groqApi';
import { CanvasNodesView } from './src/CanvasNodesView';
import { CanvasExSettingTab } from './src/CanvasExSettingTab';
import { parseCanvasExYamlFences } from './src/parseYamlFenced';
import * as yaml from 'js-yaml';

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
export interface GroqDefaultMessage {
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
	groqRemovePropOnDrop?: boolean;
	groqDebugMode?: boolean;
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
	groqRemovePropOnDrop: false,
	groqDebugMode: false,
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

		// canvasファイル保存時にtextノードのID除去
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (file instanceof TFile && file.extension === 'canvas') {
					try {
						const content = await this.app.vault.read(file);
						let json = JSON.parse(content);
						let changed = false;
						let cleanedCount = 0;
						if (Array.isArray(json.nodes)) {
							(json.nodes as any[]).forEach((node: any) => {
								if (node.type === 'text' && typeof node.text === 'string') {
									const cleaned = node.text.replace(/\{\{innerID:.*?\}\}/g, '').trim();
									if (cleaned !== node.text) {
										node.text = cleaned;
										changed = true;
										cleanedCount++;
									}
								}
							});
						}
						if (changed) {
							debugLog(this, `canvasファイル修正: ${file.path}、textノード修正数: ${cleanedCount}`);
							await this.app.vault.modify(file, JSON.stringify(json, null, 2));
						}
					} catch (e) {
						// エラー時は何もしない
					}
				}
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
				if ((window as any).getCanvasData) {
					delete (window as any).getCanvasData;
				}
				if ((window as any).logCanvasNodes) {
					delete (window as any).logCanvasNodes;
				}
				if ((window as any).parseCanvasExYamlFences) {
					delete (window as any).parseCanvasExYamlFences;
				}

				// 新しい関数を登録
				(window as any).getCanvasData = this.getCanvasData.bind(this);
				(window as any).logCanvasNodes = this.logCanvasNodes.bind(this);
				(window as any).parseCanvasExYamlFences = parseCanvasExYamlFences;

				this.isInitialized = true;

				console.log('Canvas Ex plugin has been loaded');
				console.log('The following functions are now available:');
				console.log('- getCanvasData(): Get complete data of the current canvas');
				console.log('- logCanvasNodes(): Output node information to the console');
				console.log('- parseCanvasExYamlFences(text): Parse canvasex/cex fenced YAML blocks from text');
			}
		} catch (error) {
			console.error('Canvas Ex plugin initialization error:', error);
		}
	}

	onunload() {
		try {
			this.isInitialized = false;
			console.log('Canvas Ex plugin has been unloaded');
			if (typeof window !== 'undefined') {
				delete (window as any).getCanvasData;
				delete (window as any).logCanvasNodes;
				delete (window as any).parseCanvasExYamlFences;
			}
		} catch (error) {
			console.error('Canvas Ex plugin unload error:', error);
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
			const nodes = this.getCanvasData()?.nodes ?? [];
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

// === デバッグ用ヘルパー ===
function debugLog(plugin: CanvasExPlugin, ...args: any[]) {
	if (plugin.settings.groqDebugMode) {
		console.log('[CanvasEx]', ...args);
	}
}