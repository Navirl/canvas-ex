import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type CanvasExPlugin from '../main';

// モデル選択肢の型
export interface GroqModelOption {
  value: string;
  label: string;
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