const EYE_OFFSETS = [0, 32] as const;

export function EyeMark({
  className = 'pointer-events-none shrink-0',
  onEyeRef,
  onPupilRef,
}: {
  className?: string;
  onEyeRef?: (element: SVGPathElement | null, index: number) => void;
  onPupilRef?: (element: SVGGElement | null, index: number) => void;
}) {
  return (
    <svg
      viewBox="0 0 64 30"
      width="64"
      height="30"
      fill="none"
      focusable="false"
      aria-hidden="true"
      className={className}
    >
      {EYE_OFFSETS.map((offset, index) => (
        <g key={offset} transform={`translate(${offset} 0)`}>
          <path
            ref={onEyeRef ? (element) => onEyeRef(element, index) : undefined}
            d="M1.6 15.1C6.8 8.1 11.1 5.5 16.2 5.6C21.3 5.7 25.7 8.7 30.1 14.6C25.6 20.2 21.2 23.5 15.8 23.4C10.6 23.3 6.2 20.5 1.6 15.1Z"
            fill="var(--surface-base)"
            stroke="var(--ink-secondary)"
            strokeOpacity="0.7"
            strokeWidth="1.15"
          />
          <g ref={onPupilRef ? (element) => onPupilRef(element, index) : undefined}>
            <circle cx="16" cy="14.7" r="4.35" fill="var(--ink-primary)" />
            <circle cx="14.8" cy="13.4" r="0.85" fill="var(--surface-base)" opacity="0.85" />
          </g>
        </g>
      ))}
    </svg>
  );
}