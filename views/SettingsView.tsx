import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icons } from '../components/Icons';
import { useAuth } from '../contexts/AuthContext';
import { useClearCollectionMutation, useCollectionQuery, useImportCollectionMutation } from '../hooks/useCollection';
import { useSettingsQuery, useUpdateSettingsMutation } from '../hooks/useSettings';
import { getProviderLabel } from '../lib/authProviderLabel';
import { serializeCollectionExport } from '../lib/collectionExport';
import { parseCollectionImport } from '../lib/collectionImport';
import { getBrowserLocales, resolveEffectivePreferredRegion } from '../lib/detectRegionFromLocale';
import { triggerTextDownload } from '../lib/downloadFile';
import { FORMAT_FAMILY_OPTIONS } from '../lib/filters';
import { listRegionOptions } from '../lib/regionLabel';

const selectClassName =
  'w-full bg-vinyl-800/80 text-white border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:border-vinyl-accent/60 focus:ring-2 focus:ring-vinyl-accent/20 focus:outline-none transition-colors';

function PreferencesSection() {
  const { data: settings } = useSettingsQuery();
  const updateSettingsMutation = useUpdateSettingsMutation();
  const regionOptions = useMemo(() => listRegionOptions(), []);
  // Guessed from the browser's own locale (never saved until the user
  // actually touches the select) so the field isn't just sitting on "No
  // preference" for someone who'd obviously want their own region.
  const guessedRegion = useMemo(() => resolveEffectivePreferredRegion(null, getBrowserLocales()), []);
  // Without this, explicitly picking "No preference" would immediately snap
  // back to the guess: preferredRegion becomes null either way (unset or
  // deliberately cleared look identical server-side), so the guess would
  // keep reapplying on every render. Once the user has touched the select
  // this session, respect whatever they chose — including "No preference" —
  // instead of re-guessing.
  const [regionTouched, setRegionTouched] = useState(false);
  const isGuessedRegion = !settings.preferredRegion && !regionTouched;
  const regionSelectValue = regionTouched ? settings.preferredRegion ?? '' : settings.preferredRegion ?? guessedRegion;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 mb-4">
      <h3 className="text-sm font-semibold text-white mb-1">Collection defaults</h3>
      <p className="text-sm text-gray-400 mb-4">
        Used to pick a pressing automatically when you add an album without choosing a specific edition
        (e.g. quick-add). Falls back to the usual default when an album has no pressing matching your preference.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1.5">Preferred format</span>
          <select
            value={settings.preferredFormat ?? ''}
            onChange={(e) =>
              updateSettingsMutation.mutate({ preferredFormat: e.target.value || null })
            }
            className={selectClassName}
          >
            <option value="">No preference</option>
            {FORMAT_FAMILY_OPTIONS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1.5">Preferred region</span>
          <select
            value={regionSelectValue}
            onChange={(e) => {
              setRegionTouched(true);
              updateSettingsMutation.mutate({ preferredRegion: e.target.value || null });
            }}
            className={selectClassName}
          >
            <option value="">No preference</option>
            {regionOptions.map((region) => (
              <option key={region.code} value={region.code}>
                {region.label}
              </option>
            ))}
          </select>
          {isGuessedRegion && (
            <span className="block text-[11px] text-gray-500 mt-1.5">
              Guessed from your browser — change it if this isn't right.
            </span>
          )}
        </label>
      </div>
    </section>
  );
}

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

      <PreferencesSection />

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
