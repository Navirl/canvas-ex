import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { postGroqChatCompletion } from './groqApi';
import type CanvasExPlugin from '../main';

// 必要な型を再定義またはimport
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

interface GroqNodeHistoryEntry {
	text: string;
	timestamp: number;
}

const CANVAS_NODES_VIEW_TYPE = 'canvas-nodes-view';

// テンプレート置換関数
function applyGroupTemplate(template: string, textNodes: any[]): string {
	let result = template;
	for (let i = 0; i < textNodes.length; i++) {
		const re = new RegExp(`\\{\\{\\s*text${i+1}\\s*\\}}`, 'g');
		result = result.replace(re, textNodes[i]?.text ?? '');
	}
	return result;
}

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

export class CanvasNodesView extends ItemView {
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
		['all', 'group', 'text', 'file', 'edge'].forEach(type => {
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
			let nodes = (this.plugin.getCanvasData()?.nodes ?? []) as CanvasNode[];

			// === エッジを仮想ノードとして追加 ===
			const canvasData = this.plugin.getCanvasData();
			if (canvasData && Array.isArray(canvasData.edges)) {
				const edgeNodes = canvasData.edges.map((edge: any): CanvasNode => ({
					id: edge.id,
					type: 'edge',
					fromNode: edge.fromNode,
					toNode: edge.toNode,
					fromSide: edge.fromSide,
					toSide: edge.toSide,
					label: edge.label,
					color: edge.color,
					x: 0, y: 0, width: 0, height: 0
				}));
				nodes = [...nodes, ...edgeNodes];
			}

			// === 追加: タイプフィルター ===
			if (this.filterType !== 'all') {
				nodes = nodes.filter((n: CanvasNode) => n.type === this.filterType);
			}
			// === 追加: Groupラベル検索 ===
			if (this.filterType === 'group' && this.labelQuery.trim() !== '') {
				nodes = nodes.filter((n: CanvasNode) => typeof n.label === 'string' && n.label.includes(this.labelQuery.trim()));
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
			nodes.forEach((node: CanvasNode, index: number) => {
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

				if (node.type !== 'edge') {
					detailsEl.createEl('div', {
						text: `Position: (${node.x}, ${node.y})`,
						cls: 'canvas-ex-node-position'
					});

					detailsEl.createEl('div', {
						text: `Size: ${node.width} x ${node.height}`,
						cls: 'canvas-ex-node-size'
					});
				}

				if (node.type === 'edge') {
					if (node.label) {
						detailsEl.createEl('div', {
							text: `Label: ${node.label}`,
							cls: 'canvas-ex-node-label'
						});
					}

					// fromNode/toNodeの詳細表示
					const canvasNodes = (this.plugin.getCanvasData()?.nodes ?? []) as CanvasNode[];
					const from = canvasNodes.find(n => n.id === node.fromNode);
					const to = canvasNodes.find(n => n.id === node.toNode);
					const fromInfo = from ?
						(from.type === 'file' ? `file: ${from.file}` :
						 from.type === 'text' ? `text: ${from.text ? from.text.substring(0, 20) + (from.text.length > 20 ? '...' : '') : ''}` :
						 from.type === 'group' ? `label: ${from.label}` :
						 from.type || 'Unknown')
						: 'Unknown';
					const toInfo = to ?
						(to.type === 'file' ? `file: ${to.file}` :
						 to.type === 'text' ? `text: ${to.text ? to.text.substring(0, 20) + (to.text.length > 20 ? '...' : '') : ''}` :
						 to.type === 'group' ? `label: ${to.label}` :
						 to.type || 'Unknown')
						: 'Unknown';
					const fromType = from ? from.type : 'Unknown';
					const toType = to ? to.type : 'Unknown';
					detailsEl.createEl('div', {
						text: `From: (${fromType}) ${fromInfo}`,
						cls: 'canvas-ex-edge-from'
					});
					detailsEl.createEl('div', {
						text: `To:   (${toType}) ${toInfo}`,
						cls: 'canvas-ex-edge-to'
					});
				}

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
						if (node.backgroundStyle) {
							detailsEl.createEl('div', {
								text: `Background Style: ${node.backgroundStyle}`,
								cls: 'canvas-ex-node-background'
							});
						}
						break;
				}
			});
		} else if (this.currentTab === 'history') {
			// 履歴表示
			const history = this.plugin.settings.groqNodeHistory || [];
			if (history.length === 0) {
				this.nodesContainer.createEl('p', {
					text: 'No history entries found',
					cls: 'canvas-ex-nodes-empty'
				});
			} else {
				this.nodesContainer.createEl('p', {
					text: `History count: ${history.length}`,
					cls: 'canvas-ex-nodes-count'
				});
				const historyList = this.nodesContainer.createEl('div', {
					cls: 'canvas-ex-nodes-list'
				});
				history.forEach((entry: GroqNodeHistoryEntry, index: number) => {
					const entryEl = historyList.createEl('div', {
						cls: 'canvas-ex-node-item'
					});

					// 履歴ヘッダー
					const headerEl = entryEl.createEl('div', {
						cls: 'canvas-ex-node-header'
					});

					headerEl.createEl('span', {
						text: `${index + 1}. ${entry.text}`,
						cls: 'canvas-ex-node-type'
					});

					headerEl.createEl('span', {
						text: `Timestamp: ${new Date(entry.timestamp).toLocaleString()}`,
						cls: 'canvas-ex-node-id'
					});

					// 履歴詳細
					const detailsEl = entryEl.createEl('div', {
						cls: 'canvas-ex-node-details'
					});

					detailsEl.createEl('div', {
						text: `Text: ${entry.text}`,
						cls: 'canvas-ex-node-text'
					});
				});
			}
		}
	}
}