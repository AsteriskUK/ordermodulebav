import { Order } from './types';

export type OrderUrgency = 'overdue' | 'express' | 'due-soon' | 'normal';

/**
 * Determine visual urgency of an order based on delivery type and post-by date.
 * - Overdue / express → red
 * - Due within 2 days → amber
 * - Normal / completed → no special coloring
 */
export function getOrderUrgency(order: Order): OrderUrgency {
  const completedStatuses = ['shipped', 'delivered', 'cancelled', 'refunded', 'returned', 'archived'];
  if (completedStatuses.includes(order.status)) return 'normal';

  if (order.deliveryType === 'express') return 'express';

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const postBy = order.postByDate ? new Date(order.postByDate) : null;
  if (postBy) {
    postBy.setHours(0, 0, 0, 0);
    if (postBy < now) return 'overdue';
    const diffDays = (postBy.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays <= 2) return 'due-soon';
  }

  return 'normal';
}

/** Tailwind row class for an order based on urgency. */
export function getOrderRowClass(order: Order): string {
  const urgency = getOrderUrgency(order);
  switch (urgency) {
    case 'overdue':
    case 'express':
      return 'bg-red-50 border-l-4 border-red-500';
    case 'due-soon':
      return 'bg-amber-50 border-l-4 border-amber-500';
    default:
      return '';
  }
}

/** Human readable urgency label. */
export function getOrderUrgencyLabel(order: Order): string | null {
  const urgency = getOrderUrgency(order);
  switch (urgency) {
    case 'overdue': return 'Overdue';
    case 'express': return 'Express';
    case 'due-soon': return 'Due soon';
    default: return null;
  }
}
