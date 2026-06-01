'use strict';

const LM_STRONG_BEAR = [
    'bankruptcy','bankrupt','fraud','lawsuit','investigation','restatement','sec probe','ponzi',
    'insolvency','criminal','subpoena','recall','breach','default','downgrade','cut','miss',
    'slump','crash','collapse','tumble','plunge','selloff','warning','cut guidance','loss',
    'charges','writedown','impairment','layoffs','job cuts','fired','resign','suspended',
    'halted','delisted',
];
const LM_BEAR = [
    'below expectations','decline','fall','drop','weak','concern','headwinds','slowdown','miss',
    'disappoints','reduces','lowers','cautious','uncertainty','volatile','pressure','challenging',
    'loss','negative','downside','risk','warns','cuts','hurt','drag','weigh','miss estimates',
    'below forecast',
];
const LM_STRONG_BULL = [
    'record revenue','blowout','beat expectations','raised guidance','fda approval','acquisition',
    'buyback','dividend hike','strategic partnership','breakthrough','upgrade','strong buy',
    'outperform','new high','all-time high','profit surge','revenue beat','eps beat',
    'accelerating growth','new contract','major deal',
];
const LM_BULL = [
    'beat','growth','strong','rise','gain','profit','outperform','upgrade','expand','positive',
    'beat estimates','above forecast','increased','higher','improve','optimistic','opportunity',
    'recovery','momentum','bullish','upside','rally','surge','soar','climb',
];

// ── Test 7: Source credibility weights ────────────────────────────────────────
const SOURCE_WEIGHTS = {
    'Reuters':           1.5,
    'Bloomberg':         1.5,
    'Economic Times':    1.2,
    'Business Standard': 1.2,
    'Livemint':          1.1,
    'NDTV Profit':       1.0,
    'MoneyControl':      0.8,
    'Zee Business':      0.7,
};

// ── Test 8: Negation patterns — check 60 chars before any keyword ─────────────
// Covers: "not", "no", "n't", "never", "fails to", "fail to", "unable to",
// "cannot", "without", "lacks", "missing", "doesn't", "didn't", "won't" etc.
const NEGATION_RE = /\b(not|no|n't|never|fail(s|ed)?\s+to|unable\s+to|cannot|can't|won't|doesn't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|without|lack(s|ed)?|miss(es|ed)?\s+to)\b\s*(\w+\s+){0,4}$/;

const checkNegated = (text, matchIndex) => {
    const window = text.slice(Math.max(0, matchIndex - 70), matchIndex);
    return NEGATION_RE.test(window);
};

// ── Test 10: Conglomerate-specific event ring-fencing ─────────────────────────
// When a headline is about a specific conglomerate entity (not the sector broadly),
// we mark it conglomerate-specific so callers can suppress sector-wide signals.
const CONGLOMERATE_PATTERNS = [
    { re: /\badani\b/,        name: 'Adani',    tickers: ['ADANIENT.NS','ADANIPORTS.NS','ADANIGREEN.NS','ADANITRANS.NS'] },
    { re: /\breliance\b/,     name: 'Reliance', tickers: ['RELIANCE.NS'] },
    { re: /\btata\s+group\b/, name: 'TataGroup',tickers: [] },
];

// Returns the conglomerate name if headline is conglomerate-specific, else null.
// A headline is considered conglomerate-specific if it names the group AND does NOT
// contain sector-systemic words (e.g. "banking sector", "IT sector", "all banks").
const detectConglomerate = (text) => {
    const low = text.toLowerCase();
    const sectorSystemic = /\b(sector|industry|all banks|banking system|entire market|market-wide)\b/.test(low);
    if (sectorSystemic) return null;
    for (const cg of CONGLOMERATE_PATTERNS) {
        if (cg.re.test(low)) return { name: cg.name, tickers: cg.tickers };
    }
    return null;
};

// ── Core scorer with negation awareness ──────────────────────────────────────
const _scoreText = (text) => {
    const t = (text || '').toLowerCase();
    let score = 0;
    let total = 0;

    const apply = (words, base) => {
        words.forEach((w) => {
            const idx = t.indexOf(w);
            if (idx === -1) return;
            const negated = checkNegated(t, idx);
            // Negated bear → effectively bullish; negated bull → effectively bearish
            const effective = negated ? -base : base;
            score += effective;
            total += Math.abs(base);
        });
    };

    apply(LM_STRONG_BEAR, -2);
    apply(LM_BEAR,        -1);
    apply(LM_STRONG_BULL, +2);
    apply(LM_BULL,        +1);

    return { score, total };
};

