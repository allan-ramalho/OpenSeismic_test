import { OSPModule } from '../types';

export const MODULE_LIBRARY: OSPModule[] = [
  {
    id: 'bandpass',
    name: 'Bandpass Filter',
    type: 'Filter',
    description: 'Apply frequency filtering to traces.',
    params: {
      lowCut: { label: 'Low Cut (Hz)', value: 12, type: 'number', min: 0, max: 100 },
      highCut: { label: 'High Cut (Hz)', value: 70, type: 'number', min: 20, max: 250 }
    }
  },
  {
    id: 'tgain',
    name: 'T-Gain Compensation',
    type: 'Signal',
    description: 'Deep signal attenuation compensation.',
    params: {
      exponent: { label: 'Gain Power (n)', value: 1.8, type: 'number', min: 0, max: 5.0 }
    }
  },
  {
    id: 'agc',
    name: 'AGC',
    type: 'Signal',
    description: 'Automatic Gain Control balancing.',
    params: {
      window: { label: 'Window (ms)', value: 500, type: 'number', min: 50, max: 2000 }
    }
  },
  {
    id: 'whitening',
    name: 'Spectral Whitening',
    type: 'Signal',
    description: 'Enhance high frequencies.',
    params: {}
  },
  {
    id: 'mixing',
    name: 'Trace Mixing',
    type: 'Imaging',
    description: 'Lateral coherence enhancement.',
    params: {
      numTraces: { label: 'Mix Span', value: 3, type: 'number', min: 1, max: 11 }
    }
  },
  {
    id: 'decon',
    name: 'Spiking Decon',
    type: 'Signal',
    description: 'Wavelet compression.',
    params: {
      opLength: { label: 'Operator Length', value: 100, type: 'number', min: 10, max: 500 }
    }
  },
  {
    id: 'nmo_corr',
    name: 'NMO Correction',
    type: 'Imaging',
    description: 'Normal Moveout correction.',
    params: {
      velocity: { label: 'Vrms (m/s)', value: 2200, type: 'number', min: 500, max: 6000 },
      stretchLimit: { label: 'Stretch Mute %', value: 0.8, type: 'number', min: 0.1, max: 3.0 }
    }
  },
  {
    id: 'v_stack',
    name: 'Velocity Stack',
    type: 'Imaging',
    description: 'NMO correction and trace stacking.',
    params: {
      velocity: { label: 'RMS Velocity', value: 2400, type: 'number', min: 1000, max: 6000 }
    }
  },
  {
    id: 'inversion',
    name: 'Recursive Inversion',
    type: 'Interpretation',
    description: 'Convert seismic to Acoustic Impedance.',
    params: {
      initialImpedance: { label: 'Bg Impedance', value: 3500, type: 'number', min: 1000, max: 12000 }
    }
  }
];
