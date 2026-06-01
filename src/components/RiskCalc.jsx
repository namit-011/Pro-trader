import { useState } from 'react';

export default function RiskCalc() {
    const [rc, setRc] = useState({
        capital: '', riskPct: '1', entry: '', sl: '', lotSize: '50',
    });

    const cap      = parseFloat(rc.capital)  || 0;
    const entry    = parseFloat(rc.entry)    || 0;
    const sl       = parseFloat(rc.sl)       || 0;
    const riskPct  = parseFloat(rc.riskPct)  || 1;
    const lotSize  = parseInt(rc.lotSize)    || 1;

    const maxRisk    = cap * riskPct / 100;
    const pointRisk  = entry > 0 && sl > 0 ? Math.abs(entry - sl) : 0;
    const lots       = pointRisk > 0 ? Math.floor(maxRisk / (pointRisk * lotSize)) : 0;
    const actualRisk = lots * pointRisk * lotSize;
    const rrTarget   = entry > 0 && sl > 0 ? entry + 1.5 * (entry - sl) : 0;

    const field = (key, label, placeholder, extra = {}) => (
        <div className="hft-form-field">
            <label>{label}</label>
            <input
                type="number"
                value={rc[key]}
                onChange={(e) => setRc((r) => ({ ...r, [key]: e.target.value }))}
                placeholder={placeholder}
                {...extra}
            />
        </div>
    );

    return (
        <div className="hft-risk-calc">
            <div className="hft-form-hdr">⚖ POSITION SIZE CALCULATOR</div>
            <div className="hft-rc-grid">
                {field('capital', 'CAPITAL ₹', '500000')}
                {field('riskPct', 'RISK %', '1', { step: '0.1' })}
                {field('entry', 'ENTRY ₹', '18500')}
                {field('sl', 'STOP LOSS ₹', '18400')}
                {field('lotSize', 'LOT SIZE', '50')}
            </div>

            {cap > 0 && entry > 0 && sl > 0 && (
                <div className="hft-rc-result">
                    <div className="hft-rc-row">
                        <span>MAX RISK</span>
                        <strong className="neg">₹{maxRisk.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>
                    </div>
                    <div className="hft-rc-row">
                        <span>POINT RISK</span>
                        <strong className="warn">{pointRisk.toFixed(1)} pts</strong>
                    </div>
                    <div className="hft-rc-row">
                        <span>LOTS TO TRADE</span>
                        <strong className="pos">{lots}</strong>
                    </div>
                    <div className="hft-rc-row">
                        <span>ACTUAL RISK</span>
                        <strong>₹{actualRisk.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>
                    </div>
                    <div className="hft-rc-row">
                        <span>1:1.5 TARGET</span>
                        <strong className="pos">{rrTarget > 0 ? rrTarget.toFixed(1) : '—'}</strong>
                    </div>
                </div>
            )}
        </div>
    );
}
