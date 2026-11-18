// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
import { useEffect, useRef } from 'react';

/** Temporary confirmations stay in this document; leaving never cancels a server-side IdP action. */
export function useOidcMemory(
  identity: string,
  clear: () => void,
  restore: () => void
) {
  const epoch = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const callbacks = useRef({ clear, restore });
  callbacks.current = { clear, restore };
  useEffect(() => {
    const abort = () => {
      epoch.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
    const hide = () => {
      abort();
      callbacks.current.clear();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) {
        hide();
        callbacks.current.restore();
      }
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      abort();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, [identity]);
  return {
    begin: () => {
      const generation = epoch.current;
      const controller = new AbortController();
      controllers.current.add(controller);
      return {
        signal: controller.signal,
        current: () =>
          generation === epoch.current && !controller.signal.aborted,
        done: () => controllers.current.delete(controller),
      };
    },
  };
}
