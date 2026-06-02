'use strict';

// ── Client HB6115 — Zerodha Equity Holdings as on 2026-06-01 ─────────────────
const HB6115_META = {
    clientId:    'HB6115',
    clientName:  'HB Portfolio',
    asOn:        '2026-06-01',
    broker:      'Zerodha',
    equitySummary: {
        invested:     5038667.93,
        presentValue: 5859654.65,
        pnl:           820986.72,
        pnlPct:             16.29,
    },
    mfSummary: {
        invested:     199989.998,
        presentValue: 326076.593,
        pnl:          126086.595,
        pnlPct:            63.05,
    },
    combinedSummary: {
        invested:     5238657.93,
        presentValue: 6185731.24,
        pnl:           947073.31,
        pnlPct:             18.08,
    },
};

const HB6115_EQUITY = [
    { ticker:'AMBUJACEM', isin:'INE079A01024', sector:'BUILDING MATERIALS',        qty:290,  qtyLT:290,  pledgedM:0,   pledgedL:0, avgBuy:482.8181,  cmp:435.10,   pnl:-13838.25,    pnlPct:-9.88  },
    { ticker:'AXISBANK',  isin:'INE238A01034', sector:'FINANCIAL SERVICES',         qty:80,   qtyLT:80,   pledgedM:0,   pledgedL:0, avgBuy:1171.3463, cmp:1275.90,  pnl:8364.30,      pnlPct:8.93   },
    { ticker:'BAJAJFINSV',isin:'INE918I01026', sector:'FINANCIAL SERVICES',         qty:50,   qtyLT:50,   pledgedM:0,   pledgedL:0, avgBuy:1537.052,  cmp:1758.90,  pnl:11092.40,     pnlPct:14.43  },
    { ticker:'BHEL',      isin:'INE257A01026', sector:'ENGINEERING & CAPITAL GOODS',qty:300,  qtyLT:300,  pledgedM:0,   pledgedL:0, avgBuy:209.251,   cmp:404.80,   pnl:58664.70,     pnlPct:93.45  },
    { ticker:'COFORGE',   isin:'INE591G01025', sector:'SOFTWARE SERVICES',          qty:150,  qtyLT:150,  pledgedM:0,   pledgedL:0, avgBuy:1072.1617, cmp:1461.20,  pnl:58355.75,     pnlPct:36.29  },
    { ticker:'DHANUKA',   isin:'INE435G01025', sector:'CHEMICALS',                  qty:59,   qtyLT:59,   pledgedM:0,   pledgedL:0, avgBuy:1463.4424, cmp:1084.70,  pnl:-22345.80,    pnlPct:-25.88 },
    { ticker:'DIXON',     isin:'INE935N01020', sector:'ENGINEERING & CAPITAL GOODS',qty:0,    qtyLT:30,   pledgedM:30,  pledgedL:0, avgBuy:5253.4533, cmp:11466.75, pnl:186398.90,    pnlPct:118.27 },
    { ticker:'ETERNAL',   isin:'INE758T01015', sector:'IT',                         qty:1450, qtyLT:1450, pledgedM:0,   pledgedL:0, avgBuy:224.0767,  cmp:248.10,   pnl:34833.75,     pnlPct:10.72  },
    { ticker:'GAIL',      isin:'INE129A01019', sector:'ENERGY',                     qty:500,  qtyLT:500,  pledgedM:0,   pledgedL:0, avgBuy:200.865,   cmp:163.74,   pnl:-18562.50,    pnlPct:-18.48 },
    { ticker:'HDFCBANK',  isin:'INE040A01034', sector:'FINANCIAL SERVICES',         qty:0,    qtyLT:169,  pledgedM:338, pledgedL:0, avgBuy:813.4164,  cmp:742.70,   pnl:-23902.15,    pnlPct:-8.69  },
    { ticker:'HINDALCO',  isin:'INE038A01020', sector:'METALS',                     qty:120,  qtyLT:120,  pledgedM:0,   pledgedL:0, avgBuy:526.10,    cmp:1141.30,  pnl:73824.00,     pnlPct:116.94 },
    { ticker:'HINDUNILVR',isin:'INE030A01027', sector:'FMCG',                       qty:40,   qtyLT:40,   pledgedM:0,   pledgedL:0, avgBuy:2556.2225, cmp:2085.15,  pnl:-18842.90,    pnlPct:-18.43 },
    { ticker:'INDUSTOWER',isin:'INE121J01017', sector:'TELECOM',                    qty:300,  qtyLT:750,  pledgedM:0,   pledgedL:0, avgBuy:296.7213,  cmp:431.45,   pnl:-93106.00,    pnlPct:-41.84 },
    { ticker:'JBMA',      isin:'INE927D01051', sector:'AUTO ANCILLARY',             qty:135,  qtyLT:135,  pledgedM:0,   pledgedL:0, avgBuy:764.0463,  cmp:647.15,   pnl:-15781.00,    pnlPct:-15.30 },
    { ticker:'JIOFIN',    isin:'INE758E01017', sector:'FINANCIAL SERVICES',         qty:750,  qtyLT:750,  pledgedM:0,   pledgedL:0, avgBuy:245.3165,  cmp:234.95,   pnl:-7774.85,     pnlPct:-4.23  },
    { ticker:'JKCEMENT',  isin:'INE823G01014', sector:'BUILDING MATERIALS',         qty:30,   qtyLT:30,   pledgedM:0,   pledgedL:0, avgBuy:4530.335,  cmp:5190.50,  pnl:19804.95,     pnlPct:14.57  },
    { ticker:'JSWSTEEL',  isin:'INE019A01038', sector:'METALS',                     qty:100,  qtyLT:100,  pledgedM:0,   pledgedL:0, avgBuy:790.5685,  cmp:1299.40,  pnl:50883.15,     pnlPct:64.36  },
    { ticker:'KOTAKBANK', isin:'INE237A01036', sector:'FINANCIAL SERVICES',         qty:375,  qtyLT:375,  pledgedM:0,   pledgedL:0, avgBuy:331.018,   cmp:377.40,   pnl:17393.25,     pnlPct:14.01  },
    { ticker:'LICI',      isin:'INE0J1Y01017', sector:'FINANCIAL SERVICES',         qty:120,  qtyLT:120,  pledgedM:0,   pledgedL:0, avgBuy:707.125,   cmp:404.85,   pnl:-36273.00,    pnlPct:-42.75 },
    { ticker:'LTM',       isin:'INE214T01019', sector:'SOFTWARE SERVICES',          qty:35,   qtyLT:35,   pledgedM:0,   pledgedL:0, avgBuy:4793.6815, cmp:4199.20,  pnl:-20806.85,    pnlPct:-12.40 },
    { ticker:'NAUKRI',    isin:'INE663F01032', sector:'IT',                         qty:100,  qtyLT:118,  pledgedM:0,   pledgedL:0, avgBuy:930.8278,  cmp:1004.05,  pnl:-9432.68,     pnlPct:-8.59  },
    { ticker:'NMDC',      isin:'INE584A01023', sector:'METALS',                     qty:3300, qtyLT:3300, pledgedM:0,   pledgedL:0, avgBuy:59.5036,   cmp:92.60,    pnl:109218.10,    pnlPct:55.62  },
    { ticker:'NTPC',      isin:'INE733E01010', sector:'ENERGY',                     qty:300,  qtyLT:300,  pledgedM:0,   pledgedL:0, avgBuy:343.0158,  cmp:378.70,   pnl:10705.25,     pnlPct:10.40  },
    { ticker:'OLECTRA',   isin:'INE260D01016', sector:'AUTO ANCILLARY',             qty:100,  qtyLT:160,  pledgedM:0,   pledgedL:0, avgBuy:1282.6969, cmp:1230.60,  pnl:-82171.50,    pnlPct:-40.04 },
    { ticker:'ONGC',      isin:'INE213A01029', sector:'ENERGY',                     qty:300,  qtyLT:300,  pledgedM:0,   pledgedL:0, avgBuy:245.7033,  cmp:264.30,   pnl:5579.00,      pnlPct:7.57   },
    { ticker:'PARAS',     isin:'INE045601023', sector:'DEFENCE',                    qty:200,  qtyLT:200,  pledgedM:0,   pledgedL:0, avgBuy:529.4085,  cmp:814.65,   pnl:57048.30,     pnlPct:53.88  },
    { ticker:'POLYCAB',   isin:'INE455K01017', sector:'ENGINEERING & CAPITAL GOODS',qty:20,   qtyLT:20,   pledgedM:0,   pledgedL:0, avgBuy:5721.4225, cmp:9480.50,  pnl:75181.55,     pnlPct:65.70  },
    { ticker:'RELIANCE',  isin:'INE002A01018', sector:'ENERGY',                     qty:125,  qtyLT:125,  pledgedM:0,   pledgedL:0, avgBuy:1283.6052, cmp:1320.30,  pnl:4586.85,      pnlPct:2.86   },
    { ticker:'SAIL',      isin:'INE114A01011', sector:'METALS',                     qty:400,  qtyLT:400,  pledgedM:0,   pledgedL:0, avgBuy:115.15,    cmp:204.15,   pnl:35600.00,     pnlPct:77.29  },
    { ticker:'SBIN',      isin:'INE062A01020', sector:'FINANCIAL SERVICES',         qty:0,    qtyLT:500,  pledgedM:500, pledgedL:0, avgBuy:615.819,   cmp:954.10,   pnl:169140.50,    pnlPct:54.93  },
    { ticker:'SRF',       isin:'INE647A01010', sector:'CHEMICALS',                  qty:35,   qtyLT:35,   pledgedM:0,   pledgedL:0, avgBuy:2486.5629, cmp:2696.20,  pnl:7337.30,      pnlPct:8.43   },
    { ticker:'TATAPOWER', isin:'INE245A01021', sector:'ENERGY',                     qty:700,  qtyLT:700,  pledgedM:0,   pledgedL:0, avgBuy:324.8781,  cmp:419.50,   pnl:66235.35,     pnlPct:29.13  },
    { ticker:'TATASTEEL', isin:'INE081A01020', sector:'METALS',                     qty:1000, qtyLT:1000, pledgedM:0,   pledgedL:0, avgBuy:142.3277,  cmp:210.57,   pnl:68242.30,     pnlPct:47.95  },
    { ticker:'TITAN',     isin:'INE280A01028', sector:'RETAIL',                     qty:60,   qtyLT:60,   pledgedM:0,   pledgedL:0, avgBuy:3223.73,   cmp:4025.30,  pnl:48094.20,     pnlPct:24.86  },
    { ticker:'TMCV',      isin:'INE1TAE01010', sector:'AUTO ANCILLARY',             qty:300,  qtyLT:300,  pledgedM:0,   pledgedL:0, avgBuy:228.9573,  cmp:374.25,   pnl:43587.80,     pnlPct:63.46  },
    { ticker:'TMPV',      isin:'INE155A01022', sector:'AUTO ANCILLARY',             qty:300,  qtyLT:300,  pledgedM:0,   pledgedL:0, avgBuy:506.0582,  cmp:384.90,   pnl:-36347.45,    pnlPct:-23.94 },
];

