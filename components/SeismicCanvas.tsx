import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { SeismicDataset, ProcessingState, Horizon, HorizonPoint } from '../types';
import { findLocalPeak } from '../utils/dsp';
import { ZoomIn, ZoomOut, Maximize, Download, Crosshair, Move } from 'lucide-react';

interface Props {
  dataset: SeismicDataset;
  config: ProcessingState;
  horizons: Horizon[];
  onAddPoint: (point: HorizonPoint) => void;
}

const SeismicCanvas: React.FC<Props> = ({ dataset, config, horizons, onAddPoint }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [transform, setTransform] = useState({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // State for dynamic coordinates display and snapping
  const [mousePos, setMousePos] = useState({ 
    x: 0, 
    y: 0, 
    show: false, 
    snapY: 0,
    traceIdx: 0,
    sampleIdx: 0,
    amp: 0
  });

  const resetZoom = () => setTransform({ x: 0, y: 0, scaleX: 1, scaleY: 1 });

  const exportAsImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `seismic_section_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const AXIS_MARGIN = 50;
  const COLORBAR_WIDTH = 40;

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { traces, numSamples } = dataset;
    const dpr = window.devicePixelRatio || 1;
    const fullW = canvas.width / dpr;
    const fullH = canvas.height / dpr;
    
    const viewW = fullW - AXIS_MARGIN - COLORBAR_WIDTH;
    const viewH = fullH - AXIS_MARGIN;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, fullW, fullH);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, AXIS_MARGIN, fullH);
    ctx.fillRect(0, fullH - AXIS_MARGIN, fullW, AXIS_MARGIN);

    ctx.save();
    ctx.beginPath();
    ctx.rect(AXIS_MARGIN, 0, viewW, viewH);
    ctx.clip();
    
    ctx.translate(AXIS_MARGIN + transform.x, transform.y);
    ctx.scale(transform.scaleX, transform.scaleY);

    const traceWidth = viewW / traces.length;
    const sampleHeight = viewH / numSamples;

    if (!config.isWiggle) {
      traces.forEach((trace, i) => {
        const x = i * traceWidth;
        const screenX = (x * transform.scaleX) + transform.x + AXIS_MARGIN;
        if (screenX + (traceWidth * transform.scaleX) < AXIS_MARGIN || screenX > fullW) return;

        trace.data.forEach((val, j) => {
          if (Math.abs(val) < 0.001) return;
          const y = j * sampleHeight;
          const norm = Math.max(-1, Math.min(1, val * config.gain));
          if (norm > 0) {
            const intensity = Math.floor(norm * 255);
            ctx.fillStyle = `rgb(255, ${255 - intensity}, ${255 - intensity})`;
          } else {
            const intensity = Math.floor(Math.abs(norm) * 255);
            ctx.fillStyle = `rgb(${255 - intensity}, ${255 - intensity}, 255)`;
          }
          ctx.fillRect(x, y, traceWidth + 0.3, sampleHeight + 0.3);
        });
      });
    } else {
      traces.forEach((trace, i) => {
        const baseX = (i + 0.5) * traceWidth;
        const ampScale = traceWidth * config.gain * 2.0;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 0.5 / transform.scaleX;
        ctx.moveTo(baseX + trace.data[0] * ampScale, 0);
        trace.data.forEach((v, j) => ctx.lineTo(baseX + v * ampScale, j * sampleHeight));
        ctx.stroke();
      });
    }

    horizons.forEach(horizon => {
      if (!horizon.isVisible || horizon.points.length === 0) return;
      const points = [...horizon.points].sort((a, b) => a.traceIndex - b.traceIndex);
      const isActive = config.activeHorizonId === horizon.id;
      ctx.beginPath();
      ctx.strokeStyle = horizon.color;
      ctx.lineWidth = isActive ? 3 / Math.max(transform.scaleX, transform.scaleY) : 1 / transform.scaleX;
      points.forEach((p, i) => {
        const px = (p.traceIndex + 0.5) * traceWidth;
        const py = p.sampleIndex * sampleHeight;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });

    ctx.restore();

    ctx.fillStyle = '#64748b';
    ctx.font = '9px JetBrains Mono';
    ctx.textAlign = 'right';
    
    for (let s = 0; s < numSamples; s += 100) {
      const y = (s * sampleHeight) * transform.scaleY + transform.y;
      if (y >= 0 && y <= viewH) {
        ctx.fillText(`${(s * dataset.sampleInterval).toFixed(0)}`, AXIS_MARGIN - 8, y + 4);
        ctx.fillRect(AXIS_MARGIN - 4, y, 4, 0.5);
      }
    }
    
    ctx.textAlign = 'center';
    const xStep = Math.max(1, Math.floor(20 / transform.scaleX) || 10);
    for (let t = 0; t < traces.length; t += xStep) {
      const x = (t * traceWidth) * transform.scaleX + transform.x + AXIS_MARGIN;
      if (x >= AXIS_MARGIN && x <= AXIS_MARGIN + viewW) {
        ctx.fillText(`${t}`, x, viewH + 15);
        ctx.fillRect(x, viewH, 0.5, 4);
      }
    }

    const cbX = fullW - COLORBAR_WIDTH + 10;
    const cbY = 40;
    const cbH = viewH - 80;
    const cbW = 12;

    const grad = ctx.createLinearGradient(0, cbY, 0, cbY + cbH);
    grad.addColorStop(0, '#ff0000');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#0000ff');
    ctx.fillStyle = grad;
    ctx.fillRect(cbX, cbY, cbW, cbH);
    ctx.strokeStyle = '#ffffff22';
    ctx.strokeRect(cbX, cbY, cbW, cbH);

    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText('+', cbX + cbW + 4, cbY + 8);
    ctx.fillText('0', cbX + cbW + 4, cbY + cbH / 2 + 4);
    ctx.fillText('-', cbX + cbW + 4, cbY + cbH - 2);
    ctx.save();
    ctx.translate(cbX - 8, cbY + cbH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('AMPLITUDE', 0, 0);
    ctx.restore();

  }, [dataset, config, horizons, transform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = containerRef.current!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
      render();
    });
    resizeObserver.observe(containerRef.current);
    render();
    return () => resizeObserver.disconnect();
  }, [render]);

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({
      ...prev,
      scaleX: Math.max(0.01, Math.min(50, prev.scaleX * zoomFactor)),
      scaleY: Math.max(0.01, Math.min(50, prev.scaleY * zoomFactor))
    }));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isDragging) {
      setTransform(prev => ({ ...prev, x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }));
    }

    const viewW = rect.width - AXIS_MARGIN - COLORBAR_WIDTH;
    const viewH = rect.height - AXIS_MARGIN;

    // Use exact metrics to calculate precise world coordinates
    const worldX = (mx - AXIS_MARGIN - transform.x) / transform.scaleX;
    const worldY = (my - transform.y) / transform.scaleY;
    
    const traceWidth = viewW / dataset.traces.length;
    const sampleHeight = viewH / dataset.numSamples;

    // Exact index calculation for 100% precision
    const traceIdx = Math.floor(worldX / traceWidth);
    const rawSampleIdx = Math.floor(worldY / sampleHeight);
    
    let amp = 0;
    let snapY = my;

    if (traceIdx >= 0 && traceIdx < dataset.traces.length && rawSampleIdx >= 0 && rawSampleIdx < dataset.numSamples) {
      const trace = dataset.traces[traceIdx];
      amp = trace.data[rawSampleIdx];
      
      // Calculate snap position for visual feedback
      const snappedIdx = findLocalPeak(trace.data, rawSampleIdx, 20);
      snapY = ((snappedIdx / dataset.numSamples) * viewH) * transform.scaleY + transform.y;
    }

    setMousePos({ 
      x: mx, 
      y: my, 
      show: mx > AXIS_MARGIN && mx < rect.width - COLORBAR_WIDTH && my < viewH, 
      snapY,
      traceIdx: Math.max(0, Math.min(dataset.traces.length - 1, traceIdx)),
      sampleIdx: Math.max(0, Math.min(dataset.numSamples - 1, rawSampleIdx)),
      amp
    });
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!config.isPickerActive || !config.activeHorizonId || !mousePos.show) return;
    
    const trace = dataset.traces[mousePos.traceIdx];
    if (trace) {
      // Use the high-precision snapped index shown by the reticle
      const snappedIdx = findLocalPeak(trace.data, mousePos.sampleIdx, 20);
      onAddPoint({
        traceIndex: mousePos.traceIdx,
        sampleIndex: snappedIdx,
        timeMs: snappedIdx * dataset.sampleInterval,
        amplitude: trace.data[snappedIdx]
      });
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#020617] overflow-hidden group">
      <canvas 
        ref={canvasRef} 
        onMouseDown={(e) => {
          if (e.button === 0 && !config.isPickerActive) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
          }
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => { setIsDragging(false); setMousePos(p => ({ ...p, show: false })); }}
        onClick={handleClick}
        className={`absolute inset-0 block ${config.isPickerActive ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      />

      {/* DYNAMIC COORDINATES HUD */}
      {mousePos.show && (
        <div 
          className="absolute pointer-events-none z-50 animate-in fade-in zoom-in duration-150"
          style={{ left: mousePos.x + 20, top: mousePos.y + 20 }}
        >
          <div className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-lg px-3 py-2 shadow-2xl flex flex-col gap-1 min-w-[140px]">
            <div className="flex justify-between items-center gap-4">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Trace</span>
              <span className="text-[11px] font-mono font-bold text-white">{mousePos.traceIdx}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Time</span>
              <span className="text-[11px] font-mono font-bold text-white">{(mousePos.sampleIdx * dataset.sampleInterval).toFixed(1)} ms</span>
            </div>
            <div className="flex justify-between items-center gap-4 border-t border-white/5 pt-1 mt-1">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Amp</span>
              <span className={`text-[11px] font-mono font-bold ${mousePos.amp >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                {mousePos.amp.toFixed(6)}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="absolute top-4 left-16 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <div className="flex bg-slate-900/90 backdrop-blur border border-white/10 rounded-xl overflow-hidden p-1 shadow-2xl">
          <ControlButton icon={ZoomIn} onClick={() => setTransform(p => ({ ...p, scaleX: p.scaleX * 1.2, scaleY: p.scaleY * 1.2 }))} title="Zoom In" />
          <ControlButton icon={ZoomOut} onClick={() => setTransform(p => ({ ...p, scaleX: p.scaleX * 0.8, scaleY: p.scaleY * 0.8 }))} title="Zoom Out" />
          <ControlButton icon={Maximize} onClick={resetZoom} title="Reset View" />
          <div className="w-px bg-white/10 mx-1" />
          <ControlButton icon={Download} onClick={exportAsImage} title="Export PNG" />
        </div>
      </div>

      <div className="absolute bottom-16 right-16 bg-black/60 backdrop-blur border border-white/5 rounded-lg px-3 py-1 text-[9px] font-mono text-slate-400 pointer-events-none z-10">
        Z: {transform.scaleX.toFixed(2)}x
      </div>

      {mousePos.show && (
        <>
          <div className="absolute top-0 bottom-[50px] w-px bg-white/20 pointer-events-none" style={{ left: mousePos.x }} />
          <div className="absolute left-[50px] right-[40px] h-px bg-white/20 pointer-events-none" style={{ top: mousePos.y }} />
          {config.isPickerActive && (
             <div className="absolute w-6 h-6 border border-amber-500 rounded-full flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: mousePos.x, top: mousePos.snapY }}>
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
             </div>
          )}
        </>
      )}
    </div>
  );
};

const ControlButton: React.FC<{icon: any, onClick: () => void, title: string}> = ({ icon: Icon, onClick, title }) => (
  <button onClick={onClick} title={title} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition">
    <Icon className="w-4 h-4" />
  </button>
);

export default SeismicCanvas;