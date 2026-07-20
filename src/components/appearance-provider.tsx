'use client';

import { useEffect } from 'react';
import { useSettingString } from '@/hooks/use-settings';

// Applies the Appearance settings to the document so every component picks them
// up without threading props: the accent colour becomes CSS variables, and
// density becomes a data attribute that globals.css keys off.

/** #rrggbb → "r g b" for use in colour-mix / rgb() and Tailwind arbitrary values. */
function hexToRgb(hex: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Readable foreground for a background colour (WCAG relative luminance). */
function foregroundFor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.split(' ').map((v) => Number(v) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? '#0f172a' : '#ffffff';
}

export function AppearanceProvider() {
  const accent = useSettingString('appearance.accentColor');
  const density = useSettingString('appearance.density');

  useEffect(() => {
    const root = document.documentElement;
    const rgb = hexToRgb(accent);
    if (rgb) {
      root.style.setProperty('--app-accent', accent);
      root.style.setProperty('--app-accent-rgb', rgb);
      root.style.setProperty('--app-accent-foreground', foregroundFor(accent));
    } else {
      root.style.removeProperty('--app-accent');
      root.style.removeProperty('--app-accent-rgb');
      root.style.removeProperty('--app-accent-foreground');
    }
  }, [accent]);

  useEffect(() => {
    document.documentElement.dataset.density = density === 'compact' ? 'compact' : 'comfortable';
  }, [density]);

  return null;
}
