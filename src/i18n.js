import {monitoringText} from './monitoring-text.js';
// Translations for the dashboard
export const translations = {
    en: {
        title: 'Country Risk Monitoring · Engine v2.0',
        subtitle: 'News-derived signals; confirmed functional impacts are assessed separately',
        dataDate: 'DATA',
        active: 'ACTIVE',
        red: 'RED',
        orange: 'ORANGE',
        yellow: 'YELLOW',
        legend: {
            title: 'MONITORING SIGNAL',
            critical: 'Critical',
            warning: 'Warning',
            watch: 'Watch',
            stable: 'No elevated signal',
            unknown: 'Unknown'
        },
        panel: {
            placeholder: 'SELECT A COUNTRY',
            riskScores: 'RISK SCORES',
            r1: 'R1 Security',
            r2: 'R2 Basic Living Conditions',
            r3: 'R3 Governance',
            r4: 'R4 Aid, Sanctions & Economic Pressure',
            rLabels: {
                r1: 'Security',
                r2: 'Living',
                r3: 'Governance',
                r4: 'Aid / Sanctions'
            },
            composite: 'Composite Score',
            summary: 'SITUATION SUMMARY',
            indicator: 'Indicator',
            sources: 'KEY SOURCES'
        },
        alertLabels: {
            red: 'CRITICAL',
            orange: 'WARNING',
            yellow: 'WATCH',
            green: 'STABLE'
        },
        global: {
            monitoringSummary: 'MONITORING DATA',
            noComparable: 'Unavailable',
            none: 'No entries',
            rIndexUnavailable: 'R-INDEX is unavailable: the current data and comparable baseline are insufficient. At least 10 complete days within the previous 14 calendar days and a sufficient baseline are required. Gray means unknown, not safe.',
            noHeat: 'No elevated signals can be listed in this view. Countries with missing or insufficient observations remain unknown.',
            showRaw: 'View RAW monitoring signals',
            briefing: 'AI DAILY BRIEFING',
            noBriefing: 'No briefing generated for this date.',
            heatList: 'Global Heat List',
            country: 'Country',
            risk: 'Risk',
            summary: 'Summary',
            airSignals: 'AIR SIGNALS',
            airCaptions: {
                gt: 'Google Trends: Rising search queries (by country)',
                pm: 'Polymarket: Key topics in prediction markets'
            }
        },
        footer: {
            data: 'DATA: GDELT PROJECT',
            ai: 'AI: GEMINI',
            status: 'STATUS: OPERATIONAL',
            framework: 'Based on the framework of state failure and collapse developed by Robert I. Rotberg.'
        },
        loading: 'LOADING DATA...',
        error: 'ERROR',
        viewMode: {
            title: 'SCORE VIEW',
            raw: 'RAW',
            surge_r: 'R-INDEX',
            surge: 'TRENDING',
            index: 'Index'
        }
    },
    ja: {
        title: '国別リスク監視 · エンジンv2.0',
        subtitle: '報道由来の監視信号。確認済みの実影響・国家機能は別途評価',
        dataDate: 'データ',
        active: '稼働中',
        red: 'RED',
        orange: 'ORANGE',
        yellow: 'YELLOW',
        legend: {
            title: '監視信号',
            critical: '警戒',
            warning: '注意',
            watch: '監視',
            stable: '警戒信号なし',
            unknown: '判定不能'
        },
        panel: {
            placeholder: '国を選択してください',
            riskScores: 'リスクスコア',
            r1: 'R1 安全',
            r2: 'R2 生活の床',
            r3: 'R3 統治の安定',
            r4: 'R4 援助・制裁・経済圧力',
            rLabels: {
                r1: '治安',
                r2: '生活',
                r3: '統治',
                r4: '援助・制裁'
            },
            composite: '総合スコア',
            summary: '状況要約',
            indicator: '指標',
            sources: '主要ニュースソース'
        },
        alertLabels: {
            red: '警戒',
            orange: '注意',
            yellow: '監視',
            green: '安定'
        },
        global: {
            monitoringSummary: '監視データの状況',
            noComparable: '比較不可',
            none: '該当なし',
            rIndexUnavailable: 'R-INDEXは、現在の観測・比較基準が不足しているため表示できません。直前14暦日のうち10日以上の完全な同一方式のデータと、十分な基準値が必要です。灰色は判定不能で、安全を意味しません。',
            noHeat: 'この表示で一覧にできる警戒信号はありません。欠測・観測不足の国は判定不能です。',
            showRaw: 'RAWの監視信号を見る',
            briefing: 'AIデイリーブリーフィング',
            noBriefing: '本日のブリーフィングは生成されていません。',
            heatList: 'グローバルヒートリスト',
            country: '国名',
            risk: 'リスク',
            summary: '要約',
            airSignals: 'AIR SIGNALS (社会的関心)',
            airCaptions: {
                gt: 'Google Trends：検索トレンド上昇語（国別）',
                pm: 'Polymarket：予測市場の主要テーマ'
            }
        },
        footer: {
            data: 'データ: GDELT PROJECT',
            ai: 'AI: GEMINI',
            status: 'ステータス: 稼働中',
            framework: 'Robert I. Rotberg の国家破綻・崩壊フレームワークに基づく'
        },
        loading: 'データを読み込んでいます...',
        error: 'エラー',
        viewMode: {
            title: '表示モード',
            raw: 'RAW / 生データ',
            surge_r: 'R-INDEX',
            surge: 'TRENDING / トレンド',
            index: '指数 (Index)'
        }
    },
    es: {
        title: 'Seguimiento del Riesgo País · Motor v2.0',
        subtitle: 'Señales derivadas de noticias; los impactos funcionales confirmados se evalúan por separado',
        dataDate: 'DATOS',
        active: 'ACTIVO',
        red: 'ROJO',
        orange: 'NARANJA',
        yellow: 'AMARILLO',
        legend: {
            title: 'SEÑAL DE SEGUIMIENTO',
            critical: 'Crítico',
            warning: 'Alerta',
            watch: 'Vigilancia',
            stable: 'Sin señal elevada',
            unknown: 'Sin evaluación'
        },
        panel: {
            placeholder: 'SELECCIONE UN PAÍS',
            riskScores: 'PUNTUACIONES DE RIESGO',
            r1: 'R1 Seguridad',
            r2: 'R2 Condiciones Básicas de Vida',
            r3: 'R3 Gobernanza',
            r4: 'R4 Ayuda, Sanciones y Presión Económica',
            rLabels: {
                r1: 'Seguridad',
                r2: 'Vida diaria',
                r3: 'Gobernanza',
                r4: 'Ayuda / Sanciones'
            },
            composite: 'Puntuación Compuesta',
            summary: 'RESUMEN DE SITUACIÓN',
            indicator: 'Indicador',
            sources: 'FUENTES PRINCIPALES'
        },
        alertLabels: {
            red: 'CRÍTICO',
            orange: 'ALERTA',
            yellow: 'VIGILANCIA',
            green: 'ESTABLE'
        },
        global: {
            monitoringSummary: 'DATOS DE SEGUIMIENTO',
            noComparable: 'No disponible',
            none: 'Sin registros',
            rIndexUnavailable: 'R-INDEX no está disponible: faltan observaciones actuales o una base comparable suficiente. Se requieren al menos 10 días completos de los 14 días anteriores y una base suficiente. El gris significa sin evaluación, no seguridad.',
            noHeat: 'No se pueden listar señales elevadas en esta vista. Los países con observaciones ausentes o insuficientes quedan sin evaluación.',
            showRaw: 'Ver señales RAW',
            briefing: 'INFORME DIARIO DE IA',
            noBriefing: 'No se generó informe para esta fecha.',
            heatList: 'Lista de Calor Global',
            country: 'País',
            risk: 'Riesgo',
            summary: 'Resumen',
            airSignals: 'SEÑALES AÉREAS',
            airCaptions: {
                gt: 'Google Trends: Consultas de búsqueda en alza (por país)',
                pm: 'Polymarket: Temas clave en mercados de predicción'
            }
        },
        footer: {
            data: 'DATOS: GDELT PROJECT',
            ai: 'IA: GEMINI',
            status: 'ESTADO: OPERATIVO',
            framework: 'Basado en el marco de fracaso y colapso estatal desarrollado por Robert I. Rotberg.'
        },
        loading: 'CARGANDO DATOS...',
        error: 'ERROR',
        viewMode: {
            title: 'MODO',
            raw: 'BRUTO',
            surge_r: 'R-INDEX',
            surge: 'TENDENCIAS',
            index: 'Índice'
        }
    }
};

