import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import type CanvasExPlugin from '../main';
import { loadAllTemplates, saveTemplate, deleteTemplate, GroqDefaultMessage } from './templateIO';
import { loadAllOutputTemplates, saveOutputTemplate, deleteOutputTemplate, OutputTemplate } from './outputTemplateIO';

// モデル選択肢の型
export interface GroqModelOption {
  value: string;
  label: string;
}

// ヘルプモーダル
class OutputTemplateHelpModal extends Modal {
  constructor(app: App) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '出力テンプレートのプレースホルダ一覧' });
    contentEl.createEl('ul', {}, (ul) => {
      ul.createEl('li', { text: '{{json}} : Groqレスポンスから抽出したJSON全体（テキスト）' });
      ul.createEl('li', { text: '{{field1}}, {{field2}}, ... : 「抽出フィールド」設定で指定した順の値（key: value形式）' });
      ul.createEl('li', { text: '{{key1}}, {{key2}}, ... : 「抽出フィールド」設定で指定した順のフィールド名' });
      ul.createEl('li', { text: '{{value1}}, {{value2}}, ... : 「抽出フィールド」設定で指定した順の値（値のみ）' });
    });
    contentEl.createEl('p', { text: '例: "{{field1}}\n---\n{{field2}}" など' });
    contentEl.createEl('p', { text: '今後バージョンアップで拡張される場合があります。' });
  }
  onClose() {
    this.contentEl.empty();
  }
}

