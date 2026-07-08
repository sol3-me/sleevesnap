import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Scanner } from '../components/Scanner';
import { useScanContext } from '../contexts/ScanContext';
import { collectionQueryKey } from '../hooks/useCollection';
import { useIsMobileLayout } from '../hooks/useIsMobileLayout';

export function ScanView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobileLayout = useIsMobileLayout();
  const { pendingScanImage, clearPendingScanImage } = useScanContext();

  return (
    <Scanner
      isMobileLayout={isMobileLayout}
      initialImage={pendingScanImage}
      onInitialImageConsumed={clearPendingScanImage}
      onCancel={() => void navigate({ to: '/' })}
      onScanComplete={async (record) => {
        await queryClient.invalidateQueries({ queryKey: collectionQueryKey });
        void navigate({ to: '/' });
        toast.success(`Added "${record.title}" to collection!`);
      }}
      onAlreadyInCollection={(record) => {
        // Already in the collection — no save happened, so no need to
        // invalidate the query. Just take the user back and point at it.
        void navigate({ to: '/', search: { highlight: record.id } });
        toast(`"${record.title}" is already in your collection`);
      }}
    />
  );
}
