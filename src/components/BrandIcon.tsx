const paths = {
  box: 'm12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5m-9 5v10',
  swap: 'M3 7h17m-4-4 4 4-4 4 M21 17H4m4-4-4 4 4 4',
  people:
    'M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M16 15a4 4 0 0 1 5 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M16 3a4 4 0 0 1 0 8',
  cart: 'M2 3h3l3 12h10l3-8H6 M10 21h.01m7 0h.01',
  upload: 'M12 15V3m-5 5 5-5 5 5 M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  download: 'M12 3v12m-5-5 5 5 5-5 M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 7v5l3 2',
  file: 'M6 2h8l5 5v15H6z M14 2v6h5 M9 13h7m-7 4h7',
  check: 'm4 12 5 5L20 6',
  warning:
    'M10.2 4.1 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.8 4.1a2.1 2.1 0 0 0-3.6 0z M12 9v4m0 3h.01',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  sliders: 'M4 6h16M4 12h16M4 18h16 M8 4v4m8 2v4m-6 2v4',
  list: 'M8 5h13M8 12h13M8 19h13 M3 5h.01M3 12h.01M3 19h.01',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0z m-1.5 4.5 5 5',
  play: 'm7 4 13 8-13 8z',
} as const;

export type BrandIconName = keyof typeof paths;

export function BrandIcon({ name }: { name: BrandIconName }) {
  return (
    <svg
      className="brand-icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
