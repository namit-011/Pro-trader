import { useEffect, useRef } from 'react';

export default function StarField() {
    const ref = useRef(null);

    useEffect(() => {
        const c = ref.current;
        if (!c) return;
        const ctx = c.getContext('2d');

        const resize = () => {
            c.width = window.innerWidth;
            c.height = window.innerHeight;
        };
        resize();

        const stars = Array.from({ length: 220 }, () => ({
            x:  Math.random() * c.width,
            y:  Math.random() * c.height,
            r:  Math.random() * 1.4 + 0.2,
            o:  Math.random() * 0.6 + 0.25,
            sp: Math.random() * 0.6 + 0.2,
        }));

        let frame, t = 0;
        const draw = () => {
            ctx.clearRect(0, 0, c.width, c.height);
            t += 0.008;
            stars.forEach((s) => {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(200,220,255,${s.o * (0.65 + 0.35 * Math.sin(t * s.sp))})`;
                ctx.fill();
            });
            frame = requestAnimationFrame(draw);
        };
        draw();

        window.addEventListener('resize', resize);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', resize);
        };
    }, []);

    return <canvas ref={ref} className="star-field" />;
}