const HB6115_MF = [
    { name:'AXIS ELSS TAX SAVER FUND - DIRECT PLAN',  isin:'INF846K01EW2', type:'Equity - ELSS', qty:638.495,  avgNav:78.3053,  nav:104.3083, pnl:16602.78,  pnlPct:33.21 },
    { name:'KOTAK ELSS TAX SAVER FUND - DIRECT PLAN', isin:'INF174K01LI3', type:'Equity - ELSS', qty:373.683,  avgNav:80.2779,  nav:131.038,  pnl:18968.20,  pnlPct:63.23 },
    { name:'MIRAE ASSET ELSS TAX SAVER FUND - DIRECT',isin:'INF769K01DM9', type:'Equity - ELSS', qty:841.662,  avgNav:35.642,   nav:55.284,   pnl:16531.93,  pnlPct:55.11 },
    { name:'QUANT ELSS TAX SAVER FUND - DIRECT PLAN', isin:'INF966L01986', type:'Equity - ELSS', qty:234.324,  avgNav:234.7059, nav:449.939,  pnl:50434.27,  pnlPct:91.70 },
    { name:'TATA ELSS FUND - DIRECT PLAN',             isin:'INF277K01I86', type:'Equity - ELSS', qty:1125.2,   avgNav:31.104,   nav:52.0331,  pnl:23549.41,  pnlPct:67.29 },
];