for(const [lang,text] of Object.entries(monitoringText)) {
    const extra={
      ja:{comparisonTitle:'指標別の比較',pairedToday:'当日・一致枠中央値',pairedBaseline:'基準・一致枠中央値',comparisonDays:'比較日',comparisonStatus:{baseline_days_insufficient:'比較日数不足',low_or_zero_baseline:'基準が小さい／ゼロ'},impactCurrent:'締切時点の有効な確認',impactHistorical:'過去の確認（現在の継続は未確認）'},
      en:{comparisonTitle:'Component comparisons',pairedToday:'Today: matched median',pairedBaseline:'Baseline: matched median',comparisonDays:'paired dates',comparisonStatus:{baseline_days_insufficient:'Insufficient paired dates',low_or_zero_baseline:'Low or zero baseline'},impactCurrent:'Valid at cutoff',impactHistorical:'Historical; continuity unconfirmed'},
      es:{comparisonTitle:'Comparación por indicador',pairedToday:'Actual: mediana coincidente',pairedBaseline:'Base: mediana coincidente',comparisonDays:'fechas comparadas',comparisonStatus:{baseline_days_insufficient:'Fechas insuficientes',low_or_zero_baseline:'Base pequeña o cero'},impactCurrent:'Confirmación válida al cierre',impactHistorical:'Histórico; continuidad no confirmada'}
    };
    Object.assign(translations[lang],extra[lang]);
    translations[lang].comparisonMax={ja:'最大比較倍率',en:'Maximum comparison ratio',es:'Razón comparativa máxima'}[lang];
    for(const [key,value] of Object.entries(text))if(!["global","stable"].includes(key))translations[lang][key]=value;
    translations[lang].methods=text.methods;translations[lang].reasons=text.reasons;
    Object.assign(translations[lang].global,text.global);
    translations[lang].green=text.green;translations[lang].legend.stable=text.stable;
    translations[lang].alertLabels.green=text.green;
    translations[lang].alertLabels.unknown=translations[lang].legend.unknown;
    translations[lang].global.rIndexUnavailable=text.global.matchedNote;
    translations[lang].global.scopeNote={ja:'報道由来の監視信号。部分観測・判定不能・確認済みの実影響を区別します。旧版との差は日々の悪化ではありません。',en:'News monitoring: partial observations, Unknown and verified impacts are distinct. Changes from the legacy method do not show daily deterioration.',es:'Seguimiento de noticias: se distinguen observaciones parciales, falta de evaluación e impactos confirmados. El cambio de método no implica deterioro diario.'}[lang];
    translations[lang].global.weeklyHistory={ja:'週次の観測履歴',en:'Weekly observation history',es:'Historial semanal observado'}[lang];
    translations[lang].global.retrospective={ja:'過去の履歴は原本からの再構成です。その当時に発表した予測ではありません。旧方式とv2の値は直接比較できません。',en:'Past observations are reconstructed from retained originals, not predictions published at that time. Legacy andv2 values are not directly comparable.',es:'El pasado se reconstruye de originales conservados; no son predicciones publicadas entonces. Los métodos anterior yv2 no son directamente comparables.'}[lang];
    translations[lang].viewMode.monitoring={ja:'総合報道監視',en:'Combined news monitoring',es:'Seguimiento integral de noticias'}[lang];
    translations[lang].methods.rindex={ja:'R-INDEX：平常時比較＋発火条件',en:'R-INDEX: baseline comparison and activation guards',es:'R-INDEX: base y controles de activación'}[lang];
    translations[lang].global.primaryColorNote={ja:'R-INDEXは比較と発火条件、RAWは観測数・構成比、総合監視は両者と確認済み影響を示します。選んだ方式で色と件数が変わります。',en:'R-INDEX shows guarded baseline comparisons; RAW shows counts/composition; combined monitoring adds qualified comparisons and accepted impacts. Colors and counts follow the selected method.',es:'R-INDEX compara con controles; RAW muestra conteos y composición; el seguimiento integral añade comparaciones válidas e impactos confirmados. Colores y conteos dependen del método.'}[lang];
    translations[lang].global.rindexGreen={ja:'R-INDEX発火なし',en:'No R-INDEX activation',es:'Sin activación R-INDEX'}[lang];
    translations[lang].global.noFilteredEntries={ja:'選択した警戒色・国名に該当する国はありません。',en:'No countries match the selected level and country name.',es:'Ningún país coincide con el nivel y nombre seleccionados.'}[lang];
    translations[lang].global.rindexGreenScope={ja:'緑は比較可能な指標にgateを通った発火なし。比較不能の指標は未評価で、国の安全や実影響なしを示しません。',en:'Green means no gate-qualified activation in available R comparisons. Unavailable components are unassessed; it does not establish safety or absence of impact.',es:'Verde indica ausencia de activación válida en indicadores comparables. Los faltantes quedan sin evaluar; no demuestra seguridad ni ausencia de impacto.'}[lang];
    const guardReasons={
      ja:{insufficient_country_denominator:'国別の観測母数が不足',insufficient_observation_coverage:'取得時間・出典・観測範囲の条件不足',no_comparable_components:'比較できる指標がない',high_volume_absolute_only_suppressed:'高報道量：絶対数だけの発火を抑制',absolute_share_gate_not_met:'絶対数・構成比の条件未達',external_pressure_geography_proxy_orange_threshold:'actor地理の整合率が低く、R1/R3は橙閾値を適用',actor_geography_unknown_conservative_orange_threshold:'actor地理不明：R1/R3に保守的な橙閾値を適用',below_active_threshold:'発火倍率の閾値未達',active_after_all_guards:'全発火条件を充足',no_active_in_available_comparisons:'比較可能な指標に発火なし'},
      en:{insufficient_country_denominator:'Insufficient country denominator',insufficient_observation_coverage:'Insufficient time/source observation coverage',no_comparable_components:'No comparable components',high_volume_absolute_only_suppressed:'High volume: absolute-only activation suppressed',absolute_share_gate_not_met:'Count/share gate not met',external_pressure_geography_proxy_orange_threshold:'Low actor geographic alignment: Orange threshold for R1/R3',actor_geography_unknown_conservative_orange_threshold:'Actor geography unknown: conservative Orange threshold for R1/R3',below_active_threshold:'Below activation ratio threshold',active_after_all_guards:'All activation guards met',no_active_in_available_comparisons:'No activation in available comparisons'},
      es:{insufficient_country_denominator:'Denominador del país insuficiente',insufficient_observation_coverage:'Cobertura temporal o de fuentes insuficiente',no_comparable_components:'Sin indicadores comparables',high_volume_absolute_only_suppressed:'Volumen alto: no se activa solo por conteo absoluto',absolute_share_gate_not_met:'Condición de conteo/proporción no cumplida',external_pressure_geography_proxy_orange_threshold:'Baja coincidencia geográfica: umbral naranja para R1/R3',actor_geography_unknown_conservative_orange_threshold:'Geografía desconocida: umbral naranja conservador para R1/R3',below_active_threshold:'Razón inferior al umbral',active_after_all_guards:'Todas las condiciones cumplidas',no_active_in_available_comparisons:'Sin activación en indicadores comparables'}
    };
    Object.assign(translations[lang].reasons,guardReasons[lang]);
    translations[lang].global.localImpactScope={ja:'確認できた事業者・サービスの範囲の事実です。全国の機能不全・政府の対応不能へ自動集約しません。掲載や期限だけでは継続・回復を判断しません。',en:'Facts are limited to the stated provider/service scope. They do not automatically set national functional failure or inability to respond. Publication age or expiry does not prove continuity or recovery.',es:'Hechos limitados al proveedor y servicio indicados. No se trasladan automáticamente a falla nacional o incapacidad de respuesta. La fecha o caducidad no prueba continuidad ni recuperación.'}[lang];
    translations[lang].global.scopeNote += {ja:' この画面は報道監視です。国家機能の実供給評価は設計レビュー中で、未実施です。',en:' This is news monitoring. Actual national functional delivery is under design review and remains unassessed.',es:' Es seguimiento de noticias. La provisión funcional nacional sigue sin evaluar; el diseño está en revisión.'}[lang];
    translations[lang].global.primaryColorNote={ja:'R-INDEX：比較と発火条件。RAW：観測数・構成比。総合報道監視：両者の報道信号。確認済みサービス障害と国家機能評価は別です。',en:'R-INDEX: guarded comparisons. RAW: counts/composition. Combined news monitoring: both news signals. Verified service disruptions and national functional assessment remain separate.',es:'R-INDEX: comparación con controles. RAW: conteos y composición. Seguimiento integral: ambas señales de noticias. Las interrupciones confirmadas y la evaluación funcional nacional son distintas.'}[lang];
    translations[lang].global.countrySearch={ja:'国名・国コードを検索',en:'Search country or code',es:'Buscar país o código'}[lang];
    translations[lang].comparisonMax={ja:'発火指標の最大倍率',en:'Maximum active ratio',es:'Razón máxima activa'}[lang];
    translations[lang].global.activeZeroNote={ja:'0＝比較可能な指標に発火なし。—＝比較自体が不能。指標別の倍率と未評価理由は下表に表示します。',en:'0 = no activation in available comparisons; — = not evaluable. Component ratios and reasons are shown below.',es:'0 = sin activación en comparaciones disponibles; — = no evaluable. Razones y motivos por indicador se muestran abajo.'}[lang];
    translations[lang].impactCurrent={ja:'直近の原文確認・継続は未推定',en:'Recent source confirmation; continuity not inferred',es:'Confirmación reciente; continuidad no inferida'}[lang];
    translations[lang].global.firstLitScope={ja:'選択した方式・期間の初点灯週。実事件の開始・因果・回復の証明ではありません。',en:'First model activation in selected method/range; not onset, causality or verified recovery.',es:'Primera activación en método/período elegido; no prueba inicio, causalidad ni recuperación.'}[lang];
    translations[lang].reasons.distinct_domain_or_article_support_insufficient={ja:'R固有の記録または別記事群の裏づけが不足',en:'Insufficient distinct R records/article groups',es:'Respaldo insuficiente por R o grupos de artículos distintos'}[lang];
    translations[lang].global.articleContextScope={ja:'原文を確認した少数記事のR要素・方向の補助説明です。全GKGの分類・記事数や国民全体の感情として扱わず、CAMEOの分母へ加算しません。',en:'Reviewed article R/direction context for a small accepted subset. Not all-GKG classification, article volume or population sentiment; never added to CAMEO denominators.',es:'Contexto R/dirección de pocos artículos revisados. No clasifica todo GKG ni mide volumen o sentimiento poblacional; no se suma al denominador CAMEO.'}[lang];
    translations[lang].global.sourceLedger={ja:'利用中の観測ソース・未接続項目',en:'Observation sources and unconnected inputs',es:'Fuentes e insumos no conectados'}[lang];
    translations[lang].global.snsScope={ja:'住民投稿の文脈は本版に未接続です。Google Trendsは検索関心で、恐怖・不信の方向や全国感情を示しません。',en:'Resident post context is not connected here. Google Trends is search interest, not fear/distrust or nationwide sentiment.',es:'El contexto de publicaciones residentes no está conectado. Google Trends es interés de búsqueda, no miedo/desconfianza ni sentimiento nacional.'}[lang];
}

export const languages = [
    { code: 'en', label: 'EN' },
    { code: 'ja', label: '日本語' },
    { code: 'es', label: 'ES' }
];
