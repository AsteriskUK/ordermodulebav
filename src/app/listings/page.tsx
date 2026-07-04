'use client';

import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { CreateListingForm } from '@/components/create-listing-form';
import { BackmarketCreateListingForm } from '@/components/backmarket-create-listing-form';
import { EbayLiveListings } from '@/components/ebay-live-listings';

type Platform = 'ebay' | 'backmarket';
type Tab = 'create' | 'live';

export default function ListingsPage() {
  const [platform, setPlatform] = useState<Platform>('ebay');
  const [tab, setTab] = useState<Tab>('create');

  return (
    <AppShell>
      <div className="h-full overflow-y-auto">
        <div className="p-6 max-w-5xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Listings</h1>
            <p className="text-sm text-slate-500 mt-1">
              Create new listings or manage your live eBay catalog.
            </p>
          </div>

          {/* Section tabs */}
          <div className="flex gap-2 mb-6 border-b">
            {([
              { id: 'create' as Tab, label: 'Create Listing' },
              { id: 'live' as Tab, label: 'Live eBay Listings' },
            ]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'live' ? (
            <EbayLiveListings />
          ) : (
            <>
              {/* Platform tabs */}
              <div className="flex gap-2 mb-6 border-b">
                {([
                  { id: 'ebay' as Platform, label: 'eBay' },
                  { id: 'backmarket' as Platform, label: 'Back Market' },
                ]).map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setPlatform(id)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      platform === id
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {platform === 'ebay' ? <CreateListingForm /> : <BackmarketCreateListingForm />}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
