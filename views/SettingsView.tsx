import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icons } from '../components/Icons';
import { useAuth } from '../contexts/AuthContext';
import { useClearCollectionMutation, useCollectionQuery } from '../hooks/useCollection';
import { getProviderLabel } from '../lib/authProviderLabel';

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