// ── Ticker → NSE Yahoo Finance symbol map ─────────────────────────────────────
const TICKER_TO_NS = {
    AMBUJACEM: 'AMBUJACEM.NS', AXISBANK:  'AXISBANK.NS',  BAJAJFINSV:'BAJAJFINSV.NS',
    BHEL:      'BHEL.NS',      COFORGE:   'COFORGE.NS',   DHANUKA:   'DHANUKA.NS',
    DIXON:     'DIXON.NS',     ETERNAL:   'ETERNAL.NS',   GAIL:      'GAIL.NS',
    HDFCBANK:  'HDFCBANK.NS',  HINDALCO:  'HINDALCO.NS',  HINDUNILVR:'HINDUNILVR.NS',
    INDUSTOWER:'INDUSTOWER.NS',JBMA:      'JBCHEPHARM.NS',JIOFIN:    'JIOFIN.NS',
    JKCEMENT:  'JKCEMENT.NS',  JSWSTEEL:  'JSWSTEEL.NS',  KOTAKBANK: 'KOTAKBANK.NS',
    LICI:      'LICHSGFIN.NS', LTM:       'LTIM.NS',      NAUKRI:    'NAUKRI.NS',
    NMDC:      'NMDC.NS',      NTPC:      'NTPC.NS',      OLECTRA:   'OLECTRA.NS',
    ONGC:      'ONGC.NS',      PARAS:     'PARAS.NS',     POLYCAB:   'POLYCAB.NS',
    RELIANCE:  'RELIANCE.NS',  SAIL:      'SAIL.NS',      SBIN:      'SBIN.NS',
    SRF:       'SRF.NS',       TATAPOWER: 'TATAPOWER.NS', TATASTEEL: 'TATASTEEL.NS',
    TITAN:     'TITAN.NS',     TMCV:      'TATAMOTORS.NS',TMPV:      'M&M.NS',
};

