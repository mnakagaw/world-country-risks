// Translations for the dashboard
export const translations = {
    en: {
        title: 'State Capacity Risk Early-Warning Dashboard',
        subtitle: 'Visualizing daily signs of instability across Security, Living, Governance, and Fiscal signals',
        dataDate: 'DATA',
        active: 'ACTIVE',
        red: 'RED',
        orange: 'ORANGE',
        yellow: 'YELLOW',
        legend: {
            title: 'THREAT LEVEL',
            critical: 'Critical',
            warning: 'Warning',
            watch: 'Watch',
            stable: 'Stable'
        },
        panel: {
            placeholder: 'SELECT A COUNTRY',
            riskScores: 'RISK SCORES',
            r1: 'R1 Security',
            r2: 'R2 Basic Living Conditions',
            r3: 'R3 Governance',
            r4: 'R4 Fiscal Sustainability',
            rLabels: {
                r1: 'Security',
                r2: 'Living',
                r3: 'Governance',
                r4: 'Fiscal'
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
        title: '国家機能リスク早期警戒ダッシュボード',
        subtitle: '各国の不安定化を、治安・生活・統治・財政の兆候から日次で可視化',
        dataDate: 'データ',
        active: '稼働中',
        red: 'RED',
        orange: 'ORANGE',
        yellow: 'YELLOW',
        legend: {
            title: '脅威レベル',
            critical: '警戒',
            warning: '注意',
            watch: '監視',
            stable: '安定'
        },
        panel: {
            placeholder: '国を選択してください',
            riskScores: 'リスクスコア',
            r1: 'R1 安全',
            r2: 'R2 生活の床',
            r3: 'R3 統治の安定',
            r4: 'R4 財政の持続性',
            rLabels: {
                r1: '治安',
                r2: '生活',
                r3: '統治',
                r4: '財政'
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
        title: 'Tablero de Alerta Temprana de Riesgo de Capacidad Estatal',
        subtitle: 'Visualización diaria de señales de inestabilidad a partir de indicadores de Seguridad, Vida, Gobernanza y Fiscalidad',
        dataDate: 'DATOS',
        active: 'ACTIVO',
        red: 'ROJO',
        orange: 'NARANJA',
        yellow: 'AMARILLO',
        legend: {
            title: 'NIVEL DE AMENAZA',
            critical: 'Crítico',
            warning: 'Alerta',
            watch: 'Vigilancia',
            stable: 'Estable'
        },
        panel: {
            placeholder: 'SELECCIONE UN PAÍS',
            riskScores: 'PUNTUACIONES DE RIESGO',
            r1: 'R1 Seguridad',
            r2: 'R2 Condiciones Básicas de Vida',
            r3: 'R3 Gobernanza',
            r4: 'R4 Sostenibilidad Fiscal',
            rLabels: {
                r1: 'Seguridad',
                r2: 'Vida diaria',
                r3: 'Gobernanza',
                r4: 'Fiscal'
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

export const languages = [
    { code: 'en', label: 'EN' },
    { code: 'ja', label: '日本語' },
    { code: 'es', label: 'ES' }
];
