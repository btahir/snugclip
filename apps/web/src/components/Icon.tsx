// UI icons (drawn for Snugclip, MIT) plus the destination glyphs generated from brand/glyphs.
// All use currentColor and a 24×24 grid. Icons are decorative (aria-hidden); the control
// that holds one always carries its own accessible name.
import { DESTINATION_GLYPHS, type DestinationGlyph } from './glyphs.generated';

const S = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
const S2 = 'fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"';

export const UI_ICONS = {
  sliders: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9" ${S}/><circle cx="15" cy="7" r="2.2" ${S}/><circle cx="9" cy="17" r="2.2" ${S}/>`,
  ok: `<circle cx="12" cy="12" r="10" fill="currentColor" opacity=".16"/><path d="m7.4 12.4 3.1 3.1 6.1-6.6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  check: `<path d="m5.5 12.5 4.2 4.2 8.8-9.4" ${S2}/>`,
  down: `<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14" ${S2}/>`,
  share: `<path d="M12 15V4m-4 4 4-4 4 4M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12" ${S2}/>`,
  lr: `<path d="m9 7-5 5 5 5M15 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  play: `<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>`,
  pause: `<rect x="6.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/>`,
  x: `<path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>`,
  plus: `<circle cx="12" cy="12" r="10" fill="currentColor" opacity=".14"/><path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  shield: `<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z" ${S}/><path d="m9 12 2.2 2.2L15.3 10" ${S}/>`,
  wifi: `<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.8 4.8 0 0 1 6.4 0" ${S}/><circle cx="12" cy="19.3" r="1.3" fill="currentColor"/>`,
  heart: `<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" fill="currentColor"/>`,
  chevron: `<path d="m7 10 5 5 5-5" ${S2}/>`,
  chevronRight: `<path d="m10 7 5 5-5 5" ${S2}/>`,
  scissors: `<circle cx="6.5" cy="7" r="2.6" ${S}/><circle cx="6.5" cy="17" r="2.6" ${S}/><path d="M8.7 8.6 20 17M8.7 15.4 20 7" ${S}/>`,
  info: `<circle cx="12" cy="12" r="9" ${S}/><path d="M12 11v5.5M12 7.6v.1" ${S2}/>`,
  eye: `<path d="M2.8 12S6.2 5.5 12 5.5 21.2 12 21.2 12 17.8 18.5 12 18.5 2.8 12 2.8 12Z" ${S}/><circle cx="12" cy="12" r="2.8" ${S}/>`,
  half: `<circle cx="12" cy="12" r="8.6" ${S}/><path d="M12 3.4a8.6 8.6 0 0 1 0 17.2Z" fill="currentColor"/>`,
  copy: `<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.4" ${S}/><path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5" ${S}/>`,
  retry: `<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4v4h4" ${S2}/>`,
  mute: `<path d="M4 9.5h3l4.5-4v13L7 14.5H4z" ${S}/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5" ${S}/>`,
  sound: `<path d="M4 9.5h3l4.5-4v13L7 14.5H4z" ${S}/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" ${S}/>`,
  sun: `<circle cx="12" cy="12" r="4.2" ${S}/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5" ${S}/>`,
  moon: `<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z" ${S}/>`,
  auto: `<circle cx="12" cy="12" r="8.6" ${S}/><path d="M12 3.4a8.6 8.6 0 0 1 0 17.2Z" fill="currentColor"/>`,
  link: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" ${S}/>`,
  file: `<path d="M6.5 3.5h7l4 4v11.6a1.4 1.4 0 0 1-1.4 1.4H6.5a1.4 1.4 0 0 1-1.4-1.4V4.9a1.4 1.4 0 0 1 1.4-1.4Z" ${S}/><path d="M13.5 3.5v4h4" ${S}/>`,
  upload: `<path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 19.5h14" ${S2}/>`,
  flip: `<path d="M7 7h11l-3-3M17 17H6l3 3" ${S2}/>`,
  zoom: `<circle cx="10.5" cy="10.5" r="6" ${S}/><path d="m15 15 5 5M8 10.5h5M10.5 8v5" ${S}/>`,
  spill: `<path d="M5.5 5 7.4 18.4A2.6 2.6 0 0 0 10 20.6h4a2.6 2.6 0 0 0 2.6-2.2L18.5 5" ${S}/><path d="M3.5 9.5h17" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M6.5 7.2c1.8-1.2 3.4-1.2 5.2 0s3.4 1.2 5.2 0 2.9-1 4.6.2" ${S}/><path d="M20.8 7.6v3.4" ${S}/>`,
  question: `<circle cx="12" cy="12" r="9" ${S}/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.5M12 16.9v.1" ${S2}/>`,
  doc: `<path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" ${S}/><path d="M9 8.5h6M9 12h6M9 15.5h3.5" ${S}/>`,
  star: `<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" ${S}/>`,
  terminal: `<rect x="3" y="4.5" width="18" height="15" rx="2.6" ${S}/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17" ${S}/>`,
} as const;

export type UiIconName = keyof typeof UI_ICONS;
export type IconName = UiIconName | DestinationGlyph;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const markup = (UI_ICONS as Record<string, string>)[name] ?? (DESTINATION_GLYPHS as Record<string, string>)[name] ?? '';
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
