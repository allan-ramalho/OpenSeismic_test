import { Horizon } from '../types';

export const exportHorizonData = (horizon: Horizon, format: 'csv' | 'json' | 'dat') => {
  let content = '';
  let filename = `${horizon.name}.${format}`;
  let mimeType = 'text/plain';

  switch (format) {
    case 'json':
      content = JSON.stringify(horizon, null, 2);
      mimeType = 'application/json';
      break;
    case 'csv':
      content = 'TraceIndex,SampleIndex,TimeMs,Amplitude\n';
      content += horizon.points
        .map(p => `${p.traceIndex},${p.sampleIndex},${p.timeMs},${p.amplitude}`)
        .join('\n');
      mimeType = 'text/csv';
      break;
    case 'dat':
      // Generic DAT format: Trace Sample Time Amplitude
      content = horizon.points
        .map(p => `${p.traceIndex}\t${p.sampleIndex}\t${p.timeMs.toFixed(2)}\t${p.amplitude.toFixed(6)}`)
        .join('\n');
      break;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