// ── Analyst tags (Head of Equity Research verdicts) ───────────────────────────
const ANALYST_TAGS = {
    // CRITICAL RISK
    INDUSTOWER: { tag:'CRITICAL_RISK',   reason:'Qty discrepancy: 300 available vs 750 LT — possible pledged loan position. Down -42% from cost. Telecom infra faces ARPU pressure.' },
    LICI:       { tag:'CRITICAL_RISK',   reason:'Down -42.7% from avg cost ₹707. LIC HFL impacted by rising NPA concerns and margin compression in housing finance.' },
    OLECTRA:    { tag:'CRITICAL_RISK',   reason:'Down -40%. EV bus order execution delays, working capital strain. Monitor Q1FY27 order inflows closely.' },
    // HIGH CONVICTION HOLD
    DIXON:      { tag:'HIGH_CONVICTION', reason:'Up +118%. PLI beneficiary, strong revenue visibility from Samsung, Apple supply chain. Shares pledged — ensure margin call buffer.' },
    HINDALCO:   { tag:'HIGH_CONVICTION', reason:'Up +117%. Copper & aluminium supercycle intact. Novelis (US) expansion adds premium revenue. Strong free cash flow.' },
    BHEL:       { tag:'HIGH_CONVICTION', reason:'Up +93%. Capex upcycle, nuclear power orders, defence orderbook. Re-rating story intact — BHEL order book at 16-year high.' },
    SBIN:       { tag:'HIGH_CONVICTION', reason:'Up +55%. Best-in-class PSU bank, NPA cycle behind. Rate cut cycle benefits NIM. Pledged 500 shares — ensure LTV maintained.' },
    POLYCAB:    { tag:'HIGH_CONVICTION', reason:'Up +66%. Wires & cables sector structural growth, FMEG push. Capex in cables for data centres adds new revenue stream.' },
    // REVIEW
    GAIL:       { tag:'REVIEW',          reason:'Down -18.5%. Gas transmission under pressure from low tariff revision. LNG import uncertainty. Re-evaluate on Q2FY27 volume data.' },
    HINDUNILVR: { tag:'REVIEW',          reason:'Down -18.4%. Rural recovery slower than expected. Volume growth muted at 3-4%. Staples de-rated globally. Time-bound hold.' },
    DHANUKA:    { tag:'REVIEW',          reason:'Down -25.9%. Agri-chem weak, RM costs elevated. Await 2 quarters of sequential improvement before adding.' },
    HDFCBANK:   { tag:'REVIEW',          reason:'Down -8.7%. Post-merger CASA dilution, credit growth moderation. Pledged 338 shares. Long-term thesis intact but near-term underperformance.' },
    LTM:        { tag:'REVIEW',          reason:'Down -12.4%. LTIM lagging peers. Weak discretionary IT demand in BFSI vertical. Re-evaluate on Q1FY27 deal wins.' },
    JBMA:       { tag:'REVIEW',          reason:'Down -15.3%. JBM Auto EV bus segment facing similar headwinds to Olectra. Promoter commitment critical to monitor.' },
    TMPV:       { tag:'REVIEW',          reason:'Down -23.9%. M&M Passenger Vehicles (TMPV) — await confirmation of this mapping. If M&M, thesis intact given SUV dominance.' },
    JIOFIN:     { tag:'REVIEW',          reason:'Down -4.2%. Jio Financial in build phase — no NBFC revenue yet. Optionality play. Reduce if rotation into productive assets preferred.' },
    // HOLD
    AXISBANK:   { tag:'HOLD',            reason:'Up +8.9%. Rate cut beneficiary, retail loan book healthy. Watchout for MFI stress in Q1FY27.' },
    BAJAJFINSV: { tag:'HOLD',            reason:'Up +14.4%. Bajaj Finserv holding company. Bajaj Finance premium intact. Insurance businesses adding value.' },
    COFORGE:    { tag:'HOLD',            reason:'Up +36.3%. Mid-cap IT with strong deal pipeline, BFS vertical recovery. One of the better positioned mid-cap IT names.' },
    ETERNAL:    { tag:'HOLD',            reason:'Up +10.7%. Zomato (Eternal) — profitability inflection complete. Quick commerce (Blinkit) is the next re-rating trigger.' },
    JKCEMENT:   { tag:'HOLD',            reason:'Up +14.6%. Premium cement, North India capacity addition. Demand recovery from infra push. Hold for 12-18 months.' },
    JSWSTEEL:   { tag:'HOLD',            reason:'Up +64%. Steel cycle still constructive. China export duties, domestic demand from railways+infra. Hold with trailing stop.' },
    KOTAKBANK:  { tag:'HOLD',            reason:'Up +14%. Post-RBI action, new MD settling in. Conservative bank, well-capitalised. No stress signs.' },
    NMDC:       { tag:'HOLD',            reason:'Up +55.6%. Iron ore price supportive. NMDC Steel monetisation a key event. Government holding makes it a policy play.' },
    NTPC:       { tag:'HOLD',            reason:'Up +10.4%. Power demand secular theme, renewable capacity expansion. 60GW target by 2032 — steady compounder.' },
    ONGC:       { tag:'HOLD',            reason:'Up +7.6%. Crude oil range-bound. ONGC benefits from upstream capex and dividend yield ~4%. Defensive position.' },
    PARAS:      { tag:'HOLD',            reason:'Up +53.9%. PARAS Defence — niche defence electronics, import substitution theme. Small float, high conviction.' },
    RELIANCE:   { tag:'HOLD',            reason:'Up +2.9%. Retail EBITDA recovery, Jio tariff hike benefits. New Energy is a 5-year optionality. Core holding.' },
    SAIL:       { tag:'HOLD',            reason:'Up +77.3%. Steel Authority — cyclical upswing. Watch steel pricing trends and China policy for exit signals.' },
    SRF:        { tag:'HOLD',            reason:'Up +8.4%. Specialty chemicals recovery in progress. Fluorochemicals capacity addition in FY27 a key catalyst.' },
    TATAPOWER:  { tag:'HOLD',            reason:'Up +29.1%. Renewable energy capacity, power distribution (Mumbai+Odisha). IEX volumes growing. Solid compounder.' },
    TATASTEEL:  { tag:'HOLD',            reason:'Up +48%. UK ops turnaround, India capacity expansion. Strong balance sheet. China risk and EU carbon tax watchlist.' },
    TITAN:      { tag:'HOLD',            reason:'Up +24.9%. Jewellery demand secular, CaratLane digital growing. Wedding season tailwind. Premium valuation justified.' },
    TMCV:       { tag:'HOLD',            reason:'Up +63.5%. Tata Motors CV — commercial vehicle upcycle. Jaguar Land Rover profitability much improved. Hold.' },
    NAUKRI:     { tag:'HOLD',            reason:'Nearly flat. Info Edge — Naukri hiring volume dependent on IT hiring recovery. 99acres showing traction. Patient hold.' },
    AMBUJACEM:  { tag:'REVIEW',          reason:'Down -9.9%. Ambuja integration with ACC ongoing. Volume growth present but pricing pressure from South India. Monitor margin recovery.' },
};

module.exports = { HB6115_META, HB6115_EQUITY, HB6115_MF, TICKER_TO_NS, ANALYST_TAGS };
