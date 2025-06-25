# Canvas Ex Plugin

ObsidianのCanvasで現在開いているノードを取得するためのユーティリティプラグインです。

## 機能

このプラグインは、Obsidianのコンソールで以下の関数を利用できるようにします：

### `getCanvasNodes()`
現在開いているcanvasの全てのノードを取得します。

**戻り値**: ノードの配列
```javascript
[
  {
    id: "node-id",
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    type: "text",
    text: "ノードの内容",
    color: "#ff0000"
  }
]
```

### `getCanvasData()`
現在開いているcanvasの完全なデータ（ノードとエッジ）を取得します。

**戻り値**: Canvasの完全なデータオブジェクト
```javascript
{
  nodes: [...],
  edges: [...],
  // その他のcanvasデータ
}
```

### `logCanvasNodes()`
現在のcanvasのノード情報をコンソールに詳細に出力します。

## 使用方法

1. このプラグインをObsidianにインストールして有効化します
2. Canvasファイルを開きます
3. 開発者ツール（F12）を開いてコンソールにアクセスします
4. 以下のコマンドを実行します：

```javascript
// 全てのノードを取得
const nodes = getCanvasNodes();
console.log(nodes);

// 完全なcanvasデータを取得
const canvasData = getCanvasData();
console.log(canvasData);

// ノード情報を詳細に出力
logCanvasNodes();
```

## ノードタイプ

このプラグインは以下のノードタイプをサポートしています：

- **file**: ファイルノード（`file`, `subpath`プロパティを含む）
- **text**: テキストノード（`text`プロパティを含む）
- **link**: リンクノード（`url`プロパティを含む）
- **group**: グループノード（`label`, `background`, `backgroundStyle`プロパティを含む）

## インストール

1. このリポジトリをクローンまたはダウンロードします
2. Obsidianのプラグインフォルダに配置します
3. Obsidianでプラグインを有効化します

## 開発

```bash
# 依存関係をインストール
npm install

# 開発モードでビルド
npm run dev

# 本番用ビルド
npm run build
```

## ライセンス

MIT License 