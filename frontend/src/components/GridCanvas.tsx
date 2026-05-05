import { useEffect, useRef } from 'react';
import { initPixi, destroyPixi } from '../pixi/pixi-manager';

export default function GridCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const coordsRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    initPixi(containerRef.current, coordsRef.current);
    return () => destroyPixi();
  }, []);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full cursor-crosshair select-none" />
      <div
        ref={coordsRef}
        style={{ display: 'none' }}
        className="absolute bottom-2 left-2 text-xs text-gray-300 bg-black/50 px-2 py-1 rounded pointer-events-none font-mono"
      />
    </div>
  );
}
