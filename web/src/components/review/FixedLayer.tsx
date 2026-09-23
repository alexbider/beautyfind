'use client';

import { useEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ActionBar } from '@/components/shell/ActionBar';
import { SHELL_MQ } from '@/lib/ui/shell';

// Fixed layers (action bar, toasts) for the secondary client screens.
//
// The page transition wrapper (.bf-page-in, root template) keeps a filled transform animation, and a
// transformed ancestor becomes the containing block of `position: fixed`: a bar or toast rendered
// inside the page would stick to the bottom of the page instead of the screen. These helpers render
// the layer into <body> instead. Once the transition stops filling (animation-fill-mode: backwards),
// FixedActionBar can go back to a plain ActionBar.

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia(SHELL_MQ);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** True inside the app shell media query (phones, touch tablets). False on the server. */
export function useShell() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SHELL_MQ).matches,
    () => false,
  );
}

/** Renders children into <body> once mounted. */
export function BodyLayer({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  return mounted ? createPortal(children, document.body) : null;
}

/**
 * The shell's sticky action bar, fixed to the screen. Outside the shell it renders in place (inline,
 * or nothing with `mobileOnly`), exactly like ActionBar.
 */
export function FixedActionBar(props: ComponentProps<typeof ActionBar>) {
  const shell = useShell();
  const mounted = useMounted();
  if (shell && mounted) return createPortal(<ActionBar {...props} />, document.body);
  return <ActionBar {...props} />;
}
