import { useNavigate } from '@tanstack/react-router';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

interface ScanContextValue {
  /** A data URL supplied from outside (e.g. a global clipboard paste), consumed once by ScanView. */
  pendingScanImage: string | null;
  clearPendingScanImage: () => void;
}

const ScanContext = createContext<ScanContextValue | null>(null);

/**
 * Lives inside the router tree (needs useNavigate) so a screenshot pasted
 * from anywhere on the site — the desktop-friendly alternative to the
 * webcam — can jump straight to /scan with the image already attached.
 */
export function ScanProvider({ children }: { children: ReactNode }) {
  const [pendingScanImage, setPendingScanImage] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;

      e.preventDefault();

      const reader = new FileReader();
      reader.onloadend = () => {
        setPendingScanImage(reader.result as string);
        void navigate({ to: '/scan' });
      };
      reader.readAsDataURL(file);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [navigate]);

  return (
    <ScanContext.Provider value={{ pendingScanImage, clearPendingScanImage: () => setPendingScanImage(null) }}>
      {children}
    </ScanContext.Provider>
  );
}

export function useScanContext(): ScanContextValue {
  const ctx = useContext(ScanContext);
  if (!ctx) {
    throw new Error('useScanContext must be used within a ScanProvider');
  }
  return ctx;
}
