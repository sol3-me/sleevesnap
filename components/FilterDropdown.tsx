import React, { useEffect, useRef, useState } from 'react';

interface FilterDropdownProps {
  label: string;
  options: string[];
  isSelected: (option: string) => boolean;
  onToggle: (option: string, checked: boolean) => void;
  /** Extra classes on the trigger button, used to visually distinguish sibling dropdowns (e.g. a tinted left border). */
  accentClassName?: string;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  label,
  options,
  isSelected,
  onToggle,
  accentClassName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideEvent = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setIsOpen(false);
        return;
      }
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideEvent);
    document.addEventListener('keydown', handleOutsideEvent);
    return () => {
      document.removeEventListener('mousedown', handleOutsideEvent);
      document.removeEventListener('keydown', handleOutsideEvent);
    };
  }, [isOpen]);

  const selectedCount = options.filter(isSelected).length;
  const isNarrowed = selectedCount < options.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 pl-3.5 pr-3 py-1.5 rounded-full border text-[13px] font-medium transition-colors ${
          isNarrowed
            ? 'bg-vinyl-accent/10 border-vinyl-accent/30 text-vinyl-accent'
            : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
        } ${accentClassName ?? ''}`}
      >
        {label}
        {isNarrowed && (
          <span className="min-w-4.5 px-1 py-px rounded-full bg-vinyl-accent text-white text-[10px] font-bold text-center leading-4">
            {selectedCount}
          </span>
        )}
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute z-10 mt-2 min-w-44 rounded-xl border border-white/10 bg-vinyl-800 shadow-2xl shadow-black/50 p-1.5 space-y-0.5"
        >
          {options.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/5 cursor-pointer select-none text-sm text-gray-200"
            >
              <input
                type="checkbox"
                checked={isSelected(option)}
                onChange={(e) => onToggle(option, e.target.checked)}
                className="accent-vinyl-accent w-4 h-4"
              />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
