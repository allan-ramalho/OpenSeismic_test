import React, { useRef, useEffect, useState, useMemo } from 'react';
import { SeismicDataset, ProcessingState, Horizon, HorizonPoint } from '../types';
import { findLocalPeak, calculateAVOCurve } from '../utils/dsp';
import { LineChart, Activity, Maximize2, Move, ZoomIn, SearchX, Download, MousePointer2 } from 'lucide-react';

interface Props {
  dataset: SeismicDataset;
  config: ProcessingState;
  horizons: Horizon[];
  onAddPoint: (point: HorizonPoint) => void;
}

const SeismicCanvas: React.FC<Props> = ({ dataset, config, horizons, onAddPoint }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Advanced Visualization State
  const [viewTransform, setViewTransform] = useState({ scaleX: 1.0, scaleY: 1.0, offsetX: 0, offsetY: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0, show: false, traceIdx: 0, sampleIdx: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const AXIS_PAD_LEFT = 75;
  const AXIS_PAD_BOTTOM = 55;
  const COLOR_BAR_WIDTH = 65;

  const maxAbsAmplitude = useMemo(() => {
    let max = 0;
    dataset.traces.slice(0, 100).forEach(t => { 
      t.data.forEach(v => { if (Math.abs(v) > max) max = Math.abs(v); });
    });
    return max || 1;
  }, [dataset]);

  const activeHorizon = useMemo(() => 
    horizons.find(h => h.id === config.activeHorizonId),
    [horizons, config.activeHorizonId]
  );

  const avoData = useMemo(() => 
    calculateAVOCurve(dataset, activeHorizon),
    [dataset, activeHorizon]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
       render(); 
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [dataset, config, horizons, viewTransform]);

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = containerRef.current;
    
    if (canvas.width !== clientWidth * dpr || canvas.height !== clientHeight * dpr) {
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
    }

    const w = canvas.width;
    const h = canvas.height;
    const plotW = w - (AXIS_PAD_LEFT + COLOR_BAR_WIDTH) * dpr;
    const plotH = h - AXIS_PAD_BOTTOM * dpr;
    
    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Data clipping area
    ctx.save();
    ctx.beginPath();
    ctx.rect(AXIS_PAD_LEFT * dpr, 0, plotW, plotH);
    ctx.clip();

    ctx.fillStyle = '#020617';
    ctx.fillRect(AXIS_PAD_LEFT * dpr, 0, plotW, plotH);

    const { traces, numSamples } = dataset;
    const traceCount = traces.length;

    // View calc
    const drawTraceCount = traceCount / viewTransform.scaleX;
    const drawSampleCount = numSamples / viewTransform.scaleY;
    const startTrace = -viewTransform.offsetX * (traceCount / plotW);
    const startSample = -viewTransform.offsetY * (numSamples / plotH);

    const getRdBu = (val: number) => {
      const norm = Math.max(-1, Math.min(1, (val / maxAbsAmplitude) * config.gain));
      let r, g, b;
      if (norm > 0) {
        r = 180 + 75 * norm;
        g = 255 * (1 - norm * 0.9);
        b = 255 * (1 - norm * 0.9);
      } else {
        const n = Math.abs(norm);
        r = 255 * (1 - n * 0.9);
        g = 255 * (1 - n * 0.9);
        b = 180 + 75 * n;
      }
      return [r, g, b];
    };

    if (!config.isWiggle) {
      const imgData = ctx.createImageData(Math.floor(plotW), Math.floor(plotH));
      const pixelData = imgData.data;

      for (let py = 0; py < Math.floor(plotH); py++) {
        const sampleIdx = Math.floor(startSample + (py / plotH) * drawSampleCount);
        if (sampleIdx < 0 || sampleIdx >= numSamples) continue;
        
        for (let px = 0; px < Math.floor(plotW); px++) {
          const traceIdx = Math.floor(startTrace + (px / plotW) * drawTraceCount);
          if (traceIdx < 0 || traceIdx >= traceCount) continue;

          const val = traces[traceIdx]?.data[sampleIdx] || 0;
          const [r, g, b] = getRdBu(val);
          const idx = (py * Math.floor(plotW) + px) * 4;
          pixelData[idx] = r;
          pixelData[idx+1] = g;
          pixelData[idx+2] = b;
          pixelData[idx+3] = 255;
        }
      }
      ctx.putImageData(imgData, AXIS_PAD_LEFT * dpr, 0);
    } else {
      const traceWidth = plotW / drawTraceCount;
      const sampleHeight = plotH / drawSampleCount;
      ctx.lineWidth = 0.5 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      
      const tStep = Math.max(1, Math.floor(drawTraceCount / 120));
      for (let i = Math.floor(Math.max(0, startTrace)); i < Math.min(traceCount, Math.ceil(startTrace + drawTraceCount)); i += tStep) {
        const baseX = AXIS_PAD_LEFT * dpr + (i - startTrace + 0.5) * traceWidth;
        const ampScale = traceWidth * config.gain * 2.2;
        ctx.beginPath();
        ctx.moveTo(baseX + (traces[i].data[Math.floor(Math.max(0, startSample))] || 0) * ampScale, 0);
        for (let s = Math.floor(Math.max(0, startSample)); s < Math.min(numSamples, Math.ceil(startSample + drawSampleCount)); s += 4) {
          ctx.lineTo(baseX + (traces[i].data[s] || 0) * ampScale, (s - startSample) * sampleHeight);
        }
        ctx.stroke();
      }
    }

    horizons.forEach(horizon => {
      if (!horizon.isVisible || horizon.points.length === 0) return;
      const isActive = config.activeHorizonId === horizon.id;
      ctx.beginPath();
      ctx.strokeStyle = horizon.color;
      ctx.lineWidth = (isActive ? 3 : 1) * dpr;
      ctx.setLineDash(isActive ? [] : [4 * dpr, 4 * dpr]);
      
      horizon.points.forEach((p, idx) => {
        const x = AXIS_PAD_LEFT * dpr + ((p.traceIndex - startTrace) / drawTraceCount) * plotW;
        const y = ((p.sampleIndex - startSample) / drawSampleCount) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    ctx.restore(); 

    // Axis Rendering
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `${Math.floor(10 * dpr)}px JetBrains Mono, monospace`;
    
    ctx.textAlign = 'right';
    const sStep = Math.pow(10, Math.floor(Math.log10(100 / viewTransform.scaleY))) * 10;
    for (let s = 0; s < numSamples; s += sStep) {
      const y = ((s - startSample) / drawSampleCount) * plotH;
      if (y < 0 || y > plotH) continue;
      ctx.fillText(`${(s * dataset.sampleInterval).toFixed(0)}`, (AXIS_PAD_LEFT - 10) * dpr, y + 4 * dpr);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(AXIS_PAD_LEFT * dpr, y, plotW, 1 * dpr);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
    }

    ctx.textAlign = 'center';
    const tStepX = Math.pow(10, Math.floor(Math.log10(traceCount / 8 / viewTransform.scaleX))) * 5;
    for (let t = 0; t < traceCount; t += Math.max(10, tStepX)) {
      const x = AXIS_PAD_LEFT * dpr + ((t - startTrace) / drawTraceCount) * plotW;
      if (x < AXIS_PAD_LEFT * dpr || x > (AXIS_PAD_LEFT * dpr + plotW)) continue;
      ctx.fillText(`${t}`, x, plotH + 15 * dpr);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, 0, 1 * dpr, plotH);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
    }

    ctx.save();
    ctx.translate(20 * dpr, plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `bold ${Math.floor(12 * dpr)}px JetBrains Mono`;
    ctx.fillText("Time (ms)", 0, 0);
    ctx.restore();
    ctx.font = `bold ${Math.floor(12 * dpr)}px JetBrains Mono`;
    ctx.fillText("Trace No", AXIS_PAD_LEFT * dpr + plotW / 2, plotH + 40 * dpr);

    const cbX = w - (COLOR_BAR_WIDTH - 15) * dpr;
    const cbH = plotH * 0.7;
    const cbY = (plotH - cbH) / 2;
    const cbGradient = ctx.createLinearGradient(0, cbY + cbH, 0, cbY);
    cbGradient.addColorStop(0, '#0000ff'); 
    cbGradient.addColorStop(0.5, '#ffffff'); 
    cbGradient.addColorStop(1, '#ff0000');
    ctx.fillStyle = cbGradient;
    ctx.fillRect(cbX, cbY, 15 * dpr, cbH);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'left';
    ctx.font = `${Math.floor(10 * dpr)}px monospace`;
    ctx.fillText(`${maxAbsAmplitude.toFixed(1)}`, cbX + 20 * dpr, cbY + 5 * dpr);
    ctx.fillText(`0.0`, cbX + 20 * dpr, cbY + cbH / 2 + 3 * dpr);
    ctx.fillText(`-${maxAbsAmplitude.toFixed(1)}`, cbX + 20 * dpr, cbY + cbH);
    ctx.save();
    ctx.translate(cbX + 50 * dpr, cbY + cbH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText("Amplitude", 0, 0);
    ctx.restore();
  };

  useEffect(() => { render(); }, [dataset, config, horizons, viewTransform]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomIntensity = 0.12;
    const delta = e.deltaY > 0 ? -1 : 1;
    const zoomFactor = 1 + delta * zoomIntensity;
    
    setViewTransform(prev => ({
      ...prev,
      scaleX: Math.min(50, Math.max(1, prev.scaleX * zoomFactor)),
      scaleY: Math.min(50, Math.max(1, prev.scaleY * zoomFactor))
    }));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (config.isPickerActive && e.button === 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setViewTransform(prev => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy
      }));
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const plotWidth = rect.width - (AXIS_PAD_LEFT + COLOR_BAR_WIDTH);
    const plotHeight = rect.height - AXIS_PAD_BOTTOM;
    
    const normX = (x - AXIS_PAD_LEFT) / plotWidth;
    const normY = y / plotHeight;
    
    const traceCount = dataset.traces.length;
    const sampleCount = dataset.numSamples;

    const dpr = window.devicePixelRatio || 1;
    const startTrace = -viewTransform.offsetX * (traceCount / (plotWidth * dpr));
    const startSample = -viewTransform.offsetY * (sampleCount / (plotHeight * dpr));
    const drawTraceCount = traceCount / viewTransform.scaleX;
    const drawSampleCount = sampleCount / viewTransform.scaleY;

    const traceIdx = Math.floor(startTrace + normX * drawTraceCount);
    const sampleIdx = Math.floor(startSample + normY * drawSampleCount);

    if (traceIdx >= 0 && traceIdx < traceCount && sampleIdx >= 0 && sampleIdx < sampleCount) {
      setMousePos({ x, y, show: true, traceIdx, sampleIdx });
    } else {
      setMousePos(p => ({ ...p, show: false }));
    }
  };

  const handleMouseUp = () => setIsPanning(false);

  const handleClick = (e: React.MouseEvent) => {
    if (!config.isPickerActive || !config.activeHorizonId || !mousePos.show) return;
    const trace = dataset.traces[mousePos.traceIdx];
    if (!trace) return;
    const snappedIdx = findLocalPeak(trace.data, mousePos.sampleIdx, 12);
    onAddPoint({
      traceIndex: mousePos.traceIdx,
      sampleIndex: snappedIdx,
      timeMs: snappedIdx * dataset.sampleInterval,
      amplitude: trace.data[snappedIdx]
    });
  };

  const resetView = () => setViewTransform({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });

  const exportImage = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `OSP_Section_${Date.now()}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  const datasetMaxOffset = useMemo(() => {
    if (dataset.traces.length === 0) return 6000;
    return Math.max(...dataset.traces.map(t => t.header.offset)) || 1;
  }, [dataset]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#020617] cursor-crosshair overflow-hidden group select-none">
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 block" 
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onClick={handleClick}
        onDoubleClick={resetView}
      />

      {/* Interactive Toolbar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 p-1.5 bg-black/70 border border-white/10 rounded-2xl backdrop-blur-xl opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-2xl">
         <button onClick={resetView} className="p-2 hover:bg-white/10 rounded-xl text-slate-400" title="Autoscale"><Maximize2 className="w-4 h-4" /></button>
         <button onClick={() => setViewTransform(p => ({...p, scaleX: p.scaleX * 1.25, scaleY: p.scaleY * 1.25}))} className="p-2 hover:bg-white/10 rounded-xl text-slate-400" title="Zoom In"><ZoomIn className="w-4 h-4" /></button>
         <button onClick={() => setViewTransform(p => ({...p, scaleX: p.scaleX / 1.25, scaleY: p.scaleY / 1.25}))} className="p-2 hover:bg-white/10 rounded-xl text-slate-400" title="Zoom Out"><SearchX className="w-4 h-4" /></button>
         <button onClick={exportImage} className="p-2 hover:bg-white/10 rounded-xl text-slate-400" title="Download Image"><Download className="w-4 h-4" /></button>
         <div className="w-px h-5 bg-white/10 mx-1" />
         <div className="px-3 py-1 text-[9px] font-black text-blue-400 uppercase tracking-widest">{viewTransform.scaleX.toFixed(1)}X</div>
      </div>
      
      {mousePos.show && (
        <div 
          className="absolute bg-black/90 border border-white/10 rounded-xl p-3 shadow-2xl pointer-events-none text-[10px] font-mono z-50 flex flex-col gap-1 min-w-[125px] backdrop-blur-md"
          style={{ left: mousePos.x + 15, top: mousePos.y + 15 }}
        >
          <div className="flex justify-between border-b border-white/5 pb-1 mb-1">
            <span className="text-slate-500 uppercase">Trace</span>
            <span className="text-blue-400 font-bold">{mousePos.traceIdx}</span>
          </div>
          <div className="flex justify-between border-b border-white/5 pb-1 mb-1">
            <span className="text-slate-500 uppercase">Time</span>
            <span className="text-emerald-400 font-bold">{(mousePos.sampleIdx * dataset.sampleInterval).toFixed(0)} ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 uppercase">Amp</span>
            <span className="text-amber-400 font-bold">{dataset.traces[mousePos.traceIdx]?.data[mousePos.sampleIdx]?.toFixed(4)}</span>
          </div>
        </div>
      )}

      {config.activeHorizonId && activeHorizon && avoData && (
        <div className="absolute top-4 right-4 w-56 h-40 bg-slate-900/90 border border-white/10 rounded-2xl p-4 backdrop-blur-2xl shadow-2xl animate-in zoom-in duration-300 pointer-events-none">
           <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><LineChart className="w-3.5 h-3.5 text-blue-500" /> AVO Analysis</span>
             <span className="text-[9px] text-white font-bold truncate max-w-[90px]">{activeHorizon.name}</span>
           </div>
           
           <div className="flex-1 relative h-20 border-l border-b border-white/10 flex items-end mb-2">
              {avoData.regression && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                  <line 
                    x1="0%" 
                    y1={`${(1 - avoData.regression.intercept) * 100}%`} 
                    x2="100%" 
                    y2={`${(1 - (avoData.regression.intercept + avoData.regression.slope * datasetMaxOffset)) * 100}%`} 
                    stroke="rgba(255,255,255,0.3)" 
                    strokeWidth="1.5" 
                    strokeDasharray="4 2"
                  />
                </svg>
              )}
              {avoData.points.map((p, i) => (
                <div 
                  key={i} 
                  className="absolute w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)]" 
                  style={{ 
                    left: `${(p.offset / datasetMaxOffset) * 100}%`, 
                    bottom: `${p.normAmplitude * 100}%` 
                  }} 
                />
              ))}
           </div>
           
           <div className="flex justify-between items-center text-[8px] font-black text-slate-500 uppercase tracking-tighter">
             <div className="flex gap-2">
               <span>P: {avoData.regression.intercept.toFixed(3)}</span>
               <span>G: {avoData.regression.slope.toFixed(4)}</span>
             </div>
             <span className="text-white bg-blue-600/20 px-1.5 py-0.5 rounded">{avoData.points.length} Pts</span>
           </div>
        </div>
      )}

      {mousePos.show && (
        <>
          <div className="absolute bg-white/15 pointer-events-none" style={{ left: mousePos.x, top: 0, bottom: AXIS_PAD_BOTTOM, width: 1 }} />
          <div className="absolute bg-white/15 pointer-events-none" style={{ top: mousePos.y, left: AXIS_PAD_LEFT, right: COLOR_BAR_WIDTH, height: 1 }} />
          {config.isPickerActive && (
            <div 
              className="absolute w-8 h-8 border-2 border-amber-500 rounded-full pointer-events-none flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 shadow-[0_0_20px_rgba(245,158,11,0.6)]" 
              style={{ left: mousePos.x, top: mousePos.y }}
            >
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SeismicCanvas;