<details open>
<summary><strong>日本語</strong></summary>

# World Country Risks（国家機能リスク早期警戒ダッシュボード）

## 0. 概要
World Country Risks は、各国の「国家機能の不安定化（state fragility / stress on state capacity）」を、ニュース由来の出来事データを中心に 日次で可視化する早期警戒ダッシュボードです。  
本プロジェクトの目的は「政権崩壊の予言」ではなく、国家が担うべき中核機能（R1:治安・R2:生活・R3:統治・R4:財政）が どの方向に、どれくらい強く、平時から逸脱しているかを国別に把握し、研究・政策・報道の初動判断を支援することにあります。

- 表示サイト（GitHub Pages）：https://mnakagaw.github.io/world-country-risks/
- 公開リポジトリ（ロジック公開）：mnakagaw/world-country-risks

## 1. 使用法
### 1) 日付の切替
画面上部の日付操作（← / → / TODAY）で対象日を切り替えます。

### 2) 表示モードの切替
画面右上の表示モードで、可視化の観点を切り替えます。

- **R-INDEX**：平時からのズレ（倍率）を中心に国家の中核機能に対する「危機兆候」を見る（メイン）
- **RAW / 生データ**：その日の件数など“量”を中心に見る（比較用）
- **TRENDING / トレンド**：話題化している国・トピック（報道ベース）

### 3) 国別詳細の確認
地図上の国、または右側の国リストをクリックすると国別パネルが開き、以下を確認できます。

- どの領域（R1〜R4）が強まっているか
- Today / Baseline / Ratio（当日値・平時参照・倍率）
- 根拠となるニュース（タイトル／ソース）

### 4) ヒストリー（週次の推移）の確認（Expand）
国別パネル上部の **Expand** をクリックすると、その国の **週次ヒストリー表示（Historical Analysis）** を開けます。ここでは「危機兆候がいつから・どの束（R1〜R4）で点灯し始めたか」を、直近最大52週などの範囲で確認できます。

**上段のタイル（Bundle / R1〜R4）**  
週ごとの状態を色で表示します。Bundle は総合（束全体）、R1〜R4 は各領域の週次シグナルです。  
表示は Signal View（ゲート適用後の is_active に基づく離散色）が基本で、週ごとの「点灯」を追う用途に向きます。

**View（表示切替）の意味**
- **Signal (Discrete)**：週ごとの警戒シグナル（離散表示）。運用上の判断・時系列比較に適します。
- **State (Absolute)**：絶対量（件数）寄りの見方。慢性的負荷（平時から多い）を把握する補助に使います。
- **Intensity (Heatmap)**：強度（比率）寄りの見方。点灯の“手前”や上昇の度合いを把握する補助に使います。

**First Lit Analysis（初回点灯分析）**  
R1〜R4それぞれについて、最初に Yellow / Orange / Red が点灯した週を表示します。  
これにより「どの領域が先行して悪化し始めたか（例：R3→R1 の波及）」を読み取れます。

## 2. 背景理論：なぜ「国家機能」を束で捉えるのか
### 2.1 国家機能＝国家が供給すべき中核的な公共財
本プロジェクトは国家を、領土支配の装置としてだけでなく、社会が最低限成り立つために必要な機能（公共財）を継続的に供給する主体として捉えます。  
国家の不安定化は、クーデターや選挙結果のような単発イベントだけでなく、国家が供給すべき機能が、じわじわと（あるいは急激に）劣化するプロセスとして現れます。  
本ダッシュボードは、この劣化プロセスを「兆候」として日次で観測可能な形に整理し、国際比較に耐える視点で提示します。

### 2.2 Rotberg：国家崩壊研究における「政治的財（political goods）」
Robert I. Rotberg の議論では、国家は市民に対して「政治的財（political goods）」を供給する責務があり、国家の危機はそれらの供給不全として観測される、という発想が強調されます。  
政治的財を日常語で言い換えると、概ね次のような機能です。

- 人々の **安全** と秩序が維持されること
- 生活の基盤となる **基本サービス** が継続して提供されること
- ルールが **正当に運用** され、統治が機能すること
- 国家運営に必要な **財政的基盤** が維持されること

本プロジェクトは、これらを観測可能なシグナルへ落とし込み、R1〜R4の4束として操作化します。

### 2.3 Besley & Persson（Pillars）：国家能力を支える4要素
本プロジェクトのもう一つの参照枠は、Besley & Persson による国家能力（state capacity）に関する議論です。  
国家能力を「平時の耐性（shock absorption / resilience）」として捉える際、一般に次のような柱（pillars）が中核になります（本プロジェクトでは概念的整理として参照します）。

- **徴税能力（fiscal/tax capacity）**：税を公平・継続的に集め、国家運営の財源を確保する力
- **法の執行能力（legal capacity）**：契約・権利・治安を法制度により担保し、秩序を維持する力
- **行政実施能力（administrative capacity）**：政策を実装し、サービスを現場まで届ける運用能力
- **統治の正統性・協力基盤（legitimacy / compliance）**：統治への受容・協力が成立し、制度が機能する土台

