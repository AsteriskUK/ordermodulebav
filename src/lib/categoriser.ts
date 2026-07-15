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
  // ── PROJECTOR ─────────────────────────────────────────────────────────────
  [/projector|lumens|\belpls\b|short.throw.*display|epson\s+eb|epson\s+eh|benq\s+(mx|tw|th|mw|w\d)|optoma\s+(hd|uh|gt|ep)|nec\s+np|nec\s+v\d|casio\s+xj|sanyo\s+plc|panasonic\s+pt-|viewsonic\s+p[jg]|acer\s+p\d/i, 'PROJECTOR'],

  // ── NETWORKING / UPS ──────────────────────────────────────────────────────
  [/\bups\b.*\d+\s*(va|w)\b|\bups\b.*uninterruptible|uninterruptible\s+power|apc\s+(back|smart|surt|rbc|sua|smc|bx|br)|cisco\s+catalyst|cisco\s+sg|cisco\s+ws-|netgear\s+(gs|jgs|m\d)|hp\s+procurve|\bprocurve\b|fz-vebg/i, 'NETWORKING'],

  // ── MONITOR ───────────────────────────────────────────────────────────────
  [/\bmonitor\b|\btft\b|flat.?panel.*(display|screen)|ips\s+screen\s+pc|\beled\b.*display|touch.?screen\s+monitor|elo\s+touch|dell\s+p\d{4}|hp\s+(e|z|la|lp|zr)\d{3,4}[a-z]*\s*(monitor|display|screen|ips|led)|benq\s+(bl|gl|gw|sw)\d{4}|viewsonic\s+v[ax]\d|iiyama\s+pro|lg\s+\d{2}[a-z]+\d+[a-z]*\s*(monitor|ips|display)/i, 'MONITOR'],

  // ── COMPONENTS / ACCESSORIES (raw parts, not full systems) ────────────────
  [/\btoner\b|\bdrum\s+unit\b|\bcartridge\b|lsi\s+(sas|megaraid)|\bhba\b.*controller|megaraid\s+sas|\bjob\s*lot\b|\bspare\s+(parts?|job)\b|asrock\s+(b|z|x|h)\d{3}|\bmotherboard\b|plantronics|poly\s+(cs|savi|voyager)|blackwire|jabra\s+(biz|engage|evolve)|charger\s+only|ac\s+adapter\s+only|replacement\s+(battery|psu|charger)|\bpsu\b.*\d+w\b/i, 'MB/RAM/HDD/SSD'],
  // Standalone drives / memory (not inside a complete system)
  [/^\s*\d+\s*(gb|tb)\s+(ssd|hdd|nvme|m\.2|ddr[345])\b|samsung\s+(sm883|pm|mz|mznl)|seagate\s+(st\d|skyhawk|barracuda)|western\s+digital\s+\d|\bwd\s+\d+tb|\bcrucial\s+(mx|p[235]|bx)\d|\bkingston\s+(sv|sa|dc|kc|uv)\d/i, 'MB/RAM/HDD/SSD'],

  // ── GAMING PC ─────────────────────────────────────────────────────────────
  // Explicit gaming label
  [/gaming\s+(pc|desktop|computer|tower|bundle|rig)|pc\s+gaming\b|gaming\s+workstation/i, 'PC-GAMING'],
  // Any discrete GPU model anywhere in title alongside a system keyword
  [/\b(rtx\s*[0-9]{3,4}|gtx\s*[0-9]{3,4}|radeon\s+rx\s*[0-9]{3,4}|rx\s*[0-9]{3,4}(?:\s*xt)?|r9\s+[23][79]0|geforce\s+(gtx|rtx))\b/i, 'PC-GAMING'],
  // Gaming build descriptors
  [/water.?cool|liquid.?cool|rgb\s+(gaming|pc|desktop|tower)|powerful\s+gaming|extreme\s+gaming|ultimate\s+gaming/i, 'PC-GAMING'],

  // ── LAPTOP ────────────────────────────────────────────────────────────────
  [/\blaptop\b|\bnotebook\b|\btoughbook\b|\btoughpad\b|macbook\s+(pro|air|m\d)|thinkpad\s+[a-z]\d|thinkbook\s+\d|elitebook\s+\d|probook\s+\d|lifebook\s+[a-z]|latitude\s+[e3-9]\d{3}|inspiron\s+\d{4}|vostro\s+\d|alienware\s+(m|x)\d|hp\s+zbook|dell\s+xps\s+\d+|surface\s+(laptop|pro|book|go)|getac\s+[a-z]\d|\brugged\s+(laptop|notebook)\b|cf-[a-z]\d{2}|fz-[a-z]\d{2}|panasonic\s+(cf|fz)-|x1\s+(carbon|yoga|extreme|nano)|x\d{3}[se]?\s+yoga|l\d{3}0[es]?\s+thinkpad|lenovo\s+(v1[45]|ideapad|yoga\s+slim|legion)|hp\s+(pavilion|envy|spectre|omen)|acer\s+(aspire|swift|travelmate|nitro)|asus\s+(vivobook|zenbook|rog\s+(strix|zephyrus))|msi\s+(modern|prestige|katana|stealth)/i, 'LAPTOP'],
  // "14 inch / 15.6 inch / 15-inch" size descriptor with Core processor (classic refurb laptop title)
  [/\d{2}(\.\d)?[\s-]*(?:inch|")\s*.*core\s+i[3579]|core\s+i[3579].*\d{2}(\.\d)?[\s-]*(?:inch|")/i, 'LAPTOP'],

  // ── PC-AIO-MINI (SFF / tiny / mini desktops, all-in-ones) ─────────────────
  // Brand + known SFF model families
  [/hp\s+elitedesk\s+\d|hp\s+prodesk\s+\d|hp\s+compaq\s+(elite|pro)\d|hp\s+(8[0-9][05]\s+g[1-9]|6[0-9][05]\s+g[1-9])|hp\s+(z[12]\d{2}|z[234]\s+(tower|sff))/i, 'PC-AIO-MINI'],
  [/dell\s+optiplex\s+\d|dell\s+precision\s+(t|r|tower)\d|lenovo\s+thinkcentre\s+m\d|lenovo\s+(m[6-9]\d{2}|m\d{3}[eq]|m[6-9]\d)\b|intel\s+nuc\s+\d/i, 'PC-AIO-MINI'],
  // Generic SFF/mini/AIO keywords
  [/\b(sff|small\s+form\s+factor|mini\s+tower|micro\s+tower|ultra\s+small|usdt|usff|tiny\s+(desktop|pc)|mini\s+(pc|desktop|computer)|all.in.one|all\s+in\s+one)\b/i, 'PC-AIO-MINI'],
  // Desktop / Tower without GPU markers (fallback)
  [/\bdesktop\s+(pc|computer|workstation)\b|\btower\s+(pc|computer)\b|\bworkstation\b.*\b(xeon|core\s+i[3579])\b/i, 'PC-AIO-MINI'],
  // "HP / Dell / Lenovo <model> SFF" - model code then SFF/MT/DT
  [/\b(elitedesk|optiplex|prodesk|thinkcentre|compaq\s+elite|compaq\s+pro)\b/i, 'PC-AIO-MINI'],
];

