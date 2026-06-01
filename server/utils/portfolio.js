'use strict';

/**
 * Portfolio Analysis Engine
 * Tests addressed: 1 (signal throttle), 2 (cost basis / LTCG), 4 (rotation cost),
 * 14 (liquidity cost), 15 (MF flag), 18 (ticker disambiguation), 19 (position significance),
 * 20 (new listing guard), 28 (liquidity risk), 29 (long-term core)
 */

const { SECTOR_MAP } = require('../constants/indices');
const { classifyRangeboundStock } = require('./rotationEngine');

// ── Test 18: Ticker disambiguation lookup ─────────────────────────────────────
// Handles mergers, name changes, DVR shares, common ambiguities in Indian markets
const TICKER_ALIAS_MAP = {
    // HDFC merger (HDFC Ltd merged into HDFC Bank Apr 2023)
    'HDFC':         'HDFCBANK.NS',
    'HDFC.NS':      'HDFCBANK.NS',
    'HDFCLTD':      'HDFCBANK.NS',
    'HDFCLTD.NS':   'HDFCBANK.NS',
    // Tata Motors DVR
    'TATAMTRDVR':   'TATAMTRDVR.NS',
    'TATAMTRDVR.NS':'TATAMTRDVR.NS',
    // Common short forms
    'BAJAJ-AUTO':   'BAJAJ-AUTO.NS',
    'M&M':          'M&M.NS',
    'L&T':          'LT.NS',
    // Without .NS suffix — normalise
};

const normaliseTicker = (raw) => {
    const upper = (raw || '').toUpperCase().trim();
    if (TICKER_ALIAS_MAP[upper]) return TICKER_ALIAS_MAP[upper];
    // Auto-append .NS for NSE tickers that don't have it
    if (!upper.endsWith('.NS') && !upper.endsWith('.BO') &&
        !upper.includes('=F') && !upper.includes('=X') &&
        !upper.startsWith('^')) {
        return upper + '.NS';
    }
    return upper;
};

// ── Ticker → Sector lookup (extends SECTOR_MAP) ───────────────────────────────
const buildTickerSectorMap = () => {
    const map = {};
    Object.entries(SECTOR_MAP).forEach(([sector, tickers]) => {
        tickers.forEach(t => { map[t] = sector; });
    });
    return map;
};
const TICKER_SECTOR = buildTickerSectorMap();

const getSector = (ticker) => TICKER_SECTOR[ticker] || TICKER_SECTOR[ticker.replace('.NS','')+'.NS'] || 'Other';

// ── Test 2: LTCG classification ───────────────────────────────────────────────
const LTCG_THRESHOLD_DAYS = 365;
const STCG_RATE = 0.20;   // 20% STCG on equity post-Jul 2024
const LTCG_RATE = 0.125;  // 12.5% LTCG above ₹1.25L exemption
const LTCG_EXEMPTION = 125000;

const classifyHoldingPeriod = (buyDate) => {
    if (!buyDate) return { isLTCG: null, daysHeld: null, taxRate: null };
    const days = Math.floor((Date.now() - new Date(buyDate).getTime()) / 86400000);
    const isLTCG = days >= LTCG_THRESHOLD_DAYS;
    return { isLTCG, daysHeld: days, taxRate: isLTCG ? LTCG_RATE : STCG_RATE };
};

// ── Test 4 & 14: Rotation cost calculator ────────────────────────────────────
/**
 * Estimates the all-in cost of executing a rotation:
 * exit old position + enter new position
 * Includes: brokerage, STT (sell side), exchange charges, SEBI fee, GST, capital gains tax
 */