これらの柱は、短期ショックが生じた際に「どれだけ早く、どれだけ損傷を局限できるか」を規定します。  
本ダッシュボードは、出来事（イベント）を通じて観測されるストレスが、国家機能のどの束に集中しているかを見える化します。

## 3. R1〜R4（国家機能の4束）
本ダッシュボードは、国家機能の劣化兆候を4領域（4つの束）に整理します。  
これはニュースのジャンル分類ではなく、国家のどの機能が傷んでいるかを表す操作概念です。

- **R1：治安・暴力（Security）**  
  暴力、武装衝突、治安機関との衝突、重大な犯罪的暴力など
- **R2：生活・基礎サービス（Living / Basic Services）**  
  物資不足、インフラ障害、災害影響、人道危機、生活基盤の動揺など
- **R3：統治・正統性・予測可能性（Governance / Legitimacy）**  
  法の支配・抗議・政治対立、制度不信、行政・司法・選挙等の統治過程の混乱、腐敗など
- **R4：財政・経済（Fiscal / Economic stress）**  
  財政逼迫、通貨・物価・金融ショック、経済政策の混乱など  
  （※R4は短期イベントよりも構造要因として効く場合が多く、他領域の不安定化の背景要因になり得ます。）

## 4. データソース：何を観測しているのか
### 4.1 中心：GDELT Events（「起きたこと」寄り）
本プロジェクトの中心は **GDELT Events（ニュースから抽出されたイベントを集計したデータベース）**です。  
GDELT Events はニュース記事を元に「どんな種類の出来事がどの国で発生したか」をイベントコードとして集計できるため、国別・日次で兆候を追跡できます。

本プロジェクトが測りたいのは **“注目された量（報道量）”そのものではなく、“各国で起きた事の性質と数”**です。  
ただしニュースを源泉にしている以上、観測バイアス（報道密度や情報アクセス差）の影響を完全には免れません。

### 4.2 補助：GDELT GKG / RSS（根拠見出し・表示材料）
国別パネルやブリーフィングで表示する「根拠ニュース」は主に以下から構成されます。

- **GDELT GKG（記事・テーマ・トーンなどのメタ情報）**
- **RSS 等（欠損時のフォールバックとして）**

目的は「根拠の手がかり」を提示し、ブラックボックス化を避けることにあります。

### 4.3 補助：AIR SIGNALS（注目の高まり）
AIR は 危機スコアの主因ではなく補助情報です。  
ニュース以外の外部信号から「注目の高まり」を補助的に表示します（例：検索トレンド、SNSの急上昇、予測市場の主要テーマなど）。

### 4.4 データ種別の関係（まとめ）
- **Events（GDELT）**：R-INDEX（中核スコア）の主要入力（出来事の兆候）
- **AIR**：検索・SNS・予測市場などの補助的な注目シグナル（文脈・注意喚起）

## 5. ロジック：なぜ“件数”ではなく“平時からのズレ”を見るのか
### 5.1 国ごとの平時が異なる問題
国によってニュース量や出来事量は構造的に異なります。  
単純な件数ランキングでは、大国が常に上位に出る／小国はデータが薄く揺れやすい等の歪みが生じます。

### 5.2 ベースライン（平時参照）と倍率（Ratio）
本プロジェクトは、各国について **平時の参照分布（ベースライン）**を持ち、

- 今日（Today）
- 平時参照（Baseline）
- 倍率（Ratio = Today / Baseline）

により「ズレ」を測ります。

### 5.3 R-INDEX（危機兆候スコア）
R-INDEX は“平時からのズレ（倍率）”を中心に構成された危機兆候スコアです。  
画面での Red / Orange / Yellow は、単なる件数ではなく、主にこの「ズレ」と安全弁（ゲート）を通過した結果として表現されます。

R-INDEX は「出来事の件数」ではなく、各国の平時ベースラインに対する ズレ（Ratio） を中心に算出する“兆候”指標です。欠損・外圧ノイズ・不安定入力などは Gate（安全弁） で抑制し、誤点灯を減らします。  
Yellow / Orange / Red は「絶対件数」ではなく R-INDEX＋Gate の結果で決まります。

### 5.4 誤検知抑制：ゲート（Gate）と安全弁
倍率が跳ねても、それが

- データが薄いことによる偶然
- 外部要因・報道偏り
- 一過性ノイズ

である場合は、アラートとして扱うべきではありません。  
そのため実装では、欠損・異常値・不安定入力の抑制や、過剰反応を避ける条件（ゲート）を設け、**“倍率が高い＝即アラート”**にならないよう制御します（詳細は config/ と scripts/ を参照）。

## 6. 表示モードの意味
### R-INDEX（メイン）
その国の平時と比べて、どれだけ兆候が強まったかを見る  
早期警戒の主画面

### RAW / 生データ（比較用）
純粋な件数・量に近いビュー  
“今日は多いが平時も多い”などの比較に用いる

### TRENDING / トレンド（報道ベース）
いま話題になっている国・トピックを見つける  
危機スコアの確度を決める場所ではなく、深掘り対象を見つける用途

## 7. 再現性と透明性：公開リポジトリの構造（main と gh-pages）
公開リポジトリ（mnakagaw/world-country-risks）は、透明性（論文・検証）と配布（閲覧用）を分離するため、2ブランチ運用とします。

