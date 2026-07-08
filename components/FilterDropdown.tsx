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
  const summary =
    selectedCount < options.length ? `${label} (${selectedCount} of ${options.length})` : label;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-vinyl-800 border-vinyl-700 text-sm text-gray-200 hover:bg-vinyl-700/50 transition-colors ${accentClassName ?? ''}`}
      >
        {summary}
        <span className={`text-xs leading-none transition-transform ${isOpen ? 'rotate-180' : ''}`}>⌄</span>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute z-10 mt-2 min-w-[180px] rounded-lg border border-vinyl-700 bg-vinyl-800 shadow-xl p-2 space-y-1"
        >
          {options.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-vinyl-700/50 cursor-pointer select-none text-sm text-gray-200"
            >
              <input
                type="checkbox"
                checked={isSelected(option)}
                onChange={(e) => onToggle(option, e.target.checked)}
                className="accent-vinyl-accent"
              />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
