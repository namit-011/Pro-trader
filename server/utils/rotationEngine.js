'use strict';

/**
 * Rotation Engine
 * Tests addressed: 9 (Budget Day dampening), 11 (accumulation vs dead money),
 * 13 (India-specific cycle), 25 (crash circuit breaker), 26 (flow concentration warning)
 */

// ── 30-day rolling sector sentiment store ─────────────────────────────────────
// Structure: { [sector]: [{ ts, score, sourceWeight }] }
const sectorHistory = {};
const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const SECTORS = [
    'Banking','IT','Energy','Pharma','Auto','Metals',
    'Telecom','Finance','FMCG','Realty','Infrastructure',
];

SECTORS.forEach(s => { sectorHistory[s] = []; });

// ── Test 9: High-volume event detection (Budget, RBI Policy, etc.) ────────────
const MACRO_EVENT_PATTERNS = [
    /\bunion budget\b/i, /\brbi (policy|meet|mpc|rate|decision)\b/i,
    /\bbudget (day|2024|2025|2026)\b/i, /\bmonetary policy\b/i,
    /\bquarterly results\b.*\ball\b/i, /\bgst council\b/i,
    /\bfed (meeting|decision|rate|fomc)\b/i,
];

let macroEventBuffer = []; // recent headlines checked for event density
let macroEventTs = 0;
const MACRO_EVENT_TTL = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Test 9: Returns a dampening factor (0.0–1.0) for sector differentiation.
 * When a macro event floods all sectors with simultaneous news, the differential
 * signal collapses. We dampen confidence rather than suppress it entirely.
 */
const getMacroEventDampening = (headlines) => {
    const now = Date.now();
    // Refresh buffer every 4 hours
    if (now - macroEventTs > MACRO_EVENT_TTL) {
        macroEventBuffer = [];
        macroEventTs = now;
    }
    const recent = [...macroEventBuffer, ...headlines].slice(-200);
    macroEventBuffer = recent;

    const eventHits = recent.filter(h =>
        MACRO_EVENT_PATTERNS.some(re => re.test(h))
    ).length;

    // If >25 event-tagged headlines in the buffer → high-saturation event day
    if (eventHits > 40) return 0.30; // 70% dampening
    if (eventHits > 25) return 0.55; // 45% dampening
    if (eventHits > 10) return 0.75; // 25% dampening
    return 1.0;                       // no dampening
};

// ── Test 25: Market crash circuit breaker ─────────────────────────────────────
// When market-wide stress is detected, suppress rotation SELL/EXIT signals.
// Selling at the bottom is the worst outcome; the product must not amplify it.
let circuitBreakerState = { active: false, triggeredAt: 0, reason: '' };
const CIRCUIT_BREAKER_TTL = 2 * 60 * 60 * 1000; // re-evaluate every 2h

/**
 * @param {number} niftyChangePercent  - Today's Nifty 50 % change
 * @param {number} negSectorCount      - Number of sectors with negative rotation score
 * @param {number} indiaVix            - India VIX level
 */
const updateCircuitBreaker = (niftyChangePercent, negSectorCount, indiaVix) => {
    const now = Date.now();
    const stressConditions = [
        niftyChangePercent <= -3,         // Nifty down 3%+
        negSectorCount >= 8,              // 8+ of 11 sectors negative simultaneously
        indiaVix > 30,                    // VIX panic zone
    ];
    const stressScore = stressConditions.filter(Boolean).length;

    if (stressScore >= 2) {
        circuitBreakerState = {
            active: true,
            triggeredAt: now,
            reason: `Market stress: Nifty ${niftyChangePercent?.toFixed(1)}%, ${negSectorCount} sectors negative, VIX ${indiaVix?.toFixed(0)}`,
        };
    } else if (circuitBreakerState.active && now - circuitBreakerState.triggeredAt > CIRCUIT_BREAKER_TTL) {
        circuitBreakerState = { active: false, triggeredAt: 0, reason: '' };
    }
    return circuitBreakerState;
};

const getCircuitBreaker = () => circuitBreakerState;

// ── Test 11: Accumulation vs Dead Money differentiation ───────────────────────
/**
 * Returns 'ACCUMULATION' | 'DEAD_MONEY' | 'RANGING' based on price + volume pattern.
 * Key insight: price flat + volume INCREASING = institutional accumulation (do not flag).
 *              price flat + volume DECLINING   = true dead money (flag).
 */
const classifyRangeboundStock = ({ closes, volumes, rsi }) => {
    if (!closes || closes.length < 20) return 'INSUFFICIENT_DATA';

    const recent = closes.slice(-20);
    const priceRange = (Math.max(...recent) - Math.min(...recent)) / recent[0];

    // Not actually rangebound
    if (priceRange > 0.08) return 'TRENDING';

    if (!volumes || volumes.length < 20) return 'RANGING';

    const recentVols = volumes.slice(-10);
    const priorVols  = volumes.slice(-20, -10);
    const avgRecent  = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
    const avgPrior   = priorVols.reduce((s, v)  => s + v, 0) / priorVols.length;

    // Volume expanding while price is flat → accumulation
    if (avgRecent > avgPrior * 1.25 && rsi >= 40 && rsi <= 60) return 'ACCUMULATION';
    // Volume contracting while price flat → dead money
    if (avgRecent < avgPrior * 0.80) return 'DEAD_MONEY';
    return 'RANGING';
};