- **main：ロジック公開（透明性）**  
  src/, scripts/, config/, tests/ 等  
  ※巨大データ（例：public/data 等）や機密（credentials）は除外して軽量化
- **gh-pages：公開サイト成果物（配布）**  
  ビルド成果物（dist 相当）を配置し、GitHub Pages が配信

## 8. 参考文献・理論的支柱
### ダッシュボードの中心理論（骨格）
本ダッシュボードは、Rotberg、Besley & Persson、North らの議論を骨格として設計されています。

- **Rotberg（政治的財）**  
  国家が最低限提供すべき「政治財（political goods）」を軸に、R1–R4（治安・生活・統治・財政）という観測束の“規範軸（何を見るべきか）”を与えます。
- **Besley & Persson（国家能力の柱）**  
  国家能力・暴力・徴税・統治が「束（クラスター）」として結びつくという見方を提示し、複数兆候の同時点灯（R-concurrency）を“因果の束”として正当化します。
- **North（制度の作動）**  
  制度は紙の上ではなく「実際に作動するか（incentives & enforcement）」が重要であるという立場から、運用・執行・解除規律（点灯→裏取り→解除）を“制度の作動確認”として位置づけます。

### 参考文献一覧
**中心理論（ダッシュボードの骨格）**
- Rotberg, Robert I. (2002). *The New Nature of Nation-State Failure.*
- Rotberg, Robert I. (ed.). (2003). *When States Fail: Causes and Consequences.*
- Rotberg, Robert I. (ed.). (2003). *Failed States, Collapsed States, Weak States: Causes and Indicators.*
- Besley, Timothy, & Persson, Torsten. (2011). *Pillars of Prosperity: Political Economics of State Building and Violence.*
- North, Douglass C. (1990). *Institutions, Institutional Change and Economic Performance.*（邦訳：『制度・制度変化・経済成果』）

**理論補強（運用・可視化・高頻度の正当化）**
- Andrews, Matt, Pritchett, Lant, & Woolcock, Michael. (2017). *Building State Capability: Evidence, Analysis, Action.*
- Scott, James C. (1998). *Seeing Like a State: How Certain Schemes to Improve the Human Condition Have Failed.*（邦訳：『国家のように見る』）
- Epstein, Richard A. (1995). *Simple Rules for a Complex World: Legal Principles.*
- Lipsky, Michael. (1980). *Street-Level Bureaucracy: Dilemmas of the Individual in Public Services.*（邦訳：『ストリート・レベルの官僚制』）
- Taleb, Nassim Nicholas. (2012). *Antifragile: Things That Gain from Disorder.*（邦訳：『反脆弱性』）
- Rosa, Hartmut. (2013). *Social Acceleration: A New Theory of Modernity.*
- Rothstein, Bo (ed.). (2012). *The Oxford Handbook of Quality of Government.*
- Basu, Kaushik, & Cordella, Tito (eds.). (2018). *Institutions, Governance and the Control of Corruption.*

## 9. 引用（Cite this）
本ダッシュボード／リポジトリを論文・報告書等で参照する場合は、以下の形式を推奨します（アクセス日を記載）：

Nakagawa, M. (2026). *World Country Risks — Global Early Warning Dashboard (GitHub repository).* Retrieved YYYY-MM-DD, from https://github.com/mnakagaw/world-country-risks

（※年は適宜更新、Retrievedは参照日）

## 10. データソース（Credits）
本プロジェクトは公開データソースを利用しています（例）：

- GDELT 2.x（Events / GKG）
- Google Trends / GetDayTrends / Polymarket（AIRとして表示）

### 注意書き
データの網羅性や報道・言語の偏りは国ごとに異なります。本表示は「観測されたデータにもとづく兆候」であり、現地の実態そのもの（ground truth）を直接表すものではありません。

</details>

<details>
<summary><strong>English</strong></summary>

# World Country Risks (State Capacity Risk Early-Warning Dashboard)

## 0. Overview
World Country Risks is an early-warning dashboard that visualizes each country’s **state fragility / stress on state capacity** on a daily basis, primarily using event data derived from news reporting.  
The aim of this project is **not** to “predict government collapse,” but to help users assess—by country—**in what direction, and how strongly**, the core functions a state must provide (**R1: Security, R2: Living, R3: Governance, R4: Fiscal**) are deviating from their normal baseline, supporting early-stage judgment for research, policy, and journalism.

- Live site (GitHub Pages): https://mnakagaw.github.io/world-country-risks/
- Public repository (logic transparency): mnakagaw/world-country-risks

## 1. How to Use
### 1) Change the date
Use the date controls at the top of the screen (← / → / TODAY) to switch the target day.

### 2) Switch the view mode
Use the view-mode selector at the top-right to change the visualization perspective.

- **R-INDEX**: Focus on **deviation from normal (ratio / multiplier)** to identify early warning signals for core state functions (main view)
- **RAW**: Focus on the day’s **counts / volume** (for comparison)
- **TRENDING**: Countries and topics that are currently gaining attention (news-based)

