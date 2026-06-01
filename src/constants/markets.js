// NSE index name → Yahoo Finance symbol mapping
export const NSE_YAHOO = {
    'NIFTY 50':                '^NSEI',
    'NIFTY BANK':              '^NSEBANK',
    'INDIA VIX':               '^INDIAVIX',
    'S&P BSE SENSEX':          '^BSESN',
    'NIFTY MIDCAP 100':        '^CNXMIDCAP',
    'NIFTY SMALLCAP 100':      '^CNXSC',
    'NIFTY IT':                '^CNXIT',
    'NIFTY AUTO':              '^CNXAUTO',
    'NIFTY PHARMA':            '^CNXPHARMA',
    'NIFTY FMCG':              '^CNXFMCG',
    'NIFTY METAL':             '^CNXMETAL',
    'NIFTY ENERGY':            '^CNXENERGY',
    'NIFTY REALTY':            '^CNXREALTY',
    'NIFTY FINANCIAL SERVICES':'^NSEBANK',
    'NIFTY INFRA':             '^CNXINFRA',
    'NIFTY MEDIA':             '^CNXMEDIA',
};

export const nseShortName = (n) =>
    n
        .replace('NIFTY FINANCIAL SERVICES', 'FINNIFTY')
        .replace('NIFTY MIDCAP 100', 'MIDCAP')
        .replace('NIFTY SMALLCAP 100', 'SMALLCAP')
        .replace('S&P BSE SENSEX', 'SENSEX')
        .replace('NIFTY BANK', 'BANKNIFTY')
        .replace('NIFTY 50', 'NIFTY')
        .replace('INDIA VIX', 'VIX')
        .replace('NIFTY ', '');

// Country risk scores (ISO_A3 → 0–100)
export const RISK = {
    PRK: 93, RUS: 88, UKR: 84, IRN: 78, SYR: 80, YEM: 82, AFG: 81, IRQ: 73,
    ISR: 70, PAK: 67, SDN: 68, MLI: 65, NGA: 61, ETH: 64, SOM: 76, LBY: 70,
    VEN: 62, MMR: 72, CHN: 44, IND: 33, USA: 28, GBR: 22, FRA: 23, DEU: 20,
    JPN: 26, AUS: 16, CAN: 17, BRA: 35, MEX: 42, SAU: 55, TUR: 48, EGY: 50,
    ZAF: 38, IDN: 30, MYS: 25, SGP: 14, KOR: 32, TWN: 58, ARE: 38, QAT: 34,
    KWT: 45, OMN: 38, BGD: 42, LKA: 50, NPL: 36, KHM: 30, THA: 32, VNM: 28,
    PHL: 40, ARG: 52, COL: 48, PER: 40, CHL: 30, POL: 28, CZE: 18, HUN: 25,
    GRC: 26, ITA: 22, ESP: 20, PRT: 16, NOR: 12, SWE: 12, DNK: 12, FIN: 14,
    NLD: 16, BEL: 16, AUT: 15, CHE: 12, NZL: 13, ZAR: 38,
};

export const countryColor = (iso) => {
    const r = RISK[iso] ?? 22;
    if (r >= 80) return 'rgba(239,68,68,0.72)';
    if (r >= 60) return 'rgba(251,146,60,0.65)';
    if (r >= 35) return 'rgba(59,130,246,0.55)';
    return 'rgba(34,197,94,0.30)';
};

export const API_BASE = '/api';
