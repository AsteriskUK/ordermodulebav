// eBay "From eBay" system messages (VAT invoices, policy notices…) arrive from
// the Message API as complete raw HTML emails. Convert those to readable plain
// text; genuine buyer messages are already plain and pass through untouched.

export function looksLikeHtmlEmail(s: string): boolean {
  return /<(!DOCTYPE|html|head|body|style|table|div)[\s>]/i.test(s);
}

export function htmlEmailToText(input: string): string {
  if (!input || !looksLikeHtmlEmail(input)) return input;
  let s = input;
  // Comments first — kills MSO conditional blocks (<!--[if mso]>…<![endif]-->).
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  // Block-level closers become line breaks so the text keeps its shape.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|tr|li|table|ul|ol)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;|&#160;|&#8202;/gi, ' ')
    .replace(/&zwnj;|&#8204;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&copy;/gi, '©')
    .replace(/&middot;/gi, '·');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
