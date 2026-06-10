/**
 * Auto-categoriser for item titles.
 *
 * Categories (from training data):
 *  PC-GAMING    – gaming desktops / gaming bundles with discrete GPU
 *  PC-AIO-MINI  – all-in-one, SFF, mini/tiny desktop PCs (no gaming GPU)
 *  LAPTOP       – all laptops, toughbooks, 2-in-1s
 *  MONITOR      – standalone monitors and display screens
 *  PROJECTOR    – projectors and projector lenses/accessories
 *  MB/RAM/HDD/SSD – components: drives, RAM, motherboards, peripherals, accessories
 *  NETWORKING   – switches, routers, UPS, network hardware
 *  N/A          – could not be determined
 */

export const CATEGORIES = [
  'PC-GAMING',
  'PC-AIO-MINI',
  'LAPTOP',
  'MONITOR',
  'PROJECTOR',
  'MB/RAM/HDD/SSD',
  'NETWORKING',
  'N/A',
] as const;

export type Category = typeof CATEGORIES[number];

// ---------------------------------------------------------------------------
// Rule sets: ordered by specificity (first match wins)
// Each rule is [pattern, category]
// ---------------------------------------------------------------------------
const RULES: [RegExp, Category][] = [
  // ── PROJECTOR (very distinctive keywords) ────────────────────────────────
  [/projector|lumens|epson\s+eb|benq\s+(mx|tw|th|mw)|optoma|pt-[a-z]|elpls|nec\s+np|sanyo\s+lns|panasonic\s+et-|casio\s+xj|casio\s+led\s+dlp|short\s+throw.*hdmi\s+.*projector/i, 'PROJECTOR'],

  // ── NETWORKING ────────────────────────────────────────────────────────────
  [/\bups\b|uninterruptible|switch\s+\d+.port|cisco\s+catalyst|apc\s+(surt|rbc)|docking\s+station.*toughbook|toughpad.*docking|fz-vebg/i, 'NETWORKING'],

  // ── MONITOR ───────────────────────────────────────────────────────────────
  [/\bmonitor\b|\btft\b|flat\s+screen\s+display|dual\s+(monitor|screen|pc\s+monitor)|elo\s+touch\s+screen\s+monitor|vga\s+flat\s+screen|touch\s+screen\s+monitor\s+vga/i, 'MONITOR'],

  // ── MB/RAM/HDD/SSD (components, not full systems) ────────────────────────
  [/\bssd\b.*\bhealth\b|\btoner\s+cartridge\b|\bdrum\s+cartridge\b|lsi\s+sas|megaraid|hba\s+controller|\bjoblot\b|\bmotherboard\b|asrock|headset.*usb|plantronics|blackwire|replacement\s+battery\s+set|apc\s+rbc|charger\s+only|\bsend\s+charger\b/i, 'MB/RAM/HDD/SSD'],
  // Large-capacity raw drives (not inside a system)
  [/^\d+tb\s+(hdd|ssd)\b|samsung\s+ssd\s+\d+tb|14tb\s+hdd|sm883/i, 'MB/RAM/HDD/SSD'],

  // ── GAMING PC (must come before generic desktop) ──────────────────────────
  // Explicit "gaming pc" / "gaming desktop" in title
  [/gaming\s+(pc|desktop|computer|bundle)|pc\s+gaming\b/i, 'PC-GAMING'],
  // Discrete GPU keywords that signal a gaming build
  [/\b(rtx|gtx|radeon\s+rx|rx\s*580|rx\s*570|rx\s*6600|rx\s*7600|r9\s+270|gtx\s+1\d{3}|gtx\s+780|gtx\s+730|rtx\s+[23456789]\d{3}|nvidia\s+rtx|nvidia\s+gtx|amd\s+rx)\b.*\b(pc|desktop|computer|tower|bundle)\b/i, 'PC-GAMING'],
  // Core i9 / i7 gaming phrases
  [/(vr\s+powerful|powerful\s+gaming|extreme\s+gaming|ultimate\s+rtx|liquid\s+cool)/i, 'PC-GAMING'],
  // Water-cooled builds
  [/water\s+cool.*gaming|gaming.*water\s+cool/i, 'PC-GAMING'],

  // ── LAPTOP (before generic desktop) ──────────────────────────────────────
  [/\blaptop\b|\bnotebook\b|toughbook|toughpad|macbook|thinkpad|elitebook|lifebook|latitude\s+\d|inspiron|iseries\s+laptop|2\s+in\s+1.*core|x1\s+yoga|x380|x390|panasonic\s+cf-|panasonic\s+fz-|getac|rugged\s+laptop|surface\s+laptop|alienware\s+1[57]\b|hp\s+zbook|dell\s+xps\s+\d/i, 'LAPTOP'],
  // Catch "Refurbished Core i5 ... 14 inches" style titles
  [/core\s+i[3579].*\d{2,3}\s*gb\s+ram.*ssd.*win(dows)?/i, 'LAPTOP'],

  // ── PC-AIO-MINI (SFF / tiny / mini / all-in-one desktops, no gaming GPU) ──
  [/\b(sff|small\s+form\s+factor|tiny\s+pc|mini\s+pc|micro\s+pc|elitedesk|optiplex|prodesk|thinkcentre|nuc\b|all.in.one|aio\b)\b/i, 'PC-AIO-MINI'],
  [/hp\s+elitedesk|lenovo\s+(m[89]\d{2}|m\d{3}|tiny)|dell\s+optiplex\s+micro|intel\s+nuc/i, 'PC-AIO-MINI'],
  // "Desktop PC SFF" or "Desktop Mini PC"
  [/desktop\s+(pc\s+)?(sff|mini|micro|tiny)/i, 'PC-AIO-MINI'],
  // "Small Form Factor Desktop" without GPU
  [/small\s+form.*desktop|desktop.*small\s+form/i, 'PC-AIO-MINI'],

  // ── Fallback generic desktop (no GPU → AIO/MINI, with GPU → GAMING) ───────
  [/\bdesktop\s+(pc|computer)\b|\btower\s+(pc|computer)\b/i, 'PC-AIO-MINI'],
];

/**
 * Derive a category from an item title.
 * Returns 'N/A' when no rule matches.
 */
export function deriveCategory(title: string): Category {
  if (!title || !title.trim()) return 'N/A';
  const t = title.trim();
  for (const [pattern, cat] of RULES) {
    if (pattern.test(t)) return cat;
  }
  return 'N/A';
}
