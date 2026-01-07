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
  
  // Transformation State for Interactive Pan/Zoom
  const [transform, setTransform] = useState({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0, show: false, snapY: 0 });

  const resetZoom = () => setTransform({ x: 0, y: 0, scaleX: 1, scaleY: 1 });

  const exportAsImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `seismic_section_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { traces, numSamples } = dataset;
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;

    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, w, h);

    // Apply viewport transformation
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scaleX, transform.scaleY);

    const traceWidth = w / traces.length;
    const sampleHeight = h / numSamples;

    // 1. Draw Seismic Data with High Quality
    if (!config.isWiggle) {
      // Density Map
      traces.forEach((trace, i) => {
        const x = i * traceWidth;
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
          // Optimization: Draw larger pixels to avoid sub-pixel gaps
          ctx.fillRect(x, y, traceWidth + 0.5, sampleHeight + 0.5);
        });
      });
    } else {
      // Wiggle Traves
      traces.forEach((trace, i) => {
        const baseX = (i + 0.5) * traceWidth;
        const ampScale = traceWidth * config.gain * 2.0;
        
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 0.5 / transform.scaleX;
        ctx.moveTo(baseX + trace.data[0] * ampScale, 0);
        trace.data.forEach((v, j) => {
          ctx.lineTo(baseX + v * ampScale, j * sampleHeight);
        });
        ctx.stroke();

        // Optional: Area fill for positives
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.moveTo(baseX, 0);
        trace.data.forEach((v, j) => {
          if (v > 0) ctx.lineTo(baseX + v * ampScale, j * sampleHeight);
          else ctx.lineTo(baseX, j * sampleHeight);
        });
        ctx.fill();
      });
    }

    // 2. Draw Horizons
    horizons.forEach(horizon => {
      if (!horizon.isVisible || horizon.points.length === 0) return;
      const points = [...horizon.points].sort((a, b) => a.traceIndex - b.traceIndex);
      const isActive = config.activeHorizonId === horizon.id;

      ctx.beginPath();
      ctx.strokeStyle = horizon.color;
      ctx.lineWidth = isActive ? 3 / Math.max(transform.scaleX, transform.scaleY) : 1 / transform.scaleX;
      if (!isActive) ctx.setLineDash([5, 5]);
      
      points.forEach((p, i) => {
        const px = (p.traceIndex + 0.5) * traceWidth;
        const py = p.sampleIndex * sampleHeight;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      if (isActive) {
        points.forEach(p => {
          ctx.fillStyle = horizon.color;
          ctx.beginPath();
          ctx.arc((p.traceIndex + 0.5) * traceWidth, p.sampleIndex * sampleHeight, 2 / transform.scaleX, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });

    ctx.restore();

    // 3. Grid Lines (Fixed Position HUD)
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '10px JetBrains Mono';
    for (let s = 0; s < numSamples; s += 200) {
      const y = (s * sampleHeight) * transform.scaleY + transform.y;
      if (y > 0 && y < h) {
        ctx.fillRect(0, y, w, 0.5);
        ctx.fillText(`${(s * dataset.sampleInterval).toFixed(0)}ms`, 10, y - 5);
      }
    }
  }, [dataset, config, horizons, transform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = containerRef.current!;
      canvas.width = clientWidth * window.devicePixelRatio;
      canvas.height = clientHeight * window.devicePixelRatio;
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
      render();
    });
    resizeObserver.observe(containerRef.current);
    render();
    return () => resizeObserver.disconnect();
  }, [render]);

  // Event Handlers
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({
      ...prev,
      scaleX: Math.max(0.1, Math.min(20, prev.scaleX * zoomFactor)),
      scaleY: Math.max(0.1, Math.min(20, prev.scaleY * zoomFactor))
    }));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !config.isPickerActive) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isDragging) {
      setTransform(prev => ({
        ...prev,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      }));
    }

    // Picker Logic
    const worldX = (mx - transform.x) / transform.scaleX;
    const worldY = (my - transform.y) / transform.scaleY;
    const traceIdx = Math.floor((worldX / rect.width) * dataset.traces.length);
    const rawSampleIdx = Math.floor((worldY / rect.height) * dataset.numSamples);
    
    let snapY = my;
    if (dataset.traces[traceIdx]) {
      const snappedIdx = findLocalPeak(dataset.traces[traceIdx].data, rawSampleIdx, 20);
      snapY = ((snappedIdx / dataset.numSamples) * rect.height) * transform.scaleY + transform.y;
    }
    setMousePos({ x: mx, y: my, show: true, snapY });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleClick = (e: React.MouseEvent) => {
    if (!config.isPickerActive || !config.activeHorizonId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const worldX = (mx - transform.x) / transform.scaleX;
    const worldY = (my - transform.y) / transform.scaleY;
    
    const traceIdx = Math.floor((worldX / rect.width) * dataset.traces.length);
    const rawSampleIdx = Math.floor((worldY / rect.height) * dataset.numSamples);
    
    if (dataset.traces[traceIdx]) {
      const snappedIdx = findLocalPeak(dataset.traces[traceIdx].data, rawSampleIdx, 20);
      onAddPoint({
        traceIndex: traceIdx,
        sampleIndex: snappedIdx,
        timeMs: snappedIdx * dataset.sampleInterval,
        amplitude: dataset.traces[traceIdx].data[snappedIdx]
      });
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#020617] overflow-hidden group">
      <canvas 
        ref={canvasRef} 
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setIsDragging(false); setMousePos(p => ({ ...p, show: false })); }}
        onClick={handleClick}
        className={`absolute inset-0 block ${config.isPickerActive ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      />

      {/* Interactive Controls Overlay */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex bg-slate-900/90 backdrop-blur border border-white/10 rounded-xl overflow-hidden p-1 shadow-2xl">
          <ControlButton icon={ZoomIn} onClick={() => setTransform(p => ({ ...p, scaleX: p.scaleX * 1.2, scaleY: p.scaleY * 1.2 }))} title="Zoom In" />
          <ControlButton icon={ZoomOut} onClick={() => setTransform(p => ({ ...p, scaleX: p.scaleX * 0.8, scaleY: p.scaleY * 0.8 }))} title="Zoom Out" />
          <ControlButton icon={Maximize} onClick={resetZoom} title="Reset View" />
          <div className="w-px bg-white/10 mx-1" />
          <ControlButton icon={Download} onClick={exportAsImage} title="Export as PNG" />
        </div>
        <div className="bg-slate-900/90 backdrop-blur border border-white/10 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-xl">
           <Move className="w-3 h-3 text-slate-500" />
           <span className="text-[9px] font-bold text-slate-400 uppercase">Drag to Pan / Scroll to Zoom</span>
        </div>
      </div>

      {/* HUD Info */}
      <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur border border-white/5 rounded-lg px-3 py-1 text-[9px] font-mono text-slate-400 pointer-events-none">
        X: {mousePos.x.toFixed(0)} Y: {mousePos.y.toFixed(0)} | Scale: {transform.scaleX.toFixed(2)}x
      </div>

      {/* Crosshair Overlay */}
      {mousePos.show && (
        <>
          <div className="absolute top-0 bottom-0 w-px bg-white/20 pointer-events-none" style={{ left: mousePos.x }} />
          <div className="absolute left-0 right-0 h-px bg-white/20 pointer-events-none" style={{ top: mousePos.y }} />
          {config.isPickerActive && (
             <div className="absolute w-6 h-6 border border-amber-500 rounded-full flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: mousePos.x, top: mousePos.snapY }}>
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full shadow-lg" />
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
