import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Plus, Zap, ChevronRight, Settings2, Activity, 
  MessageSquare, Terminal, Trash2, Download, BarChart3, 
  Waves, MousePointer2, Eye, EyeOff, Target, LassoSelect, ShieldCheck, 
  LayoutDashboard, Map as MapIcon, LineChart, AudioLines, Search, Beaker, Database, AlertCircle, RotateCcw,
  Settings, Layers, Play, Save, ChevronUp, ChevronDown, X, Folder, FileJson, Edit2, Check, Sliders
} from 'lucide-react';
import SeismicCanvas from './components/SeismicCanvas';
import ChatPanel from './components/ChatPanel';
import { MODULE_LIBRARY } from './utils/ospModules';
import { generateSyntheticSeismic } from './utils/seismicGenerators';
import { SeismicDataset, ActiveModule, OSPModule, ProcessingState, SeismicTrace, Horizon, HorizonPoint, WorkspaceTab, ModuleParam, TreeItem } from './types';
import { applyAGC, applyBandpass, applyMixing, applyTGain, calculateAverageSpectrum, autoTrackHorizon, calculateAVOCurve, applyWhitening, applyDecon, applyStack, applyInversion, applyNMO, calculateSemblance } from './utils/dsp';

const STORAGE_KEY = 'OSP_PRO_ULTIMATE_V7';