### 3) Open country details
Click a country on the map or in the country list on the right to open the country panel and review:

- Which domain(s) (R1–R4) are intensifying
- Today / Baseline / Ratio (today’s value, normal reference, and multiplier)
- Evidence news (headline / source)

### 4) Check history (weekly trend) (Expand)
Click **Expand** at the top of the country panel to open the country’s **weekly history (Historical Analysis)**. This allows you to see **when** and **which bundle(s) (R1–R4)** started to light up as early warning signals, typically up to the most recent 52 weeks.

**Top tiles (Bundle / R1–R4)**  
Each week is displayed as a color-coded status. **Bundle** is the overall combined signal (across bundles), while **R1–R4** are the weekly signals for each domain.  
By default, the tiles use **Signal View** (discrete colors based on **is_active** after gate application), which is suitable for tracking “lights turning on” week by week.

**Meaning of View (display switch)**
- **Signal (Discrete)**: Discrete weekly alert signals. Best for operational judgment and time-series comparison.
- **State (Absolute)**: A more absolute, count-oriented view. Helps identify chronic load (consistently high even in normal times).
- **Intensity (Heatmap)**: A more ratio/intensity-oriented view. Helps see “pre-light” increases and rising momentum.

**First Lit Analysis**  
For each of R1–R4, this displays the first week when **Yellow / Orange / Red** lit up.  
This helps interpret which domain deteriorated earlier (e.g., diffusion from **R3 → R1**).

## 2. Background Theory: Why treat “state functions” as bundles?
### 2.1 State functions as essential public goods
This project views the state not only as a territorial control apparatus, but as an entity responsible for continuously providing the essential functions (public goods) needed for society to minimally operate.  
State instability appears not only as one-off events like coups or election outcomes, but as a process in which the functions the state should provide gradually (or sometimes abruptly) degrade.  
This dashboard organizes that degradation process into observable “signals” on a daily basis and presents them in a way that supports cross-country comparison.

### 2.2 Rotberg: “Political goods” in state failure studies
In Robert I. Rotberg’s framework, the state has a duty to provide **“political goods”** to citizens, and state crises are emphasized as failures in supplying those goods.  
In plain terms, these functions roughly include:

- Maintaining **security** and public order
- Continuously providing **basic services** that sustain daily life
- Ensuring rules are **legitimately operated** and governance functions
- Maintaining the **fiscal foundation** required for state operations

This project operationalizes these into observable signals as four bundles: **R1–R4**.

### 2.3 Besley & Persson (Pillars): Four elements supporting state capacity
Another reference framework is Besley & Persson’s discussion of **state capacity**.  
When state capacity is understood as “normal-time resilience (shock absorption / resilience),” the following pillars are often central (used here as conceptual organization):

- **Fiscal / tax capacity**: The ability to collect taxes fairly and continuously, securing revenue for state operations
- **Legal capacity**: The ability to secure contracts, rights, and public order through legal institutions
- **Administrative capacity**: The operational ability to implement policy and deliver services to the field
- **Legitimacy / compliance**: The foundation enabling acceptance and cooperation with governance so institutions can function

These pillars shape how quickly and how much damage can be contained when shocks occur.  
This dashboard visualizes which bundle of state functions the observed stress (via events) concentrates on.

## 3. R1–R4 (Four bundles of state functions)
This dashboard organizes early warning signals of state-function degradation into four domains (four bundles).  
These are not “news categories,” but operational concepts representing which state functions are being strained.

- **R1: Security / Violence (Security)**  
  Violence, armed conflict, clashes with security forces, major criminal violence, etc.
- **R2: Living / Basic Services (Living / Basic Services)**  
  Shortages, infrastructure disruptions, disaster impacts, humanitarian crises, instability in livelihoods, etc.
- **R3: Governance / Legitimacy / Predictability (Governance / Legitimacy)**  
  Rule of law, protests, political confrontation, institutional distrust, disruption in governance processes (administration/judiciary/elections), corruption, etc.
- **R4: Fiscal / Economic stress (Fiscal / Economic stress)**  
  Fiscal strain, currency/price/financial shocks, policy disruption, etc.  
  (*R4 often acts more as a structural factor than a short-term event and can become a background driver of instability in other domains.*)

## 4. Data Sources: What is being observed?
### 4.1 Core: GDELT Events (closer to “what happened”)
The core of this project is **GDELT Events** (a database that aggregates events extracted from news).  
Because GDELT Events can aggregate “what kinds of events occurred in which country” as event codes based on news articles, it enables daily, country-level tracking of signals.

What this project aims to measure is **not** “how much attention (coverage volume) a country received,” but **the type and number of things that happened in each country**.  
However, because the source is news, the system cannot fully avoid observation bias (differences in media density and information access).

### 4.2 Support: GDELT GKG / RSS (evidence headlines & display material)
“Evidence news” shown in country panels and briefings mainly comes from:

- **GDELT GKG** (metadata such as themes and tone)
- **RSS, etc.** (fallback when missing)

The goal is to provide “clues for evidence” and avoid turning the system into a black box.

### 4.3 Support: AIR SIGNALS (rising attention)
AIR is not a primary driver of the risk score; it is supplementary.  
It displays “rising attention” using non-news external signals (e.g., search trends, social media surges, prediction-market themes).

