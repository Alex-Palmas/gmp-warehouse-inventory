import { useEffect, useState } from 'react';
import type { Capability, Session } from '../types';
import { hasCapability, listSessionCapabilities } from '../lib/permissions';

export function useCap(session: Session, cap: Capability): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void hasCapability(session, cap).then((v) => {
      if (live) setOk(v);
    });
    return () => {
      live = false;
    };
  }, [session, cap]);
  return ok;
}

export function useCaps(session: Session): Set<Capability> | null {
  const [set, setSet] = useState<Set<Capability> | null>(null);
  useEffect(() => {
    let live = true;
    void listSessionCapabilities(session).then((v) => {
      if (live) setSet(v);
    });
    return () => {
      live = false;
    };
  }, [session]);
  return set;
}
