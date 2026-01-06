
import { OSPModule } from '../types';

export const MODULE_LIBRARY: OSPModule[] = [
  {
    id: 'read_segy',
    name: 'Read SEGY',
    type: 'IO',
    description: 'Import seismic data from SEGY file.',
    params: {
      file: { label: 'Source File', value: 'data_01.segy', type: 'string' }
    }
  },
  {
    id: 'bandpass',
    name: 'Bandpass Filter',
    type: 'Filter',
    description: 'Apply zero-phase frequency filtering to traces.',
    params: {
      lowCut: { label: 'Low Cut (Hz)', value: 10, type: 'number', min: 0, max: 100 },
      highCut: { label: 'High Cut (Hz)', value: 65, type: 'number', min: 20, max: 200 }
    }
  },
  {
    id: 'tgain',
    name: 'T-Gain Compensation',
    type: 'Signal',
    description: 'Compensate for deep signal attenuation using exponential gain.',
    params: {
      exponent: { label: 'Gain Power (n)', value: 1.5, type: 'number', min: 0, max: 5.0 }
    }
  },
  {
    id: 'agc',
    name: 'AGC',
    type: 'Signal',
    description: 'Automatic Gain Control for amplitude balancing.',
    params: {
      window: { label: 'Window (ms)', value: 400, type: 'number', min: 50, max: 2000 }
    }
  },
  {
    id: 'whitening',
    name: 'Spectral Whitening',
    type: 'Signal',
    description: 'Enhance high frequencies and flatten spectrum.',
    params: {}
  },
  {
    id: 'mixing',
    name: 'Trace Mixing',
    type: 'Imaging',
    description: 'Lateral coherence enhancement by trace summation.',
    params: {
      numTraces: { label: 'Mix Span', value: 3, type: 'number', min: 1, max: 11 }
    }
  },
  {
    id: 'decon',
    name: 'Spiking Decon',
    type: 'Signal',
    description: 'Predictive deconvolution to compress wavelets.',
    params: {
      opLength: { label: 'Operator Length', value: 120, type: 'number', min: 10, max: 500 }
    }
  },
  {
    id: 'v_stack',
    name: 'Velocity Stack',
    type: 'Imaging',
    description: 'NMO correction and trace stacking.',
    params: {
      velocity: { label: 'RMS Velocity', value: 2150, type: 'number', min: 1000, max: 5000 }
    }
  }
];
