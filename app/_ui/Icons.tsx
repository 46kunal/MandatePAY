// Small stroke icons (24px grid), drawn inline so there is nothing to download. Decorative by default: pass a
// `title` only when the icon stands alone without text.
import type { SVGProps } from 'react';

const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  shield: 'M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Zm-3 9 2.2 2.2L15.5 10',
  inbox: 'M3.5 13.5 6 5h12l2.5 8.5M3.5 13.5V19h17v-5.5M3.5 13.5H8l1 2h6l1-2h4.5',
  box: 'm12 3 8 4.2v9.6L12 21l-8-4.2V7.2L12 3Zm0 9 8-4.8M12 12v9M12 12 4 7.2',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3',
  file: 'M7 3h7l4 4v14H7V3Zm7 0v4h4M9.5 12h5m-5 3.5h5',
  chart: 'M4 20V4m0 16h16M8 16v-4m4 4V8m4 8v-6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l1.9-1.5-1.9-3.3-2.3.9a7.5 7.5 0 0 0-2-1.2L14.6 3h-3.8l-.4 2.7c-.7.3-1.4.7-2 1.2l-2.3-.9-1.9 3.3 1.9 1.5a7.400 7.400 0 0 0 0 2.400l-1.9 1.500 1.900 3.300 2.300-.9c.6.5 1.300.9 2 1.200l.4 2.700h3.800l.4-2.700c.7-.3 1.400-.7 2-1.200l2.300.9 1.900-3.300-1.900-1.500c.1-.4.1-.8.1-1.200Z',
  lock: 'M6 11h12v9H6v-9Zm3 0V8a3 3 0 1 1 6 0v3',
  cart: 'M3 4h2.5l2 11h10l2-8H7M9.5 19.500h.01M16.500 19.500h.01',
  bag: 'M5 8h14l-1 12H6L5 8Zm4 0V7a3 3 0 0 1 6 0v1',
  user: 'M12 12.500a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.500 8c.6-3.600 3.600-5.500 7.500-5.500s6.900 1.900 7.500 5.500',
  logout: 'M10 4H5v16h5m4-4 4-4-4-4m4 4H9',
  chevron: 'm7 10 5 5 5-5',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  check: 'm5 12.500 4.500 4.500L19 7.500',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.500V12l3 2',
  alert: 'M12 4 3 19.500h18L12 4Zm0 5.500v4.500m0 3h.01',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0m-6 6v3',
  spark: 'm12 3 1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800L12 3Z',
  store: 'M4 9.500 5.500 4h13L20 9.500M4 9.500c0 1.400 1 2.500 2.300 2.500s2.300-1.100 2.300-2.500c0 1.400 1 2.500 2.400 2.500s2.400-1.100 2.400-2.500c0 1.400 1 2.500 2.300 2.500S20 10.900 20 9.500M5.500 12v8h13v-8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, title, ...rest }: { name: IconName; size?: number; title?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
