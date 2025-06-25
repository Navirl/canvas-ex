# Canvas Ex Plugin 使用方法

## インストール

1. このフォルダをObsidianのプラグインディレクトリにコピーします
2. Obsidianを再起動します
3. 設定 → コミュニティプラグイン → プラグインを有効にする で「Canvas Ex」を有効化します

## 使用方法

### 1. Canvasファイルを開く
まず、ノードを取得したいCanvasファイルを開きます。

### 2. 開発者ツールを開く
- Windows/Linux: `Ctrl + Shift + I`
- Mac: `Cmd + Option + I`

### 3. コンソールで関数を実行

#### 基本的な使用方法
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

#### 特定のノードタイプをフィルタリング
```javascript
// テキストノードのみを取得
const textNodes = getCanvasNodes().filter(node => node.type === 'text');
console.log('テキストノード:', textNodes);

// ファイルノードのみを取得
const fileNodes = getCanvasNodes().filter(node => node.type === 'file');
console.log('ファイルノード:', fileNodes);
```

#### ノードの位置情報を取得
```javascript
// ノードの位置情報を配列で取得
const positions = getCanvasNodes().map(node => ({
  id: node.id,
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height
}));
console.log('位置情報:', positions);
```

#### ノードの内容を取得
```javascript
// テキストノードの内容を取得
const texts = getCanvasNodes()
  .filter(node => node.type === 'text')
  .map(node => node.text);
console.log('テキスト内容:', texts);

// ファイルノードのファイルパスを取得
const files = getCanvasNodes()
  .filter(node => node.type === 'file')
  .map(node => node.file);
console.log('ファイルパス:', files);
```

#### エッジ（接続）情報を取得
```javascript
// エッジ情報を取得
const canvasData = getCanvasData();
if (canvasData && canvasData.edges) {
  console.log('エッジ情報:', canvasData.edges);
  
  // 特定のノードからの接続を取得
  const nodeId = 'your-node-id';
  const connections = canvasData.edges.filter(edge => edge.fromNode === nodeId);
  console.log(`${nodeId}からの接続:`, connections);
}
```

#### ノードの統計情報を取得
```javascript
// ノードタイプ別の統計
const nodes = getCanvasNodes();
const stats = nodes.reduce((acc, node) => {
  acc[node.type] = (acc[node.type] || 0) + 1;
  return acc;
}, {});

console.log('ノード統計:', stats);
console.log(`総ノード数: ${nodes.length}`);
```

## 戻り値の形式

### getCanvasNodes() の戻り値
```javascript
[
  {
    id: "node-id",
    x: 100,
    y: 200,
    width: 300,
    height: 150,
    color: "#ff0000",
    type: "text",
    text: "ノードの内容"  // type === 'text' の場合
  },
  {
    id: "file-node-id",
    x: 400,
    y: 300,
    width: 200,
    height: 100,
    type: "file",
    file: "path/to/file.md",  // type === 'file' の場合
    subpath: "#heading"       // オプション
  }
]
```

### getCanvasData() の戻り値
```javascript
{
  nodes: [...],  // ノードの配列
  edges: [       // エッジの配列
    {
      id: "edge-id",
      fromNode: "node-id-1",
      fromSide: "right",
      toNode: "node-id-2",
      toSide: "left",
      label: "接続ラベル",  // オプション
      color: "#0000ff"     // オプション
    }
  ]
}
```

## トラブルシューティング

### エラーメッセージ
- **「アクティブなcanvasビューが見つかりません」**: Canvasファイルが開かれていません
- **「canvasオブジェクトが見つかりません」**: プラグインが正しく読み込まれていません
- **「ノードが見つかりません」**: Canvasにノードが存在しません

### よくある問題
1. **関数が見つからない**: プラグインが有効化されているか確認してください
2. **空の配列が返される**: Canvasファイルが開かれているか確認してください
3. **エラーが発生する**: ブラウザを再読み込みしてから再試行してください

## 高度な使用方法

### ノードの検索
```javascript
// 特定のテキストを含むノードを検索
const searchText = "検索したいテキスト";
const matchingNodes = getCanvasNodes().filter(node => 
  node.type === 'text' && node.text.includes(searchText)
);
console.log('検索結果:', matchingNodes);
```

### ノードの並び替え
```javascript
// X座標でソート
const sortedByX = getCanvasNodes().sort((a, b) => a.x - b.x);
console.log('X座標順:', sortedByX);

// Y座標でソート
const sortedByY = getCanvasNodes().sort((a, b) => a.y - b.y);
console.log('Y座標順:', sortedByY);
```

### データのエクスポート
```javascript
// JSONとしてエクスポート
const canvasData = getCanvasData();
const jsonString = JSON.stringify(canvasData, null, 2);
console.log('JSONデータ:', jsonString);

// クリップボードにコピー（ブラウザによっては動作しない場合があります）
navigator.clipboard.writeText(jsonString).then(() => {
  console.log('クリップボードにコピーされました');
});
``` 