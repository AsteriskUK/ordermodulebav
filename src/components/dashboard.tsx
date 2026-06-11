'use client';

import { useRouter } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG, OrderStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Package,
  Clock,
  Truck,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RotateCcw,
  ShoppingCart,
  Wrench,
  ClipboardCheck,
  BoxSelect,
  PauseCircle,
  PackageOpen,
  Archive,
} from 'lucide-react';

const statusIcons: Record<OrderStatus, React.ElementType> = {
  pending: Clock,
  assembling: Wrench,
  checking: ClipboardCheck,
  packing: BoxSelect,
  packed: Package,
  shipped: Truck,
  delivered: CheckCircle,
  held: PauseCircle,
  'no-stock': AlertTriangle,
  cancelled: XCircle,
  refunded: RotateCcw,
  returned: PackageOpen,
  archived: Archive,
};

export function Dashboard() {
  const router = useRouter();
  const orders = useOrderStore((s) => s.orders);
  const batches = useOrderStore((s) => s.batches);

  const statusCounts = orders.reduce(
    (acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const totalRevenue = orders.reduce((sum, o) => sum + o.soldFor, 0);
  const pendingCount = statusCounts['pending'] || 0;
  const shippedCount = statusCounts['shipped'] || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-slate-500 text-sm mt-1">
          Overview of your warehouse pipeline
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/orders')}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Total Orders
            </CardTitle>
            <ShoppingCart className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{orders.length}</div>
            <p className="text-xs text-slate-500 mt-1">
              {batches.length} batch{batches.length !== 1 ? 'es' : ''} imported
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/orders?status=pending')}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Awaiting Action
            </CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {pendingCount}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Need packaging & dispatch
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/orders?status=shipped')}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Shipped
            </CardTitle>
            <Truck className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {shippedCount}
            </div>
            <p className="text-xs text-slate-500 mt-1">In transit</p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push('/orders')}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Total Revenue
            </CardTitle>
            <span className="text-slate-400 text-sm font-bold">£</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              £{totalRevenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-slate-500 mt-1">From all orders</p>
          </CardContent>
        </Card>
      </div>

      {/* Status breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {(Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[]).map(
              (status) => {
                const config = ORDER_STATUS_CONFIG[status];
                const Icon = statusIcons[status];
                const count = statusCounts[status] || 0;
                return (
                  <div
                    key={status}
                    className={`flex flex-col items-center p-3 rounded-lg border cursor-pointer hover:opacity-80 transition-opacity ${config.color}`}
                    onClick={() => router.push(`/orders?status=${status}`)}
                  >
                    <Icon className="h-5 w-5 mb-1" />
                    <span className="text-lg font-bold">{count}</span>
                    <span className="text-xs">{config.label}</span>
                  </div>
                );
              }
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent batches */}
      {batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Imports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {batches
                .slice(-5)
                .reverse()
                .map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between p-3 bg-slate-100 rounded-lg"
                  >
                    <div>
                      <p className="text-sm font-medium">{batch.name}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(batch.importedAt).toLocaleString()} •{' '}
                        {batch.source.toUpperCase()}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-slate-600">
                      {batch.orderCount} orders
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {orders.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-600">No orders yet</h3>
            <p className="text-sm text-slate-400 mt-1">
              Import a CSV file to get started
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
