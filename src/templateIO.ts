import { Vault, normalizePath, TFile } from 'obsidian';

export interface GroqDefaultMessage {
  id: string;
  label: string;
  message: string;
}

// inputDir: 'path/to/.obsidian/plugins/canvas-ex/input' など
// inputディレクトリ配下の全テンプレートjsonを読み込む
export async function loadAllTemplates(vault: Vault, inputDir: string): Promise<GroqDefaultMessage[]> {
  const templates: GroqDefaultMessage[] = [];
  try {
    // inputディレクトリがなければ作成
    if (!(await vault.adapter.exists(inputDir))) {
      await vault.createFolder(inputDir);
    }
    const files = await vault.adapter.list(inputDir);
    for (const file of files.files) {
      if (file.endsWith('.json')) {
        try {
          const jsonStr = await vault.adapter.read(file);
          const obj = JSON.parse(jsonStr);
          if (obj && obj.id && obj.label && typeof obj.message === 'string') {
            templates.push(obj);
          }
        } catch (e) {
          // パース失敗はスキップ
        }
      }
    }
  } catch (e) {
    // ディレクトリがない場合など
  }
  return templates;
}

// テンプレートを保存（新規・上書き）
export async function saveTemplate(vault: Vault, inputDir: string, template: GroqDefaultMessage): Promise<void> {
  const fileName = `${inputDir}/${template.id}.json`;
  await vault.adapter.write(fileName, JSON.stringify(template, null, 2));
}

// テンプレートを削除
export async function deleteTemplate(vault: Vault, inputDir: string, id: string): Promise<void> {
  const fileName = `${inputDir}/${id}.json`;
  if (await vault.adapter.exists(fileName)) {
    await vault.adapter.remove(fileName);
  }
} 