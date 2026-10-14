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
                xt: 'GetDayTrends: Trending topics on X (by country)',
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
                xt: 'GetDayTrends：X上の急上昇トピック（国別）',
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
                xt: 'GetDayTrends: Temas en tendencia en X (por país)',
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
}

export const languages = [
    { code: 'en', label: 'EN' },
    { code: 'ja', label: '日本語' },
    { code: 'es', label: 'ES' }
];
