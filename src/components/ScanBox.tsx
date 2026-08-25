import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function ScanBox() {
  const [v, setV] = useState('');
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const s = v.trim();
      if (!s) return;
      nav(`/scan?serial=${encodeURIComponent(s)}`);
      setV('');
    }
  }

  return (
    <div className="scan no-print">
      <span className="mono">SCAN</span>
      <input
        ref={ref}
        placeholder="HID scanner or type serial, then Enter"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={onKey}
        aria-label="Barcode scan lookup"
      />
    </div>
  );
}