// 入力テンプレート用ヘルプモーダル
class InputTemplateHelpModal extends Modal {
  constructor(app: App) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '入力テンプレートのプレースホルダ一覧' });
    contentEl.createEl('ul', {}, (ul) => {
      ul.createEl('li', { text: '{{text1}}, {{text2}}, ... : グループ内のTextノードの内容（上から順にtext1, text2...）' });
    });
    contentEl.createEl('p', { text: '例: "{{text1}}\n---\n{{text2}}" など' });
    contentEl.createEl('p', { text: '今後バージョンアップで拡張される場合があります。' });
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class CanvasExSettingTab extends PluginSettingTab {
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
            this.plugin.saveSettings();
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
          this.plugin.saveSettings();
        });
      });

    // === Input: Groq API Default Message Management ===
    containerEl.createEl('h3', { text: 'Groq API Default Message Management (Input Template)' });
    const msgList = this.plugin.templates || [];
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
          this.plugin.saveSettings();
        });
      });

    // メッセージ一覧・編集UI
    msgList.forEach((msg, idx) => {
      const s = new Setting(containerEl)
        .setName(`Message: ${msg.label}`)
        .addText(text => text.setValue(msg.label).onChange(async (v) => {
          msg.label = v;
          await saveTemplate(this.plugin.app.vault, this.plugin.inputDir, msg);
        }))
        .addTextArea(text => text.setValue(msg.message).onChange(async (v) => {
          msg.message = v;
          await saveTemplate(this.plugin.app.vault, this.plugin.inputDir, msg);
        }));
      // 削除ボタン
      if (msgList.length > 1) {
        s.addExtraButton(btn => btn.setIcon('trash').setTooltip('Delete').onClick(async () => {
          await deleteTemplate(this.plugin.app.vault, this.plugin.inputDir, msg.id);
          if (this.plugin.settings.groqDefaultMessageId === msg.id) {
            this.plugin.settings.groqDefaultMessageId = this.plugin.templates[0]?.id ?? '';
            this.plugin.saveSettings();
          }
          this.plugin.templates = await loadAllTemplates(this.plugin.app.vault, this.plugin.inputDir);
          this.display();
        }));
      }
    });
    // 追加ボタン
    new Setting(containerEl)
      .addButton(btn => btn.setButtonText('Add new message').onClick(async () => {
        const newId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        const newMsg: GroqDefaultMessage = { id: newId, label: 'New Message', message: '' };
        await saveTemplate(this.plugin.app.vault, this.plugin.inputDir, newMsg);
        this.plugin.settings.groqDefaultMessageId = newId;
        this.plugin.saveSettings();
        this.plugin.templates = await loadAllTemplates(this.plugin.app.vault, this.plugin.inputDir);
        this.display();
      }))
      .addExtraButton(btn => btn.setIcon('help').setTooltip('ヘルプ').onClick(() => new InputTemplateHelpModal(this.app).open()));

    // === Output: Groq API Response Output Template Management ===
    containerEl.createEl('hr');
    containerEl.createEl('h3', { text: 'Groq API Response Output Template Management (Output Template)' });
    const outList = this.plugin.outputTemplates || [];
    const outId = this.plugin.settings.groqOutputTemplateId || (outList[0]?.id ?? '');

    // 出力テンプレート選択UI
    new Setting(containerEl)
      .setName('Select output template')
      .setDesc('Choose the output template for Groq API response')
      .addDropdown(drop => {
        outList.forEach(o => drop.addOption(o.id, o.label));
        drop.setValue(outId);
        drop.onChange(async (value) => {
          this.plugin.settings.groqOutputTemplateId = value;
          this.plugin.saveSettings();
        });
      });

    // 出力テンプレート一覧・編集UI
    outList.forEach((tpl, idx) => {
      const s = new Setting(containerEl)
        .setName(`Output: ${tpl.label}`)
        .addText(text => text.setValue(tpl.label).onChange(async (v) => {
          tpl.label = v;
          await saveOutputTemplate(this.plugin.app.vault, this.plugin.outputDir, tpl);
        }))
        .addTextArea(text => text.setValue(tpl.template).onChange(async (v) => {
          tpl.template = v;
          await saveOutputTemplate(this.plugin.app.vault, this.plugin.outputDir, tpl);
        }));
      // 削除ボタン
      if (outList.length > 1) {
        s.addExtraButton(btn => btn.setIcon('trash').setTooltip('Delete').onClick(async () => {
          await deleteOutputTemplate(this.plugin.app.vault, this.plugin.outputDir, tpl.id);
          if (this.plugin.settings.groqOutputTemplateId === tpl.id) {
            this.plugin.settings.groqOutputTemplateId = this.plugin.outputTemplates[0]?.id ?? '';
            this.plugin.saveSettings();
          }
          this.plugin.outputTemplates = await loadAllOutputTemplates(this.plugin.app.vault, this.plugin.outputDir);
          this.display();
        }));
      }
    });
    // 追加ボタン
    new Setting(containerEl)
      .addButton(btn => btn.setButtonText('Add new output template').onClick(async () => {
        const newId = 'out-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        const newTpl: OutputTemplate = { id: newId, label: 'New Output', template: '{{json}}' };
        await saveOutputTemplate(this.plugin.app.vault, this.plugin.outputDir, newTpl);
        this.plugin.settings.groqOutputTemplateId = newId;
        this.plugin.saveSettings();
        this.plugin.outputTemplates = await loadAllOutputTemplates(this.plugin.app.vault, this.plugin.outputDir);
        this.display();
      }))
      .addExtraButton(btn => btn.setIcon('help').setTooltip('ヘルプ').onClick(() => new OutputTemplateHelpModal(this.app).open()));

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
          this.plugin.saveSettings();
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
          this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('ドラッグ＆ドロップで元ファイルの値を削除')
      .setDesc('File Propertiesからcanvasへドラッグ＆ドロップした際、元ファイルの該当値を自動で削除します')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.groqRemovePropOnDrop || false)
        .onChange(async (value) => {
          this.plugin.settings.groqRemovePropOnDrop = value;
          this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('デバッグモード')
      .setDesc('削除処理などの詳細なconsole.logを出力します')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.groqDebugMode || false)
        .onChange(async (value) => {
          this.plugin.settings.groqDebugMode = value;
          this.plugin.saveSettings();
        })
      );
  }
} 