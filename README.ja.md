# Canvas Ex Plugin

> このリポジトリのほとんどは、[Cursor](https://www.cursor.so/)（AIペアプログラミングツール）を使用して作成されました。

ObsidianのCanvasでノード情報を取得・活用・AI連携できる多機能ユーティリティプラグインです。

## 主な機能

- **Canvasノード一覧・履歴サイドバー**: サイドバーで現在開いているCanvasのノード一覧やGroq経由で追加した履歴を確認・検索・フィルタ可能
- **ノード情報取得API**: `getCanvasNodes()` `getCanvasData()` `logCanvasNodes()` などの関数をコンソールから利用可能
- **Groq API連携**: Canvasノードやグループ内テキストをAI（Groq）に送信し、レスポンスを新規ノードとしてCanvasに追加
- **履歴のドラッグ＆ドロップ**: 履歴タブからCanvasへテキストノードをドラッグ＆ドロップで追加
- **右クリックメニュー**: グループノードの右クリックで「グループ内テキスト一覧出力」「GroqにPOST」などのアクション
- **柔軟な設定**: Groq APIキー、モデル選択、デフォルトメッセージ、JSON抽出・フィールド指定など細かくカスタマイズ可能

## 使い方

### 1. インストール

1. このリポジトリをクローンまたはダウンロード
2. Obsidianのプラグインフォルダ（`.obsidian/plugins/`）に配置
3. Obsidianを再起動し、設定→コミュニティプラグインから「Canvas Ex」を有効化

### 2. サイドバーの利用

- 右サイドバーに「Canvas Nodes」アイコンが追加されます
- ノード一覧/履歴タブでCanvasノードや履歴を確認・検索・フィルタできます
- 履歴タブの項目はドラッグ＆ドロップでCanvasに追加可能

### 3. Groq API連携

- サイドバーのグループノードを右クリック→「GroqにPOST」で、グループ内テキストをAIに送信し、レスポンスを新規ノードとしてCanvasに追加
- コマンドパレットから「Groq Chat Completion (API POST)」で任意のメッセージをAIに送信し、履歴に保存
- 設定画面でAPIキーやモデル、デフォルトメッセージ、JSON抽出方法などを指定可能

#### 対応モデル例（`models.json`より）
- llama3-8b-8192
- llama3-70b-8192
- mixtral-8x7b-32768
- gemma-7b-it
- qwen/qwen3-32b

### 4. コンソールAPI

開発者ツール（F12）で以下の関数が利用できます：

```js
// 全てのノードを取得
const nodes = getCanvasNodes();
console.log(nodes);

// 完全なcanvasデータを取得
const canvasData = getCanvasData();
console.log(canvasData);

// ノード情報を詳細に出力
logCanvasNodes();
```

### 5. ノードタイプ

- **file**: ファイルノード（`file`, `subpath`）
- **text**: テキストノード（`text`）
- **link**: リンクノード（`url`）
- **group**: グループノード（`label`, `background`, `backgroundStyle`）

## 設定項目

- **Groq APIキー**: https://console.groq.com/ で取得したAPIキー
- **Groq モデル**: 利用するAIモデル（`models.json`で追加可能）
- **デフォルトメッセージ**: Groqに送る初期メッセージテンプレート
- **JSONのみ抽出**: AIレスポンスから最初のJSON部分だけをノード/履歴に反映
- **抽出フィールド**: JSONから特定フィールドのみ抽出してノード化（カンマ区切り指定）

## 開発・ビルド

```bash
# 依存関係をインストール
npm install

# 開発モードでビルド
npm run dev

# 本番用ビルド
npm run build
```

- TypeScript, esbuild利用
- 主要依存: obsidian, esbuild, typescript など

## ライセンス

MIT License 