const dSent = (text) => {
    const { score } = _scoreText(text);
    if (score >= 2)  return 'bullish';
    if (score <= -2) return 'bearish';
    if (score > 0)   return 'mildly_bullish';
    if (score < 0)   return 'mildly_bearish';
    return 'neutral';
};

// ── sentScore: negation-aware, returns sourceWeight for aggregation ───────────
const sentScore = (text, source = null) => {
    const { score, total } = _scoreText(text);
    const confidence = total > 0 ? Math.min(99, Math.round((Math.abs(score) / total) * 100)) : 0;
    const sourceWeight = SOURCE_WEIGHTS[source] || 1.0;
    let sentiment;
    if (score >= 2)  sentiment = 'bullish';
    else if (score <= -2) sentiment = 'bearish';
    else if (score > 0)   sentiment = 'mildly_bullish';
    else if (score < 0)   sentiment = 'mildly_bearish';
    else                  sentiment = 'neutral';
    return { sentiment, score, confidence, sourceWeight };
};

// Legacy 0-100 scale helper
const dSentScore = (t) => {
    const { score } = _scoreText(t);
    return Math.max(0, Math.min(100, 50 + score * 10));
};

// ── Sector classifier ─────────────────────────────────────────────────────────
const dSec = (t, conglomerateCtx = null) => {
    // Test 10: if headline is conglomerate-specific, return only that entity's
    // primary sectors, not a broad multi-sector blast.
    if (conglomerateCtx) {
        if (conglomerateCtx.name === 'Adani')     return ['Infrastructure', 'Energy'];
        if (conglomerateCtx.name === 'Reliance')  return ['Energy'];
        if (conglomerateCtx.name === 'TataGroup') return ['Broad Market'];
    }

    const low = t.toLowerCase();
    const k = {
        Banking:       ['bank','hdfc','icici','axis','sbi','rbi','kotak','npa','credit','nbfc','lending','fintech'],
        IT:            ['tcs','infy','infosys','wipro','hcl','tech mahindra','software','ai ','digital','saas','cloud'],
        Energy:        ['oil','reliance','crude','fuel','gas','power','ongc','bpcl','petroleum','renewable','solar'],
        Pharma:        ['pharma','drug','medicine','fda','cipla','sun pharma','health','vaccine','biotech','api '],
        Auto:          ['maruti','mahindra','bajaj auto','hero motor','ev ','electric vehicle','automotive','automobile'],
        Metals:        ['steel','jswsteel','tatasteel','hindalco','vedanta','aluminium','copper','mining','iron ore'],
        Telecom:       ['airtel','jio','vodafone','telecom','5g','spectrum'],
        Finance:       ['sebi','sensex','nifty','fii','ipo','bajaj finance','stock market','equity','mutual fund'],
        FMCG:          ['hindustan unilever','hul','nestle','dabur','fmcg','itc','britannia','consumer goods'],
        Realty:        ['real estate','dlf','housing','property','realty','cement','construction'],
        Infrastructure:['infrastructure','adani','larsen','l&t','defence','bhel','siemens'],
    };
    const found = Object.keys(k).filter((s) => k[s].some((x) => low.includes(x)));
    return found.length ? found : ['Broad Market'];
};

// ── India macro impact ────────────────────────────────────────────────────────
const dIndiaImpact = (t) => {
    const low = t.toLowerCase();
    const india = ['india','sensex','nifty','bse','nse','rupee','sebi','rbi','mumbai','modi'].some((w) => low.includes(w));
    const macro  = ['fed','federal reserve','dollar','crude','oil price','china','us tariff','treasury','wall street'].some((w) => low.includes(w));
    const pos    = ['rate cut','stimulus','rally','surge','gain','growth','record','beat','boom'].some((w) => low.includes(w));
    const neg    = ['rate hike','recession','crash','tariff','war','crisis','inflation','sanctions','drop','fall'].some((w) => low.includes(w));
    if (india || macro) {
        if (pos && !neg) return 'bullish';
        if (neg && !pos) return 'bearish';
    }
    return 'neutral';
};

module.exports = {
    LM_STRONG_BULL, LM_BULL, LM_STRONG_BEAR, LM_BEAR,
    SOURCE_WEIGHTS,
    dSent, sentScore, dSentScore, dSec, dIndiaImpact,
    detectConglomerate,
};
