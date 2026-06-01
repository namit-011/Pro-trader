import { gtiColor } from '../utils/colors';

export default function GTISparkline({ history }) {
    const vals = history.length > 1 ? history : [48, 52, 55, 58, 62, 65];
    const W  = 110;
    const H  = 28;
    const mn = Math.min(...vals) - 3;
    const mx = Math.max(...vals) + 3;

    const pts = vals
        .map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - mn) / (mx - mn)) * H}`)
        .join(' ');

    const last = vals[vals.length - 1];
    const lx   = W;
    const ly   = H - ((last - mn) / (mx - mn)) * H;

    return (
        <svg width={W} height={H} className="gti-spark">
            <defs>
                <linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor="#06b6d4" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="1"   />
                </linearGradient>
            </defs>
            <polyline points={pts} fill="none" stroke="url(#sparkGrad)" strokeWidth="1.8" />
            <circle cx={lx} cy={ly} r="3.5" fill={gtiColor(last)} />
        </svg>
    );
}
