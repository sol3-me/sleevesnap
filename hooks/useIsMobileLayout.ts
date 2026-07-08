import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT_PX = 768;

export function useIsMobileLayout(): boolean {
  const [isMobileLayout, setIsMobileLayout] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT_PX : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateLayout = () => setIsMobileLayout(window.innerWidth < MOBILE_BREAKPOINT_PX);
    updateLayout();

    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  return isMobileLayout;
}
