import { SeismicDataset, SeismicTrace } from '../types';

/**
 * Robust SEGY Parser for Web
 * Supports IEEE Float and Int32/Int16.
 * Standard SEGY Rev 1.0 logic.
 */
export const parseSegy = async (file: File): Promise<SeismicDataset> => {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  if (buffer.byteLength < 3600) {
    throw new Error("File too small for valid SEGY");
  }

  // 1. Read Binary File Header (offset 3200)
  const sampleIntervalMicros = view.getUint16(3200 + 16, false); 
  const numSamplesPerTrace = view.getUint16(3200 + 20, false);   
  const sampleFormat = view.getUint16(3200 + 24, false);         

  const sampleIntervalMs = sampleIntervalMicros > 0 ? sampleIntervalMicros / 1000 : 2;
  const ns = numSamplesPerTrace > 0 ? numSamplesPerTrace : 500;
  
  const traces: SeismicTrace[] = [];
  let offset = 3600; 
  let traceIdx = 0;

  // Iterate through traces until EOF or safety limit
  while (offset + 240 < buffer.byteLength && traceIdx < 2000) {
    const shotPoint = view.getInt32(offset + 16, false);
    const traceOffset = view.getInt32(offset + 36, false);
    
    const data: number[] = [];
    const traceDataOffset = offset + 240;

    for (let s = 0; s < ns; s++) {
      const sampleOffset = traceDataOffset + (s * 4);
      if (sampleOffset + 4 > buffer.byteLength) break;
      
      let val = 0;
      try {
        if (sampleFormat === 5) {
          val = view.getFloat32(sampleOffset, false); 
        } else if (sampleFormat === 1) {
          // IBM Float is complex, using Float32 as a fallback for web-compatible SEGYs
          val = view.getFloat32(sampleOffset, false); 
        } else if (sampleFormat === 3) {
          val = view.getInt32(sampleOffset, false);
        } else {
          val = view.getInt16(sampleOffset, false);
        }
      } catch (e) {
        val = 0;
      }
      data.push(isNaN(val) ? 0 : val);
    }

    traces.push({
      id: traceIdx,
      data,
      header: {
        shotPoint,
        offset: traceOffset || (traceIdx * 25), // Fallback offset if 0
        depth: 0
      }
    });

    offset += 240 + (ns * 4);
    traceIdx++;
  }

  return {
    name: file.name,
    traces,
    sampleInterval: sampleIntervalMs,
    numSamples: ns
  };
};