### 4.4 Relationship between data types (summary)
- **Events (GDELT)**: Main input for **R-INDEX** (core score) as event-based signals
- **AIR**: Supplementary attention signals from search/SNS/prediction markets (context / heads-up)

## 5. Logic: Why focus on deviation from normal instead of raw counts?
### 5.1 Countries differ in “normal”
News volume and event volume differ structurally across countries.  
A simple count ranking tends to distort the view: large countries always rise to the top, while small countries have sparse data and can fluctuate sharply.

### 5.2 Baseline (normal reference) and Ratio
This project maintains a **normal reference distribution (baseline)** for each country and measures deviation using:

- Today
- Baseline
- Ratio (= Today / Baseline)

### 5.3 R-INDEX (early warning signal score)
R-INDEX is an early warning signal score built primarily around **deviation from normal (ratio)**.  
The on-screen **Red / Orange / Yellow** are not just raw counts; they reflect results after combining this deviation with safety mechanisms (gates).

R-INDEX is not a “count of events,” but a signal indicator calculated mainly from the **Ratio** against a country’s baseline. Missingness, external noise, and unstable inputs are suppressed via **Gate** (safety valves) to reduce false lights.  
Yellow / Orange / Red are determined by **R-INDEX + Gate**, not by absolute counts.

### 5.4 False-positive suppression: Gate and safety valves
Even if the ratio spikes, it should not be treated as an alert when it may reflect:

- Randomness due to sparse data
- External factors / reporting bias
- Transient noise

Therefore, the implementation includes conditions (gates) to suppress missing/abnormal/unstable inputs and avoid overreaction, so that **“high ratio ≠ immediate alert.”** (See config/ and scripts/ for details.)

## 6. Meaning of view modes
### R-INDEX (main)
See how strongly signals intensified compared to the country’s normal baseline  
Primary early-warning screen

### RAW (for comparison)
A more pure count/volume view  
Used to compare cases like “high today but also high in normal times”

### TRENDING (news-based)
Find countries and topics that are currently being talked about  
Not where you decide score certainty; used to pick what to investigate deeper

## 7. Reproducibility & transparency: Public repository structure (main and gh-pages)
The public repository (mnakagaw/world-country-risks) uses a two-branch structure to separate transparency (paper/validation) from distribution (viewer site).

- **main: logic transparency**  
  src/, scripts/, config/, tests/, etc.  
  *Large data (e.g., public/data) and secrets (credentials) are excluded to keep it lightweight.*
- **gh-pages: published site artifacts**  
  Hosts build outputs (equivalent to dist), served via GitHub Pages

## 8. References / Theoretical backbone
### Core theories (backbone)
This dashboard is designed around the discussions of Rotberg, Besley & Persson, North, and others.

- **Rotberg (political goods)**  
  Provides a normative axis (“what should be observed”) via political goods and the observation bundles **R1–R4** (security/living/governance/fiscal).
- **Besley & Persson (pillars of state capacity)**  
  Supports the idea that capacities form clusters, justifying simultaneous multi-signal lights (**R-concurrency**) as a “bundle of causes.”
- **North (institutions in operation)**  
  Emphasizes that what matters is whether institutions actually operate (incentives & enforcement), positioning operational discipline (light → verification → release) as “checking institutional operation.”

### Bibliography
**Core theory (dashboard backbone)**
- Rotberg, Robert I. (2002). *The New Nature of Nation-State Failure.*
- Rotberg, Robert I. (ed.). (2003). *When States Fail: Causes and Consequences.*
- Rotberg, Robert I. (ed.). (2003). *Failed States, Collapsed States, Weak States: Causes and Indicators.*
- Besley, Timothy, & Persson, Torsten. (2011). *Pillars of Prosperity: Political Economics of State Building and Violence.*
- North, Douglass C. (1990). *Institutions, Institutional Change and Economic Performance.*

**Theory reinforcement (operations / visualization / high-frequency justification)**
- Andrews, Matt, Pritchett, Lant, & Woolcock, Michael. (2017). *Building State Capability: Evidence, Analysis, Action.*
- Scott, James C. (1998). *Seeing Like a State: How Certain Schemes to Improve the Human Condition Have Failed.*
- Epstein, Richard A. (1995). *Simple Rules for a Complex World: Legal Principles.*
- Lipsky, Michael. (1980). *Street-Level Bureaucracy: Dilemmas of the Individual in Public Services.*
- Taleb, Nassim Nicholas. (2012). *Antifragile: Things That Gain from Disorder.*
- Rosa, Hartmut. (2013). *Social Acceleration: A New Theory of Modernity.*
- Rothstein, Bo (ed.). (2012). *The Oxford Handbook of Quality of Government.*
- Basu, Kaushik, & Cordella, Tito (eds.). (2018). *Institutions, Governance and the Control of Corruption.*

## 9. Cite this
If you cite this dashboard/repository in papers or reports, the following format is recommended (include access date):

Nakagawa, M. (2026). *World Country Risks — Global Early Warning Dashboard (GitHub repository).* Retrieved YYYY-MM-DD, from https://github.com/mnakagaw/world-country-risks