const App: React.FC = () => {
  const [flow, setFlow] = useState<ActiveModule[]>([]);
  const [rawDataset, setRawDataset] = useState<SeismicDataset | null>(null);
  const [processedDataset, setProcessedDataset] = useState<SeismicDataset | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [logs, setLogs] = useState<string[]>(["[KERNEL] OSP Suite v9.2 - Final Product Review Ready"]);
  const [horizons, setHorizons] = useState<Horizon[]>([]);
  const [editingHorizonId, setEditingHorizonId] = useState<string | null>(null);
  const [tempHorizonName, setTempHorizonName] = useState("");
  
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

  // Project Tree - Now reactive to selection
  const projectTree = useMemo((): TreeItem[] => [
    {
      id: 'f-data', label: 'Surveys & Data', type: 'folder', isOpen: true,
      children: [
        { id: 'ds-1', label: rawDataset?.name || 'Synthetic_Gather_01', type: 'dataset' }
      ]
    },
    {
      id: 'f-flows', label: 'Processing Flows', type: 'folder', isOpen: true,
      children: [
        { id: 'fl-1', label: 'Primary Processing Flow', type: 'flow' }
      ]
    },
    {
      id: 'f-interp', label: 'Interpretations', type: 'folder', isOpen: true,
      children: horizons.map(h => ({ id: h.id, label: h.name, type: 'horizon', color: h.color }))
    }
  ], [horizons, rawDataset]);

  const semblanceMap = useMemo(() => {
    if (displayConfig.activeTab !== 'velocity' || !rawDataset) return null;
    return calculateSemblance(rawDataset.traces, rawDataset.sampleInterval, 1000, 4000, 100);
  }, [displayConfig.activeTab, rawDataset]);

  const avoResult = useMemo(() => {
    return calculateAVOCurve(processedDataset, horizons.find(h => h.id === displayConfig.activeHorizonId));
  }, [horizons, displayConfig.activeHorizonId, processedDataset]);

  const datasetMaxOffset = useMemo(() => {
    if (!rawDataset || rawDataset.traces.length === 0) return 6000;
    return Math.max(...rawDataset.traces.map(t => t.header.offset));
  }, [rawDataset]);

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

  const runFlow = async () => {
    if (isProcessing || !rawDataset) return;
    setIsProcessing(true);
    addLog("Kernel: Executing sequence...");
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
          case 'whitening': working = working.map(t => ({...t, data: applyWhitening(t.data)})); break;
          case 'decon': working = working.map(t => ({...t, data: applyDecon(t.data, mod.params.opLength.value as number)})); break;
          case 'inversion': working = working.map(t => ({...t, data: applyInversion(t.data, mod.params.initialImpedance.value as number)})); break;
        }
      }
      setProcessedDataset({ ...rawDataset, traces: working });
      addLog(`Kernel: Sequence completed in ${(performance.now() - startTime).toFixed(1)}ms`);
    } catch (e) { addLog(`[ERROR] Workflow execution failed: ${e}`); } finally { setIsProcessing(false); }
  };

  const startRenaming = (h: Horizon) => {
    setEditingHorizonId(h.id);
    setTempHorizonName(h.name);
  };

  const saveRename = () => {
    if (editingHorizonId && tempHorizonName.trim()) {
      setHorizons(horizons.map(h => h.id === editingHorizonId ? { ...h, name: tempHorizonName } : h));
      setEditingHorizonId(null);
      addLog(`System: Horizon renamed to '${tempHorizonName}'`);
    }
  };

  const addHorizonPoint = useCallback((point: HorizonPoint) => {
    const aid = displayConfig.activeHorizonId;
    if (!aid) return;
    setHorizons(current => current.map(h => h.id === aid ? {
      ...h,
      points: [...h.points.filter(p => p.traceIndex !== point.traceIndex), point].sort((a,b) => a.traceIndex - b.traceIndex)
    } : h));
  }, [displayConfig.activeHorizonId]);

  return (
    <div className="flex h-screen w-screen bg-[#020617] text-slate-300 font-sans overflow-hidden">
      {/* LEFT SIDEBAR: Project & Modules */}
      <aside className="w-80 bg-[#0f172a] border-r border-white/5 flex flex-col shrink-0 z-30 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3">
            <Waves className="text-blue-500 w-6 h-6" />
            <span className="font-bold text-white text-lg tracking-tight">OSP Suite</span>
          </div>
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
          {/* 1. Project Navigator Tree */}
          <div className="space-y-4">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><Folder className="w-3 h-3" /> Navigator</h4>
             <div className="space-y-1">
                {projectTree.map(node => (
                  <div key={node.id} className="space-y-1">
                    <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-slate-400 hover:text-white transition cursor-pointer">
                      <ChevronDown className="w-3 h-3 text-slate-600" />
                      {node.label}
                    </div>
                    <div className="pl-4 space-y-0.5">
                      {node.children?.map(child => (
                        <div 
                          key={child.id} 
                          onClick={() => child.type === 'horizon' && setDisplayConfig({...displayConfig, activeHorizonId: child.id})}
                          className={`flex items-center justify-between px-2 py-1.5 rounded-lg transition group cursor-pointer ${displayConfig.activeHorizonId === child.id ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20' : 'hover:bg-white/5 text-slate-500 hover:text-slate-200'}`}
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            {child.type === 'dataset' && <FileJson className="w-3 h-3 text-amber-500" />}
                            {child.type === 'horizon' && <Activity className={`w-3 h-3`} style={{ color: child.color }} />}
                            {child.type === 'flow' && <Zap className="w-3 h-3 text-purple-500" />}
                            <span className="text-[10.5px] truncate">{child.label}</span>
                          </div>
                          {child.type === 'horizon' && (
                             <button onClick={(e) => {e.stopPropagation(); startRenaming(horizons.find(h => h.id === child.id)!);}} className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-white transition">
                               <Edit2 className="w-2.5 h-2.5" />
                             </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
             </div>
          </div>

          {/* 2. Display Controls (Permanent Sidebar UI) */}
          <div className="space-y-4 pt-6 border-t border-white/5">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><Sliders className="w-3 h-3" /> Display Props</h4>
             <div className="px-2 space-y-4">
               <div>
                 <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase mb-1.5"><span>Amplitude Gain</span><span className="text-blue-400">{displayConfig.gain.toFixed(1)}x</span></div>
                 <input type="range" min="0.1" max="20" step="0.5" value={displayConfig.gain} onChange={(e) => setDisplayConfig({...displayConfig, gain: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-blue-600" />
               </div>
               <div className="flex gap-2">
                 <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: false})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${!displayConfig.isWiggle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/5 text-slate-500'}`}>DENSITY</button>
                 <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: true})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${displayConfig.isWiggle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/5 text-slate-500'}`}>WIGGLE</button>
               </div>
               <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Show Well Overlay</span>
                  <button onClick={() => setDisplayConfig({...displayConfig, showWell: !displayConfig.showWell})} className={`w-8 h-4 rounded-full transition relative ${displayConfig.showWell ? 'bg-blue-600' : 'bg-slate-800'}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${displayConfig.showWell ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
               </div>
             </div>
          </div>

          {/* 3. Module Library */}
          <div className="space-y-4 pt-6 border-t border-white/5">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><Layers className="w-3 h-3" /> Module Library</h4>
             <div className="grid grid-cols-1 gap-2">
                {MODULE_LIBRARY.map(mod => (
                  <button key={mod.id} onClick={() => setFlow([...flow, {...mod, instanceId: Date.now().toString()}])} className="group w-full p-3 rounded-xl bg-slate-800/40 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/30 text-left transition flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-bold text-white group-hover:text-blue-400 transition">{mod.name}</span>
                      <Plus className="w-3 h-3 text-slate-600 group-hover:text-blue-500" />
                    </div>
                  </button>
                ))}
             </div>
          </div>
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-16 border-b border-white/5 px-8 flex items-center justify-between glass z-20 shadow-xl">
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 shadow-inner">
            <TabBtn active={displayConfig.activeTab === 'section'} icon={LayoutDashboard} label="Seismic Section" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'section'})} />
            <TabBtn active={displayConfig.activeTab === 'velocity'} icon={Target} label="Velocity Analysis" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'velocity'})} />
            <TabBtn active={displayConfig.activeTab === 'avo'} icon={LineChart} label="AVO Analysis" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'avo'})} />
            <TabBtn active={displayConfig.activeTab === 'spectral'} icon={AudioLines} label="Spectral" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'spectral'})} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setDisplayConfig({...displayConfig, isPickerActive: !displayConfig.isPickerActive})} className={`px-4 py-2 rounded-xl text-[10px] font-bold border flex items-center gap-2 transition ${displayConfig.isPickerActive ? 'bg-amber-500/20 border-amber-500/50 text-amber-500 shadow-lg' : 'bg-slate-800/40 border-white/5 text-slate-500 hover:text-slate-300'}`}><MousePointer2 className="w-3.5 h-3.5" /> {displayConfig.isPickerActive ? 'PICKER ACTIVE' : 'PICKER IDLE'}</button>
            <button onClick={runFlow} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"><Play className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} /> RUN WORKFLOW</button>
            <button onClick={() => setShowChat(!showChat)} className="p-2.5 bg-slate-800 border border-white/5 rounded-xl text-slate-400 hover:text-white transition shadow-lg"><MessageSquare className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="flex-1 flex flex-row p-6 gap-6 scanline overflow-hidden relative">
          <div className="flex-1 flex flex-col gap-6 min-w-0 h-full">
            {/* Viewport Canvas */}
            <div className="flex-1 relative rounded-3xl overflow-hidden border border-white/5 bg-black shadow-[0_0_50px_rgba(0,0,0,0.5)]">
              {displayConfig.activeTab === 'section' && processedDataset && (
                <SeismicCanvas dataset={processedDataset} config={displayConfig} horizons={horizons} onAddPoint={addHorizonPoint} />
              )}
              {displayConfig.activeTab === 'velocity' && (
                <div className="absolute inset-0 p-12 flex flex-col bg-slate-950 overflow-hidden">
                   <h3 className="text-xs font-bold text-slate-500 mb-8 uppercase tracking-[0.3em] text-center flex items-center justify-center gap-2"><Target className="w-4 h-4 text-blue-500" /> Semblance / Coherence Spectrum</h3>
                   <div className="flex-1 relative border border-white/10 rounded-2xl overflow-hidden bg-black/40 shadow-inner">
                      {semblanceMap ? (
                        <div className="w-full h-full grid gap-px" style={{ gridTemplateColumns: `repeat(${semblanceMap.length}, 1fr)` }}>
                          {semblanceMap.map((vCol, vIdx) => (
                            <div key={vIdx} className="flex flex-col h-full">
                               {vCol.map((val, sIdx) => sIdx % 4 === 0 && (
                                 <div key={sIdx} className="flex-1" style={{ backgroundColor: `rgba(59, 130, 246, ${val * 1.8})` }} />
                               ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-[10px] uppercase font-bold text-slate-700 gap-4">
                           <Loader2 className="w-10 h-10 animate-spin text-blue-900" />
                           Analysing Seismic Coherence...
                        </div>
                      )}
                      <div className="absolute bottom-4 left-0 right-0 flex justify-between px-8 text-[9px] text-slate-500 font-bold uppercase bg-black/40 py-1 border-t border-white/5"><span>1000 m/s</span><span>RMS Velocity Domain</span><span>4000 m/s</span></div>
                   </div>
                </div>
              )}
              {displayConfig.activeTab === 'avo' && (
                <div className="absolute inset-0 p-24 flex flex-col items-center justify-center bg-slate-950">
                   {avoResult ? (
                     <div className="w-full h-full flex flex-col max-w-4xl animate-in fade-in duration-500">
                        <div className="flex justify-between items-center mb-12">
                           <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.3em]">Quantitative AVO Gradient</h3>
                           {avoResult.regression && (
                             <div className="flex gap-6 bg-black/40 p-5 rounded-2xl border border-white/5 shadow-2xl backdrop-blur-md">
                                <div className="flex flex-col px-4 border-r border-white/5">
                                   <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-1">P-Intercept</span>
                                   <span className="text-xl text-white font-mono">{avoResult.regression.intercept.toFixed(4)}</span>
                                </div>
                                <div className="flex flex-col px-4">
                                   <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-1">G-Gradient</span>
                                   <span className={`text-xl font-mono ${avoResult.regression.slope > 0 ? 'text-green-400' : 'text-red-400'}`}>{avoResult.regression.slope.toFixed(6)}</span>
                                </div>
                             </div>
                           )}
                        </div>
                        <div className="flex-1 relative border-l-2 border-b-2 border-white/10 flex items-end bg-black/20 rounded-tr-3xl overflow-hidden group">
                          <div className="absolute inset-0 grid grid-cols-10 grid-rows-10 opacity-5 pointer-events-none">
                            {Array.from({length: 100}).map((_, i) => <div key={i} className="border border-white" />)}
                          </div>
                          {avoResult.points.map((d: any, i: number) => (
                             <div key={i} className="absolute w-3 h-3 bg-blue-500 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.6)] transform -translate-x-1/2 translate-y-1/2 group-hover:scale-125 transition-all z-10" 
                                  style={{ bottom: `${d.normAmplitude * 100}%`, left: `${(d.offset / datasetMaxOffset) * 100}%` }}>
                               <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-3 py-1.5 bg-slate-900 text-[9px] rounded-lg opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 border border-white/10 shadow-2xl font-mono text-blue-400">
                                 Offset: {d.offset}m | Amp: {d.amplitude.toFixed(5)}
                               </div>
                             </div>
                          ))}
                          {avoResult.regression && (
                            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible opacity-40">
                              <line 
                                x1="0%" y1={`${(1 - avoResult.regression.intercept) * 100}%`} 
                                x2="100%" y2={`${(1 - (avoResult.regression.intercept + avoResult.regression.slope * datasetMaxOffset)) * 100}%`} 
                                stroke="white" strokeWidth="2" strokeDasharray="10 5"
                              />
                            </svg>
                          )}
                        </div>
                        <div className="mt-6 flex justify-between text-[10px] text-slate-600 uppercase font-bold tracking-widest px-4 font-mono"><span>Near Offset (0m)</span><span>Far Offset ({datasetMaxOffset}m)</span></div>
                     </div>
                   ) : (
                     <div className="text-slate-700 text-xs uppercase font-bold flex flex-col items-center gap-6 animate-pulse">
                       <AlertCircle className="w-16 h-16 opacity-20" />
                       <div className="text-center space-y-2">
                         <p>AVO Engine Offline</p>
                         <p className="text-[10px] normal-case font-normal text-slate-800">Please pick points on the active horizon to calculate amplitudes.</p>
                       </div>
                     </div>
                   )}
                </div>
              )}
              {displayConfig.activeTab === 'spectral' && processedDataset && (
                <div className="absolute inset-0 p-24 flex flex-col bg-slate-950">
                  <h3 className="text-xs font-bold text-slate-500 mb-12 uppercase tracking-[0.3em] text-center">Average Amplitude Spectrum</h3>
                  <div className="flex-1 flex items-end gap-1 px-12 border-b border-white/5 pb-1">
                    {calculateAverageSpectrum(processedDataset.traces).map((v, i) => (
                      <div key={i} className="bg-gradient-to-t from-blue-600/80 to-blue-400/20 w-full rounded-t-sm transition-all duration-700" style={{ height: `${v}%` }} />
                    ))}
                  </div>
                  <div className="flex justify-between mt-6 text-[10px] text-slate-600 px-12 font-bold uppercase tracking-widest font-mono"><span>0 Hz</span><span>Nyquist (125 Hz)</span></div>
                </div>
              )}
            </div>

            {/* Workflow / Active Modules Section */}
            <div className="h-44 bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl relative group">
              <div className="px-5 py-3 border-b border-white/5 text-[9px] font-bold text-slate-500 uppercase flex items-center justify-between bg-black/20">
                <div className="flex items-center gap-2"><Settings className="w-3.5 h-3.5 text-blue-500" /> Active Workflow Stack</div>
                <div className="flex gap-4">
                   <button onClick={() => setFlow([])} className="flex items-center gap-1.5 hover:text-red-400 transition text-slate-600"><RotateCcw className="w-3 h-3" /> Reset Flow</button>
                   <button className="flex items-center gap-1.5 hover:text-white transition text-slate-600"><Save className="w-3 h-3" /> Save Stack</button>
                </div>
              </div>
              <div className="flex-1 p-3 flex gap-3 overflow-x-auto scrollbar-hide">
                {flow.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[10px] text-slate-700 uppercase font-bold border-2 border-dashed border-white/5 rounded-2xl m-2">
                    <Plus className="w-5 h-5 opacity-20" />
                    Drop modules from library to build your PSTM/PSDM sequence
                  </div>
                ) : flow.map((mod, i) => (
                  <div key={mod.instanceId} className="w-56 shrink-0 bg-slate-900 border border-white/10 rounded-2xl p-4 flex flex-col justify-between shadow-lg relative group/mod">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <span className="text-[10px] font-bold text-slate-100 uppercase tracking-tighter truncate w-36">{mod.name}</span>
                      </div>
                      <button onClick={() => setFlow(flow.filter(f => f.instanceId !== mod.instanceId))} className="text-slate-600 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="space-y-3">
                       {Object.entries(mod.params).map(([key, p]) => {
                         const param = p as ModuleParam;
                         return (
                           <div key={key} className="flex flex-col gap-1.5">
                              <div className="flex justify-between text-[8.5px] text-slate-500 font-bold uppercase tracking-tighter font-mono"><span>{param.label}</span><span className="text-blue-500">{param.value}</span></div>
                              <input type="range" min={param.min} max={param.max} step="0.1" value={param.value as number} onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setFlow(flow.map(m => m.instanceId === mod.instanceId ? { ...m, params: { ...m.params, [key]: { ...param, value: val } } } : m));
                              }} className="w-full h-1 accent-blue-500 bg-slate-800 rounded-full" />
                           </div>
                         );
                       })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* INTERPRETATION & LOGS PANELS */}
          <aside className="w-80 flex flex-col gap-6 shrink-0 h-full">
             {/* 1. Interpretation / Horizon List */}
             <div className="bg-[#0f172a] border border-white/5 rounded-3xl flex-1 flex flex-col overflow-hidden shadow-2xl relative">
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-black/10">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Database className="w-4 h-4 text-blue-400" /> Interpretation</span>
                  <button onClick={() => {
                    const nid = Date.now().toString();
                    setHorizons([...horizons, { id: nid, name: `Horiz_${horizons.length+1}`, color: '#'+Math.floor(Math.random()*16777215).toString(16), points: [], isVisible: true }]);
                    setDisplayConfig(p => ({...p, activeHorizonId: nid}));
                  }} className="p-2 bg-blue-600/10 text-blue-400 rounded-xl hover:bg-blue-600/20 transition-all shadow-lg active:scale-90"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                  {horizons.map(h => (
                    <div key={h.id} onClick={() => setDisplayConfig({...displayConfig, activeHorizonId: h.id})} className={`group p-4 rounded-2xl border transition-all cursor-pointer ${displayConfig.activeHorizonId === h.id ? 'bg-blue-600/10 border-blue-500/40 shadow-xl' : 'bg-slate-900/40 border-white/5 hover:border-white/20'}`}>
                      <div className="flex items-center justify-between mb-2">
                         <div className="flex items-center gap-3 flex-1 overflow-hidden">
                           <div className="w-3 h-3 rounded-full shadow-lg shrink-0" style={{ backgroundColor: h.color }} />
                           {editingHorizonId === h.id ? (
                             <input 
                                autoFocus
                                value={tempHorizonName} 
                                onChange={(e) => setTempHorizonName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveRename();
                                  if (e.key === 'Escape') setEditingHorizonId(null);
                                }}
                                onBlur={saveRename}
                                className="bg-slate-800 text-[11px] font-bold text-white px-2 py-1 rounded border border-blue-500/50 w-full outline-none animate-in fade-in" 
                             />
                           ) : (
                             <span className={`text-[11px] font-bold transition-colors truncate ${displayConfig.activeHorizonId === h.id ? 'text-white' : 'text-slate-400'}`}>{h.name}</span>
                           )}
                         </div>
                         <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                           {editingHorizonId !== h.id && (
                             <button onClick={(e) => { e.stopPropagation(); startRenaming(h); }} className="p-1 hover:text-white transition text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>
                           )}
                           <button onClick={(e) => { e.stopPropagation(); setHorizons(horizons.filter(x => x.id !== h.id)); if (displayConfig.activeHorizonId === h.id) setDisplayConfig({...displayConfig, activeHorizonId: null}) }} className="p-1 hover:text-red-400 transition text-slate-600"><Trash2 className="w-3.5 h-3.5" /></button>
                         </div>
                      </div>
                      <div className="flex justify-between items-center text-[8px] font-bold text-slate-500 uppercase tracking-tighter">
                        <span>{h.points.length} Samples Captured</span>
                        <div className="flex gap-2">
                           <Eye className="w-3 h-3" />
                           <Target className="w-3 h-3 text-emerald-500/40" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-5 border-t border-white/5 bg-black/20 space-y-4">
                   <div className="grid grid-cols-2 gap-3 font-mono">
                     <div className="flex flex-col gap-1 p-2 bg-slate-900/50 rounded-xl border border-white/5">
                        <span className="text-[7px] text-slate-600 uppercase font-bold">Viewport Gain</span>
                        <span className="text-[10px] text-blue-400">{displayConfig.gain.toFixed(1)}x</span>
                     </div>
                     <div className="flex flex-col gap-1 p-2 bg-slate-900/50 rounded-xl border border-white/5">
                        <span className="text-[7px] text-slate-600 uppercase font-bold">Samples</span>
                        <span className="text-[10px] text-blue-400">{rawDataset?.numSamples || 0}</span>
                     </div>
                   </div>
                   <button className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition flex items-center justify-center gap-3 shadow-lg shadow-blue-600/20 active:scale-95"><Download className="w-4 h-4" /> Export Horizon Pick</button>
                </div>
             </div>

             {/* 2. Kernel Feed / Terminal */}
             <div className="h-44 bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl">
              <div className="px-5 py-3 border-b border-white/5 text-[9px] font-bold text-slate-600 uppercase flex items-center gap-2 bg-black/20"><Terminal className="w-3.5 h-3.5 text-blue-500" /> Kernel Feed</div>
              <div className="flex-1 p-4 font-mono text-[9px] text-slate-500 overflow-y-auto scrollbar-hide space-y-1.5 bg-black/40">
                {logs.map((l, i) => (
                   <div key={i} className="animate-in fade-in slide-in-from-left duration-500 flex gap-2">
                      <span className="text-blue-900 font-bold opacity-50">[{i}]</span>
                      <span className="text-slate-400">{l}</span>
                   </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* AI CO-PILOT PANEL (Right Side Slide-in) */}
      {showChat && (
        <div className="fixed inset-y-0 right-0 w-[420px] z-50 shadow-[-100px_0_150px_rgba(0,0,0,0.8)] border-l border-white/10 animate-in slide-in-from-right duration-500 bg-[#0c0c0e]">
           <ChatPanel processingState={displayConfig} activeFlow={flow} />
           <button onClick={() => setShowChat(false)} className="absolute top-1/2 -left-12 w-12 h-12 bg-[#0f172a] border border-white/10 rounded-l-2xl flex items-center justify-center text-slate-400 hover:text-white transition shadow-2xl hover:bg-slate-800 border-r-0"><ChevronRight className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
};

const TabBtn: React.FC<{active: boolean, icon: any, label: string, onClick: () => void}> = ({ active, icon: Icon, label, onClick }) => (
  <button onClick={onClick} className={`px-5 py-2.5 rounded-lg text-[10px] font-bold uppercase transition flex items-center gap-2.5 ${active ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}><Icon className="w-4 h-4" /> {label}</button>
);

const Loader2 = ({className}: {className?: string}) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
);

export default App;