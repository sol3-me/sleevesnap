import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icons } from '../components/Icons';
import { useAuth } from '../contexts/AuthContext';
import { useClearCollectionMutation, useCollectionQuery, useImportCollectionMutation } from '../hooks/useCollection';
import { getProviderLabel } from '../lib/authProviderLabel';
import { serializeCollectionExport } from '../lib/collectionExport';
import { parseCollectionImport } from '../lib/collectionImport';
import { triggerTextDownload } from '../lib/downloadFile';

function AccountInfoSection() {
  const { user } = useAuth();
  if (!user) return null;

  const label = user.displayName ?? user.email ?? 'Signed in';
  const initial = label.charAt(0).toUpperCase();
  const providerLabel = getProviderLabel(user);
  const secondaryLine = user.displayName && user.email
    ? providerLabel ? `${user.email} · ${providerLabel}` : user.email
    : providerLabel;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-4">
      <h3 className="text-sm font-semibold text-white mb-4">Account</h3>
      <div className="flex items-center gap-3">
        {user.photoURL ? (
          <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="w-12 h-12 rounded-full shrink-0" />
        ) : (
          <span className="flex items-center justify-center w-12 h-12 rounded-full shrink-0 bg-vinyl-accent/20 text-vinyl-accent text-lg font-semibold">
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">{label}</p>
          {secondaryLine && <p className="text-xs text-gray-500 truncate">{secondaryLine}</p>}
        </div>
      </div>
    </section>
  );
}

function DataSection() {
  const { data: collection } = useCollectionQuery();
  const importMutation = useImportCollectionMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const filename = `sleevesnap-collection-${new Date().toISOString().slice(0, 10)}.json`;
    triggerTextDownload(serializeCollectionExport(collection, new Date()), filename, 'application/json');
  };

  const handleImportFileChosen = async (file: File) => {
    const text = await file.text();
    const { valid, errors } = parseCollectionImport(text);

    if (valid.length === 0) {
      toast.error(errors[0] ?? 'No valid records found in that file.');
      return;
    }

    try {
      const { added, duplicates } = await importMutation.mutateAsync(valid);
      const skipped = errors.length;
      const parts = [
        `${added} added`,
        duplicates > 0 ? `${duplicates} already in your collection` : undefined,
        skipped > 0 ? `${skipped} skipped (invalid)` : undefined,
      ].filter(Boolean);
      toast.success(parts.join(', '));
    } catch {
      toast.error('Failed to import collection. Please try again.');
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-4">
      <h3 className="text-sm font-semibold text-white mb-1">Data</h3>
      <p className="text-sm text-gray-400 mb-4">Back up your collection to a file, or restore it on another device.</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={collection.length === 0}
          onClick={handleExport}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 bg-white/5 text-sm font-medium text-gray-200 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5"
        >
          <Icons.Download />
          Export collection
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/10 bg-white/5 text-sm font-medium text-gray-200 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icons.Upload />
          {importMutation.isPending ? 'Importing…' : 'Import collection'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleImportFileChosen(file);
          }}
        />
      </div>
    </section>
  );
}

export function SettingsView() {
  const { data: collection } = useCollectionQuery();
  const clearMutation = useClearCollectionMutation();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearCollection = async () => {
    setShowClearConfirm(false);
    try {
      await clearMutation.mutateAsync();
      toast.success('Collection cleared');
    } catch {
      toast.error('Failed to clear collection. Please try again.');
    }
  };

  return (
    <div className="p-4 md:p-8 pb-28 md:pb-24 max-w-2xl">
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-6 md:mb-8">Settings</h2>

      <AccountInfoSection />

      <DataSection />

      <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <h3 className="text-sm font-semibold text-red-400 mb-1">Danger Zone</h3>
        <p className="text-sm text-gray-400 mb-4">
          Permanently remove every record from your collection. This can't be undone.
        </p>
        <button
          type="button"
          disabled={collection.length === 0}
          onClick={() => setShowClearConfirm(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-red-500/30 bg-red-500/10 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500/10"
        >
          <Icons.Trash />
          Clear collection
        </button>
      </section>

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear entire collection?"
        description={`This removes all ${collection.length} ${collection.length === 1 ? 'record' : 'records'} from your collection. This can't be undone.`}
        confirmLabel="Clear collection"
        onConfirm={() => void handleClearCollection()}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
}
