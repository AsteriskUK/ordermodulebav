// ============================================================================
// SETTINGS REGISTRY
// ----------------------------------------------------------------------------
// Every configurable value in the app is declared here once, and the settings
// UI is generated from this registry — there are no bespoke settings forms.
//
// Two rules keep this safe:
//   1. Defaults live in code. A stored value OVERRIDES its default; a missing
//      or invalid stored value falls back to it. Settings can never break the
//      app by being absent.
//   2. Protocol facts are NOT settings. API endpoints, id formats, carrier
//      service-matching rules etc. stay in code — exposing them would only
//      offer a way to break production from a form.
//
// To add a setting: add a field here, then read it with useSetting() (client)
// or getSetting() (server). Nothing else needs wiring.
// ============================================================================

export type SettingValue = string | number | boolean | string[];

export type SettingType =
  | 'boolean'      // toggle
  | 'number'       // numeric input (min/max/step/unit)
  | 'string'       // single-line text
  | 'text'         // multi-line text (templates)
  | 'select'       // one of options
  | 'multiselect'  // any of options
  | 'list'         // free-form ordered list of strings (chips)
  | 'color'        // hex colour
  | 'time';        // HH:MM

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingField {
  /** Dotted, globally unique, stable — this is the storage key. */
  key: string;
  label: string;
  type: SettingType;
  default: SettingValue;
  help?: string;
  options?: SettingOption[];
  /** number: bounds + display unit */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  /** Tucked behind "Show advanced" — rarely changed or easy to get wrong. */
  advanced?: boolean;
  /** Shown as a warning: takes effect after a page reload. */
  requiresReload?: boolean;
  /** Tokens usable in a `text` template, surfaced as hints in the UI. */
  tokens?: string[];
  /** Extra validation beyond type/bounds. Return an error string, or null. */
  validate?: (value: SettingValue) => string | null;
}

export interface SettingsSection {
  id: string;
  label: string;
  description?: string;
  fields: SettingField[];
}

export interface SettingsGroup {
  id: string;
  label: string;
  /** Lucide icon name — mapped to a component in the settings UI. */
  icon: string;
  description?: string;
  sections: SettingsSection[];
}

// ---------------------------------------------------------------------------
// Shared option sets
// ---------------------------------------------------------------------------

const CARRIER_OPTIONS: SettingOption[] = [
  { value: 'DPD', label: 'DPD' },
  { value: 'FedEx', label: 'FedEx' },
  { value: 'Royal Mail', label: 'Royal Mail' },
  { value: 'Parcelforce', label: 'Parcelforce' },
  { value: 'Other', label: 'Other' },
];

const DPD_SERVICE_OPTIONS: SettingOption[] = [
  { value: 'next_day', label: 'Next Day' },
  { value: 'by_1030', label: 'By 10:30' },
  { value: 'by_12', label: 'By 12:00' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'saturday_by_1030', label: 'Saturday by 10:30' },
  { value: 'saturday_by_12', label: 'Saturday by 12:00' },
  { value: 'sunday', label: 'Sunday' },
  { value: 'sunday_by_12', label: 'Sunday by 12:00' },
];