/**
 * Strong "this is a complete computer" signal. Full PCs/laptops often mention a
 * display as a *feature* ("Dual Monitor Support", "Monitor Ready"), which would
 * otherwise trip the MONITOR word-match. A standalone monitor never carries these
 * system nouns, so this is a safe way to keep such titles out of MONITOR.
 */
function isCompleteSystem(t: string): boolean {
  return /\bdesktop\s+pc\b|\bsmall\s+form\s+factor\b|\bsff\b|\ball.in.one\b|\ball\s+in\s+one\b|\bmini\s+pc\b|\btower\s+pc\b|\bworkstation\b|\blaptop\b|\bnotebook\b|\bgaming\s+(pc|desktop)\b|\bwindows\s+1[01]\b/i.test(t);
}

/**
 * Derive a category from an item title.
 * Returns 'N/A' when no rule matches.
 */
export function deriveCategory(title: string): Category {
  if (!title || !title.trim()) return 'N/A';
  const t = title.trim();
  for (const [pattern, cat] of RULES) {
    if (!pattern.test(t)) continue;
    // Don't let a display *mentioned as a feature* mask a full system — fall
    // through to the PC/laptop rules that follow.
    if (cat === 'MONITOR' && isCompleteSystem(t)) continue;
    return cat;
  }
  return 'N/A';
}
