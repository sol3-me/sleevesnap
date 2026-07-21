import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addRecord, clearCollection, getCollection, removeRecord } from '../services/storageService';
import { VinylRecord } from '../types';

export const collectionQueryKey = ['collection'] as const;

export function useCollectionQuery() {
  return useQuery({
    queryKey: collectionQueryKey,
    queryFn: getCollection,
    initialData: [] as VinylRecord[],
  });
}

// addRecord resolves to `false` (not a thrown error) on a 409 duplicate, so
// the query only needs invalidating when a record was actually saved.
export function useAddToCollectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (record: VinylRecord) => addRecord(record),
    onSuccess: (success) => {
      if (success) {
        void queryClient.invalidateQueries({ queryKey: collectionQueryKey });
      }
    },
  });
}

export function useRemoveFromCollectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeRecord(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: collectionQueryKey });
    },
  });
}

export function useClearCollectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearCollection(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: collectionQueryKey });
    },
  });
}
