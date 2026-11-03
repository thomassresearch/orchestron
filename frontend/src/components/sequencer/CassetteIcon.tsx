export function CassetteIcon({ kind }: { kind: "rewind" | "stop" | "play" | "pause" | "fastForward" | "loop" }) {
  if (kind === "loop") {
    return <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3l3 3-3 3M18 6H6a3 3 0 0 0-3 3M5 17l-3-3 3-3M2 14h12a3 3 0 0 0 3-3" />
    </svg>;
  }
  if (kind === "pause") return <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden><path d="M5 4h3v12H5zM12 4h3v12h-3z" /></svg>;
  if (kind === "stop") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
        <rect x="5" y="5" width="10" height="10" rx="1.2" />
      </svg>
    );
  }
  if (kind === "play") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
        <path d="M6 4.5 15 10 6 15.5Z" />
      </svg>
    );
  }
  if (kind === "rewind") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
        <path d="M11.2 4.5 4 10l7.2 5.5Z" />
        <path d="M16 4.5 8.8 10l7.2 5.5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <path d="M4 4.5 11.2 10 4 15.5Z" />
      <path d="M8.8 4.5 16 10l-7.2 5.5Z" />
    </svg>
  );
}

