export function CapDenied({ cap }: { cap: string }) {
  return (
    <p className="err">
      Access denied. Required capability: <span className="mono">{cap}</span>.
    </p>
  );
}

export function CapChecking() {
  return <p className="help">Checking access…</p>;
}