(*Update the year as appropriate; “Retrieved” indicates the access date.*)

## 10. Data sources (Credits)
This project uses public data sources (examples):

- GDELT 2.x (Events / GKG)
- Google Trends / GetDayTrends / Polymarket (shown as AIR)

### Disclaimer
Coverage and reporting/language bias vary by country. This display shows **signals based on observed data** and does not directly represent ground truth on the ground.

</details>

<details>
<summary><strong>Español</strong></summary>

# World Country Risks (Panel de alerta temprana de riesgo de capacidad estatal)

## 0. Descripción general
World Country Risks es un panel de **alerta temprana** que visualiza diariamente la **fragilidad del Estado / estrés sobre la capacidad estatal** de cada país, principalmente a partir de datos de eventos derivados de noticias.  
El objetivo de este proyecto **no** es “predecir el colapso de un gobierno”, sino ayudar a evaluar—por país—**en qué dirección y con qué intensidad** las funciones centrales que un Estado debe proveer (**R1: Seguridad, R2: Vida cotidiana, R3: Gobernanza, R4: Fiscal**) se están desviando de su línea base normal, apoyando decisiones tempranas en investigación, políticas públicas y periodismo.

- Sitio (GitHub Pages): https://mnakagaw.github.io/world-country-risks/
- Repositorio público (transparencia de la lógica): mnakagaw/world-country-risks

## 1. Cómo usar
### 1) Cambiar la fecha
Use los controles de fecha en la parte superior (← / → / TODAY) para cambiar el día objetivo.

### 2) Cambiar el modo de visualización
Use el selector de modo en la esquina superior derecha para cambiar la perspectiva.

- **R-INDEX**: Se centra en la **desviación respecto a lo normal (ratio / multiplicador)** para ver “señales de crisis” en funciones centrales del Estado (vista principal)
- **RAW**: Se centra en **conteos / volumen** del día (para comparación)
- **TRENDING**: Países y temas que están ganando atención (basado en noticias)

### 3) Ver detalles por país
Haga clic en un país en el mapa o en la lista de la derecha para abrir el panel del país y revisar:

- Qué dominio(s) (R1–R4) se están intensificando
- Today / Baseline / Ratio (valor del día, referencia normal y multiplicador)
- Noticias de evidencia (título / fuente)

### 4) Ver historial (tendencia semanal) (Expand)
Haga clic en **Expand** en la parte superior del panel del país para abrir el **historial semanal (Historical Analysis)**. Esto permite ver **desde cuándo** y **en qué paquete(s) (R1–R4)** comenzaron a encenderse las señales, normalmente hasta las últimas 52 semanas.

**Baldosas superiores (Bundle / R1–R4)**  
Cada semana se muestra con un estado por color. **Bundle** es la señal combinada total (conjunto), y **R1–R4** son las señales semanales por dominio.  
Por defecto, se utiliza **Signal View** (colores discretos basados en **is_active** después de aplicar el gate), adecuado para seguir “encendidos” semana a semana.

**Significado de View (cambio de visualización)**
- **Signal (Discrete)**: Señales discretas de alerta semanal. Adecuado para decisiones operativas y comparación temporal.
- **State (Absolute)**: Vista más absoluta, orientada a conteos. Útil para identificar carga crónica (alta incluso en tiempos normales).
- **Intensity (Heatmap)**: Vista más orientada a ratio/intensidad. Útil para ver aumentos “antes del encendido” y la aceleración.

**First Lit Analysis (análisis del primer encendido)**  
Para cada uno de R1–R4, se muestra la primera semana en la que se encendió **Yellow / Orange / Red**.  
Esto ayuda a interpretar qué dominio se deterioró antes (p. ej., difusión **R3 → R1**).

## 2. Marco teórico: ¿Por qué agrupar “funciones del Estado” en paquetes?
### 2.1 Funciones del Estado como bienes públicos esenciales
Este proyecto entiende al Estado no solo como un aparato de control territorial, sino como el actor responsable de proveer de forma continua las funciones (bienes públicos) necesarias para que la sociedad opere mínimamente.  
La inestabilidad estatal aparece no solo como eventos puntuales como golpes o resultados electorales, sino como un proceso en el que las funciones que el Estado debería proveer se degradan gradualmente (o a veces de forma abrupta).  
Este panel organiza ese proceso en “señales” observables diariamente y lo presenta de forma comparable entre países.

### 2.2 Rotberg: “bienes políticos” (political goods) en estudios de colapso estatal
En el marco de Robert I. Rotberg, el Estado tiene el deber de proveer **“bienes políticos” (political goods)** a la ciudadanía, y las crisis del Estado se enfatizan como fallas en su provisión.  
En términos cotidianos, estas funciones incluyen aproximadamente:

- Mantener la **seguridad** y el orden público
- Proveer de manera continua **servicios básicos** que sostienen la vida diaria
- Asegurar que las reglas se apliquen **legítimamente** y que la gobernanza funcione
- Mantener la **base fiscal** necesaria para operar el Estado

Este proyecto operacionaliza estas ideas en señales observables como cuatro paquetes: **R1–R4**.

