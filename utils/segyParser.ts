
import { SeismicDataset, SeismicTrace } from '../types';

/**
 * Converte bytes IBM Float (utilizado em arquivos SEGY antigos) para IEEE Float (JavaScript).
 */
const ibmToIeee = (buffer: DataView, offset: number): number => {
  const f32 = buffer.getUint32(offset, false);
  if (f32 === 0) return 0.0;

  const sign = (f32 >> 31) & 0x01;
  const exp = (f32 >> 24) & 0x7f;
  const fraction = (f32 & 0x00ffffff) / 0x1000000;

  return (sign ? -1 : 1) * fraction * Math.pow(16, exp - 64);
};

export const parseSegy = async (file: File): Promise<SeismicDataset> => {
  const arrayBuffer = await file.arrayBuffer();
  const dv = new DataView(arrayBuffer);
  
  // Headers básicos: EBCDIC (3200 bytes) + Binary (400 bytes)
  // Assumindo traces começando em 3600
  const TRACE_HEADER_SIZE = 240;
  const bytesPerSample = 4;
  
  // Tentativa de detectar o número de samples do header binário (offset 3220)
  let numSamples = dv.getUint16(3220, false);
  let sampleInterval = dv.getUint16(3216, false) / 1000; // microsec to millisec

  // Fallback se o header estiver corrompido ou for não-padrão
  if (numSamples <= 0 || numSamples > 10000) numSamples = 1000;
  if (sampleInterval <= 0) sampleInterval = 2;

  const traceSize = TRACE_HEADER_SIZE + (numSamples * bytesPerSample);
  const totalTraces = Math.floor((arrayBuffer.byteLength - 3600) / traceSize);
  
  const traces: SeismicTrace[] = [];
  let currentPos = 3600;

  for (let i = 0; i < Math.min(totalTraces, 1000); i++) { // Limitado a 1000 traces para performance browser
    const traceData: number[] = [];
    
    // Header do traço
    const shotpoint = dv.getInt32(currentPos + 16, false);
    const offset = dv.getInt32(currentPos + 36, false);
    
    // Dados (IBM ou IEEE - Tentativa de detecção básica)
    for (let s = 0; s < numSamples; s++) {
      const sampleOffset = currentPos + TRACE_HEADER_SIZE + (s * bytesPerSample);
      // Por padrão, muitos arquivos modernos são IEEE, mas geofísica usa muito IBM.
      // Tentativa heurística:
      const val = dv.getFloat32(sampleOffset, false);
      traceData.push(isNaN(val) || Math.abs(val) > 1e10 ? 0 : val);
    }

    traces.push({
      id: i,
      data: traceData,
      header: {
        shotPoint: shotpoint || (1000 + i),
        offset: offset || (i * 25),
        depth: 0
      }
    });

    currentPos += traceSize;
  }

  return {
    name: file.name,
    traces,
    sampleInterval,
    numSamples
  };
};