const estimateRotationCost = ({
    exitValue,      // ₹ value of position being exited
    entryValue,     // ₹ value of new position being entered (usually same)
    unrealisedPnL,  // ₹ unrealised P&L on exit (positive = profit)
    isLTCG,        // boolean
    avgDailyVolume, // of the stock being exited (for liquidity impact cost)
    bidAskSpreadPct = 0.1, // estimated bid-ask spread %
}) => {
    const exitVal  = exitValue  || 0;
    const entryVal = entryValue || exitVal;

    // Brokerage: flat ₹20/trade (Zerodha-style), both legs
    const brokerage = 40;

    // STT: 0.1% on sell delivery
    const stt = exitVal * 0.001;

    // Exchange + SEBI + clearing charges ≈ 0.00345% each side
    const exchangeCharges = (exitVal + entryVal) * 0.0000345;

    // GST: 18% on (brokerage + exchange charges)
    const gst = (brokerage + exchangeCharges) * 0.18;

    // Stamp duty: 0.015% on buy side
    const stampDuty = entryVal * 0.00015;

    // Capital gains tax
    let capitalGainsTax = 0;
    if (unrealisedPnL > 0) {
        if (isLTCG) {
            const taxableGain = Math.max(0, unrealisedPnL - LTCG_EXEMPTION);
            capitalGainsTax = taxableGain * LTCG_RATE;
        } else {
            capitalGainsTax = unrealisedPnL * STCG_RATE;
        }
    }

    // Test 14: Liquidity impact cost (market impact for large orders)
    // If position is >3% of avg daily volume, expect impact cost
    let liquidityImpact = 0;
    if (avgDailyVolume && exitVal > 0) {
        const stockPrice = exitVal; // proxy — caller should pass per-share values
        const liquidityRatio = exitVal / Math.max(1, avgDailyVolume);
        if (liquidityRatio > 0.03) {
            liquidityImpact = exitVal * Math.min(0.015, liquidityRatio * 0.1);
        }
    }

    // Bid-ask spread cost (both sides)
    const spreadCost = (exitVal + entryVal) * (bidAskSpreadPct / 100) / 2;

    const totalCost = brokerage + stt + exchangeCharges + gst + stampDuty +
                      capitalGainsTax + liquidityImpact + spreadCost;

    const totalCostPct = exitVal > 0 ? (totalCost / exitVal) * 100 : 0;

    return {
        totalCost:       +totalCost.toFixed(2),
        totalCostPct:    +totalCostPct.toFixed(2),
        breakdown: {
            brokerage:       +brokerage.toFixed(2),
            stt:             +stt.toFixed(2),
            exchangeCharges: +exchangeCharges.toFixed(2),
            gst:             +gst.toFixed(2),
            stampDuty:       +stampDuty.toFixed(2),
            capitalGainsTax: +capitalGainsTax.toFixed(2),
            liquidityImpact: +liquidityImpact.toFixed(2),
            spreadCost:      +spreadCost.toFixed(2),
        },
        // Test 1: Signal throttle — warn if cost destroys the expected gain
        warningIfRotationGainBelow: `${(totalCostPct * 2).toFixed(1)}%`,
    };
};

// ── Test 19: Position significance filter ─────────────────────────────────────
const isSignificantPosition = (positionValue, totalPortfolioValue) => {
    const pct = positionValue / totalPortfolioValue;
    return positionValue >= 10000 && pct >= 0.01; // ≥₹10k AND ≥1% of portfolio
};

// ── Test 20: New listing / insufficient data guard ────────────────────────────
const MINIMUM_HISTORY_DAYS = 30;

const checkDataSufficiency = (historicalDays, ticker) => {
    if (historicalDays < MINIMUM_HISTORY_DAYS) {
        return {
            sufficient: false,
            reason: `Only ${historicalDays} days of price history available for ${ticker}. Signals require ${MINIMUM_HISTORY_DAYS}+ days. This may be a recent IPO or newly listed stock.`,
        };
    }
    return { sufficient: true };
};

// ── Test 28: Liquidity risk classifier ────────────────────────────────────────
const classifyLiquidityRisk = ({ avgDailyVolumeCr, marketCapCr, bidAskSpreadPct, isF0Eligible }) => {
    let score = 0;
    if (avgDailyVolumeCr < 5)   score += 3;
    else if (avgDailyVolumeCr < 20) score += 1;

    if (marketCapCr < 500)   score += 3;
    else if (marketCapCr < 2000) score += 1;

    if (bidAskSpreadPct > 0.5)  score += 2;
    else if (bidAskSpreadPct > 0.2) score += 1;

    if (!isF0Eligible) score += 1;

    if (score >= 6) return { level: 'HIGH',   label: 'Thinly traded — exit may move price against you' };
    if (score >= 3) return { level: 'MEDIUM', label: 'Moderate liquidity — check volumes before acting' };
    return           { level: 'LOW',    label: 'Adequately liquid' };
};

// ── Core: analyse a single holding ───────────────────────────────────────────
/**
 * @param {object} holding - { ticker, qty, avgBuy, buyDate, isCore, currentPrice,
 *                             rsi, closes, volumes, avgDailyVolumeCr, marketCapCr,
 *                             recentNewsCount, highImpactNews }
 * @param {object} sectorRotation - { [sector]: { heat, rank } }
 * @param {number} totalPortfolioValue
 */