### 2.3 Besley & Persson (Pillars): Cuatro elementos que sostienen la capacidad estatal
Otro marco de referencia es la discusión de Besley & Persson sobre **capacidad estatal (state capacity)**.  
Cuando la capacidad estatal se entiende como resiliencia en tiempos normales (**shock absorption / resilience**), suelen ser centrales los siguientes pilares (usados aquí como organización conceptual):

- **Capacidad fiscal / tributaria (fiscal/tax capacity)**: Recaudar impuestos de forma justa y continua, asegurando ingresos para el funcionamiento del Estado
- **Capacidad legal (legal capacity)**: Garantizar contratos, derechos y orden público mediante instituciones legales
- **Capacidad administrativa (administrative capacity)**: Implementar políticas y entregar servicios en el territorio
- **Legitimidad / cumplimiento (legitimacy / compliance)**: Base para la aceptación y cooperación con la gobernanza, permitiendo que las instituciones funcionen

Estos pilares determinan cuán rápido y cuánto daño puede contenerse cuando ocurren shocks.  
Este panel visualiza en qué paquete de funciones del Estado se concentra el estrés observado (a través de eventos).

## 3. R1–R4 (Cuatro paquetes de funciones estatales)
Este panel organiza señales de degradación de funciones estatales en cuatro dominios (cuatro paquetes).  
No son “categorías de noticias”, sino conceptos operativos que representan qué funciones del Estado están bajo tensión.

- **R1: Seguridad / violencia (Security)**  
  Violencia, conflicto armado, choques con fuerzas de seguridad, violencia criminal grave, etc.
- **R2: Vida cotidiana / servicios básicos (Living / Basic Services)**  
  Escasez, fallas de infraestructura, impactos de desastres, crisis humanitarias, inestabilidad de medios de vida, etc.
- **R3: Gobernanza / legitimidad / previsibilidad (Governance / Legitimacy)**  
  Estado de derecho, protestas, confrontación política, desconfianza institucional, desorden en procesos de gobernanza (administración/justicia/elecciones), corrupción, etc.
- **R4: Estrés fiscal / económico (Fiscal / Economic stress)**  
  Tensión fiscal, shocks monetarios/de precios/financieros, desorden de políticas económicas, etc.  
  (*R4 suele actuar más como factor estructural que como evento de corto plazo, y puede ser un factor de fondo que impulse inestabilidad en otros dominios.*)

## 4. Fuentes de datos: ¿Qué se observa?
### 4.1 Núcleo: GDELT Events (más cercano a “lo que ocurrió”)
El núcleo de este proyecto es **GDELT Events** (una base de datos que agrega eventos extraídos de noticias).  
Como GDELT Events puede agregar “qué tipos de eventos ocurrieron en qué país” como códigos de evento a partir de artículos, permite el seguimiento diario por país.

Este proyecto busca medir **no** “la cantidad de atención (volumen de cobertura)”, sino **la naturaleza y el número de cosas que ocurrieron en cada país**.  
Sin embargo, al basarse en noticias, no puede evitar por completo sesgos de observación (diferencias en densidad mediática y acceso a información).

### 4.2 Apoyo: GDELT GKG / RSS (titulares de evidencia y material de presentación)
Las “noticias de evidencia” mostradas en paneles por país y en briefings provienen principalmente de:

- **GDELT GKG** (metadatos como temas y tono)
- **RSS, etc.** (fallback cuando faltan datos)

El objetivo es ofrecer “pistas de evidencia” y evitar que el sistema sea una caja negra.

### 4.3 Apoyo: AIR SIGNALS (aumento de atención)
AIR no es el motor principal del puntaje de riesgo; es información complementaria.  
Muestra “aumento de atención” usando señales externas no basadas en noticias (p. ej., tendencias de búsqueda, picos en redes sociales, temas de mercados de predicción).

### 4.4 Relación entre tipos de datos (resumen)
- **Events (GDELT)**: Entrada principal de **R-INDEX** (puntaje central) como señales basadas en eventos
- **AIR**: Señales complementarias de atención (búsqueda/redes/mercados de predicción) para contexto / aviso

## 5. Lógica: ¿Por qué mirar la desviación respecto a lo normal y no solo conteos?
### 5.1 Cada país tiene un “normal” distinto
El volumen de noticias y de eventos difiere estructuralmente entre países.  
Un ranking simple por conteo distorsiona: los países grandes suelen quedar arriba siempre, mientras que los pequeños tienen datos escasos y pueden fluctuar mucho.

### 5.2 Línea base (Baseline) y Ratio
Este proyecto mantiene una **distribución de referencia normal (baseline)** por país y mide la desviación usando:

- Today
- Baseline
- Ratio (= Today / Baseline)

### 5.3 R-INDEX (puntaje de señal temprana)
R-INDEX es un puntaje de señal temprana construido principalmente alrededor de la **desviación respecto a lo normal (ratio)**.  
Los colores **Red / Orange / Yellow** en pantalla no son solo conteos; reflejan resultados tras combinar la desviación con mecanismos de seguridad (gates).

