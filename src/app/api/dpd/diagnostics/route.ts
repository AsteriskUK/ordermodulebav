import { NextRequest, NextResponse } from 'next/server';

const SANDBOX_BASE = 'https://developers.api.customers.dpd.co.uk';
const LIVE_BASE = 'https://api.customers.dpd.co.uk';

export async function GET(req: NextRequest) {
  const isSandbox = process.env.DPD_ENV?.toLowerCase() !== 'live';
  const baseUrl = isSandbox ? SANDBOX_BASE : LIVE_BASE;
  const networkCode = process.env.DPD_NETWORK_CODE;
  const apiKey = process.env.DPD_API_KEY;
  const apiSecret = process.env.DPD_API_SECRET;
  const accountNumber = process.env.DPD_ACCOUNT_NUMBER;

  const info = {
    environment: process.env.DPD_ENV ?? '(not set)',
    baseUrl,
    apiKeyExists: !!apiKey,
    apiSecretExists: !!apiSecret,
    accountNumberExists: !!accountNumber,
    accountNumber: accountNumber ?? '(not set)',
    configuredNetworkCode: networkCode ?? '(NOT SET)',
    collectionPostcode: process.env.DPD_COLLECTION_POSTCODE ?? '(not set)',
  };

  // Step 1: get access token
  let accessToken: string | null = null;
  let tokenStatus: string;
  try {
    const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const tokenRes = await fetch(`${baseUrl}/v1/customer/auth/access`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json',
        'Client-Id': apiKey ?? '',
      },
    });
    const tokenBody = await tokenRes.json();
    if (tokenRes.ok && tokenBody?.data?.accessToken) {
      accessToken = tokenBody.data.accessToken;
      tokenStatus = `OK (${tokenRes.status})`;
    } else {
      tokenStatus = `Failed (${tokenRes.status}): ${JSON.stringify(tokenBody).slice(0, 200)}`;
    }
  } catch (e) {
    tokenStatus = `Error: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Step 2: fetch account profile to discover available network codes
  let accountNetworks: unknown = null;
  let accountNetworksStatus: string = 'skipped (no token)';
  if (accessToken && accountNumber) {
    try {
      const profileRes = await fetch(`${baseUrl}/v1/customer/account/${accountNumber}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Client-Id': apiKey ?? '',
          'GeoClient': `account/${accountNumber}`,
        },
      });
      const profileBody = await profileRes.json();
      accountNetworksStatus = `${profileRes.status}`;
      if (profileRes.ok) {
        accountNetworks = profileBody;
      } else {
        accountNetworks = profileBody;
      }
    } catch (e) {
      accountNetworksStatus = `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Step 3: try the network lookup endpoint directly
  let networkLookup: unknown = null;
  let networkLookupStatus = 'skipped (no token)';
  if (accessToken && accountNumber) {
    try {
      const nlRes = await fetch(`${baseUrl}/v1/customer/shipping/networks`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Client-Id': apiKey ?? '',
          'GeoClient': `account/${accountNumber}`,
        },
      });
      const nlBody = await nlRes.json();
      networkLookupStatus = `${nlRes.status}`;
      networkLookup = nlBody;
    } catch (e) {
      networkLookupStatus = `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json({
    ...info,
    tokenCheck: tokenStatus,
    accountNetworksStatus,
    accountNetworks,
    networkLookupStatus,
    networkLookup,
  });
}
