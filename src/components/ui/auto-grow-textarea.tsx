'use client';

import { useEffect, useRef } from 'react';

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Max height in px before the box scrolls instead of growing further. */
  maxHeight?: number;
};

/**
 * Textarea that grows with its content up to maxHeight, then scrolls. Used for
 * message reply boxes so a long reply is fully visible while typing.
 */
export function AutoGrowTextarea({ value, maxHeight = 240, className = '', ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';                         // reset so it can shrink too
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  // Re-fit whenever the controlled value changes (typing, or cleared after send).
  useEffect(resize, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      onInput={resize}
      rows={1}
      className={`resize-none ${className}`}
      {...props}
    />
  );
}