R-INDEX no es un “conteo de eventos”, sino un indicador de señales calculado principalmente con el **Ratio** contra la línea base del país. Faltantes, ruido externo y entradas inestables se suprimen mediante **Gate** (válvulas de seguridad) para reducir falsos encendidos.  
Yellow / Orange / Red se determinan por **R-INDEX + Gate**, no por conteos absolutos.

### 5.4 Supresión de falsos positivos: Gate y válvulas de seguridad
Incluso si el ratio se dispara, no debe tratarse como alerta si puede reflejar:

- Aleatoriedad por datos escasos
- Factores externos / sesgo de cobertura
- Ruido transitorio

Por ello, la implementación incluye condiciones (gates) para suprimir entradas faltantes/anómalas/inestables y evitar sobrerreacción, de modo que **“ratio alto ≠ alerta inmediata.”** (Ver config/ y scripts/ para detalles.)

## 6. Significado de los modos de visualización
### R-INDEX (principal)
Ver cuán fuerte se intensificaron las señales respecto al “normal” del país  
Pantalla principal de alerta temprana

### RAW (para comparación)
Vista más pura de conteos/volumen  
Útil para comparar “alto hoy pero también alto en tiempos normales”

### TRENDING (basado en noticias)
Encontrar países y temas que están siendo comentados ahora  
No es donde se decide la certeza del puntaje; sirve para elegir qué investigar más

## 7. Reproducibilidad y transparencia: Estructura del repositorio público (main y gh-pages)
El repositorio público (mnakagaw/world-country-risks) usa una estructura de dos ramas para separar transparencia (artículo/validación) de distribución (sitio de visualización).

- **main: transparencia de la lógica**  
  src/, scripts/, config/, tests/, etc.  
  *Se excluyen datos grandes (p. ej., public/data) y secretos (credentials) para mantenerlo liviano.*
- **gh-pages: artefactos del sitio publicado**  
  Aloja los resultados de build (equivalente a dist), servidos por GitHub Pages

## 8. Referencias / columna teórica
### Teorías centrales (columna vertebral)
Este panel está diseñado en torno a las discusiones de Rotberg, Besley & Persson, North y otros.

- **Rotberg (bienes políticos)**  
  Provee un eje normativo (“qué observar”) mediante los bienes políticos y los paquetes de observación **R1–R4** (seguridad/vida/gobernanza/fiscal).
- **Besley & Persson (pilares de capacidad estatal)**  
  Sustenta la idea de que las capacidades forman clústeres, justificando encendidos simultáneos de múltiples señales (**R-concurrency**) como “paquetes de causas”.
- **North (instituciones en operación)**  
  Enfatiza que importa si las instituciones realmente operan (incentivos y cumplimiento), ubicando la disciplina operativa (encendido → verificación → apagado) como “comprobación de operación institucional”.

### Bibliografía
**Teoría central (columna del panel)**
- Rotberg, Robert I. (2002). *The New Nature of Nation-State Failure.*
- Rotberg, Robert I. (ed.). (2003). *When States Fail: Causes and Consequences.*
- Rotberg, Robert I. (ed.). (2003). *Failed States, Collapsed States, Weak States: Causes and Indicators.*
- Besley, Timothy, & Persson, Torsten. (2011). *Pillars of Prosperity: Political Economics of State Building and Violence.*
- North, Douglass C. (1990). *Institutions, Institutional Change and Economic Performance.*

**Refuerzo teórico (operación / visualización / justificación de alta frecuencia)**
- Andrews, Matt, Pritchett, Lant, & Woolcock, Michael. (2017). *Building State Capability: Evidence, Analysis, Action.*
- Scott, James C. (1998). *Seeing Like a State: How Certain Schemes to Improve the Human Condition Have Failed.*
- Epstein, Richard A. (1995). *Simple Rules for a Complex World: Legal Principles.*
- Lipsky, Michael. (1980). *Street-Level Bureaucracy: Dilemmas of the Individual in Public Services.*
- Taleb, Nassim Nicholas. (2012). *Antifragile: Things That Gain from Disorder.*
- Rosa, Hartmut. (2013). *Social Acceleration: A New Theory of Modernity.*
- Rothstein, Bo (ed.). (2012). *The Oxford Handbook of Quality of Government.*
- Basu, Kaushik, & Cordella, Tito (eds.). (2018). *Institutions, Governance and the Control of Corruption.*

## 9. Cita (Cite this)
Si cita este panel/repositorio en artículos o informes, se recomienda el siguiente formato (incluya fecha de acceso):

Nakagawa, M. (2026). *World Country Risks — Global Early Warning Dashboard (GitHub repository).* Retrieved YYYY-MM-DD, from https://github.com/mnakagaw/world-country-risks

(*Actualice el año según corresponda; “Retrieved” indica la fecha de acceso.*)

## 10. Fuentes de datos (Créditos)
Este proyecto utiliza fuentes públicas de datos (ejemplos):

- GDELT 2.x (Events / GKG)
- Google Trends / GetDayTrends / Polymarket (mostrado como AIR)

### Aviso
La cobertura y los sesgos de reporte/idioma varían por país. Esta visualización muestra **señales basadas en datos observados** y no representa directamente la realidad en terreno (ground truth).

</details>
