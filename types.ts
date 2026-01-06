
export interface SeismicTrace {
  id: number;
  data: number[];
  header: {
    shotPoint: number;
    offset: number;
    depth: number;
  };
}

export interface SeismicDataset {
  name: string;
  traces: SeismicTrace[];
  sampleInterval: number;
  numSamples: number;
}

export type ModuleType = 'IO' | 'Filter' | 'Signal' | 'Imaging' | 'Interpretation';

export interface ModuleParam {
  label: string;
  value: number | string | boolean;
  type: 'number' | 'string' | 'toggle';
  min?: number;
  max?: number;
}

export interface OSPModule {
  id: string;
  name: string;
  type: ModuleType;
  description: string;
  params: Record<string, ModuleParam>;
}

export interface ActiveModule extends OSPModule {
  instanceId: string;
}

export interface HorizonPoint {
  traceIndex: number;
  sampleIndex: number;
  timeMs: number;
  amplitude: number;
}

export interface Horizon {
  id: string;
  name: string;
  color: string;
  points: HorizonPoint[];
  isVisible: boolean;
}

export type WorkspaceTab = 'section' | 'map' | 'spectral' | 'avo';

export interface ProcessingState {
  gain: number;
  isWiggle: boolean;
  lowCut: number;
  highCut: number;
  agcWindow: number;
  isPickerActive: boolean;
  activeHorizonId: string | null;
  activeTab: WorkspaceTab;
  isAutoTrackEnabled: boolean;
  selectedTraceIndex: number | null;
  showWell: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
