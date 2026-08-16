import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load static config
const configPath = path.resolve(__dirname, '../../config/ai_runtime.json');
let config = {};
try {
    const content = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(content);
} catch (err) {
    console.warn("[AI-BUDGET] Warning: config/ai_runtime.json not found, using defaults.");
    config = {
        maxRetries: 1,
        retryDelayMs: 2000,
        quotaHitThresholds: { low: 2, medium: 5 },
        totalRequestBudget: 500,
        totalWallTimeBudgetMs: 1200000
    };
}

// Runtime state (dynamic)
export const aiState = {
    requests: 0,
    successes: 0,
    failures: 0,
    skipped: 0,
    quotaHits: 0,
    startTime: Date.now(),
    forceDisable: process.env.DISABLE_GEMINI === '1',
    phaseCache: {} // For GT/PM within-run caching
};

const isQuotaError = (err) => {
    const msg = err.message || '';
    return msg.includes('429') || msg.includes('Quota') || msg.includes('Resource has been exhausted') || msg.includes('Too Many Requests');
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const executeFallback = async (fallbackDataOrFn, msg) => {
    if (msg) console.log(msg);
    if (typeof fallbackDataOrFn === 'function') {
        return await fallbackDataOrFn();
    }
    return fallbackDataOrFn;
};

const shouldSkipDueToDegradedState = (priority) => {
    if (aiState.forceDisable) return true;

    // Check Wall Time
    if (config.totalWallTimeBudgetMs && (Date.now() - aiState.startTime) > config.totalWallTimeBudgetMs) {
        return true;
    }

    // Check Requests limit
    if (config.totalRequestBudget && aiState.requests >= config.totalRequestBudget) {
        return true;
    }

    // Check Quota hits vs Priority
    if (priority === 'low' && aiState.quotaHits >= config.quotaHitThresholds.low) return true;
    if (priority === 'medium' && aiState.quotaHits >= config.quotaHitThresholds.medium) return true;
    
    return false;
};

export async function callGeminiWithBudget(model, prompt, priority, fallbackDataOrFn) {
    if (shouldSkipDueToDegradedState(priority)) {
        aiState.skipped++;
        return executeFallback(fallbackDataOrFn, `[AI-BUDGET] Priority: ${priority} | Skipped due to degraded state or budget exhaustion.`);
    }

    const retries = config.maxRetries || 1;
    for (let i = 0; i <= retries; i++) {
        aiState.requests++;
        try {
            const res = await model.generateContent(prompt);
            aiState.successes++;
            return res;
        } catch (err) {
            if (isQuotaError(err)) {
                aiState.quotaHits++;
                const isLimitZero = err.message.includes('limit: 0') || err.message.includes('limit:0');
                if (isLimitZero) {
                    console.warn(`[AI-BUDGET] Fatal limit: 0 hit. Forcing global degradation.`);
                    aiState.forceDisable = true;
                    break;
                }
                
                if (i < retries) {
                    console.warn(`[AI-BUDGET] Priority: ${priority} | Quota Hit detected. Retrying in ${config.retryDelayMs}ms... (Attempt ${i+1}/${retries})`);
                    await delay(config.retryDelayMs || 2000);
                }
            } else {
                console.warn(`[AI-BUDGET] Priority: ${priority} | Non-quota error: ${err.message}`);
                break; // Do not retry non-quota errors
            }
        }
    }

    aiState.failures++;
    return executeFallback(fallbackDataOrFn, `[AI-BUDGET] Priority: ${priority} | Failed after retries. Fallback applied.`);
}

export function logAIReport(phaseName) {
    const elapsed = Date.now() - aiState.startTime;
    console.log(`[AI-REPORT] Phase: ${phaseName} | Elapsed: ${(elapsed/1000).toFixed(1)}s | req=${aiState.requests} success=${aiState.successes} fail=${aiState.failures} skip=${aiState.skipped} 429=${aiState.quotaHits}`);
}

export function getOverallReport() {
    return {
        elapsedMs: Date.now() - aiState.startTime,
        requests: aiState.requests,
        successes: aiState.successes,
        failures: aiState.failures,
        skipped: aiState.skipped,
        quotaHits: aiState.quotaHits
    };
}