// ── Test 13: India business cycle sector rotation map ─────────────────────────
// India's cycle differs from the US. Key drivers:
// - Rate cuts → Banking/NBFC/Realty lead
// - Capex/infra push → Infrastructure/Metals lead
// - Rural recovery → FMCG/Auto (2-wheeler) lead
// - Export recovery → IT/Pharma lead
// - Commodity spike → Energy/Metals lead
const INDIA_CYCLE_CONTEXT = {
    rateCutCycle:   { leaders: ['Banking','Finance','Realty'],    laggards: ['IT','FMCG']        },
    caexPush:       { leaders: ['Infrastructure','Metals','Energy'], laggards: ['FMCG','Telecom'] },
    ruralRecovery:  { leaders: ['FMCG','Auto'],                   laggards: ['IT','Metals']      },
    exportRecovery: { leaders: ['IT','Pharma'],                   laggards: ['Realty','Energy']  },
    commoditySpike: { leaders: ['Energy','Metals'],               laggards: ['Auto','FMCG']      },
    defensiveFlight:{ leaders: ['Pharma','FMCG','IT'],            laggards: ['Realty','Banking'] },
};

// ── Rotation score computation ─────────────────────────────────────────────────
/**
 * Computes a composite sector Heat Score from -10 to +10.
 * Formula:
 *   Heat = sentimentMomentum×0.30 + priceMomentum30d×0.35
 *        + volumeConfirmation×0.15 + fiiFlow×0.20
 * Each component is normalised to [-1, +1] before weighting.
 */
const computeSectorHeat = ({
    sentimentDelta,   // 7d avg sentiment score minus 30d avg (raw score units)
    priceMomentum30d, // % change over 30 days (e.g. +6.2 or -3.1)
    volumeVsAvg,      // ratio: recent 10d avg vol / prior 20d avg vol (e.g. 1.3)
    fiiFlow7d,        // net FII flow in crores over 7 days (positive = buying)
    dampening = 1.0,  // macro event dampening factor
}) => {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // Normalise each component to [-1, +1]
    const sentNorm  = clamp(sentimentDelta / 5, -1, 1);
    const priceNorm = clamp(priceMomentum30d / 15, -1, 1);
    const volNorm   = clamp((volumeVsAvg - 1) / 0.5, -1, 1);
    const fiiNorm   = clamp(fiiFlow7d / 5000, -1, 1); // 5000 Cr as full scale

    const raw = (sentNorm * 0.30) + (priceNorm * 0.35) + (volNorm * 0.15) + (fiiNorm * 0.20);
    const heat = +(raw * 10 * dampening).toFixed(2); // scale to -10…+10

    return { heat: clamp(heat, -10, 10), components: { sentNorm, priceNorm, volNorm, fiiNorm } };
};

// ── Record a sentiment data point for a sector ────────────────────────────────
const recordSectorSentiment = (sector, score, sourceWeight = 1.0) => {
    if (!sectorHistory[sector]) sectorHistory[sector] = [];
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    // Prune old entries
    sectorHistory[sector] = sectorHistory[sector].filter(e => e.ts > cutoff);
    sectorHistory[sector].push({ ts: Date.now(), score, sourceWeight });
};

// ── Get weighted average sector sentiment for a time window ──────────────────
const getSectorSentimentAvg = (sector, windowMs) => {
    const cutoff = Date.now() - windowMs;
    const entries = (sectorHistory[sector] || []).filter(e => e.ts > cutoff);
    if (!entries.length) return 0;
    const weightedSum = entries.reduce((s, e) => s + e.score * e.sourceWeight, 0);
    const totalWeight = entries.reduce((s, e) => s + e.sourceWeight, 0);
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
};

// ── Get 7d vs 30d momentum delta ─────────────────────────────────────────────
const getSectorMomentumDelta = (sector) => {
    const avg7d  = getSectorSentimentAvg(sector, 7  * 24 * 60 * 60 * 1000);
    const avg30d = getSectorSentimentAvg(sector, 30 * 24 * 60 * 60 * 1000);
    return { avg7d, avg30d, delta: avg7d - avg30d };
};

// ── Test 26: Flow concentration warning ───────────────────────────────────────
/**
 * If the top-3 rotating-in sectors are all correlated (e.g. all PSU plays,
 * all rate-sensitive), warn that the product's recommendation may create
 * a crowded trade with self-reinforcing retail flows.
 */
const SECTOR_CORRELATION_GROUPS = {
    rateSensitive: ['Banking','Finance','Realty'],
    commodity:     ['Energy','Metals'],
    defensive:     ['Pharma','FMCG'],
    growth:        ['IT','Telecom'],
    capex:         ['Infrastructure','Auto'],
};

const getFlowConcentrationWarning = (topSectors) => {
    for (const [group, members] of Object.entries(SECTOR_CORRELATION_GROUPS)) {
        const overlap = topSectors.filter(s => members.includes(s));
        if (overlap.length >= 2) {
            return {
                warning: true,
                group,
                message: `Top rotation picks are concentrated in correlated ${group} plays. Crowded trade risk — these sectors tend to move together.`,
            };
        }
    }
    return { warning: false };
};

module.exports = {
    SECTORS,
    recordSectorSentiment,
    getSectorSentimentAvg,
    getSectorMomentumDelta,
    computeSectorHeat,
    getMacroEventDampening,
    updateCircuitBreaker,
    getCircuitBreaker,
    classifyRangeboundStock,
    getFlowConcentrationWarning,
    INDIA_CYCLE_CONTEXT,
};
