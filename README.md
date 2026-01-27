# World Country Risks — Logic Transparency & GitHub Pages Mirror

**Live dashboards**
- Primary (custom domain): https://world.countryrisks.org/
- Secondary mirror (GitHub Pages): https://mnakagaw.github.io/world-country-risks/

This repository is the **public transparency layer** of the World Country Risks project:
- Publishes core **logic and UI** for reproducibility (research/policy).
- Hosts a **read-only mirror** site via GitHub Pages.

> This dashboard provides risk *signals* derived from open data pipelines. It is not a definitive statement of ground truth.

---

## What the dashboard measures (R1–R4)

The system tracks country-level stress signals as four operational bundles:

- **R1 — Security / Violence**
- **R2 — Living / Basic Services**
- **R3 — Governance / Legitimacy**
- **R4 — Fiscal / Economic stress**

Implementation details (generation, scoring, and UI) are in `scripts/` and `src/`.

---

## Branches and what they contain

This public repository uses two branches with different purposes:

### `main` — logic transparency (source code)
Contains the source code and configuration needed to understand and reproduce the logic:
- `src/` (UI)
- `scripts/` (generation pipeline)
- `config/`, `tests/`, `public/` (light assets)
- `LICENSE`, `SECURITY.md`, `.env.example`

To keep `main` lightweight, large runtime datasets are excluded (for example `public/data/`, `public/geo/`).

### `gh-pages` — published site artifacts
Contains the built static site output (equivalent to `dist/`). GitHub Pages serves **this branch**.

---

## How public updates work (two-stage sync)

### 1) Source sync (logic) — when code changes
When the **private build repo** updates its `main`, a workflow syncs an allowlist of safe files to this public repo’s `main`.

- Goal: publish logic for transparency
- Safety: credentials and large data are excluded by design

### 2) Artifact sync (site) — when daily builds run
Daily (or manual) runs generate data and build the site **once**, then deploy the same artifacts to:
1) the primary custom-domain site (FTP)
2) GitHub Pages (`gh-pages` branch)

This is the **Build Once, Deploy Twice** design to avoid double BigQuery execution.

---

## Reproducibility (local)

### Requirements
- Node.js 20+
- npm
- BigQuery project + credentials (only if running full generation)

### Install

    npm ci

### Run UI locally

    npm run dev

### Generate data + build (may incur BigQuery cost)

    npm run generate
    npm run build

### Environment variables
See `.env.example`. Typical variables:
- `BQ_PROJECT_ID` (or `GOOGLE_CLOUD_PROJECT`)
- `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON path)
- `GEMINI_API_KEY` (optional; depends on configuration)

> Cost note: `npm run generate` may scan large datasets depending on query windows and baselines.

---

## Security
Do **not** commit secrets or credentials. For vulnerability reporting, see `SECURITY.md`.

---

## License
MIT — see `LICENSE`.

---

<details>
<summary><strong>日本語（概要）</strong></summary>

## このリポジトリは何？
World Country Risks は、国家機能の不安定化を **R1–R4（治安・生活・統治・財政）** の4束で日次モニタリングする早期警戒ダッシュボードです。  
このリポジトリは **ロジック公開（透明性）** と **GitHub Pages ミラー公開** のための公開レイヤーです。

- 本番（独自ドメイン）: https://world.countryrisks.org/
- ミラー（GitHub Pages）: https://mnakagaw.github.io/world-country-risks/

## ブランチの役割
- `main`：ロジック（`src/`, `scripts/`, `config/`, `tests/`）。巨大データは除外して軽量化。  
- `gh-pages`：表示サイトの成果物（`dist` 相当）。Pages はここを配信。

## 更新の仕組み
- ソース同期：Private側の変更を allowlist で抽出し Public `main` に同期  
- 成果物同期：日次で生成＋ビルドを **1回だけ** 実行し、同じ成果物を FTP と Pages に二重配布（Build Once, Deploy Twice）

</details>

<details>
<summary><strong>Español (resumen)</strong></summary>

Este repositorio es la capa pública de transparencia del proyecto World Country Risks:
- `main`: código (UI y lógica) para reproducibilidad.
- `gh-pages`: artefactos compilados del sitio (equivalente a dist) para GitHub Pages.

Actualizaciones:
- Sincronización de lógica cuando cambia el código (allowlist).
- Compilación diaria una sola vez y despliegue a FTP + Pages (Build Once, Deploy Twice) para minimizar costo de BigQuery.

</details>
