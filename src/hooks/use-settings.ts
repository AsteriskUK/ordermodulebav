'use client';

import { useCallback } from 'react';
import { useOrderStore } from '@/lib/store';
import { resolveSetting, asBool, asNumber, asString, asList, SettingsValues } from '@/lib/settings';
import { SettingValue } from '@/lib/settings-schema';

/**
 * Read one setting reactively. Falls back to the registry default when nothing
 * is stored, so components never need to handle "not configured yet".
 *
 *   const cap = useSettingNumber('queue.maxVisiblePerStage');
 */
export function useSetting<T extends SettingValue = SettingValue>(key: string): T {
  const values = useOrderStore((s) => s.appSettings);
  return resolveSetting<T>(values, key);
}

export const useSettingNumber = (key: string): number => asNumber(useSetting(key));
export const useSettingBool = (key: string): boolean => asBool(useSetting(key));
export const useSettingString = (key: string): string => asString(useSetting(key));
export const useSettingList = (key: string): string[] => asList(useSetting(key));

/**
 * Non-reactive read for callbacks/effects that shouldn't re-subscribe
 * (e.g. inside an event handler or a one-off async flow).
 */
export function readSetting<T extends SettingValue = SettingValue>(key: string): T {
  return resolveSetting<T>(useOrderStore.getState().appSettings, key);
}

/** All current overrides plus a resolver — for settings screens and bulk reads. */
export function useSettings(): { values: SettingsValues; get: <T extends SettingValue>(key: string) => T } {
  const values = useOrderStore((s) => s.appSettings) ?? {};
  const get = useCallback(
    <T extends SettingValue>(key: string) => resolveSetting<T>(values, key),
    [values],
  );
  return { values, get };
}
