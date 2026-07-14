import React from 'react';

export interface AdvancedSearchFieldsValue {
  title: string;
  artist: string;
  year: string;
  label: string;
}

interface AdvancedSearchFieldsProps {
  value: AdvancedSearchFieldsValue;
  onChange: (next: AdvancedSearchFieldsValue) => void;
  onSubmit: () => void;
}

const inputClassName =
  'w-full bg-vinyl-800/80 text-white placeholder:text-gray-500 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-vinyl-accent/60 focus:ring-2 focus:ring-vinyl-accent/20 focus:outline-none transition-colors';

/** Title/Artist/Year/Label fields for a structured (MusicBrainz `SearchIntent`-shaped) search. */
export const AdvancedSearchFields: React.FC<AdvancedSearchFieldsProps> = ({ value, onChange, onSubmit }) => {
  const handleEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSubmit();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <input
        type="text"
        value={value.title}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        onKeyDown={handleEnter}
        placeholder="Title"
        className={inputClassName}
      />
      <input
        type="text"
        value={value.artist}
        onChange={(e) => onChange({ ...value, artist: e.target.value })}
        onKeyDown={handleEnter}
        placeholder="Artist"
        className={inputClassName}
      />
      <input
        type="text"
        value={value.year}
        onChange={(e) => onChange({ ...value, year: e.target.value })}
        onKeyDown={handleEnter}
        placeholder="Year"
        className={inputClassName}
      />
      <input
        type="text"
        value={value.label}
        onChange={(e) => onChange({ ...value, label: e.target.value })}
        onKeyDown={handleEnter}
        placeholder="Label"
        className={inputClassName}
      />
    </div>
  );
};
