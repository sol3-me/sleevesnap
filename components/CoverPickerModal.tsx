import { ChangeEvent, useEffect, useRef } from 'react';
import { VinylRecord } from '../types';
import { Icons } from './Icons';

interface CoverPickerModalProps {
  record: VinylRecord | null;
  isSaving: boolean;
  onClose: () => void;
  onUploadPhoto: (base64Photo: string) => void;
  onRevertToMusicBrainz: () => void;
}

/** Lets the user replace a collection record's cover with their own photo, or revert to the MusicBrainz-sourced one. */
export function CoverPickerModal({
  record,
  isSaving,
  onClose,
  onUploadPhoto,
  onRevertToMusicBrainz,
}: CoverPickerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!record) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [record, onClose]);

  if (!record) return null;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] ?? dataUrl;
      onUploadPhoto(base64);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-picker-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-vinyl-900 p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="cover-picker-title" className="text-lg font-semibold text-white">
            Change cover
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-white transition-colors"
          >
            <Icons.X />
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-400 truncate">
          {record.artist} — {record.title}
        </p>

        <div className="mt-5 w-32 aspect-square mx-auto rounded-xl overflow-hidden bg-vinyl-800 border border-white/10">
          {record.coverUrl ? (
            <img src={record.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600">
              <Icons.Disc />
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-vinyl-accent hover:bg-vinyl-accent/90 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <Icons.Upload /> Upload from device
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          {record.coverSource === 'user' && (
            <button
              type="button"
              disabled={isSaving}
              onClick={onRevertToMusicBrainz}
              className="px-4 py-2.5 rounded-full border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              Use MusicBrainz cover
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