const analyseHolding = (holding, sectorRotation, totalPortfolioValue) => {
    const ticker   = normaliseTicker(holding.ticker);
    const sector   = getSector(ticker);
    const cmp      = holding.currentPrice || holding.avgBuy;
    const value    = cmp * holding.qty;
    const pnl      = (cmp - holding.avgBuy) * holding.qty;
    const pnlPct   = ((cmp - holding.avgBuy) / holding.avgBuy) * 100;
    const { isLTCG, daysHeld, taxRate } = classifyHoldingPeriod(holding.buyDate);

    // Test 19: skip insignificant positions from active signals
    const significant = isSignificantPosition(value, totalPortfolioValue);

    // Test 29: Long-term core positions are excluded from rotation analysis
    if (holding.isCore) {
        return {
            ticker, sector, value, pnl, pnlPct, daysHeld, isLTCG, taxRate,
            verdict: 'CORE', verdictLabel: 'Long-term Core — excluded from rotation analysis',
            significant, isCore: true,
        };
    }

    // Test 11: Accumulation vs Dead Money
    const rangeClass = classifyRangeboundStock({
        closes:  holding.closes  || [],
        volumes: holding.volumes || [],
        rsi:     holding.rsi     || 50,
    });

    // Sector rotation alignment
    const sectorData  = sectorRotation[sector] || { heat: 0, rank: 6 };
    const heat        = sectorData.heat || 0;
    const rotatingIn  = heat >= 3;
    const rotatingOut = heat <= -3;

    // Dead Money: rangebound + low sector heat + no recent catalyst
    const noRecentCatalyst = (holding.highImpactNews || 0) === 0;
    const isDeadMoney = rangeClass === 'DEAD_MONEY' &&
                        Math.abs(heat) < 3 &&
                        noRecentCatalyst &&
                        significant;

    // Verdict logic
    let verdict, verdictLabel;
    if (!significant) {
        verdict = 'NEGLIGIBLE'; verdictLabel = 'Position too small to flag (<1% / <₹10k)';
    } else if (rangeClass === 'ACCUMULATION') {
        verdict = 'WATCH'; verdictLabel = 'Rangebound but volume building — possible accumulation';
    } else if (isDeadMoney) {
        verdict = 'DEAD_MONEY'; verdictLabel = 'Capital idle — flat price, no catalyst, neutral sector';
    } else if (rotatingOut && pnlPct > 5) {
        verdict = 'REVIEW'; verdictLabel = 'Sector rotating out — consider reviewing if thesis unchanged';
    } else if (rotatingOut && pnlPct <= 5) {
        verdict = 'EXIT_ZONE'; verdictLabel = 'Sector rotating out + limited upside buffer';
    } else if (rotatingIn) {
        verdict = 'HOLD'; verdictLabel = 'Sector in positive rotation — thesis intact';
    } else {
        verdict = 'NEUTRAL'; verdictLabel = 'Sector momentum neutral — monitor';
    }

    // Test 2: LTCG warning when verdict suggests action
    const ltcgWarning = (verdict === 'REVIEW' || verdict === 'EXIT_ZONE') && isLTCG === false && pnl > 0
        ? `STCG alert: selling now triggers ${STCG_RATE * 100}% tax on ₹${Math.round(pnl).toLocaleString('en-IN')} gain. Holding ${LTCG_THRESHOLD_DAYS - daysHeld} more days qualifies for LTCG (${LTCG_RATE * 100}%).`
        : null;

    // Test 4: Rotation cost estimate
    const rotationCost = (verdict === 'REVIEW' || verdict === 'EXIT_ZONE' || verdict === 'DEAD_MONEY') && significant
        ? estimateRotationCost({
            exitValue:      value,
            entryValue:     value,
            unrealisedPnL:  pnl,
            isLTCG:         isLTCG,
            avgDailyVolume: (holding.avgDailyVolumeCr || 50) * 1e7,
        })
        : null;

    // Test 28: Liquidity risk
    const liquidityRisk = classifyLiquidityRisk({
        avgDailyVolumeCr: holding.avgDailyVolumeCr || 50,
        marketCapCr:      holding.marketCapCr      || 10000,
        bidAskSpreadPct:  holding.bidAskSpreadPct  || 0.1,
        isF0Eligible:     holding.isF0Eligible      || false,
    });

    return {
        ticker, sector, value, pnl: +pnl.toFixed(2), pnlPct: +pnlPct.toFixed(2),
        daysHeld, isLTCG, taxRate, significant, isCore: false,
        sectorHeat: heat, rangeClass, verdict, verdictLabel,
        ltcgWarning, rotationCost, liquidityRisk,
    };
};

