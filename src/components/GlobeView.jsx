import { useEffect, useRef } from 'react';
import { countryColor, RISK } from '../constants/markets';

export default function GlobeView({ onCountryClick }) {
    const containerRef = useRef(null);
    const globeRef     = useRef(null);
    const onClickRef   = useRef(onCountryClick);
    onClickRef.current = onCountryClick;

    useEffect(() => {
        if (!containerRef.current || globeRef.current) return;
        let g;

        import('globe.gl').then((mod) => {
            const Globe = mod.default || mod;
            g = Globe()(containerRef.current)
                .backgroundColor('rgba(0,0,0,0)')
                .showAtmosphere(true)
                .atmosphereColor('rgba(6,182,212,0.45)')
                .atmosphereAltitude(0.14)
                .showGraticules(false);

            fetch('https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
                .then((r) => r.json())
                .then(({ features }) => {
                    g.polygonsData(features)
                        .polygonCapColor((f) => countryColor(f.properties?.ISO_A3))
                        .polygonSideColor(() => 'rgba(6,182,212,0.08)')
                        .polygonStrokeColor(() => 'rgba(6,182,212,0.35)')
                        .polygonLabel(
                            (f) => `
                            <div class="globe-tip">
                                <strong>${f.properties?.NAME || ''}</strong>
                                <span>Risk Score: ${RISK[f.properties?.ISO_A3] ?? 'Low'}</span>
                                <span class="gt-click-hint">Click for market data</span>
                            </div>`
                        )
                        .polygonsTransitionDuration(900)
                        .onPolygonClick((polygon) => {
                            const iso  = polygon?.properties?.ISO_A3;
                            const name = polygon?.properties?.NAME;
                            if (iso && onClickRef.current) onClickRef.current(iso, name);
                        });
                })
                .catch(() => {});

            g.controls().autoRotate      = true;
            g.controls().autoRotateSpeed = 0.38;
            g.controls().enableZoom      = false;
            g.pointOfView({ lat: 22, lng: 55, altitude: 2.1 });

            const fit = () => {
                if (containerRef.current)
                    g.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
            };
            fit();
            window.addEventListener('resize', fit);
            globeRef.current = { globe: g, cleanup: () => window.removeEventListener('resize', fit) };
        }).catch(() => {});

        return () => {
            globeRef.current?.cleanup?.();
        };
    }, []);

    return <div ref={containerRef} className="globe-container" />;
}
