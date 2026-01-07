
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { SeismicDataset, ProcessingState, Horizon, HorizonPoint } from '../types';
import { findLocalPeak, calculateAVOCurve } from '../utils/dsp';
import { LineChart, Activity } from 'lucide-react';

interface Props {
  dataset: SeismicDataset;
  config: ProcessingState;
  horizons: Horizon[];
  onAddPoint: (point: HorizonPoint) => void;
}

const SeismicCanvas: React.FC<Props> = ({ dataset, config, horizons, onAddPoint }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0, show: false, snapY: 0, isPeak: false });

  const activeHorizon = useMemo(() => 
    horizons.find(h => h.id === config.activeHorizonId),
    [horizons, config.activeHorizonId]
  );

  const avoData = useMemo(() => 
    calculateAVOCurve(dataset, activeHorizon),
    [dataset, activeHorizon]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = containerRef.current!;
      canvas.width = clientWidth * window.devicePixelRatio;
      canvas.height = clientHeight * window.devicePixelRatio;
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
      render();
    });

    resizeObserver.observe(containerRef.current);

    const render = () => {
      const { traces, numSamples } = dataset;
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, w, h);
      
      const traceWidth = w / traces.length;
      const sampleHeight = h / numSamples;

      // 1. Draw Seismic Data
      if (!config.isWiggle) {
        traces.forEach((trace, i) => {
          const x = i * traceWidth;
          trace.data.forEach((val, j) => {
            if (Math.abs(val) < 0.005) return;
            const y = j * sampleHeight;
            const norm = Math.max(-1, Math.min(1, val * config.gain));
            if (norm > 0) {
              ctx.fillStyle = `rgb(${255}, ${Math.floor(255 - norm * 200)}, ${Math.floor(255 - norm * 200)})`;
            } else {
              ctx.fillStyle = `rgb(${Math.floor(255 + norm * 200)}, ${Math.floor(255 + norm * 200)}, 255)`;
            }
            ctx.fillRect(x, y, traceWidth + 0.5, sampleHeight + 0.5);
          });
        });
      } else {
        traces.forEach((trace, i) => {
          const baseX = (i + 0.5) * traceWidth;
          const ampScale = traceWidth * config.gain * 1.5;
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 0.5;
          ctx.moveTo(baseX + trace.data[0] * ampScale, 0);
          trace.data.forEach((v, j) => ctx.lineTo(baseX + v * ampScale, j * sampleHeight));
          ctx.stroke();
        });
      }

      // 2. Draw Horizons with AVO Highlight
      horizons.forEach(horizon => {
        if (!horizon.isVisible || horizon.points.length === 0) return;
        
        const sortedPoints = [...horizon.points].sort((a, b) => a.traceIndex - b.traceIndex);
        const isActive = config.activeHorizonId === horizon.id;
        
        // Find max amplitude for relative scaling in this horizon
        const maxAbsAmp = Math.max(...sortedPoints.map(p => Math.abs(p.amplitude))) || 1;

        for (let i = 0; i < sortedPoints.length - 1; i++) {
          const p1 = sortedPoints[i];
          const p2 = sortedPoints[i+1];
          const x1 = (p1.traceIndex + 0.5) * traceWidth;
          const y1 = p1.sampleIndex * sampleHeight;
          const x2 = (p2.traceIndex + 0.5) * traceWidth;
          const y2 = p2.sampleIndex * sampleHeight;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          
          if (isActive) {
            // AVO Highlighting: Color depends on normalized amplitude
            const norm = Math.abs(p1.amplitude) / maxAbsAmp;
            // Map 0 -> Background Color, 1 -> Horizon Color
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + norm * 0.7})`;
            ctx.lineWidth = 1.5 + (norm * 2);
            ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = horizon.color;
            ctx.lineWidth = 1.0;
            ctx.setLineDash([4, 2]);
          }
          ctx.stroke();
        }

        if (isActive) {
           sortedPoints.forEach(p => {
             const norm = Math.abs(p.amplitude) / maxAbsAmp;
             ctx.fillStyle = horizon.color;
             ctx.beginPath();
             ctx.arc((p.traceIndex + 0.5) * traceWidth, p.sampleIndex * sampleHeight, 2 + norm * 3, 0, Math.PI * 2);
             ctx.fill();
             
             // Glow effect for high amplitude AVO points
             if (norm > 0.8) {
               ctx.strokeStyle = 'white';
               ctx.lineWidth = 0.5;
               ctx.stroke();
             }
           });
        }
      });

      // 3. Grid Lines
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.font = '7px monospace';
      for (let s = 0; s < numSamples; s += 100) {
        const y = s * sampleHeight;
        ctx.fillRect(0, y, w, 0.5);
        ctx.fillText(`${(s * dataset.sampleInterval).toFixed(0)}ms`, 5, y - 2);
      }
    };

    render();
    return () => resizeObserver.disconnect();
  }, [dataset, config, horizons]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    let snapY = y;
    const traceIdx = Math.floor((x / rect.width) * dataset.traces.length);
    const rawSampleIdx = Math.floor((y / rect.height) * dataset.numSamples);
    
    if (dataset.traces[traceIdx]) {
      const snappedIdx = findLocalPeak(dataset.traces[traceIdx].data, rawSampleIdx, 15);
      snapY = (snappedIdx / dataset.numSamples) * rect.height;
    }
    
    setMousePos({ x, y, show: true, snapY, isPeak: true });
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!config.isPickerActive || !config.activeHorizonId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const traceIdx = Math.floor((x / rect.width) * dataset.traces.length);
    const rawSampleIdx = Math.floor((y / rect.height) * dataset.numSamples);
    
    if (dataset.traces[traceIdx]) {
      const snappedIdx = findLocalPeak(dataset.traces[traceIdx].data, rawSampleIdx, 15);
      onAddPoint({
        traceIndex: traceIdx,
        sampleIndex: snappedIdx,
        timeMs: snappedIdx * dataset.sampleInterval,
        amplitude: dataset.traces[traceIdx].data[snappedIdx]
      });
    }
  };

  const maxOffset = useMemo(() => 
    dataset.traces.length > 0 ? Math.max(...dataset.traces.map(t => t.header.offset)) : 6000,
    [dataset]
  );

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#020617] cursor-crosshair group overflow-hidden">
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 block" 
        onMouseMove={handleMouseMove} 
        onClick={handleClick}
        onMouseLeave={() => setMousePos(p => ({ ...p, show: false }))}
      />
      
      {/* HUD - AVO Mini Chart Overlay */}
      {config.activeHorizonId && activeHorizon && (
        <div className="absolute top-4 right-4 w-48 h-32 bg-black/80 border border-white/10 rounded-2xl p-3 flex flex-col gap-2 backdrop-blur-xl pointer-events-none shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-bold text-slate-500 uppercase flex items-center gap-1"><LineChart className="w-3 h-3 text-blue-500" /> AVO HUD</span>
            <span className="text-[8px] text-blue-400 font-bold">{activeHorizon.name}</span>
          </div>
          <div className="flex-1 relative border-l border-b border-white/5 flex items-end overflow-hidden">
             {avoData?.points.map((p, i) => (
               <div 
                 key={i} 
                 className="absolute w-1 h-1 bg-amber-500 rounded-full" 
                 style={{ 
                   left: `${(p.offset / maxOffset) * 100}%`, 
                   bottom: `${p.normAmplitude * 100}%` 
                 }} 
               />
             ))}
             {avoData?.regression && (
               <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                 <line 
                   x1="0%" 
                   y1={`${(1 - avoData.regression.intercept) * 100}%`} 
                   x2="100%" 
                   y2={`${(1 - (avoData.regression.intercept + avoData.regression.slope * maxOffset)) * 100}%`} 
                   stroke="rgba(255,255,255,0.2)" 
                   strokeWidth="1" 
                 />
               </svg>
             )}
          </div>
          <div className="flex justify-between text-[7px] text-slate-600 font-bold uppercase"><span>Offset</span><span>{avoData?.points.length || 0} Pts</span></div>
        </div>
      )}

      {/* Precision Crosshair UI */}
      {mousePos.show && (
        <>
          <div className="absolute top-0 bottom-0 w-px bg-white/10 pointer-events-none" style={{ left: mousePos.x }} />
          <div className="absolute left-0 right-0 h-px bg-white/10 pointer-events-none" style={{ top: mousePos.y }} />
          {config.isPickerActive && (
            <div 
              className="absolute w-5 h-5 border border-amber-500 rounded-full pointer-events-none flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2" 
              style={{ left: mousePos.x, top: mousePos.snapY }}
            >
              <div className="w-1 h-1 bg-amber-500 rounded-full" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SeismicCanvas;