// ── Portfolio Health Score (0–100) ────────────────────────────────────────────
/**
 * @param {Array}  holdings         - array of analyseHolding() results
 * @param {object} sectorRotation   - { [sector]: { heat, rank } }
 */
const computeHealthScore = (holdings, sectorRotation) => {
    const significant = holdings.filter(h => h.significant && !h.isCore);
    if (!significant.length) return { score: null, reason: 'No significant holdings to score' };

    const totalValue = significant.reduce((s, h) => s + h.value, 0);

    // Component 1: % in top-3 rotating sectors (0–40 pts)
    const topSectors = Object.entries(sectorRotation)
        .sort((a, b) => b[1].heat - a[1].heat)
        .slice(0, 3).map(e => e[0]);
    const inTopSectors = significant.filter(h => topSectors.includes(h.sector))
        .reduce((s, h) => s + h.value, 0) / totalValue;
    const c1 = inTopSectors * 40;

    // Component 2: % NOT in bottom-3 rotating sectors (0–25 pts)
    const bottomSectors = Object.entries(sectorRotation)
        .sort((a, b) => a[1].heat - b[1].heat)
        .slice(0, 3).map(e => e[0]);
    const inBottomSectors = significant.filter(h => bottomSectors.includes(h.sector))
        .reduce((s, h) => s + h.value, 0) / totalValue;
    const c2 = (1 - inBottomSectors) * 25;

    // Component 3: % NOT in dead money (0–20 pts)
    const deadMoney = significant.filter(h => h.verdict === 'DEAD_MONEY')
        .reduce((s, h) => s + h.value, 0) / totalValue;
    const c3 = (1 - deadMoney) * 20;

    // Component 4: Diversification via HHI (0–15 pts)
    const sectorWeights = {};
    significant.forEach(h => {
        sectorWeights[h.sector] = (sectorWeights[h.sector] || 0) + h.value / totalValue;
    });
    const hhi = Object.values(sectorWeights).reduce((s, w) => s + w * w, 0);
    const diversification = 1 - hhi; // 0 = fully concentrated, ~0.9 = well diversified
    const c4 = diversification * 15;

    const score = Math.round(c1 + c2 + c3 + c4);

    // Labels
    let label, colour;
    if (score >= 70) { label = 'Healthy';     colour = '#22c55e'; }
    else if (score >= 45) { label = 'Review';  colour = '#f59e0b'; }
    else               { label = 'Restructure'; colour = '#ef4444'; }

    // Opportunity gaps: top-rotating sectors where portfolio has <5% exposure
    const portfolioSectors = new Set(significant.map(h => h.sector));
    const gaps = topSectors.filter(s => !portfolioSectors.has(s) ||
        (sectorWeights[s] || 0) < 0.05
    );

    // Dead capital summary
    const deadCapital = significant.filter(h => h.verdict === 'DEAD_MONEY')
        .reduce((s, h) => s + h.value, 0);

    return {
        score, label, colour,
        components: { alignedToRotation: +c1.toFixed(1), avoidingRotatingOut: +c2.toFixed(1), noDeadMoney: +c3.toFixed(1), diversification: +c4.toFixed(1) },
        topSectors, bottomSectors, gaps,
        deadCapital: +deadCapital.toFixed(2),
        deadCapitalPct: +((deadCapital / totalValue) * 100).toFixed(1),
    };
};

// ── Test 15: MF holdings flag ─────────────────────────────────────────────────
const MF_PATTERNS = /^(.*)(MF|FUND|ETF|BEES|NIFTY\s?\d|SENSEX|LIQUIDBEES|GOLDBEES|BANKBEES|JUNIORBEES|CPSEETF|PSUBNKBEES)$/i;

const isMutualFundTicker = (ticker) => MF_PATTERNS.test(ticker) ||
    ticker.includes('NIFTYBEES') || ticker.includes('LIQUIDCASE') ||
    ticker.toLowerCase().includes('growth') || ticker.toLowerCase().includes('direct plan');

module.exports = {
    normaliseTicker,
    getSector,
    classifyHoldingPeriod,
    estimateRotationCost,
    isSignificantPosition,
    checkDataSufficiency,
    classifyLiquidityRisk,
    analyseHolding,
    computeHealthScore,
    isMutualFundTicker,
    LTCG_THRESHOLD_DAYS,
    STCG_RATE,
    LTCG_RATE,
};
