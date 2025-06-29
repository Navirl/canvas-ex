import { Vault, normalizePath } from 'obsidian';

export interface OutputTemplate {
  id: string;
  label: string;
  template: string;
}

// outputDir: 'path/to/.obsidian/plugins/canvas-ex/output' など
// outputディレクトリ配下の全テンプレートjsonを読み込む
export async function loadAllOutputTemplates(vault: Vault, outputDir: string): Promise<OutputTemplate[]> {
  const templates: OutputTemplate[] = [];
  try {
    // outputディレクトリがなければ作成
    if (!(await vault.adapter.exists(outputDir))) {
      await vault.createFolder(outputDir);
    }
    const files = await vault.adapter.list(outputDir);
    for (const file of files.files) {
      if (file.endsWith('.json')) {
        try {
          const jsonStr = await vault.adapter.read(file);
          const obj = JSON.parse(jsonStr);
          if (obj && obj.id && obj.label && typeof obj.template === 'string') {
            templates.push(obj);
          }
        } catch {}
      }
    }
  } catch {}
  return templates;
}

// テンプレートを保存（新規/上書き）
export async function saveOutputTemplate(vault: Vault, outputDir: string, tpl: OutputTemplate): Promise<void> {
  if (!(await vault.adapter.exists(outputDir))) {
    await vault.createFolder(outputDir);
  }
  const filePath = normalizePath(`${outputDir}/${tpl.id}.json`);
  await vault.adapter.write(filePath, JSON.stringify(tpl, null, 2));
}

// テンプレートを削除
export async function deleteOutputTemplate(vault: Vault, outputDir: string, id: string): Promise<void> {
  const filePath = normalizePath(`${outputDir}/${id}.json`);
  if (await vault.adapter.exists(filePath)) {
    await vault.adapter.remove(filePath);
  }
} 