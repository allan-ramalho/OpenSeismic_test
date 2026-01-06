
import React, { useRef, useEffect, useState } from 'react';
import { SeismicDataset, ProcessingState, Horizon, HorizonPoint } from '../types';
import { findLocalPeak } from '../utils/dsp';

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

      // 1. Draw Seismic Data (Density)
      if (!config.isWiggle) {
        traces.forEach((trace, i) => {
          const x = i * traceWidth;
          trace.data.forEach((val, j) => {
            if (Math.abs(val) < 0.005) return;
            const y = j * sampleHeight;
            const norm = Math.max(-1, Math.min(1, val * config.gain));
            // Escala de cor clássica Sísmica: Azul (negativo) -> Branco -> Vermelho (positivo)
            if (norm > 0) {
              ctx.fillStyle = `rgb(${255}, ${Math.floor(255 - norm * 200)}, ${Math.floor(255 - norm * 200)})`;
            } else {
              ctx.fillStyle = `rgb(${Math.floor(255 + norm * 200)}, ${Math.floor(255 + norm * 200)}, 255)`;
            }
            ctx.fillRect(x, y, traceWidth + 0.5, sampleHeight + 0.5);
          });
        });
      } else {
        // Wiggle with variable area
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

      // 2. Draw Horizons
      horizons.forEach(horizon => {
        if (!horizon.isVisible || horizon.points.length === 0) return;
        
        ctx.beginPath();
        ctx.strokeStyle = horizon.color;
        ctx.lineWidth = 2.0;
        ctx.setLineDash([]);
        
        const sortedPoints = [...horizon.points].sort((a, b) => a.traceIndex - b.traceIndex);
        sortedPoints.forEach((p, idx) => {
          const x = (p.traceIndex + 0.5) * traceWidth;
          const y = p.sampleIndex * sampleHeight;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw individual points if zoomed in or active
        if (config.activeHorizonId === horizon.id) {
           sortedPoints.forEach(p => {
             ctx.fillStyle = horizon.color;
             ctx.beginPath();
             ctx.arc((p.traceIndex + 0.5) * traceWidth, p.sampleIndex * sampleHeight, 2, 0, Math.PI * 2);
             ctx.fill();
           });
        }
      });

      // 3. Grid Lines
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '8px monospace';
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

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#020617] cursor-crosshair group">
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 block" 
        onMouseMove={handleMouseMove} 
        onClick={handleClick}
        onMouseLeave={() => setMousePos(p => ({ ...p, show: false }))}
      />
      
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
