import { SeismicTrace, HorizonPoint, SeismicDataset } from '../types';

const hamming = (n: number, N: number) => 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1));

export const applyTGain = (trace: number[], exponent: number): number[] => {
  return trace.map((v, i) => v * Math.pow(1 + i * 0.001, exponent));
};

export const findLocalPeak = (data: number[], centerIdx: number, radius: number = 10): number => {
  let maxAbs = -1;
  let peakIdx = centerIdx;
  const start = Math.max(0, centerIdx - radius);
  const end = Math.min(data.length - 1, centerIdx + radius);
  
  for (let i = start; i <= end; i++) {
    const absVal = Math.abs(data[i]);
    if (absVal > maxAbs) {
      maxAbs = absVal;
      peakIdx = i;
    }
  }
  return peakIdx;
};

export const calculateAverageSpectrum = (traces: SeismicTrace[]): number[] => {
  if (traces.length === 0) return [];
  const n = traces[0].data.length;
  const specLen = 64; 
  const avgSpectrum = new Array(specLen).fill(0);
  
  const step = Math.max(1, Math.floor(traces.length / 20));
  let count = 0;

  for (let i = 0; i < traces.length; i += step) {
    const trace = traces[i].data;
    for (let f = 0; f < specLen; f++) {
      let re = 0; let im = 0;
      for (let t = 0; t < Math.min(n, 256); t += 2) {
        const angle = (2 * Math.PI * f * t) / specLen;
        re += trace[t] * Math.cos(angle);
        im -= trace[t] * Math.sin(angle);
      }
      avgSpectrum[f] += Math.sqrt(re*re + im*im);
    }
    count++;
  }
  
  const max = Math.max(...avgSpectrum);
  return avgSpectrum.map(v => (v / (max || 1)) * 100);
};

export const calculateAVOCurve = (dataset: SeismicDataset | null, horizon: any) => {
  if (!dataset || !horizon || horizon.points.length < 2) return null;
  
  const points = horizon.points.map((p: any) => {
    const trace = dataset.traces[p.traceIndex];
    if (!trace) return null;
    return {
      offset: trace.header.offset,
      amplitude: Math.abs(p.amplitude),
      traceIndex: p.traceIndex
    };
  }).filter(Boolean).sort((a: any, b: any) => a.offset - b.offset);

  if (points.length === 0) return null;

  const maxAmp = Math.max(...points.map((p: any) => p.amplitude));
  return points.map((p: any) => ({
    ...p,
    normAmplitude: p.amplitude / (maxAmp || 1)
  }));
};

export const autoTrackHorizon = (
  seed: HorizonPoint, 
  traces: SeismicTrace[], 
  searchWindow: number = 12,
  maxTraces: number = 100
): HorizonPoint[] => {
  const points: HorizonPoint[] = [seed];
  const directions = [-1, 1];
  
  directions.forEach(dir => {
    let currentSample = seed.sampleIndex;
    let currentAmp = Math.abs(seed.amplitude);
    let count = 0;
    
    for (let i = seed.traceIndex + dir; i >= 0 && i < traces.length && count < maxTraces; i += dir) {
      const traceData = traces[i].data;
      const nextSample = findLocalPeak(traceData, currentSample, searchWindow);
      const nextAmp = Math.abs(traceData[nextSample]);
      
      if (nextAmp < currentAmp * 0.1 || nextAmp > currentAmp * 5.0) break;
      
      points.push({
        traceIndex: i,
        sampleIndex: nextSample,
        timeMs: nextSample * 2,
        amplitude: traceData[nextSample]
      });
      currentSample = nextSample;
      currentAmp = nextAmp;
      count++;
    }
  });
  
  return points;
};

export const applyAGC = (trace: number[], windowSamples: number): number[] => {
  if (windowSamples <= 0) return [...trace];
  const n = trace.length;
  const out = new Array(n).fill(0);
  const halfWin = Math.floor(windowSamples / 2);
  for (let i = 0; i < n; i++) {
    let energy = 0; let count = 0;
    for (let j = Math.max(0, i - halfWin); j < Math.min(n, i + halfWin); j++) {
      energy += trace[j] * trace[j];
      count++;
    }
    const rms = Math.sqrt(energy / (count || 1));
    out[i] = rms > 1e-6 ? trace[i] / (rms * 2) : trace[i];
  }
  return out;
};

export const applyBandpass = (trace: number[], lowCut: number, highCut: number, sampleRateHz: number): number[] => {
  if (lowCut <= 0 && highCut >= sampleRateHz / 2) return [...trace];
  const order = 31;
  const kernel = new Array(order).fill(0);
  const mid = Math.floor(order / 2);
  const fL = lowCut / sampleRateHz;
  const fH = highCut / sampleRateHz;
  for (let i = 0; i < order; i++) {
    const n = i - mid;
    if (n === 0) kernel[i] = 2 * (fH - fL);
    else kernel[i] = (Math.sin(2 * Math.PI * fH * n) - Math.sin(2 * Math.PI * fL * n)) / (Math.PI * n);
    kernel[i] *= hamming(i, order);
  }
  const res = new Array(trace.length).fill(0);
  for (let i = 0; i < trace.length; i++) {
    for (let j = 0; j < order; j++) {
      const idx = i - j + mid;
      if (idx >= 0 && idx < trace.length) res[i] += trace[idx] * kernel[j];
    }
  }
  return res;
};

export const applyMixing = (traces: SeismicTrace[], numTraces: number): SeismicTrace[] => {
  if (numTraces <= 1) return traces;
  const result = JSON.parse(JSON.stringify(traces));
  const half = Math.floor(numTraces / 2);
  for (let i = 0; i < traces.length; i++) {
    const n = traces[i].data.length;
    const mixed = new Array(n).fill(0);
    let totalWeight = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < traces.length) {
        for (let s = 0; s < n; s++) mixed[s] += traces[j].data[s];
        totalWeight++;
      }
    }
    for (let s = 0; s < n; s++) result[i].data[s] = mixed[s] / (totalWeight || 1);
  }
  return result;
};

export const applyWhitening = (trace: number[]): number[] => {
    const n = trace.length;
    const out = new Array(n).fill(0);
    const winSize = 100;
    for (let i = 0; i < n; i++) {
        let energy = 0;
        let count = 0;
        for (let j = Math.max(0, i - winSize/2); j < Math.min(n, i + winSize/2); j++) {
            energy += Math.abs(trace[j]);
            count++;
        }
        const avg = energy / (count || 1);
        out[i] = avg > 0.001 ? (trace[i] / avg) * 0.1 : trace[i];
    }
    return out;
};

export const applyDecon = (trace: number[], opLength: number): number[] => {
    const out = [...trace];
    const n = trace.length;
    for (let i = 1; i < n; i++) {
        out[i] = trace[i] - 0.9 * trace[i-1];
    }
    return out;
};

export const applyStack = (traces: SeismicTrace[], velocity: number, sampleInterval: number): SeismicTrace[] => {
    if (traces.length === 0) return traces;
    const numSamples = traces[0].data.length;
    const stackedData = new Array(numSamples).fill(0);
    
    traces.forEach(trace => {
        const offset = trace.header.offset;
        for (let s = 0; s < numSamples; s++) {
            const t0 = s * sampleInterval;
            const t_nmo = Math.sqrt(t0 * t0 + (offset * offset) / (velocity * velocity));
            const s_nmo = Math.round(t_nmo / sampleInterval);
            if (s_nmo < numSamples) {
                stackedData[s] += trace.data[s_nmo];
            }
        }
    });

    return traces.map(t => ({...t, data: stackedData.map(v => v / traces.length)}));
};