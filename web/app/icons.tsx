/**
 * The HUD's icons: small, square, drawn on a 16-unit grid with square caps so
 * they sit with the pixel art. `currentColor` throughout, so each takes the
 * colour of the text beside it.
 */
type Props = { className?: string };

function Icon({ className = "h-4 w-4", children }: Props & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden className={className}>
      {children}
    </svg>
  );
}

export const WalletIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2 4.5h10.5v9H2z" />
    <path d="M2 4.5l8-2.5v2.5" />
    <path d="M9.5 8h4v3h-4z" />
  </Icon>
);

export const SunIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M5.5 5.5h5v5h-5z" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" />
  </Icon>
);

export const MoonIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M10 2.5a5.5 5.5 0 1 0 3.5 9A5 5 0 0 1 10 2.5z" />
  </Icon>
);

export const VillageIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2 7.5L8 2.5l6 5" />
    <path d="M3.5 6.5V14h9V6.5" />
    <path d="M6.5 14v-4h3v4" />
  </Icon>
);

export const LiveIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M7 7h2v2H7z" />
    <path d="M5 5.5a3.5 3.5 0 0 0 0 5M11 5.5a3.5 3.5 0 0 1 0 5M3 3.5a6 6 0 0 0 0 9M13 3.5a6 6 0 0 1 0 9" />
  </Icon>
);

export const FieldIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2.5 2.5l9 9M13.5 2.5l-9 9" />
    <path d="M10 13.5l3.5-3.5M6 13.5L2.5 10" />
  </Icon>
);

export const LadderIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4.5 2.5h7v4a3.5 3.5 0 0 1-7 0z" />
    <path d="M4.5 4H2.5v1.5a2 2 0 0 0 2 2M11.5 4h2v1.5a2 2 0 0 1-2 2" />
    <path d="M8 10v3M5.5 13.5h5" />
  </Icon>
);

export const GamesIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2.5 5h11l1 6.5h-3L10 9.5H6l-1.5 2h-3z" />
    <path d="M5 6.5v2M4 7.5h2M10.5 7h.5M12 8h.5" />
  </Icon>
);

export const RewardsIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2.5 6h11v2.5h-11zM3.5 8.5h9V14h-9zM8 6v8" />
    <path d="M8 6C6.5 3.5 4 3.5 4.5 5S8 6 8 6zM8 6c1.5-2.5 4-2.5 3.5-1S8 6 8 6z" />
  </Icon>
);

export const MoreIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3 8h.5M7.75 8h.5M12.5 8h.5" strokeWidth="2.5" />
  </Icon>
);

export const ChevronIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icon>
);

export const ArrowIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2.5 8h10M9 4.5L12.5 8 9 11.5" />
  </Icon>
);

export const CloseIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </Icon>
);

export const SoundIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" />
    <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" />
  </Icon>
);

export const MuteIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" />
    <path d="M11 6l3.5 4M14.5 6L11 10" />
  </Icon>
);
