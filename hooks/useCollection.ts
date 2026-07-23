import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addRecord,
  clearCollection,
  getCollection,
  importCollection,
  removeRecord,
  revertRecordCoverToMusicBrainz,
  setRecordCoverPhoto,
} from '../services/storageService';
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

export function useImportCollectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (records: VinylRecord[]) => importCollection(records),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: collectionQueryKey });
    },
  });
}

function replaceRecordInCache(queryClient: ReturnType<typeof useQueryClient>, updated: VinylRecord) {
  queryClient.setQueryData<VinylRecord[]>(collectionQueryKey, (prev) =>
    (prev ?? []).map((r) => (r.id === updated.id ? updated : r)),
  );
}

export function useSetCoverPhotoMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, photo }: { id: string; photo: string }) => setRecordCoverPhoto(id, photo),
    onSuccess: (updated) => replaceRecordInCache(queryClient, updated),
  });
}

export function useRevertCoverMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revertRecordCoverToMusicBrainz(id),
    onSuccess: (updated) => replaceRecordInCache(queryClient, updated),
  });
}
