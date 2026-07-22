import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CardSize, getSettings, updateCardSize, UserSettings } from '../services/settingsService';

export const settingsQueryKey = ['settings'] as const;

export function useSettingsQuery() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: getSettings,
    initialData: { cardSize: 'M' } as UserSettings,
  });
}

// Optimistic: the S/M/L control should feel instant, not wait on a round
// trip, so the cache is updated immediately and only rolled back on failure.
export function useUpdateCardSizeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardSize: CardSize) => updateCardSize(cardSize),
    onMutate: async (cardSize) => {
      await queryClient.cancelQueries({ queryKey: settingsQueryKey });
      const previous = queryClient.getQueryData<UserSettings>(settingsQueryKey);
      queryClient.setQueryData<UserSettings>(settingsQueryKey, { cardSize });
      return { previous };
    },
    onError: (_err, _cardSize, context) => {
      if (context?.previous) {
        queryClient.setQueryData(settingsQueryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}
