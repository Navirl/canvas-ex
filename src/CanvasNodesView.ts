import { ItemView, WorkspaceLeaf, Notice, TFile, TAbstractFile } from 'obsidian';
import { postGroqChatCompletion } from './groqApi';
import type CanvasExPlugin from '../main';
import { parseCanvasExYamlFences } from './parseYamlFenced';
import * as yaml from 'js-yaml';

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

interface CanvasExSettings {
	groqRemovePropOnDrop?: boolean;
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
	private currentTab: 'nodes' | 'history' | 'fileProps' = 'nodes';
	private filterType: string = 'all';
	private labelQuery: string = '';
	private _filterContainer: HTMLElement | null = null;
	public fileNodeProps: any[] = [];
	public fileNodePropsFile: string | null = null;

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
		const tabFileProps = this.tabContainer.createEl('button', { text: 'File Properties', cls: 'canvas-nodes-tab' });
		tabNodes.onclick = () => { this.currentTab = 'nodes'; this.updateNodes(); };
		tabHistory.onclick = () => { this.currentTab = 'history'; this.updateNodes(); };
		tabFileProps.onclick = () => { this.currentTab = 'fileProps'; this.updateNodes(); };
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
		switch (this.currentTab) {
			case 'nodes':
				tabs[0].classList.add('active');
				break;
			case 'history':
				tabs[1].classList.add('active');
				break;
			case 'fileProps':
				tabs[2].classList.add('active');
				break;
		}

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
							// === クリックイベント追加 ===
							detailsEl.style.cursor = 'pointer';
							detailsEl.title = 'クリックでファイルプロパティを表示';
							detailsEl.onclick = async (e) => {
								e.stopPropagation();
								if (!node.file) return;
								try {
									const tfile = this.plugin.app.vault.getAbstractFileByPath(node.file);
									if (!tfile || !(tfile instanceof TFile)) {
										new Notice('ファイルが見つかりません');
										return;
									}
									const content = await this.plugin.app.vault.read(tfile);
									const props = parseCanvasExYamlFences(content);
									this.fileNodeProps = props;
									this.fileNodePropsFile = node.file;
									this.currentTab = 'fileProps';
									this.updateNodes();
								} catch (err) {
									new Notice('ファイル読み込みエラー');
								}
							};
							// === 右クリックメニュー追加 ===
							nodeEl.addEventListener('contextmenu', (e) => {
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
								menu.style.minWidth = '260px';

								// 1. 接続textノード一覧を出力
								const itemList = document.createElement('div');
								itemList.textContent = 'Output list of connected text nodes';
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
									const canvasData = this.plugin.getCanvasData();
									if (!canvasData) {
										new Notice('Canvas data not found');
										return;
									}
									const edges = canvasData.edges || [];
									const nodes = canvasData.nodes || [];
									// fileノードにtoNodeとして接続されているedgeを抽出
									const connectedTextNodes = edges
										.filter((edge: any) => edge.toNode === node.id)
										.map((edge: any) => nodes.find((n: any) => n.id === edge.fromNode && n.type === 'text'))
										.filter((n: any) => n);
									if (connectedTextNodes.length === 0) {
										new Notice('No connected text nodes found');
										return;
									}
									let msg = 'List of text nodes connected to this file node:\n';
									connectedTextNodes.forEach((t: any) => {
										msg += `ID: ${t.id}\nContent: ${t.text}\n---\n`;
									});
									console.log(msg);
									new Notice('List of connected text nodes has been output to the console');
								};
								menu.appendChild(itemList);

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
						// === 右クリックメニュー追加 ===
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
								const allNodes = (this.plugin.getCanvasData()?.nodes ?? []) as CanvasNode[];
								const group = node;
								const texts = allNodes.filter((n: any) =>
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
								texts.forEach((t: any) => {
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
								const msgObj = (this.plugin.settings.groqDefaultMessages || []).find((m: any) => m.id === this.plugin.settings.groqDefaultMessageId) || { message: '' };
								const defaultMsg = msgObj.message || '';
								const group = node;
								const allNodes = (this.plugin.getCanvasData()?.nodes ?? []) as CanvasNode[];
								const texts = allNodes.filter((n: any) =>
									n.type === 'text' &&
									typeof n.x === 'number' && typeof n.y === 'number' &&
									typeof n.width === 'number' && typeof n.height === 'number' &&
									n.x >= group.x &&
									n.y >= group.y &&
									(n.x + n.width) <= (group.x + group.width) &&
									(n.y + n.height) <= (group.y + group.height)
								).sort((a: any, b: any) => a.y - b.y || a.x - b.x);
								let content = '';
								if (defaultMsg) {
									content = applyGroupTemplate(defaultMsg, texts);
								} else {
									content = texts.map((t: any) => t.text).join('\n');
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
										if (extracted !== null) {
											if (this.plugin.settings.groqExtractFields) {
												try {
													const obj = JSON.parse(extracted);
													const fieldList = this.plugin.settings.groqExtractFields.split(',').map((f: any) => f.trim()).filter((f: any) => f);
													if (Array.isArray(obj)) {
														for (const item of obj) {
															const text = fieldList.map((f: any) => formatField(item, f)).join('\n');
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
															nodeTexts.push(fieldList.map((f: any) => formatField(obj, f)).join('\n'));
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
										} else {
											nodeTexts.push(responseText);
										}
									} else {
										nodeTexts.push(responseText);
									}
									// 現在開いているcanvasファイルを取得
									const activeLeaf = this.plugin.app.workspace.activeLeaf;
									let canvasFile: TFile | null = null;
									if (activeLeaf && activeLeaf.view && typeof (activeLeaf.view as any).file === 'object') {
										canvasFile = (activeLeaf.view as any).file as TFile;
									}
									if (!canvasFile) {
										const canvasLeaves = this.plugin.app.workspace.getLeavesOfType('canvas');
										if (canvasLeaves.length > 0 && typeof (canvasLeaves[0].view as any).file === 'object') {
											canvasFile = (canvasLeaves[0].view as any).file as TFile;
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
									let baseX = node.x + node.width + 40;
									let baseY = node.y + node.height - 60;
									nodeTexts.forEach((text, idx) => {
										// 追加: {{flag: ...}}を削除
										const cleanedText = typeof text === 'string' ? text.replace(/\{\{flag:.*?\}\}/g, '').trim() : text;
										const newNode = {
											id: 'node-' + Date.now() + '-' + Math.random().toString(36).slice(2),
											type: 'text',
											text: cleanedText,
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

					// --- ドラッグ＆ドロップ用 ---
					entryEl.setAttr('draggable', 'true');
					entryEl.addEventListener('dragstart', (e: DragEvent) => {
						if (e.dataTransfer) {
							e.dataTransfer.setData('text/plain', entry.text);
							e.dataTransfer.effectAllowed = 'copy';
						}
					});
				});
			}
		} else if (this.currentTab === 'fileProps') {
			// === ファイルプロパティ表示 ===
			const file = this.fileNodePropsFile;
			const props = this.fileNodeProps;
			if (!file) {
				this.nodesContainer.createEl('p', { text: 'ファイルが選択されていません', cls: 'canvas-ex-nodes-empty' });
				return;
			}
			this.nodesContainer.createEl('h4', { text: `File Properties: ${file}` });
			if (!props || props.length === 0) {
				this.nodesContainer.createEl('p', { text: 'canvasex/cexコードフェンスが見つかりません', cls: 'canvas-ex-nodes-empty' });
				return;
			}
			props.forEach((obj, idx) => {
				const block = this.nodesContainer.createEl('div', { cls: 'canvas-ex-file-props-block' });
				block.createEl('div', { text: `--- Block ${idx + 1} ---`, cls: 'canvas-ex-file-props-block-title' });
				const table = block.createEl('div', { cls: 'canvas-ex-file-props-table' });
				let prevKey: string | null = null;
				for (const key in obj) {
					if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
					const value = obj[key];
					if (Array.isArray(value)) {
						value.forEach((v, i) => {
							const row = table.createEl('div', { cls: 'canvas-ex-file-props-row' });
							row.createEl('div', { text: prevKey === key ? '' : key, cls: 'canvas-ex-file-props-label' });
							const valDiv = row.createEl('div', { cls: 'canvas-ex-file-props-value' });
							const displayValue = typeof v === 'string' ? v : (typeof v === 'object' && v !== null ? (() => { let arr = []; for (const k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) arr.push(`${k}: ${v[k]}`); } return arr.join(', '); })() : String(v));
							valDiv.textContent = displayValue;
							valDiv.setAttr('draggable', 'true');
							valDiv.addEventListener('dragstart', (e: DragEvent) => {
								if (e.dataTransfer) {
									const textWithId = `${key}: ${displayValue} {{flag: cex}}`;
									e.dataTransfer.setData('text/plain', textWithId);
									e.dataTransfer.effectAllowed = 'copy';
								}
							});
							prevKey = key;
						});
					} else if (typeof value === 'object' && value !== null) {
						const row = table.createEl('div', { cls: 'canvas-ex-file-props-row' });
						row.createEl('div', { text: prevKey === key ? '' : key, cls: 'canvas-ex-file-props-label' });
						const valDiv = row.createEl('div', { cls: 'canvas-ex-file-props-value' });
						const objTable = valDiv.createEl('div', { cls: 'canvas-ex-file-props-object' });
						for (const k in value) {
							if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
							const v = value[k];
							const objRow = objTable.createEl('div', { cls: 'canvas-ex-file-props-row-nested' });
							objRow.createEl('div', { text: prevKey === k ? '' : k, cls: 'canvas-ex-file-props-label-nested' });
							const vDiv = objRow.createEl('div', { text: String(v), cls: 'canvas-ex-file-props-value-nested' });
							vDiv.setAttr('draggable', 'true');
							vDiv.addEventListener('dragstart', (e: DragEvent) => {
								if (e.dataTransfer) {
									const textWithId = `${k}: ${v} {{flag: cex}}`;
									e.dataTransfer.setData('text/plain', textWithId);
									e.dataTransfer.effectAllowed = 'copy';
								}
							});
							prevKey = k;
						}
						prevKey = key;
					} else {
						const row = table.createEl('div', { cls: 'canvas-ex-file-props-row' });
						row.createEl('div', { text: prevKey === key ? '' : key, cls: 'canvas-ex-file-props-label' });
						const valDiv = row.createEl('div', { text: String(value), cls: 'canvas-ex-file-props-value' });
						valDiv.setAttr('draggable', 'true');
						valDiv.addEventListener('dragstart', (e: DragEvent) => {
							if (e.dataTransfer) {
								const textWithId = `${key}: ${value} {{flag: cex}}`;
								e.dataTransfer.setData('text/plain', textWithId);
								e.dataTransfer.effectAllowed = 'copy';
							}
						});
						prevKey = key;
					}
				}
			});
		}
	}

	/**
	 * file propsから指定値を削除し、UIを更新する
	 * @param file ファイル名
	 * @param value 削除したい値の文字列（例: 'key: value'）
	 */
	removeFilePropValue(file: string, value: string) {
		// 設定でONのときだけ削除
		if (!this.plugin.settings.groqRemovePropOnDrop) return;
		if (!this.fileNodePropsFile || this.fileNodePropsFile !== file) return;
		let changed = false;
		// fileNodePropsは配列（各ブロック）
		this.fileNodeProps = this.fileNodeProps.map((block) => {
			const newBlock: any = {};
			for (const key in block) {
				if (!Object.prototype.hasOwnProperty.call(block, key)) continue;
				const v = block[key];
				if (Array.isArray(v)) {
					// 配列の場合、valueに一致するものを除外
					const filtered = v.filter((item) => {
						const str = typeof item === 'string' ? item : JSON.stringify(item);
						return !value.startsWith(`${key}: `) || str !== value.slice(key.length + 2);
					});
					if (filtered.length !== v.length) changed = true;
					newBlock[key] = filtered;
				} else if (typeof v === 'object' && v !== null) {
					// オブジェクトの場合、valueに一致するものを除外
					const filteredObj: any = {};
					for (const k in v) {
						if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
						const vv = v[k];
						const str = `${k}: ${vv}`;
						if (value !== str) {
							filteredObj[k] = vv;
						} else {
							changed = true;
						}
					}
					newBlock[key] = filteredObj;
				} else {
					// プリミティブ値
					const str = `${key}: ${v}`;
					if (value !== str) {
						newBlock[key] = v;
					} else {
						changed = true;
					}
				}
			}
			return newBlock;
		});
		if (changed) {
			this.updateNodes();
			// === 実ファイルも修正 ===
			if (this.fileNodePropsFile) {
				const app = this.plugin.app;
				const tfile = app.vault.getAbstractFileByPath(this.fileNodePropsFile);
				if (tfile && tfile instanceof TFile) {
					app.vault.read(tfile).then((content: string) => {
						// YAMLフェンスをパース
						const blocks = parseCanvasExYamlFences(content);
						let modified = false;
						const newBlocks = blocks.map((block: any) => {
							const newBlock: any = {};
							for (const key in block) {
								if (!Object.prototype.hasOwnProperty.call(block, key)) continue;
								const v = block[key];
								if (Array.isArray(v)) {
									const filtered = v.filter((item) => {
										const str = typeof item === 'string' ? item : JSON.stringify(item);
										return !value.startsWith(`${key}: `) || str !== value.slice(key.length + 2);
									});
									if (filtered.length !== v.length) modified = true;
									newBlock[key] = filtered;
								} else if (typeof v === 'object' && v !== null) {
									const filteredObj: any = {};
									for (const k in v) {
										if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
										const vv = v[k];
										const str = `${k}: ${vv}`;
										if (value !== str) {
											filteredObj[k] = vv;
										} else {
											modified = true;
										}
									}
									newBlock[key] = filteredObj;
								} else {
									const str = `${key}: ${v}`;
									if (value !== str) {
										newBlock[key] = v;
									} else {
										modified = true;
									}
								}
							}
							return newBlock;
						});
						if (modified) {
							let newContent = content;
							let idx = 0;
							newContent = newContent.replace(/````?(canvasex|cex)[\s\S]*?````?/g, (match: string, fenceType: string) => {
								const block = newBlocks[idx++];
								return '```' + fenceType + '\n' + yaml.dump(block) + '```';
							});
							app.vault.modify(tfile, newContent);
						}
					});
				}
			}
		}
	}
}