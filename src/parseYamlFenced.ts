import * as yaml from 'js-yaml';

/**
 * テキスト内の```canvasex または ```cex コードフェンス内をyamlとしてパースし、配列で返す
 * @param text 対象テキスト
 * @returns yamlとしてパースしたオブジェクト配列
 */
export function parseCanvasExYamlFences(text: string): any[] {
  const regex = /```(?:canvasex|cex)\s*([\s\S]*?)```/g;
  const results: any[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const yamlText = match[1].trim();
    try {
      const parsed = yaml.load(yamlText);
      results.push(parsed);
    } catch (e) {
      // パース失敗時はnullをpush
      results.push(null);
    }
  }
  return results;
} 