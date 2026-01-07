import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Plus, Zap, ChevronRight, Settings2, Activity, 
  MessageSquare, Terminal, Trash2, Download, BarChart3, 
  Waves, MousePointer2, Eye, EyeOff, Target, LassoSelect, ShieldCheck, 
  LayoutDashboard, Map as MapIcon, LineChart, AudioLines, Search, Beaker, Database, AlertCircle, RotateCcw,
  Settings, Layers, Play, Save, ChevronUp, ChevronDown, X, Folder, FileJson, Edit2, Check, Sliders,
  Binary, FileUp, Loader2, Info, Maximize2, Minus, PlusSquare, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen
} from 'lucide-react';
import SeismicCanvas from './components/SeismicCanvas';
import ChatPanel from './components/ChatPanel';
import { MODULE_LIBRARY } from './utils/ospModules';
import { generateSyntheticSeismic } from './utils/seismicGenerators';
import { parseSegy } from './utils/segyParser';
import { SeismicDataset, ActiveModule, OSPModule, ProcessingState, SeismicTrace, Horizon, HorizonPoint, WorkspaceTab, ModuleParam, TreeItem } from './types';
import { applyAGC, applyBandpass, applyMixing, applyTGain, calculateAverageSpectrum, calculateAVOCurve, applyWhitening, applyDecon, applyStack, applyInversion, applyNMO, calculateSemblance } from './utils/dsp';

const STORAGE_KEY = 'OSP_PRO_ULTIMATE_V18_STABLE';

