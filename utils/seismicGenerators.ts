
import { SeismicDataset, SeismicTrace } from '../types';

export const generateSyntheticSeismic = (numTraces: number = 100, numSamples: number = 500): SeismicDataset => {
  const traces: SeismicTrace[] = [];
  
  // Synthetic reflectors (depths in samples)
  const reflectors = [100, 220, 350, 420];
  const velocities = [1500, 1800, 2200, 2800];

  for (let i = 0; i < numTraces; i++) {
    const data = new Array(numSamples).fill(0);
    const offset = i * 25; // meters

    reflectors.forEach((depth, idx) => {
      // Hyperbolic moveout approximation: t^2 = t0^2 + x^2/v^2
      const t0 = depth;
      const t = Math.sqrt(t0 * t0 + (offset * offset) / (velocities[idx] / 10));
      const targetIdx = Math.round(t);

      if (targetIdx < numSamples) {
        // Wavelet: Ricker-like
        for (let j = -10; j <= 10; j++) {
          const idx_j = targetIdx + j;
          if (idx_j >= 0 && idx_j < numSamples) {
            const val = (1 - 2 * Math.pow(Math.PI * j * 0.2, 2)) * Math.exp(-Math.pow(Math.PI * j * 0.2, 2));
            data[idx_j] += val * (0.5 + Math.random() * 0.2);
          }
        }
      }
    });

    // Add noise
    for (let s = 0; s < numSamples; s++) {
      data[s] += (Math.random() - 0.5) * 0.1;
    }

    traces.push({
      id: i,
      data,
      header: {
        shotPoint: 1000 + i,
        offset: offset,
        depth: 0,
      }
    });
  }

  return {
    name: "Demo_Line_001.segy",
    traces,
    sampleInterval: 2,
    numSamples
  };
};
