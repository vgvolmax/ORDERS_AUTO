import { useState } from 'react';
import { useStore } from './appStore';
export function usePreference<T>(key: string, fallback: T): [T, (value: T) => void] {
  const { state, set } = useStore();
  const [value, update] = useState<T>(() => (state.uiPreferences[key] as T | undefined) ?? fallback);
  return [value, (next) => { update(next); set((s) => ({ uiPreferences: { ...s.uiPreferences, [key]: next } })); }];
}
