'use client';

import { useEffect, useRef } from 'react';

const EYE_OFFSETS = [0, 32] as const;
const MAX_X = 5.2;
const MAX_Y = 3.5;

type Point = { x: number; y: number };

export function TrackingEyes() {
  const eyeRefs = useRef<(SVGPathElement | null)[]>([]);
  const pupilRefs = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const hoverMedia = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    const positions: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    const targets: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    let frame = 0;
    let lastFrameTime = 0;

    function render() {
      positions.forEach((position, index) => {
        pupilRefs.current[index]?.setAttribute(
          'transform',
          `translate(${position.x.toFixed(2)} ${position.y.toFixed(2)})`,
        );
      });
    }

    function animate(time: number) {
      frame = 0;
      const elapsed = lastFrameTime ? Math.min(time - lastFrameTime, 50) : 16;
      lastFrameTime = time;
      const blend = 1 - Math.exp(-elapsed / 36);
      let moving = false;

      positions.forEach((position, index) => {
        const target = targets[index];
        position.x += (target.x - position.x) * blend;
        position.y += (target.y - position.y) * blend;

        if (Math.abs(target.x - position.x) < 0.05 && Math.abs(target.y - position.y) < 0.05) {
          position.x = target.x;
          position.y = target.y;
        } else {
          moving = true;
        }
      });

      render();
      if (moving) frame = window.requestAnimationFrame(animate);
      else lastFrameTime = 0;
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(animate);
    }

    function reset() {
      targets.forEach((target) => {
        target.x = 0;
        target.y = 0;
      });
      schedule();
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || !hoverMedia.matches || reducedMotionMedia.matches) return;

      eyeRefs.current.forEach((eye, index) => {
        if (!eye) return;
        const bounds = eye.getBoundingClientRect();
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const distance = Math.hypot(dx, dy);
        const strength = Math.min(distance / 140, 1);
        targets[index].x = distance ? (dx / distance) * MAX_X * strength : 0;
        targets[index].y = distance ? (dy / distance) * MAX_Y * strength : 0;
      });
      schedule();
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) reset();
    }

    function handlePreferenceChange() {
      if (hoverMedia.matches && !reducedMotionMedia.matches) return;
      window.cancelAnimationFrame(frame);
      frame = 0;
      lastFrameTime = 0;
      positions.forEach((position) => {
        position.x = 0;
        position.y = 0;
      });
      targets.forEach((target) => {
        target.x = 0;
        target.y = 0;
      });
      render();
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerout', handlePointerOut);
    window.addEventListener('blur', reset);
    hoverMedia.addEventListener('change', handlePreferenceChange);
    reducedMotionMedia.addEventListener('change', handlePreferenceChange);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerout', handlePointerOut);
      window.removeEventListener('blur', reset);
      hoverMedia.removeEventListener('change', handlePreferenceChange);
      reducedMotionMedia.removeEventListener('change', handlePreferenceChange);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="flex shrink-0 items-center" aria-hidden="true">
      <svg
        viewBox="0 0 64 30"
        width="64"
        height="30"
        fill="none"
        focusable="false"
        className="pointer-events-none shrink-0"
      >
        {EYE_OFFSETS.map((offset, index) => (
          <g key={offset} transform={`translate(${offset} 0)`}>
            <path
              ref={(element) => { eyeRefs.current[index] = element; }}
              d="M1.6 15.1C6.8 8.1 11.1 5.5 16.2 5.6C21.3 5.7 25.7 8.7 30.1 14.6C25.6 20.2 21.2 23.5 15.8 23.4C10.6 23.3 6.2 20.5 1.6 15.1Z"
              fill="var(--surface-base)"
              stroke="var(--ink-secondary)"
              strokeOpacity="0.7"
              strokeWidth="1.15"
            />
            <g
              ref={(element) => { pupilRefs.current[index] = element; }}
            >
              <circle cx="16" cy="14.7" r="4.35" fill="var(--ink-primary)" />
              <circle cx="14.8" cy="13.4" r="0.85" fill="var(--surface-base)" opacity="0.85" />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}