const App: React.FC = () => {
  const [flow, setFlow] = useState<ActiveModule[]>([]);
  const [rawDataset, setRawDataset] = useState<SeismicDataset | null>(null);
  const [processedDataset, setProcessedDataset] = useState<SeismicDataset | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [logs, setLogs] = useState<string[]>(["[KERNEL] OSP Suite v18.0 - SYSTEMS ONLINE"]);
  const [horizons, setHorizons] = useState<Horizon[]>([]);
  const [editingHorizonId, setEditingHorizonId] = useState<string | null>(null);
  const [tempHorizonName, setTempHorizonName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [panels, setPanels] = useState({
    left: true,
    right: true,
    navigator: true,
    display: true,
    library: true,
    stack: true,
    interpretation: true,
    kernel: true
  });

  const togglePanel = (key: keyof typeof panels) => setPanels(prev => ({ ...prev, [key]: !prev[key] }));

  const isInitialMount = useRef(true);

  const [displayConfig, setDisplayConfig] = useState<ProcessingState>({
    gain: 6.0,
    isWiggle: false,
    lowCut: 0,
    highCut: 0,
    agcWindow: 0,
    isPickerActive: false,
    activeHorizonId: null,
    activeTab: 'section',
    isAutoTrackEnabled: false,
    selectedTraceIndex: null,
    showWell: true
  });

  const projectTree = useMemo((): TreeItem[] => [
    {
      id: 'f-data', label: 'Surveys & Data', type: 'folder', isOpen: true,
      children: [
        { id: 'ds-1', label: rawDataset?.name || 'No Dataset Loaded', type: 'dataset' }
      ]
    },
    {
      id: 'f-interp', label: 'Interpretations', type: 'folder', isOpen: true,
      children: horizons.map(h => ({ id: h.id, label: h.name, type: 'horizon', color: h.color }))
    }
  ], [horizons, rawDataset]);

  const datasetMaxOffset = useMemo(() => {
    if (!processedDataset || processedDataset.traces.length === 0) return 6000;
    const offsets = processedDataset.traces.map(t => t.header.offset);
    return Math.max(...offsets) || 1;
  }, [processedDataset]);

  const avoResult = useMemo(() => {
    const activeH = horizons.find(h => h.id === displayConfig.activeHorizonId);
    return calculateAVOCurve(processedDataset, activeH);
  }, [horizons, displayConfig.activeHorizonId, processedDataset]);

  const averageSpectrum = useMemo(() => {
    if (!processedDataset) return null;
    return calculateAverageSpectrum(processedDataset.traces);
  }, [processedDataset]);

  useEffect(() => {
    const initial = generateSyntheticSeismic(250, 800);
    setRawDataset(initial);
    setProcessedDataset(initial);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setHorizons(data.horizons || []);
        setFlow(data.flow || []);
        setDisplayConfig(prev => ({ ...prev, activeHorizonId: data.activeId || (data.horizons?.[0]?.id || null) }));
      } catch(e) { console.error("Load failed", e); }
    } else {
      const defaultH = { id: 'h1', name: 'Reflector_Main', color: '#3b82f6', points: [], isVisible: true };
      setHorizons([defaultH]);
      setDisplayConfig(prev => ({ ...prev, activeHorizonId: 'h1' }));
    }
    isInitialMount.current = false;
  }, []);

  useEffect(() => {
    if (!isInitialMount.current) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ horizons, flow, activeId: displayConfig.activeHorizonId }));
    }
  }, [horizons, flow, displayConfig.activeHorizonId]);

  const addLog = (msg: string) => setLogs(p => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...p.slice(0, 15)]);

  const addHorizonPoint = useCallback((point: HorizonPoint) => {
    if (!displayConfig.activeHorizonId) return;
    setHorizons(prev => prev.map(h => {
      if (h.id === displayConfig.activeHorizonId) {
        const existingIdx = h.points.findIndex(p => p.traceIndex === point.traceIndex);
        const newPoints = [...h.points];
        if (existingIdx >= 0) {
          newPoints[existingIdx] = point;
        } else {
          newPoints.push(point);
          newPoints.sort((a, b) => a.traceIndex - b.traceIndex);
        }
        return { ...h, points: newPoints };
      }
      return h;
    }));
  }, [displayConfig.activeHorizonId]);

  const startRenaming = (h: Horizon) => {
    setEditingHorizonId(h.id);
    setTempHorizonName(h.name);
  };

  const saveRename = () => {
    if (editingHorizonId && tempHorizonName.trim()) {
      setHorizons(prev => prev.map(h => h.id === editingHorizonId ? { ...h, name: tempHorizonName } : h));
      setEditingHorizonId(null);
      addLog(`Kernel: Reflector renamed to '${tempHorizonName}'`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    addLog(`System: Parsing SEGY file: ${file.name}...`);
    try {
      const dataset = await parseSegy(file);
      setRawDataset(dataset);
      setProcessedDataset(dataset);
      addLog(`System: SEGY parsed. ${dataset.traces.length} traces @ ${dataset.numSamples} samples.`);
    } catch (err) {
      addLog(`ERROR: Failed to parse SEGY. ${err}`);
    }
  };

  const exportHorizon = () => {
    const activeH = horizons.find(h => h.id === displayConfig.activeHorizonId);
    if (!activeH || activeH.points.length === 0) {
      addLog("Export: No points found in active horizon.");
      return;
    }

    const csvContent = "Trace,Sample,Time_ms,Amplitude,Shotpoint,Offset\n" + 
      activeH.points.map(p => {
        const t = processedDataset?.traces[p.traceIndex];
        return `${p.traceIndex},${p.sampleIndex},${p.timeMs.toFixed(2)},${p.amplitude.toFixed(6)},${t?.header.shotPoint || 0},${t?.header.offset || 0}`;
      }).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeH.name}_picks.csv`;
    a.click();
    addLog(`Export: Horizon ${activeH.name} exported.`);
  };

  const runFlow = async () => {
    if (isProcessing || !rawDataset) return;
    setIsProcessing(true);
    addLog("Kernel: Running process sequence...");
    const startTime = performance.now();
    try {
      let working: SeismicTrace[] = JSON.parse(JSON.stringify(rawDataset.traces));
      for (const mod of flow) {
        switch (mod.id) {
          case 'agc': working = working.map(t => ({...t, data: applyAGC(t.data, (mod.params.window.value as number)/rawDataset.sampleInterval)})); break;
          case 'bandpass': working = working.map(t => ({...t, data: applyBandpass(t.data, mod.params.lowCut.value as number, mod.params.highCut.value as number, 1000/rawDataset.sampleInterval)})); break;
          case 'tgain': working = working.map(t => ({...t, data: applyTGain(t.data, mod.params.exponent.value as number)})); break;
          case 'nmo_corr': working = working.map(t => ({...t, data: applyNMO(t.data, t.header.offset, mod.params.velocity.value as number, rawDataset.sampleInterval, mod.params.stretchLimit.value as number)})); break;
          case 'v_stack': working = applyStack(working, mod.params.velocity.value as number, rawDataset.sampleInterval); break;
          case 'mixing': working = applyMixing(working, mod.params.numTraces.value as number); break;
          case 'whitening': working = working.map(t => ({...t, data: applyWhitening(t.data)})); break;
          case 'decon': working = working.map(t => ({...t, data: applyDecon(t.data, mod.params.opLength.value as number)})); break;
          case 'inversion': working = working.map(t => ({...t, data: applyInversion(t.data, mod.params.initialImpedance.value as number)})); break;
        }
      }
      setProcessedDataset({ ...rawDataset, traces: working });
      addLog(`Kernel: Flow completed in ${(performance.now() - startTime).toFixed(1)}ms`);
    } catch (e) { addLog(`[ERROR] Workflow failed: ${e}`); } finally { setIsProcessing(false); }
  };

  return (
    <div className="flex h-screen w-screen bg-[#020617] text-slate-300 font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".sgy,.seg,.segy" className="hidden" />

      {/* LEFT SIDEBAR */}
      <aside className={`bg-[#0f172a] border-r border-white/5 flex flex-col shrink-0 transition-all duration-300 relative z-30 ${panels.left ? 'w-80 shadow-2xl' : 'w-12'}`}>
        <div className={`p-6 border-b border-white/5 flex items-center bg-black/20 shrink-0 ${panels.left ? 'justify-between' : 'justify-center p-4'}`}>
          {panels.left && (
            <div className="flex items-center gap-3">
              <Waves className="text-blue-500 w-6 h-6" />
              <span className="font-bold text-white text-lg tracking-tight">OSP Suite</span>
            </div>
          )}
          <button onClick={() => togglePanel('left')} className="p-1 hover:bg-white/5 rounded-lg text-slate-500 transition">
             {panels.left ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          </button>
        </div>
        
        {panels.left && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
            {/* Navigator Box */}
            <div className="border border-white/5 rounded-xl overflow-hidden bg-black/10">
              <div onClick={() => togglePanel('navigator')} className="p-3 bg-white/5 flex items-center justify-between cursor-pointer hover:bg-white/10 transition">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Folder className="w-3 h-3" /> Navigator</h4>
                {panels.navigator ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </div>
              {panels.navigator && (
                <div className="p-3 space-y-2">
                   {/* Restored SEGY Import button here */}
                   <button 
                     onClick={() => fileInputRef.current?.click()} 
                     className="w-full flex items-center justify-center gap-2 py-2 mb-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/20 rounded-lg text-[10px] font-bold transition"
                   >
                     <FileUp className="w-3.5 h-3.5" /> IMPORT SEGY DATA
                   </button>
                   {projectTree.map(node => (
                    <div key={node.id} className="space-y-1">
                      <div className="flex items-center gap-2 px-1 text-[11px] font-semibold text-slate-400">
                        <ChevronDown className="w-3 h-3" /> {node.label}
                      </div>
                      <div className="pl-3 space-y-1">
                        {node.children?.map(child => (
                          <div key={child.id} onClick={() => child.type === 'horizon' && setDisplayConfig({...displayConfig, activeHorizonId: child.id})} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition group cursor-pointer ${displayConfig.activeHorizonId === child.id ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20 shadow-lg' : 'hover:bg-white/5 text-slate-500 hover:text-slate-200'}`}>
                              {child.type === 'dataset' ? <Database className="w-3 h-3 text-amber-500" /> : <Activity className="w-3 h-3" style={{ color: child.color }} />}
                              <span className="text-[10.5px] truncate">{child.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Display Box */}
            <div className="border border-white/5 rounded-xl overflow-hidden bg-black/10">
              <div onClick={() => togglePanel('display')} className="p-3 bg-white/5 flex items-center justify-between cursor-pointer hover:bg-white/10 transition">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Sliders className="w-3 h-3" /> Display Props</h4>
                {panels.display ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </div>
              {panels.display && (
                <div className="p-4 space-y-4">
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold mb-1.5 uppercase"><span>Gain</span><span className="text-blue-400">{displayConfig.gain.toFixed(1)}x</span></div>
                    <input type="range" min="0.1" max="25" step="0.5" value={displayConfig.gain} onChange={(e) => setDisplayConfig({...displayConfig, gain: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-blue-600 cursor-pointer" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: false})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${!displayConfig.isWiggle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/5 text-slate-500'}`}>DENSITY</button>
                    <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: true})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${displayConfig.isWiggle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/5 text-slate-500'}`}>WIGGLE</button>
                  </div>
                </div>
              )}
            </div>

            {/* Modules Box */}
            <div className="border border-white/5 rounded-xl overflow-hidden bg-black/10">
              <div onClick={() => togglePanel('library')} className="p-3 bg-white/5 flex items-center justify-between cursor-pointer hover:bg-white/10 transition">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><PlusSquare className="w-3 h-3" /> Processing Tools</h4>
                {panels.library ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </div>
              {panels.library && (
                <div className="p-3 space-y-1">
                   {MODULE_LIBRARY.map(mod => (
                    <button key={mod.id} onClick={() => setFlow([...flow, {...mod, instanceId: Date.now().toString()}])} className="w-full p-2.5 rounded-xl bg-slate-800/40 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/30 text-left transition flex items-center justify-between group">
                      <span className="text-[10px] font-bold text-slate-400 group-hover:text-blue-400">{mod.name}</span>
                      <Plus className="w-3 h-3 text-slate-600 group-hover:text-blue-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-16 border-b border-white/5 px-8 flex items-center justify-between backdrop-blur-md bg-[#0f172a]/80 shrink-0 z-20 shadow-xl">
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
            <TabBtn active={displayConfig.activeTab === 'section'} icon={LayoutDashboard} label="Section" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'section'})} />
            <TabBtn active={displayConfig.activeTab === 'avo'} icon={LineChart} label="AVO Analysis" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'avo'})} />
            <TabBtn active={displayConfig.activeTab === 'spectral'} icon={AudioLines} label="Spectral" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'spectral'})} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setDisplayConfig({...displayConfig, isPickerActive: !displayConfig.isPickerActive})} className={`px-4 py-2 rounded-xl text-[10px] font-bold border transition ${displayConfig.isPickerActive ? 'bg-amber-500/20 border-amber-500/50 text-amber-500 shadow-lg shadow-amber-500/10' : 'bg-slate-800/40 border-white/5 text-slate-500 hover:text-slate-300'}`}>{displayConfig.isPickerActive ? 'PICKER ON' : 'PICKER OFF'}</button>
            <button onClick={runFlow} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition flex items-center gap-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"><Play className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} /> RUN FLOW</button>
            <button onClick={() => setShowChat(!showChat)} className="p-2.5 bg-slate-800 border border-white/5 rounded-xl text-slate-400 hover:text-white transition shadow-lg"><MessageSquare className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden relative">
          {/* Header Data Cards */}
          {processedDataset && (
            <div className="grid grid-cols-3 gap-4 shrink-0 h-20">
              <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4 flex flex-col justify-center shadow-lg">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Type</span>
                <span className="text-xl font-bold text-white">Seismic 2D Line</span>
              </div>
              <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4 flex flex-col justify-center shadow-lg">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Samples / Trace</span>
                <span className="text-xl font-bold text-white">{processedDataset.numSamples}</span>
              </div>
              <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4 flex flex-col justify-center shadow-lg">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Traces</span>
                <span className="text-xl font-bold text-white">{processedDataset.traces.length}</span>
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-row gap-4 overflow-hidden relative min-h-0">
            <div className="flex-1 flex flex-col gap-4 min-w-0 h-full">
              {/* Main Content Area */}
              <div className="flex-1 relative rounded-3xl overflow-hidden border border-white/5 bg-black shadow-2xl transition-all duration-300">
                {displayConfig.activeTab === 'section' && processedDataset && (
                  <SeismicCanvas dataset={processedDataset} config={displayConfig} horizons={horizons} onAddPoint={addHorizonPoint} />
                )}
                
                {displayConfig.activeTab === 'avo' && (
                  <div className="absolute inset-0 p-12 bg-[#020617] flex flex-col items-center justify-center">
                    <h3 className="text-xs font-bold text-slate-500 mb-8 uppercase tracking-[0.4em]">AVO Regression Statistics</h3>
                    <div className="flex-1 w-full max-w-5xl flex gap-6">
                      <div className="flex-1 border border-white/10 rounded-2xl p-16 relative bg-black/20 flex items-center justify-center shadow-inner">
                        {avoResult ? (
                          <div className="w-full h-full border-l border-b border-white/10 relative flex items-end">
                            {avoResult.points.map((p, i) => (
                              <div key={i} className="absolute w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.6)] transition-all duration-300 hover:scale-150 cursor-pointer" style={{ left: `${(p.offset / datasetMaxOffset) * 100}%`, bottom: `${p.normAmplitude * 100}%` }} title={`Offset: ${p.offset}m, Amp: ${p.amplitude.toFixed(4)}`} />
                            ))}
                            {avoResult.regression && (
                              <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                                <line 
                                  x1="0%" 
                                  y1={`${(1 - avoResult.regression.intercept) * 100}%`} 
                                  x2="100%" 
                                  y2={`${(1 - (avoResult.regression.intercept + avoResult.regression.slope * datasetMaxOffset)) * 100}%`} 
                                  stroke="rgba(255,255,255,0.3)" 
                                  strokeWidth="2" 
                                  strokeDasharray="8 4"
                                />
                              </svg>
                            )}
                            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Offset (m)</div>
                            <div className="absolute -left-14 top-1/2 -rotate-90 -translate-y-1/2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Norm. Amplitude</div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-4 text-center">
                            <LineChart className="w-16 h-16 text-slate-800" />
                            <span className="text-[10px] text-slate-700 font-bold uppercase tracking-widest leading-relaxed">Select an active reflector and pick points to perform AVO Analysis</span>
                          </div>
                        )}
                      </div>

                      {avoResult && (
                        <div className="w-80 bg-slate-900/80 border border-white/10 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl backdrop-blur-2xl">
                          <div className="flex items-center gap-3 pb-6 border-b border-white/5">
                            <Target className="w-5 h-5 text-blue-500" />
                            <div className="flex flex-col">
                              <span className="text-[10px] font-black text-slate-200 uppercase tracking-widest">Seismic Report</span>
                              <span className="text-[9px] text-slate-500 font-bold italic">Shuey Approx.</span>
                            </div>
                          </div>
                          
                          <div className="space-y-6">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">Intercept (P)</span>
                              <span className="text-2xl font-mono text-blue-400 font-bold tracking-tight">{avoResult.regression.intercept.toFixed(4)}</span>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">Gradient (G)</span>
                              <span className="text-2xl font-mono text-amber-500 font-bold tracking-tight">{avoResult.regression.slope.toFixed(6)}</span>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">Quality (R²)</span>
                              <span className="text-xl font-mono text-emerald-500 font-bold">{avoResult.regression.rSquared.toFixed(3)}</span>
                            </div>
                          </div>

                          <div className="mt-auto p-4 bg-blue-500/5 rounded-xl border border-blue-500/20">
                            <p className="text-[9px] text-blue-300/60 leading-relaxed font-medium">Positive gradient (G) often characterizes gas sand reservoirs (Class III).</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {displayConfig.activeTab === 'spectral' && (
                  <div className="absolute inset-0 p-12 bg-[#020617] flex flex-col items-center justify-center">
                    <h3 className="text-xs font-bold text-slate-500 mb-8 uppercase tracking-[0.4em]">Power Density Spectrum</h3>
                    <div className="flex-1 w-full max-w-4xl flex items-end gap-1 px-8 pb-12 border-b border-l border-white/5">
                      {averageSpectrum ? averageSpectrum.map((val, i) => (
                        <div key={i} className="flex-1 bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-sm transition-all duration-700" style={{ height: `${Math.pow(val, 0.7) * 100}%`, opacity: 0.1 + val * 0.9 }} />
                      )) : <span className="text-[10px] text-slate-700 font-bold uppercase tracking-widest">No spectral data available</span>}
                    </div>
                    <div className="mt-6 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Frequency Response (Hz) →</div>
                  </div>
                )}
              </div>

              {/* Processing Stack Bar */}
              <div className={`bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl relative shrink-0 transition-all duration-300 ${panels.stack ? 'h-48' : 'h-12'}`}>
                <div onClick={() => togglePanel('stack')} className="px-5 py-3 border-b border-white/5 text-[9px] font-bold text-slate-600 uppercase flex items-center justify-between bg-black/20 cursor-pointer hover:bg-white/5">
                  <div className="flex items-center gap-2"><Settings className="w-3.5 h-3.5 text-blue-500" /> Processing Flow</div>
                  <div className="flex items-center gap-4">
                     <button onClick={(e) => { e.stopPropagation(); setFlow([]); }} className="hover:text-red-400 transition flex items-center gap-1 font-black"><RotateCcw className="w-3 h-3" /> FLUSH</button>
                     {panels.stack ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </div>
                </div>
                {panels.stack && (
                  <div className="flex-1 p-3 flex gap-3 overflow-x-auto scrollbar-hide">
                    {flow.length === 0 ? (
                      <div className="flex-1 border-2 border-dashed border-white/5 rounded-2xl m-2 flex items-center justify-center text-[10px] text-slate-700 uppercase font-black tracking-[0.3em]">Drop Modules Here</div>
                    ) : flow.map((mod, i) => (
                      <div key={mod.instanceId} className="w-56 shrink-0 bg-slate-900/80 border border-white/10 rounded-2xl p-5 flex flex-col justify-between shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-[10px] font-black text-blue-400 uppercase truncate w-36">{mod.name}</span>
                          <button onClick={() => setFlow(flow.filter(f => f.instanceId !== mod.instanceId))} className="text-slate-600 hover:text-red-500 transition"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="space-y-4">
                          {Object.entries(mod.params).map(([key, param]) => {
                            const p = param as ModuleParam;
                            return (
                              <div key={key} className="flex flex-col gap-1.5">
                                  <div className="flex justify-between text-[8px] text-slate-600 uppercase font-bold"><span>{p.label}</span><span className="text-blue-200">{String(p.value)}</span></div>
                                  <input type="range" min={p.min} max={p.max} step="0.1" value={p.value as number} onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setFlow(flow.map(m => m.instanceId === mod.instanceId ? { ...m, params: { ...m.params, [key]: { ...p, value: val } } } : m));
                                  }} className="w-full h-1 bg-slate-800 rounded-full appearance-none accent-blue-500" />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT SIDEBAR */}
            <aside className={`bg-[#0f172a] border-l border-white/5 flex flex-col shrink-0 transition-all duration-300 relative z-30 ${panels.right ? 'w-80 shadow-2xl' : 'w-12'}`}>
              <div className={`p-4 border-b border-white/5 flex items-center bg-black/10 shrink-0 ${panels.right ? 'justify-between' : 'justify-center'}`}>
                {panels.right && <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Target className="w-4 h-4 text-blue-400" /> Interpretation</span>}
                <button onClick={() => togglePanel('right')} className="p-1 hover:bg-white/5 rounded-lg text-slate-500 transition">
                  {panels.right ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
                </button>
              </div>
              
              {panels.right && (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                    <div className="border border-white/5 rounded-xl overflow-hidden bg-black/10">
                      <div onClick={() => togglePanel('interpretation')} className="p-3 bg-white/5 flex items-center justify-between cursor-pointer hover:bg-white/10 transition">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Reflector Stack</span>
                        <div className="flex items-center gap-2">
                           <button onClick={(e) => {
                             e.stopPropagation();
                             const nid = Date.now().toString();
                             setHorizons([...horizons, { id: nid, name: `Refl_${horizons.length+1}`, color: '#'+Math.floor(Math.random()*16777215).toString(16), points: [], isVisible: true }]);
                             setDisplayConfig(p => ({...p, activeHorizonId: nid}));
                           }} className="p-1 bg-blue-600/10 text-blue-400 rounded hover:bg-blue-600/20"><Plus className="w-3 h-3" /></button>
                           {panels.interpretation ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </div>
                      </div>
                      {panels.interpretation && (
                        <div className="p-3 space-y-2">
                          {horizons.map(h => (
                            <div key={h.id} onClick={() => setDisplayConfig({...displayConfig, activeHorizonId: h.id})} className={`group p-3 rounded-xl border transition-all cursor-pointer ${displayConfig.activeHorizonId === h.id ? 'bg-blue-600/10 border-blue-500/30' : 'bg-slate-900/40 border-white/5 hover:border-white/10'}`}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 overflow-hidden flex-1">
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_rgba(255,255,255,0.2)]" style={{ backgroundColor: h.color }} />
                                  {editingHorizonId === h.id ? (
                                    <input 
                                      autoFocus
                                      className="bg-slate-800 border border-blue-500/50 rounded px-2 py-0.5 text-[10px] w-full text-white outline-none font-bold"
                                      value={tempHorizonName}
                                      onChange={(e) => setTempHorizonName(e.target.value)}
                                      onBlur={saveRename}
                                      onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                                    />
                                  ) : (
                                    <span className={`text-[11px] font-black truncate ${displayConfig.activeHorizonId === h.id ? 'text-white' : 'text-slate-500'}`}>{h.name}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                                  <button onClick={(e) => { e.stopPropagation(); startRenaming(h); }} className="p-1 hover:text-blue-400 text-slate-600 transition"><Edit2 className="w-3 h-3" /></button>
                                  <button onClick={(e) => { e.stopPropagation(); setHorizons(horizons.filter(x => x.id !== h.id)); }} className="p-1 hover:text-red-500 text-slate-600 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              </div>
                              <div className="text-[8px] font-black text-slate-700 uppercase tracking-widest">{h.points.length} Pts Captured</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 border-t border-white/5 bg-black/20 space-y-2">
                    <button onClick={exportHorizon} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition flex items-center justify-center gap-2 shadow-lg"><Download className="w-3.5 h-3.5" /> EXPORT CSV</button>
                    
                    <div className={`border border-white/5 rounded-xl overflow-hidden bg-black/40 mt-4 transition-all duration-300 ${panels.kernel ? 'h-32' : 'h-10'}`}>
                      <div onClick={() => togglePanel('kernel')} className="px-3 py-2 border-b border-white/5 text-[8px] font-black text-slate-700 uppercase flex items-center justify-between cursor-pointer hover:bg-white/5">
                        <div className="flex items-center gap-1.5"><Terminal className="w-3 h-3" /> Kernel Feed</div>
                        {panels.kernel ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                      </div>
                      {panels.kernel && (
                        <div className="p-3 font-mono text-[8px] text-slate-600 overflow-y-auto h-[calc(100%-25px)] scrollbar-hide space-y-1">
                          {logs.map((l, i) => (
                            <div key={i} className="flex gap-2">
                                <span className="text-blue-900 font-bold opacity-30 select-none">[{i}]</span>
                                <span className="truncate">{l}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      </main>

      {showChat && (
        <div className="fixed inset-y-0 right-0 w-[420px] z-50 shadow-2xl border-l border-white/10 animate-in slide-in-from-right duration-500 bg-[#0c0c0e]">
           <ChatPanel processingState={displayConfig} activeFlow={flow} />
           <button onClick={() => setShowChat(false)} className="absolute top-1/2 -left-12 w-12 h-12 bg-[#0f172a] border border-white/10 rounded-l-2xl flex items-center justify-center text-slate-400 hover:text-white transition shadow-2xl border-r-0"><ChevronRight className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
};

const TabBtn: React.FC<{active: boolean, icon: any, label: string, onClick: () => void}> = ({ active, icon: Icon, label, onClick }) => (
  <button onClick={onClick} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition flex items-center gap-2.5 tracking-widest ${active ? 'bg-blue-600 text-white shadow-xl shadow-blue-900/30' : 'text-slate-600 hover:text-slate-200 hover:bg-white/5'}`}><Icon className="w-3.5 h-3.5" /> {label}</button>
);

export default App;