const LANDING_PAGE_OPTIONS: SettingOption[] = [
  { value: '/', label: 'Dashboard' },
  { value: '/overview', label: 'Overview' },
  { value: '/packaging', label: 'Queue' },
  { value: '/orders', label: 'Order Sheet' },
  { value: '/notes', label: 'Messages' },
  { value: '/tracking', label: 'Tracking' },
  { value: '/returns', label: 'Returns' },
  { value: '/hr', label: 'HR' },
];

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const SETTINGS_SCHEMA: SettingsGroup[] = [
  // ======================= BUSINESS =======================
  {
    id: 'business',
    label: 'Business',
    icon: 'Building2',
    description: 'Company identity used on invoices, labels and buyer messages.',
    sections: [
      {
        id: 'identity',
        label: 'Identity',
        fields: [
          { key: 'business.tradingName', type: 'string', default: 'BIRMINGHAM AV',
            label: 'Trading name', help: 'Shown as the seller name on packing slips and invoices.' },
          { key: 'business.legalName', type: 'string', default: '',
            label: 'Legal / registered name', placeholder: 'e.g. Birmingham AV Ltd' },
          { key: 'business.companyNumber', type: 'string', default: '', label: 'Company number', advanced: true },
          { key: 'business.supportEmail', type: 'string', default: '', label: 'Support email',
            placeholder: 'support@example.com' },
          { key: 'business.supportPhone', type: 'string', default: '', label: 'Support phone' },
        ],
      },
      {
        id: 'tax',
        label: 'Tax & currency',
        fields: [
          { key: 'business.vatRegistered', type: 'boolean', default: true, label: 'VAT registered' },
          { key: 'business.vatNumber', type: 'string', default: '', label: 'VAT number' },
          { key: 'business.vatRatePercent', type: 'number', default: 20, min: 0, max: 100, step: 0.5,
            unit: '%', label: 'VAT rate',
            help: 'Prices are treated as VAT-inclusive; this rate is used to show the VAT portion on invoices.' },
          { key: 'business.currency', type: 'select', default: 'GBP', label: 'Currency',
            options: [
              { value: 'GBP', label: 'GBP (£)' },
              { value: 'EUR', label: 'EUR (€)' },
              { value: 'USD', label: 'USD ($)' },
            ] },
        ],
      },
      {
        id: 'address',
        label: 'Collection / return address',
        description: 'Used as the despatch address for carrier bookings and on return labels.',
        fields: [
          { key: 'business.address1', type: 'string', default: '', label: 'Address line 1' },
          { key: 'business.address2', type: 'string', default: '', label: 'Address line 2' },
          { key: 'business.city', type: 'string', default: '', label: 'City' },
          { key: 'business.county', type: 'string', default: '', label: 'County' },
          { key: 'business.postcode', type: 'string', default: '', label: 'Postcode' },
          { key: 'business.country', type: 'string', default: 'United Kingdom', label: 'Country' },
        ],
      },
    ],
  },

  // ======================= WORKFLOW =======================
  {
    id: 'workflow',
    label: 'Workflow & Queue',
    icon: 'Workflow',
    description: 'How orders move through assembling, checking, packing and despatch.',
    sections: [
      {
        id: 'queue',
        label: 'Queue display',
        fields: [
          { key: 'queue.maxVisiblePerStage', type: 'number', default: 10, min: 1, max: 200, unit: 'orders',
            label: 'Orders shown per stage',
            help: 'Each queue column shows this many orders (highest priority first). The rest appear as others move on.' },
          { key: 'queue.maxActivePerUser', type: 'number', default: 10, min: 1, max: 100, unit: 'orders',
            label: 'Max orders in progress per user',
            help: 'How many orders one assembler can have claimed at once. Admins are exempt.' },
          { key: 'queue.assemblyLockMinutes', type: 'number', default: 30, min: 1, max: 480, unit: 'min',
            label: 'Assembly claim expires after',
            help: 'A claimed build is released automatically after this long, so an abandoned tab cannot block an order.' },
        ],
      },
      {
        id: 'gates',
        label: 'Stage gates',
        description: 'Rules that must be satisfied before an order can advance.',
        fields: [
          { key: 'workflow.requireTrackingBeforePacking', type: 'boolean', default: true,
            label: 'Require tracking before Packing',
            help: 'Orders without a tracking number stay at Checking (collections are exempt).' },
          { key: 'workflow.raiseTicketWhenTrackingMissing', type: 'boolean', default: true,
            label: 'Raise a Comms ticket when tracking is missing',
            help: 'Creates an urgent ticket to book the label. Deduplicated per order.' },
          { key: 'workflow.missingTrackingTicketPriority', type: 'select', default: 'urgent',
            label: 'Priority for missing-tracking tickets',
            options: [
              { value: 'urgent', label: 'Urgent' },
              { value: 'high', label: 'High' },
              { value: 'normal', label: 'Normal' },
            ] },
          { key: 'workflow.requireCleaning', type: 'boolean', default: true,
            label: 'Cleaning step required', help: 'Adds the "Cleaning done" hand-off between Assembling and Checking.' },
          { key: 'workflow.requireVinyl', type: 'boolean', default: true,
            label: 'Vinyl step required', help: 'Adds the "Vinyl applied" hand-off before an order can go to Packing.' },
          { key: 'workflow.requirePackChecklist', type: 'boolean', default: true,
            label: 'Require pack checklist complete',
            help: 'Every outstanding accessory/monitor must be ticked before an order can be marked Packed.' },
        ],
      },
      {
        id: 'autopull',
        label: 'Automatic order pulling',
        fields: [
          { key: 'autopull.enabled', type: 'boolean', default: true, label: 'Pull new orders automatically' },
          { key: 'autopull.intervalMinutes', type: 'number', default: 30, min: 5, max: 720, unit: 'min',
            label: 'Pull every', help: 'Shared across all open clients — only one pulls per window.' },
          { key: 'autopull.windowDays', type: 'number', default: 3, min: 1, max: 30, unit: 'days',
            label: 'Look back', help: 'Rolling window fetched each pull. Overlap is de-duplicated.' },
          { key: 'autopull.sources', type: 'multiselect', default: ['ebay', 'amazon', 'backmarket', 'onbuy', 'temu'],
            label: 'Pull from', options: [
              { value: 'ebay', label: 'eBay' },
              { value: 'amazon', label: 'Amazon' },
              { value: 'backmarket', label: 'BackMarket' },
              { value: 'onbuy', label: 'OnBuy' },
              { value: 'temu', label: 'Temu' },
            ] },
        ],
      },
    ],
  },

  // ======================= SHIPPING =======================
  {
    id: 'shipping',
    label: 'Shipping & Labels',
    icon: 'Truck',
    description: 'Carrier defaults and when labels get booked.',
    sections: [
      {
        id: 'autobook',
        label: 'Automatic label booking',
        description: 'Booking early means tracking exists from day one. Labels are only ever booked here — printing happens at packing.',
        fields: [
          { key: 'autobook.enabled', type: 'boolean', default: true,
            label: 'Book labels when orders are fetched',
            help: 'Books (never prints) a carrier label as soon as an order arrives.' },
          { key: 'autobook.carriers', type: 'multiselect', default: ['DPD', 'FedEx'],
            label: 'Book with', options: CARRIER_OPTIONS.filter((c) => c.value === 'DPD' || c.value === 'FedEx'),
            help: 'Only carriers with a live API integration can be auto-booked.' },
          { key: 'autobook.notifyBuyer', type: 'boolean', default: true,
            label: 'Send the tracking number to the buyer',
            help: 'Posts an order message when the label is booked. This is NOT a despatch confirmation.' },
          { key: 'autobook.buyerMessageTemplate', type: 'text',
            default: 'Hi {firstName},\n\nGood news — your order #{orderNumber} is being prepared and its {carrier} shipping label is already booked.\n\nYour tracking number is {tracking}.\n\nTracking goes live as soon as the parcel leaves our warehouse. Thanks for your purchase!',
            label: 'Buyer tracking message',
            tokens: ['{firstName}', '{buyerName}', '{orderNumber}', '{tracking}', '{carrier}', '{itemTitle}'] },
        ],
      },
      {
        id: 'fulfilment',
        label: 'Marketplace despatch',
        fields: [
          { key: 'fulfilment.uploadOnShipped', type: 'boolean', default: true,
            label: 'Upload tracking when order ships',
            help: 'Marks the order despatched on the marketplace at the moment it leaves the warehouse.' },
        ],
      },
      {
        id: 'defaults',
        label: 'Carrier defaults',
        fields: [
          { key: 'shipping.defaultCarrier', type: 'select', default: 'DPD', label: 'Default carrier',
            options: CARRIER_OPTIONS },
          { key: 'shipping.defaultDpdService', type: 'select', default: 'next_day',
            label: 'Default DPD service', options: DPD_SERVICE_OPTIONS },
          { key: 'shipping.defaultBoxes', type: 'number', default: 1, min: 1, max: 20, unit: 'boxes',
            label: 'Default boxes per order' },
          { key: 'shipping.defaultWeightKg', type: 'number', default: 20, min: 0.1, max: 500, step: 0.1, unit: 'kg',
            label: 'Default parcel weight',
            help: 'Used where a weight is required but not captured — e.g. swap collections.' },
          { key: 'shipping.expressPostcodePrefixes', type: 'list', default: [],
            label: 'Always-express postcode prefixes', advanced: true,
            help: 'Orders to these postcodes are treated as express regardless of the paid service.' },
        ],
      },
    ],
  },

  // ======================= DOCUMENTS =======================
  {
    id: 'documents',
    label: 'Printing & Documents',
    icon: 'Printer',
    description: 'Invoices, labels and how they reach a printer.',
    sections: [
      {
        id: 'printing',
        label: 'Printing behaviour',
        fields: [
          { key: 'print.autoInvoiceOnPull', type: 'boolean', default: true,
            label: 'Print invoices for auto-pulled orders' },
          { key: 'print.combineLabelAndInvoice', type: 'boolean', default: true,
            label: 'Offer combined label + invoice at packing',
            help: 'Adds the one-tap "Print Label + Invoice" action. Separate buttons remain available either way.' },
          { key: 'print.copiesPerInvoice', type: 'number', default: 1, min: 1, max: 5, unit: 'copies',
            label: 'Invoice copies', advanced: true },
        ],
      },
      {
        id: 'invoice',
        label: 'Invoice content',
        fields: [
          { key: 'invoice.useMarketplaceTemplates', type: 'boolean', default: true,
            label: 'Use marketplace-native invoice layouts',
            help: 'Amazon orders print the official Amazon packing slip; others use the branded invoice.' },
          { key: 'invoice.showBuyerNote', type: 'boolean', default: true, label: 'Show buyer notes on invoices' },
          { key: 'invoice.showSku', type: 'boolean', default: true, label: 'Show SKU on invoices' },
          { key: 'invoice.footerText', type: 'text', default: '',
            label: 'Invoice footer', help: 'Free text printed at the bottom of branded (non-Amazon) invoices.' },
        ],
      },
    ],
  },

  // ======================= MESSAGING =======================
  {
    id: 'messaging',
    label: 'Messaging',
    icon: 'MessageSquare',
    description: 'Buyer inbox behaviour across eBay, Amazon and BackMarket.',
    sections: [
      {
        id: 'compose',
        label: 'Composing',
        fields: [
          { key: 'messaging.sendShortcut', type: 'select', default: 'ctrl-enter', label: 'Send message with',
            options: [
              { value: 'ctrl-enter', label: 'Ctrl/Cmd + Enter (Enter = new line)' },
              { value: 'enter', label: 'Enter (Shift + Enter = new line)' },
            ] },
          { key: 'messaging.signature', type: 'string', default: '', label: 'Reply signature',
            help: 'Appended to outgoing replies. Leave blank for none.' },
          { key: 'messaging.maxAttachments', type: 'number', default: 5, min: 1, max: 10, unit: 'images',
            label: 'Max images per message' },
        ],
      },
      {
        id: 'inbox',
        label: 'Inbox',
        fields: [
          { key: 'messaging.defaultFilter', type: 'select', default: 'all', label: 'Default filter',
            options: [
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread' },
              { value: 'client', label: 'Client (all platforms)' },
            ] },
          { key: 'messaging.syncIntervalMinutes', type: 'number', default: 5, min: 1, max: 120, unit: 'min',
            label: 'Check for new messages every' },
          { key: 'messaging.strictOrderMatching', type: 'boolean', default: true,
            label: 'Only link threads to genuinely matching orders',
            help: 'A message about a listing the buyer never bought shows no linked order, instead of guessing.' },
        ],
      },
    ],
  },

  // ======================= RETURNS =======================
  {
    id: 'returns',
    label: 'Returns & Tickets',
    icon: 'PackageOpen',
    sections: [
      {
        id: 'returns',
        label: 'Returns',
        fields: [
          { key: 'returns.reasons', type: 'list',
            default: ['Faulty / Not working', 'Wrong item sent', 'Item not as described', 'Changed mind',
                      'Damaged in transit', 'Missing parts / accessories', 'Buyer remorse', 'Other'],
            label: 'Return reasons', help: 'Offered when logging a return. Order is preserved.' },
          { key: 'returns.defaultSwapMethod', type: 'select', default: 'collection', label: 'Default swap method',
            options: [
              { value: 'collection', label: 'Book a collection' },
              { value: 'label', label: 'Issue a return label' },
            ] },
          { key: 'returns.emailLabelToCustomer', type: 'boolean', default: true,
            label: 'Email return labels to the customer by default' },
        ],
      },
      {
        id: 'tickets',
        label: 'Tickets',
        fields: [
          { key: 'tickets.categories', type: 'list',
            default: ['cancellation', 'tracking', 'refund', 'return', 'callback', 'missing-item', 'other'],
            label: 'Ticket categories' },
          { key: 'tickets.defaultPriority', type: 'select', default: 'normal', label: 'Default priority',
            options: [
              { value: 'urgent', label: 'Urgent' },
              { value: 'high', label: 'High' },
              { value: 'normal', label: 'Normal' },
              { value: 'low', label: 'Low' },
            ] },
          { key: 'tickets.autoTicketOnCancellation', type: 'boolean', default: true,
            label: 'Raise a Comms ticket when an order is cancelled' },
        ],
      },
    ],
  },

  // ======================= INVENTORY =======================
  {
    id: 'inventory',
    label: 'Inventory & Picker',
    icon: 'Boxes',
    sections: [
      {
        id: 'stock',
        label: 'Stock',
        fields: [
          { key: 'inventory.grades', type: 'list', default: ['A', 'B', 'C', 'D', 'Spares / Faulty'],
            label: 'Condition grades' },
          { key: 'inventory.lowStockThreshold', type: 'number', default: 5, min: 0, max: 1000, unit: 'units',
            label: 'Low-stock warning at or below' },
        ],
      },
      {
        id: 'picker',
        label: 'Picker options',
        description: 'The build-spec choices offered to order pickers.',
        fields: [
          { key: 'picker.cpuGenerations', type: 'list',
            default: ['2nd', '3rd', '4th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th'],
            label: 'CPU generations' },
          { key: 'picker.ramCapacities', type: 'list', default: ['4', '8', '16', '32', '64'],
            label: 'RAM capacities', unit: 'GB' },
          { key: 'picker.storageTypes', type: 'list', default: ['SSD', 'HDD', 'NVMe'], label: 'Storage types' },
          { key: 'picker.storageCapacities', type: 'list',
            default: ['128GB', '256GB', '512GB', '1TB', '2TB'], label: 'Storage capacities' },
        ],
      },
    ],
  },

  // ======================= REPORTING =======================
  {
    id: 'reporting',
    label: 'Reporting & Alerts',
    icon: 'BarChart3',
    sections: [
      {
        id: 'eod',
        label: 'End-of-day report',
        fields: [
          { key: 'eod.enabled', type: 'boolean', default: true, label: 'Send an end-of-day report' },
          { key: 'eod.sendAt', type: 'time', default: '20:00', label: 'Send at' },
          { key: 'eod.recipients', type: 'list', default: [], label: 'Recipients',
            help: 'Email addresses that receive the EOD summary.' },
        ],
      },
      {
        id: 'alerts',
        label: 'Alerts',
        fields: [
          { key: 'alerts.feedbackPollMinutes', type: 'number', default: 5, min: 1, max: 120, unit: 'min',
            label: 'Check for new feedback every' },
          { key: 'alerts.cancellationPollMinutes', type: 'number', default: 5, min: 1, max: 120, unit: 'min',
            label: 'Check for cancellations every' },
          { key: 'alerts.negativeFeedbackAlert', type: 'boolean', default: true,
            label: 'Alert on negative or neutral feedback' },
          { key: 'alerts.cancellationFullScreen', type: 'boolean', default: true,
            label: 'Full-screen alert when an order is cancelled',
            help: 'Makes sure the floor stops work on a cancelled build immediately.' },
        ],
      },
      {
        id: 'targets',
        label: 'Targets',
        fields: [
          { key: 'targets.returnRatePercent', type: 'number', default: 4, min: 0, max: 100, step: 0.1, unit: '%',
            label: 'Return-rate target', help: 'Shown as the benchmark on the Overview dashboard.' },
          { key: 'targets.dispatchSameDayPercent', type: 'number', default: 95, min: 0, max: 100, unit: '%',
            label: 'Same-day despatch target' },
        ],
      },
    ],
  },

  // ======================= APPEARANCE =======================
  {
    id: 'appearance',
    label: 'Appearance',
    icon: 'Palette',
    description: 'Look and feel. Changes apply to everyone.',
    sections: [
      {
        id: 'theme',
        label: 'Theme',
        fields: [
          { key: 'appearance.sidebarTheme', type: 'select', default: 'dark', label: 'Sidebar theme',
            requiresReload: false,
            options: [
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ] },
          { key: 'appearance.accentColor', type: 'color', default: '#2563eb', label: 'Accent colour',
            help: 'Primary colour for buttons, links and active states.' },
          { key: 'appearance.density', type: 'select', default: 'comfortable', label: 'Density',
            options: [
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ] },
        ],
      },
      {
        id: 'nav',
        label: 'Navigation',
        fields: [
          { key: 'appearance.defaultLandingPage', type: 'select', default: '/', label: 'Default landing page',
            options: LANDING_PAGE_OPTIONS,
            help: 'Where users land after signing in, if they have access to it.' },
          { key: 'appearance.showOrderThumbnails', type: 'boolean', default: true,
            label: 'Show product thumbnails in order lists' },
        ],
      },
    ],
  },

  // ======================= DATA =======================
  {
    id: 'data',
    label: 'Data & Maintenance',
    icon: 'Database',
    sections: [
      {
        id: 'retention',
        label: 'Retention',
        fields: [
          { key: 'data.recentlyDeletedDays', type: 'number', default: 30, min: 1, max: 365, unit: 'days',
            label: 'Keep deleted orders for' },
          { key: 'data.archiveShippedAfterDays', type: 'number', default: 0, min: 0, max: 365, unit: 'days',
            label: 'Auto-archive shipped orders after',
            help: '0 disables automatic archiving — shipped orders are cleared manually at EOD.' },
        ],
      },
      {
        id: 'backfill',
        label: 'Historical backfill',
        fields: [
          { key: 'data.backfillDays', type: 'number', default: 720, min: 30, max: 730, unit: 'days',
            label: 'Backfill history depth', advanced: true,
            help: 'How far back to pull historical orders. eBay allows a maximum of about two years.' },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

/** Every field in the registry, flattened. */
export const ALL_SETTING_FIELDS: SettingField[] = SETTINGS_SCHEMA.flatMap((g) =>
  g.sections.flatMap((s) => s.fields)
);

/** key → field */
export const SETTING_FIELD_BY_KEY: Record<string, SettingField> = Object.fromEntries(
  ALL_SETTING_FIELDS.map((f) => [f.key, f])
);

/** key → default value. The app's behaviour with no stored settings at all. */
export const SETTING_DEFAULTS: Record<string, SettingValue> = Object.fromEntries(
  ALL_SETTING_FIELDS.map((f) => [f.key, f.default])
);

/** Validate a single value against its field. Returns an error message or null. */
export function validateSetting(key: string, value: SettingValue): string | null {
  const field = SETTING_FIELD_BY_KEY[key];
  if (!field) return `Unknown setting "${key}"`;

  switch (field.type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return 'Must be a number';
      if (field.min != null && n < field.min) return `Must be at least ${field.min}`;
      if (field.max != null && n > field.max) return `Must be at most ${field.max}`;
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') return 'Must be true or false';
      break;
    case 'select':
      if (!field.options?.some((o) => o.value === value)) return 'Not an allowed option';
      break;
    case 'multiselect': {
      if (!Array.isArray(value)) return 'Must be a list';
      const allowed = new Set(field.options?.map((o) => o.value) ?? []);
      if (value.some((v) => !allowed.has(v))) return 'Contains an option that is not allowed';
      break;
    }
    case 'list':
      if (!Array.isArray(value)) return 'Must be a list';
      break;
    case 'color':
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return 'Must be a hex colour, e.g. #2563eb';
      break;
    case 'time':
      if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return 'Must be a time, e.g. 20:00';
      break;
    default:
      if (typeof value !== 'string') return 'Must be text';
  }
  return field.validate?.(value) ?? null;
}
