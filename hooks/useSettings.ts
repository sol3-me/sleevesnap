import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, UserSettings, UserSettingsUpdate } from '../services/settingsService';

export const settingsQueryKey = ['settings'] as const;

export function useSettingsQuery() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: getSettings,
    initialData: { cardSize: 'M', preferredFormat: null, preferredRegion: null } as UserSettings,
  });
}

// Optimistic: settings controls (card size, preferred format/region) should
// feel instant, not wait on a round trip — the cache is updated immediately
// with just the changed fields merged in, and rolled back on failure.
export function useUpdateSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: UserSettingsUpdate) => updateSettings(update),
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey: settingsQueryKey });
      const previous = queryClient.getQueryData<UserSettings>(settingsQueryKey);
      if (previous) {
        queryClient.setQueryData<UserSettings>(settingsQueryKey, { ...previous, ...update });
      }
      return { previous };
    },
    onError: (_err, _update, context) => {
      if (context?.previous) {
        queryClient.setQueryData(settingsQueryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}
