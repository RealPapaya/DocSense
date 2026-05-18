# DocSense 中文說明

> [English](#docsense) | **中文**

**本機文件混合搜尋 — PDF、DOCX、XLSX、PPTX。**  
語意搜尋 + 全文搜尋混合模式，完全離線運行，無需 Docker、無需雲端服務、無需 GPU。

---

## 目錄

- [功能特色](#功能特色)
- [快速開始](#快速開始)
- [新增文件](#新增文件)
- [搜尋模式](#搜尋模式)
- [使用者介面](#使用者介面)
- [API 說明](#api-說明)
- [專案結構](#專案結構)
- [系統架構](#系統架構)
- [設定說明](#設定說明)
- [開發指南](#開發指南)
- [系統需求](#系統需求)

---

## 功能特色

- 🔍 **混合搜尋** — 語意向量搜尋與 BM25 關鍵字搜尋並行運行，透過 Reciprocal Rank Fusion（RRF）融合結果
- 📄 **多格式支援** — 內建支援 PDF、DOCX、XLSX、PPTX 四種格式
- ⚡ **即時索引** — 將文件拖入 `watched_docs/` 資料夾，幾秒內即可搜尋，無需重啟
- 🔒 **完全離線** — 首次啟動後無需任何網路連線，不依賴任何雲端 API
- 🧠 **ONNX 向量化** — 使用 `BAAI/bge-small-en-v1.5` 搭配 fastembed，不需要 PyTorch，不需要 GPU
- 🗄️ **雙重儲存** — Qdrant 向量資料庫（子程序模式）+ SQLite FTS5 全文索引並行運作
- 🖥️ **內建介面** — React 18 單頁應用程式，直接於 `http://localhost:8000` 開啟，無需額外編譯步驟
- 📦 **可打包發布** — 附有 PyInstaller Spec，可打包成 Windows `.exe` 單一執行檔

---

## 快速開始

```bash
# 1. 複製專案
git clone <repo-url>
cd docsense

# 2. 建立並啟用虛擬環境（建議）
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# 3. 安裝相依套件
pip install -r requirements.txt

# 4. 啟動 DocSense
python start.py
```

**首次執行時，系統會自動：**

1. 從 GitHub Releases 下載最新版 Qdrant 執行檔（約 35 MB，僅需一次）
2. 在 Port **6333** 啟動 Qdrant 子程序
3. 在 Port **8000** 啟動 FastAPI 伺服器（透過 Uvicorn）
4. 在背景對 `watched_docs/` 中的現有文件進行索引
5. 在背景預載入 ONNX 向量化模型
6. 自動在瀏覽器開啟 `http://localhost:8000`

> 伺服器啟動後即可立即接受請求。索引與模型載入在背景進行，可透過 `/api/status` 或介面上的進度條查看狀態。

---

## 新增文件

將 **PDF、DOCX、XLSX 或 PPTX** 檔案直接丟入 `watched_docs/` 資料夾。

- 系統會在幾秒內自動偵測並建立索引。
- 無需重啟應用程式。
- 修改現有檔案會自動觸發重新索引。
- 刪除檔案後，下次執行 `/api/index` 時會自動從索引中清除。

您也可以透過 UI 的設定面板，配置一個或多個監看資料夾。

---

## 搜尋模式

| 模式 | 運作方式 | 適用情境 |
|------|---------|---------|
| **混合（Hybrid）**（預設）| 同時執行向量搜尋與關鍵字搜尋，以 RRF（k=60）融合兩個排名列表，最高分正規化為 1.0 | 一般用途，相關性最佳 |
| **語意（Semantic / Vector）** | 透過 Qdrant 進行 Cosine 相似度搜尋，使用 `BAAI/bge-small-en-v1.5`（384 維） | 概念性、自然語言查詢 |
| **關鍵字（Keyword）** | SQLite FTS5 BM25 全文搜尋，搭配 trigram 分詞器 | 精確詞彙、型號、程式碼查詢 |

每筆搜尋結果包含三個分數：`score`（最終融合分數）、`semantic_score`（Cosine 相似度）、`bm25_score`（正規化 BM25 分數），介面上以徽章顯示。

### 進階搜尋選項

- **Occurrences 視圖** — 不以文件分組，而是列出每一個匹配的文字片段與前後文
- **全字比對（Whole Word）** — 限制 ASCII 詞彙邊界匹配
- **區分大小寫（Match Case）** — 大小寫敏感匹配
- **相關詞（Related Terms）** — 以 OR 擴展的額外關鍵字，與主查詢融合排名
- **路徑前綴篩選（Path Prefix）** — 限制結果只來自特定子資料夾

---

## 使用者介面

內建的 SPA（React 18，掛載於 `/`）提供以下功能：

| 面板 | 說明 |
|------|------|
| **搜尋列** | 查詢輸入框，含模式選擇器與視圖切換（Documents / Occurrences） |
| **篩選欄** | 路徑前綴篩選、相關詞、全字比對 / 大小寫開關 |
| **結果面板** | 文件卡片，含分數徽章、匹配高亮、Chunk 預覽 |
| **預覽面板** | 瀏覽器內建 PDF 閱覽器，支援 `#page=N` 頁碼跳轉；其他格式提示下載 |
| **文件總覽（Documents View）** | 所有已索引文件清單，含狀態指示（已索引 / 等待中） |
| **書籤（Bookmarks View）** | 儲存的搜尋結果，持久化至 `data/user-settings.local` |
| **偏好設定面板** | 主題、版面、密度、強調色、字型、卡片樣式 — 所有設定本地持久化 |
| **進度條** | 從 `/api/progress` 即時串流的每個檔案索引進度 |

---

## API 說明

| 方法 | 路徑 | 說明 |
|------|------|------|
| `GET` | `/api/search?q=…&mode=hybrid&limit=10` | 搜尋文件。模式：`hybrid`、`vector`、`keyword`。視圖：`documents`、`occurrences`。 |
| `GET` | `/api/search?q=…&view=occurrences&offset=0` | 分頁 Occurrences 視圖 |
| `POST` | `/api/index` | 在背景觸發所有監看資料夾的完整重新索引 |
| `GET` | `/api/status` | 索引統計（文件數、Chunk 數、Qdrant 向量數、監看資料夾） |
| `GET` | `/api/progress` | 即時每個檔案與批次索引進度 |
| `GET` | `/api/documents` | 列出所有已索引文件及尚待索引（pending）的檔案 |
| `GET` | `/api/file/{doc_id}` | 以原始格式提供文件（PDF 可在瀏覽器內直接開啟）；加上 `?download=1` 強制下載 |
| `GET` | `/api/chunks/{doc_id}` | 回傳指定文件的所有文字 Chunk |
| `POST` | `/api/open/{doc_id}` | 以 OS 預設應用程式開啟非 PDF 檔案（`os.startfile`） |
| `GET` | `/api/watch-folders` | 列出目前監看的資料夾 |
| `POST` | `/api/watch-folder/pick` | 開啟 OS 原生資料夾選擇器並回傳選取路徑 |
| `POST` | `/api/watch-folder/apply` | 儲存單一監看資料夾設定並開始重新索引 |
| `POST` | `/api/watch-folders` | 儲存多個監看資料夾設定並開始重新索引 |
| `GET` | `/api/perf-mode` | 取得目前索引效能模式 |
| `POST` | `/api/perf-mode` | 設定索引效能模式（`balanced`、`fast`、`low`） |
| `GET` | `/api/local-settings` | 讀取持久化的 UI 設定（偏好、標籤、書籤、監看設定） |
| `POST` | `/api/local-settings` | 寫入持久化的 UI 設定 |
| `GET` | `/docs` | Swagger / OpenAPI 互動式文件 |

---

## 專案結構

```
docsense/
├── start.py                    ← 單一入口點（下載 Qdrant、啟動伺服器）
├── docsense_launcher.py        ← Windows TUI 啟動器
├── docsense.bat                ← Windows 批次啟動腳本
├── DocSense.spec               ← PyInstaller 打包 Spec
├── pyproject.toml              ← 專案元資料 + 開發相依
├── requirements.txt            ← 執行期相依（僅 ONNX，無 PyTorch）
│
├── src/
│   ├── app/                    ← FastAPI 應用程式
│   │   ├── config.py           ← 所有路徑、連接埠、模型名稱、Chunk 設定
│   │   ├── main.py             ← 應用程式工廠 + lifespan 處理器
│   │   ├── models.py           ← Pydantic 請求 / 回應 Schema
│   │   ├── perf_settings.py    ← 索引執行緒 / 批次效能設定檔
│   │   ├── watch_runtime.py    ← 監看器生命週期管理
│   │   ├── watch_settings.py   ← 監看資料夾持久化
│   │   └── routes/
│   │       ├── search.py       ← GET /api/search（混合 RRF + 標註）
│   │       ├── index.py        ← /api/index、/api/status、/api/file、/api/documents …
│   │       └── settings.py     ← GET/POST /api/local-settings
│   │   └── services/
│   │       ├── embedder.py     ← fastembed ONNX 單例；延遲載入，執行緒安全
│   │       ├── qdrant_store.py ← Qdrant HTTP 客戶端；UUID5 Point ID
│   │       └── fts.py          ← SQLite FTS5 + BM25；trigram 分詞器；Schema v2
│   │
│   ├── indexer/
│   │   ├── extractor.py        ← PDF / DOCX / XLSX / PPTX → 文字 Chunk
│   │   ├── pipeline.py         ← 擷取 → 向量化 → 原子性替換（SQLite + Qdrant）
│   │   ├── progress.py         ← 每個檔案 + 批次進度追蹤
│   │   └── watcher.py          ← watchdog 觀察器；1 秒 debounce；每路徑鎖
│   │
│   └── frontend/               ← React 18 SPA（無需建置步驟，Babel 在瀏覽器內轉譯）
│       ├── index.html          ← 外殼頁面；以固定依賴順序載入腳本
│       ├── styles/main.css     ← 所有 CSS（約 1,250 行）；主題 / 版面變數
│       ├── tooltip.js          ← 輕量 [data-tip] 工具提示
│       ├── lib/                ← 共用工具（helpers、i18n、prefs、tags、bookmarks、api）
│       ├── tweaks/             ← 浮動偏好設定面板
│       ├── components/         ← Topbar、SearchRow、FiltersRail、ResultsPanel、PreviewPanel、StatusBar、TagAssignMenu
│       ├── views/              ← DocumentsView、BookmarksView
│       └── app.jsx             ← App 根元件 + ReactDOM.render（最後載入）
│
├── data/                       ← 所有執行期狀態（gitignored）
│   ├── db/                     ← SQLite 資料庫（docsense.db）
│   ├── qdrant_data/            ← Qdrant 向量儲存
│   ├── qdrant_bin/             ← 自動下載的 Qdrant 執行檔
│   ├── snapshots/              ← Qdrant 快照
│   ├── logs/                   ← Uvicorn + Qdrant + 啟動器日誌
│   └── user-settings.local     ← 持久化的 UI 偏好 / 標籤 / 書籤
│
├── watched_docs/               ← 文件投放區（gitignored）
└── tests/
    ├── test_search_matching.py
    └── test_watch_folder.py
```

---

## 系統架構

### 啟動流程（`start.py`）

1. **舊目錄遷移**：將舊版（未重構前）的 `db/`、`qdrant_data/`、`qdrant_bin/`、`snapshots/`、`logs/` 從專案根目錄移至 `data/`（一次性）
2. **下載 Qdrant 執行檔**：從 GitHub Releases 抓取對應平台的二進位檔（Windows/macOS/Linux x86-64/arm64）
3. **啟動 Qdrant 子程序**：透過環境變數配置，輪詢 `/healthz` 等待就緒
4. **啟動 Uvicorn 背景執行緒**：FastAPI 應用程式立即開始接受請求
5. **開啟瀏覽器**

### FastAPI Lifespan（`src/app/main.py`）

```
init_db() → ensure_collection() → start_watcher()
    ↳ 背景任務：index_all() + _prewarm_embedder()
```

伺服器啟動後立即可服務；索引與模型預熱在背景執行緒中進行。

### 搜尋管線（`src/app/routes/search.py`）

- **混合模式**：向量搜尋與 FTS5 搜尋並行執行，以 RRF（k=60）融合，最高分正規化為 1.0
- **向量模式**：Qdrant Cosine 相似度 top-K
- **關鍵字模式**：FTS5 BM25（負 rank 正規化為 0–1）；2 字以下 token 退化為 `LIKE '%...%'`

### 索引管線（`src/indexer/pipeline.py`）

- **Doc ID**：`sha256(abs_filepath)[:16]` — 跨重啟穩定
- **Skip 判斷**：`abs(existing_mtime - current_mtime) < 1.0`秒
- **原子性替換**：先刪除 SQLite 行（CASCADE 到 chunks → FTS 觸發器）+ Qdrant 向量，再插入新資料
- **生產者 / 消費者架構**：文字擷取（I/O 密集）在背景執行緒進行，向量化 + 儲存（CPU 密集）在主執行緒進行，兩者並行以縮短總處理時間

### 檔案監看（`src/indexer/watcher.py`）

- Watchdog `FileSystemEventHandler` 遞迴監看 `WATCHED_DOCS_DIR`
- 事件進入單一 Queue → 1 秒 debounce → 等待檔案大小穩定（防止 Office 檔案尚未寫入完成）
- 每路徑鎖（per-path lock）防止同一文件並行索引造成記憶體暴增

### 儲存層

| 服務 | 檔案 | 重點說明 |
|------|------|---------|
| 向量資料庫 | `src/app/services/qdrant_store.py` | HTTP-only 客戶端；集合 `documents`，384 維 Cosine；Point ID = `UUID5(DNS, "{doc_id}:{chunk_index}")` |
| 全文索引 | `src/app/services/fts.py` | SQLite FTS5 + trigram 分詞器；`chunks_fts` 虛擬表透過觸發器與 `chunks` 同步；Schema v2 自動 rebuild |
| 向量化 | `src/app/services/embedder.py` | `fastembed.TextEmbedding` 延遲載入單例；模型首次呼叫時自動快取；執行緒數 = `min(4, cores/2)` |

---

## 設定說明

所有可調整的常數都在 `src/app/config.py`：

| 常數 | 預設值 | 說明 |
|------|--------|------|
| `EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | fastembed 模型名稱 |
| `CHUNK_SIZE` | `1500` | 每個 Chunk 的字元數 |
| `CHUNK_OVERLAP` | `150` | 相鄰 Chunk 的重疊字元數 |
| `RRF_K` | `60` | RRF 融合常數 |
| `QDRANT_PORT` | `6333` | Qdrant 子程序的連接埠 |
| `API_PORT` | `8000` | FastAPI 伺服器的連接埠 |
| `QDRANT_VECTOR_SIZE` | `384` | 必須與向量化模型輸出維度一致 |
| `WATCHED_DOCS_DIR` | `<專案根目錄>/watched_docs` | 預設文件投放區 |
| `DATA_DIR` | `<專案根目錄>/data` | 所有執行期狀態的根目錄 |

---

## 開發指南

```bash
# 安裝開發相依套件
pip install -e ".[dev]"

# 執行所有測試
pytest

# 執行單一測試
pytest tests/test_search_matching.py::test_hybrid_search

# 程式碼檢查
ruff check src/app src/indexer

# 程式碼格式化
ruff format src/app src/indexer
```

> `pyproject.toml` 設定了 `pythonpath = ["src"]`，讓 pytest 可以直接匯入 `app.*` 與 `indexer.*` 而無需任何路徑設定。

### 前端注意事項

前端使用 React 18 + Babel CDN 在瀏覽器內即時轉譯，**不需要 Node.js 或任何建置工具**。  
跨檔案的參照依賴頂層 `var` / `function` 宣告成為全域 window 物件屬性。  
腳本載入順序固定於 `index.html`（lib → tweaks → components → views → `app.jsx`），新增元件時需依照依賴層級插入正確位置。

---

## 系統需求

- **Python** 3.11+
- **首次執行需要網路連線** — 下載 Qdrant 執行檔（約 35 MB）與 ONNX 向量化模型（約 130 MB）；之後完全離線
- **磁碟空間** — 約 500 MB（模型快取 + Qdrant 執行檔 + 文件索引）
- **不需要 Docker。不需要 PyTorch。不需要 GPU。**

支援平台：Windows x86-64、macOS x86-64 / Apple Silicon（arm64）、Linux x86-64
