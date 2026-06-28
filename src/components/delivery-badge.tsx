import { Badge } from '@/components/ui/badge';
import { Zap } from 'lucide-react';
import { DeliveryType, DeliveryCarrier } from '@/lib/types';

interface Props {
  deliveryType: DeliveryType;
  deliveryCarrier?: DeliveryCarrier;
  size?: 'sm' | 'xs';
}

export function DeliveryBadge({ deliveryType, deliveryCarrier, size = 'xs' }: Props) {
  if (deliveryType === 'express') {
    return (
      <Badge
        variant="outline"
        className={`${size === 'xs' ? 'text-[10px] px-1.5 py-0' : 'text-xs'} bg-red-100 text-red-700 border-red-400 font-bold flex items-center gap-0.5`}
      >
        <Zap className="h-2.5 w-2.5" />
        EXPRESS
      </Badge>
    );
  }
  if (deliveryType === 'next_day') {
    return (
      <Badge
        variant="outline"
        className={`${size === 'xs' ? 'text-[10px] px-1.5 py-0' : 'text-xs'} bg-orange-100 text-orange-700 border-orange-300`}
      >
        Next Day
      </Badge>
    );
  }
  if (deliveryType === 'two_day') {
    return (
      <Badge
        variant="outline"
        className={`${size === 'xs' ? 'text-[10px] px-1.5 py-0' : 'text-xs'} bg-blue-100 text-blue-700 border-blue-300`}
      >
        2-Day (BT)
      </Badge>
    );
  }
  if (deliveryType === 'collection') {
    return (
      <Badge
        variant="outline"
        className={`${size === 'xs' ? 'text-[10px] px-1.5 py-0' : 'text-xs'} bg-slate-100 text-slate-500 border-slate-300`}
      >
        Collection
      </Badge>
    );
  }
  if (deliveryCarrier) {
    return (
      <Badge
        variant="outline"
        className={`${size === 'xs' ? 'text-[10px] px-1.5 py-0' : 'text-xs'} ${
          deliveryCarrier === 'DPD'
            ? 'bg-purple-50 text-purple-700 border-purple-300'
            : deliveryCarrier === 'FedEx'
            ? 'bg-orange-50 text-orange-700 border-orange-200'
            : 'bg-slate-100 text-slate-600 border-slate-300'
        }`}
      >
        {deliveryCarrier}
      </Badge>
    );
  }
  return null;
}
