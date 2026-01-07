import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Plus, Waves, Target, LayoutDashboard, LineChart, AudioLines, 
  Database, Settings, Play, ChevronUp, ChevronDown, X, Folder, 
  RotateCcw, FileUp, MessageSquare, Sliders, PlusSquare, 
  Activity, ChevronRight, FilePlus, Terminal, Trash2, Download,
  PanelLeft, PanelBottom, ChevronLeft, Edit2, Check, Save,
  Crosshair, Info, Layers
} from 'lucide-react';
import SeismicCanvas from './components/SeismicCanvas';
import ChatPanel from './components/ChatPanel';
import { MODULE_LIBRARY } from './utils/ospModules';
import { generateSyntheticSeismic } from './utils/seismicGenerators';
import { SeismicDataset, ActiveModule, ProcessingState, SeismicTrace, Horizon, HorizonPoint, TreeItem, ChatMessage } from './types';
import { applyAGC, applyBandpass, applyMixing, applyTGain, calculateAverageSpectrum, calculateAVOCurve, applyWhitening, applyDecon, applyStack, applyInversion, applyNMO } from './utils/dsp';
import { parseSegy } from './utils/segyParser';
import { exportHorizonData } from './utils/exportUtils';

const STORAGE_KEY = 'OSP_PRO_ULTIMATE_PERSISTENT_V1';

const App: React.FC = () => {
  const [flow, setFlow] = useState<ActiveModule[]>([]);
  const [rawDataset, setRawDataset] = useState<SeismicDataset | null>(null);
  const [processedDataset, setProcessedDataset] = useState<SeismicDataset | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [editingHorizonId, setEditingHorizonId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Olá! Sou seu Geophysics Co-pilot. Pronto para processar dados SEGY de alta resolução?" }
  ]);

  const [logs, setLogs] = useState<string[]>(["[SYSTEM] SeismicStream Pro Initialized. Kernel 18.2"]);
  const [horizons, setHorizons] = useState<Horizon[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [displayConfig, setDisplayConfig] = useState<ProcessingState>({
    gain: 8.0,
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
      id: 'f-data', label: 'Surveys', type: 'folder', isOpen: true,
      children: [{ id: 'ds-1', label: rawDataset?.name || 'Empty Project', type: 'dataset' }]
    },
    {
      id: 'f-interp', label: 'Interpretation Layers', type: 'folder', isOpen: true,
      children: horizons.map(h => ({ id: h.id, label: h.name, type: 'horizon', color: h.color }))
    }
  ], [horizons, rawDataset]);

  const avoResult = useMemo(() => {
    const activeH = horizons.find(h => h.id === displayConfig.activeHorizonId);
    return calculateAVOCurve(processedDataset, activeH);
  }, [horizons, displayConfig.activeHorizonId, processedDataset]);

  const averageSpectrum = useMemo(() => {
    if (!processedDataset) return null;
    return calculateAverageSpectrum(processedDataset.traces);
  }, [processedDataset]);

  useEffect(() => {
    const initial = generateSyntheticSeismic(250, 1000);
    setRawDataset(initial);
    setProcessedDataset(initial);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setHorizons(data.horizons || []);
        setFlow(data.flow || []);
        if (data.chatMessages) setChatMessages(data.chatMessages);
        setDisplayConfig(prev => ({ ...prev, activeHorizonId: data.activeId || (data.horizons?.[0]?.id || null) }));
      } catch(e) { console.error("Load failed", e); }
    } else {
      const defaultH = { id: 'h1', name: 'Reflector_A', color: '#3b82f6', points: [], isVisible: true };
      setHorizons([defaultH]);
      setDisplayConfig(prev => ({ ...prev, activeHorizonId: 'h1' }));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 
      horizons, 
      flow, 
      activeId: displayConfig.activeHorizonId,
      chatMessages 
    }));
  }, [horizons, flow, displayConfig.activeHorizonId, chatMessages]);

  const addLog = (msg: string) => setLogs(p => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...p.slice(0, 12)]);

  const addHorizonPoint = useCallback((point: HorizonPoint) => {
    if (!displayConfig.activeHorizonId) return;
    setHorizons(prev => prev.map(h => {
      if (h.id === displayConfig.activeHorizonId) {
        const existingIdx = h.points.findIndex(p => p.traceIndex === point.traceIndex);
        const newPoints = [...h.points];
        if (existingIdx >= 0) newPoints[existingIdx] = point;
        else {
          newPoints.push(point);
          newPoints.sort((a, b) => a.traceIndex - b.traceIndex);
        }
        return { ...h, points: newPoints };
      }
      return h;
    }));
  }, [displayConfig.activeHorizonId]);

  const handleRenameHorizon = (id: string) => {
    setEditingHorizonId(id);
    const h = horizons.find(x => x.id === id);
    setEditingName(h?.name || '');
  };

  const saveHorizonName = () => {
    if (editingHorizonId) {
      setHorizons(prev => prev.map(h => h.id === editingHorizonId ? { ...h, name: editingName } : h));
      setEditingHorizonId(null);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    addLog(`IO: Initializing stream for ${file.name}...`);
    try {
      const dataset = await parseSegy(file);
      setRawDataset(dataset);
      setProcessedDataset(dataset);
      addLog(`IO: Successfully mapped ${dataset.traces.length} traces.`);
    } catch(err) { 
      addLog(`ERROR: Invalid or corrupt SEGY file.`);
      console.error(err);
    } finally {
      // Fix: Reset input value to allow re-importing same file
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const runFlow = async () => {
    if (isProcessing || !rawDataset) return;
    setIsProcessing(true);
    addLog("KERNEL: Processing sequence started...");
    const startTime = performance.now();
    try {
      let working: SeismicTrace[] = JSON.parse(JSON.stringify(rawDataset.traces));
      for (const mod of flow) {
        addLog(`FLOW: Applying ${mod.name}...`);
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
      addLog(`KERNEL: Cycle complete in ${(performance.now() - startTime).toFixed(1)}ms`);
    } catch (e) { addLog(`ERROR: Processing crash.`); } finally { setIsProcessing(false); }
  };

  return (
    <div className="flex h-screen w-screen bg-[#020617] text-slate-300 font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} onChange={handleFileImport} accept=".sgy,.seg,.segy" className="hidden" />

      {/* LEFT SIDEBAR */}
      {sidebarOpen ? (
        <aside className="w-80 bg-[#0f172a] border-r border-white/5 flex flex-col shrink-0 z-30 shadow-2xl animate-in slide-in-from-left duration-300">
          <div className="p-6 border-b border-white/5 flex items-center justify-between bg-black/20">
            <div className="flex items-center gap-3">
              <Waves className="text-blue-500 w-6 h-6" />
              <span className="font-bold text-white text-lg tracking-tight">OSP Studio</span>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="p-1 hover:bg-white/5 rounded text-slate-500"><ChevronLeft className="w-4 h-4" /></button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
            <section className="space-y-4">
               <div className="flex items-center justify-between px-2">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Folder className="w-3 h-3" /> Navigator</h4>
                  <button onClick={() => fileInputRef.current?.click()} className="p-1.5 bg-blue-600/10 text-blue-400 rounded-lg hover:bg-blue-600/20 transition flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-tighter">
                    <FilePlus className="w-3 h-3" /> Import SEGY
                  </button>
               </div>
               <div className="space-y-1">
                  {projectTree.map(node => (
                    <div key={node.id} className="space-y-1">
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-white/5 pb-1 mb-1">
                        <ChevronDown className="w-3 h-3 text-slate-600" /> {node.label}
                      </div>
                      <div className="pl-4 space-y-0.5">
                        {node.children?.map(child => (
                          <div key={child.id} onClick={() => child.type === 'horizon' && setDisplayConfig({...displayConfig, activeHorizonId: child.id})} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition group cursor-pointer ${displayConfig.activeHorizonId === child.id ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20' : 'hover:bg-white/5 text-slate-500 hover:text-slate-200'}`}>
                              {child.type === 'dataset' ? <Database className="w-3 h-3 text-amber-500" /> : <Activity className="w-3 h-3" style={{ color: child.color }} />}
                              <span className="text-[10.5px] truncate">{child.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
               </div>
            </section>

            <section className="space-y-4 pt-6 border-t border-white/5">
               <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><Sliders className="w-3 h-3" /> Visual Props</h4>
               <div className="px-2 space-y-4">
                 <div>
                   <div className="flex justify-between text-[10px] text-slate-500 font-bold mb-1.5"><span>Gain Factor</span><span className="text-blue-400">{displayConfig.gain.toFixed(1)}x</span></div>
                   <input type="range" min="0.1" max="50" step="0.5" value={displayConfig.gain} onChange={(e) => setDisplayConfig({...displayConfig, gain: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-blue-600 cursor-pointer" />
                 </div>
                 <div className="flex gap-2">
                   <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: false})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${!displayConfig.isWiggle ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/40' : 'bg-slate-800 border-white/5 text-slate-500'}`}>DENSITY</button>
                   <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: true})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${displayConfig.isWiggle ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/40' : 'bg-slate-800 border-white/5 text-slate-500'}`}>WIGGLE</button>
                 </div>
               </div>
            </section>

            <section className="space-y-4 pt-6 border-t border-white/5">
               <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><PlusSquare className="w-3 h-3" /> Processing Library</h4>
               <div className="grid grid-cols-1 gap-2">
                  {MODULE_LIBRARY.map(mod => (
                    <button key={mod.id} onClick={() => setFlow([...flow, {...mod, instanceId: Date.now().toString()}])} className="w-full p-2.5 rounded-xl bg-slate-800/40 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/30 text-left transition flex items-center justify-between group">
                      <span className="text-[10px] font-bold text-slate-400 group-hover:text-blue-400">{mod.name}</span>
                      <Plus className="w-3 h-3 text-slate-600 group-hover:text-blue-400" />
                    </button>
                  ))}
               </div>
            </section>
          </div>
        </aside>
      ) : (
        <div className="w-12 bg-[#0f172a] border-r border-white/5 flex flex-col items-center py-6 gap-6 shadow-xl shrink-0">
          <Waves className="text-blue-500 w-6 h-6" />
          <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-white/5 rounded-xl text-blue-500"><PanelLeft className="w-5 h-5" /></button>
        </div>
      )}

      {/* MAIN VIEWPORT */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-16 border-b border-white/5 px-8 flex items-center justify-between backdrop-blur-md bg-[#0f172a]/80 shrink-0 z-20 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
              <TabBtn active={displayConfig.activeTab === 'section'} icon={LayoutDashboard} label="Seismic Section" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'section'})} />
              <TabBtn active={displayConfig.activeTab === 'avo'} icon={LineChart} label="AVO Analysis" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'avo'})} />
              <TabBtn active={displayConfig.activeTab === 'spectral'} icon={AudioLines} label="Spectral" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'spectral'})} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { const d = generateSyntheticSeismic(250, 1000); setRawDataset(d); setProcessedDataset(d); addLog("IO: Synthetic Demo dataset generated."); }}
              className="px-4 py-2 rounded-xl text-[10px] font-bold border border-white/5 bg-slate-800/40 text-amber-500 hover:bg-slate-700 transition flex items-center gap-2"
            >
              <Database className="w-3.5 h-3.5" /> GENERATE DEMO
            </button>
            <button onClick={() => setDisplayConfig({...displayConfig, isPickerActive: !displayConfig.isPickerActive})} className={`px-4 py-2 rounded-xl text-[10px] font-bold border transition ${displayConfig.isPickerActive ? 'bg-amber-500/20 border-amber-500/50 text-amber-500 shadow-lg' : 'bg-slate-800/40 border-white/5 text-slate-500 hover:text-slate-300'}`}>
              <Crosshair className="w-3.5 h-3.5 mr-2" /> {displayConfig.isPickerActive ? 'PICKER ON' : 'PICKER OFF'}
            </button>
            <button onClick={runFlow} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition flex items-center gap-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"><Play className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} /> RUN ENGINE</button>
            <button onClick={() => setShowChat(!showChat)} className={`p-2.5 border rounded-xl transition shadow-lg ${showChat ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/5 text-slate-400 hover:text-white'}`}><MessageSquare className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="flex-1 p-6 flex flex-row gap-6 overflow-hidden relative">
          <div className="flex-1 flex flex-col gap-4 min-w-0 h-full">
            
            {/* METADATA CARDS */}
            {processedDataset && (
              <div className="grid grid-cols-3 gap-4 shrink-0 animate-in fade-in slide-in-from-top duration-700">
                 <MetadataCard icon={Layers} label="Seismic Type" value="2D High-Res Section" color="text-blue-400" />
                 <MetadataCard icon={Activity} label="Trace Count" value={processedDataset.traces.length.toLocaleString()} color="text-emerald-400" />
                 <MetadataCard icon={Database} label="Sample Count" value={processedDataset.numSamples.toLocaleString()} color="text-amber-400" />
              </div>
            )}

            <div className="flex-1 relative rounded-3xl overflow-hidden border border-white/5 bg-black shadow-2xl flex flex-col">
              {processedDataset ? (
                <>
                  {displayConfig.activeTab === 'section' && (
                    <SeismicCanvas dataset={processedDataset} config={displayConfig} horizons={horizons} onAddPoint={addHorizonPoint} />
                  )}
                  
                  {displayConfig.activeTab === 'avo' && (
                    <div className="absolute inset-0 p-12 bg-slate-950 flex flex-col items-center justify-center animate-in fade-in duration-500">
                      {avoResult ? (
                        <div className="w-full h-full max-w-5xl flex flex-col gap-8">
                           <div className="flex justify-between items-center bg-slate-900/60 p-8 rounded-3xl border border-white/5 backdrop-blur-xl">
                              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><LineChart className="w-4 h-4 text-blue-500" /> Intercept/Gradient Plot</h3>
                              <div className="flex gap-12">
                                 <div className="flex flex-col"><span className="text-[10px] text-slate-500 uppercase font-black">Intercept (P)</span><span className="text-2xl font-mono text-white tracking-tighter">{avoResult.regression?.intercept.toFixed(4) || '---'}</span></div>
                                 <div className="flex flex-col"><span className="text-[10px] text-slate-500 uppercase font-black">Gradient (G)</span><span className="text-2xl font-mono text-blue-400 tracking-tighter">{avoResult.regression?.slope.toFixed(6) || '---'}</span></div>
                              </div>
                           </div>
                           <div className="flex-1 border-l border-b border-white/10 relative flex items-end p-12 bg-black/40 rounded-3xl shadow-inner overflow-hidden">
                              <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 opacity-5 pointer-events-none">
                                {[...Array(16)].map((_, i) => <div key={i} className="border-r border-t border-white" />)}
                              </div>
                              {avoResult.points.map((p: any, i: number) => (
                                <div key={i} className="absolute w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.6)] hover:scale-150 transition-transform" 
                                     style={{ left: `${(p.offset / (Math.max(...processedDataset.traces.map(t=>t.header.offset)))) * 90}%`, bottom: `${p.normAmplitude * 90}%` }} />
                              ))}
                              {avoResult.regression && (
                                <svg className="absolute inset-0 w-full h-full pointer-events-none p-12">
                                   <line x1="0" y1="100%" x2="100%" y2="0" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                                </svg>
                              )}
                           </div>
                        </div>
                      ) : (
                        <div className="text-slate-800 text-[10px] font-black uppercase tracking-[0.4em] flex flex-col items-center gap-6"><Activity className="w-16 h-16 opacity-5 animate-pulse" /> PICK HORIZON POINTS TO VIEW AVO CURVE</div>
                      )}
                    </div>
                  )}

                  {displayConfig.activeTab === 'spectral' && (
                    <div className="absolute inset-0 p-12 bg-slate-950 flex flex-col items-center justify-center animate-in fade-in duration-500">
                      {averageSpectrum ? (
                         <div className="flex-1 w-full max-w-4xl flex flex-col gap-6">
                            <div className="bg-slate-900/60 p-6 rounded-3xl border border-white/5 flex items-center justify-between">
                              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><AudioLines className="w-4 h-4 text-purple-500" /> Power Spectral Density (PSD)</h3>
                              <span className="text-[10px] text-slate-600 font-mono">0 - 250 Hz Nyquist</span>
                            </div>
                            <div className="flex-1 flex items-end gap-1 px-8 pb-12 border-b border-l border-white/5 bg-black/20 rounded-3xl overflow-hidden relative">
                              {averageSpectrum.map((val: number, i: number) => (
                                <div key={i} className="flex-1 bg-gradient-to-t from-blue-600/80 to-purple-500/80 rounded-t-sm transition-all duration-1000 hover:from-white" style={{ height: `${val}%` }} />
                              ))}
                            </div>
                         </div>
                      ) : <span className="text-slate-800 text-[10px] font-black uppercase tracking-[0.4em]">NO SPECTRAL DATA AVAILABLE</span>}
                    </div>
                  )}
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 uppercase tracking-widest font-black text-xs space-y-4">
                  <Database className="w-16 h-16 opacity-5 animate-pulse" />
                  <span>PROJECT KERNEL STANDBY</span>
                  <div className="flex gap-3">
                    <button onClick={() => fileInputRef.current?.click()} className="px-6 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition shadow-xl shadow-blue-900/40">IMPORT SEGY</button>
                    <button onClick={() => { const d = generateSyntheticSeismic(250, 1000); setRawDataset(d); setProcessedDataset(d); }} className="px-6 py-2 bg-slate-800 text-slate-400 rounded-xl hover:bg-slate-700 transition">GENERATE DEMO</button>
                  </div>
                </div>
              )}
            </div>

            {/* FLOW PANEL - COLLAPSIBLE */}
            <div className={`transition-all duration-500 ${bottomPanelOpen ? 'h-52' : 'h-12'} bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl shrink-0 relative`}>
               <div className="px-5 py-3 border-b border-white/5 text-[9px] font-bold text-slate-600 uppercase flex items-center justify-between bg-black/20 shrink-0">
                  <div className="flex items-center gap-2 cursor-pointer" onClick={() => setBottomPanelOpen(!bottomPanelOpen)}>
                    <Settings className="w-3.5 h-3.5 text-blue-500" /> 
                    Active Processor Chain 
                    <span className="ml-2 text-[8px] bg-blue-600/20 px-1.5 py-0.5 rounded text-blue-400">{flow.length} Modules</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <button onClick={() => setFlow([])} className="hover:text-red-400 transition flex items-center gap-1 font-black"><RotateCcw className="w-3 h-3" /> FLUSH</button>
                    <button onClick={() => setBottomPanelOpen(!bottomPanelOpen)} className="p-1 hover:bg-white/5 rounded transition text-slate-500">
                      {bottomPanelOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                  </div>
               </div>
               {bottomPanelOpen && (
                 <div className="flex-1 p-4 flex gap-4 overflow-x-auto scrollbar-hide bg-black/40">
                    {flow.length === 0 ? (
                      <div className="flex-1 border-2 border-dashed border-white/5 rounded-2xl flex items-center justify-center text-[10px] text-slate-800 uppercase font-black tracking-[0.3em]">STACK MODULES FROM LIBRARY</div>
                    ) : flow.map((mod, i) => (
                      <div key={mod.instanceId} className="w-60 shrink-0 bg-slate-900/90 border border-white/10 rounded-2xl p-4 flex flex-col justify-between shadow-xl animate-in zoom-in duration-200">
                        <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                          <span className="text-[10px] font-bold text-blue-400 uppercase truncate w-36">{mod.name}</span>
                          <button onClick={() => setFlow(flow.filter(f => f.instanceId !== mod.instanceId))} className="text-slate-600 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="space-y-3">
                          {Object.entries(mod.params).map(([key, param]) => (
                            <div key={key} className="flex flex-col gap-1">
                                <div className="flex justify-between text-[8px] text-slate-500 uppercase font-bold"><span>{param.label}</span><span className="text-blue-200">{String(param.value)}</span></div>
                                <input type="range" min={param.min} max={param.max} step="0.1" value={param.value as number} onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  setFlow(flow.map(m => m.instanceId === mod.instanceId ? { ...m, params: { ...m.params, [key]: { ...param, value: val } } } : m));
                                }} className="w-full h-1 bg-slate-800 rounded-full appearance-none accent-blue-500 cursor-pointer" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                 </div>
               )}
            </div>
          </div>

          {/* INTERPRETATION & LOGS ASIDE */}
          {rightPanelOpen ? (
            <aside className="w-80 flex flex-col gap-6 shrink-0 h-full animate-in slide-in-from-right duration-500">
               <div className="bg-[#0f172a] border border-white/5 rounded-3xl flex-1 flex flex-col overflow-hidden shadow-2xl relative">
                  <div className="p-5 border-b border-white/5 flex items-center justify-between bg-black/10">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Target className="w-4 h-4 text-blue-400" /> Interpretations</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => {
                          const nid = Date.now().toString();
                          const newH: Horizon = { id: nid, name: `Layer_${horizons.length+1}`, color: '#'+Math.floor(Math.random()*16777215).toString(16), points: [], isVisible: true };
                          setHorizons([...horizons, newH]);
                          setDisplayConfig(p => ({...p, activeHorizonId: nid}));
                      }} className="p-1.5 bg-blue-600/10 text-blue-400 rounded-lg hover:bg-blue-600/20 transition"><Plus className="w-4 h-4" /></button>
                      <button onClick={() => setRightPanelOpen(false)} className="p-1.5 hover:bg-white/5 rounded transition text-slate-500"><ChevronRight className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                    {horizons.map(h => (
                      <div key={h.id} onClick={() => setDisplayConfig({...displayConfig, activeHorizonId: h.id})} className={`group p-4 rounded-2xl border transition-all cursor-pointer ${displayConfig.activeHorizonId === h.id ? 'bg-blue-600/10 border-blue-500/40 shadow-xl shadow-blue-900/10' : 'bg-slate-900/40 border-white/5 hover:border-white/10'}`}>
                        <div className="flex items-center justify-between mb-3">
                           <div className="flex items-center gap-3 overflow-hidden flex-1">
                             <div className="w-3 h-3 rounded-full shrink-0 shadow-lg" style={{ backgroundColor: h.color }} />
                             {editingHorizonId === h.id ? (
                               <div className="flex items-center gap-1 flex-1">
                                  <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveHorizonName()} className="bg-slate-800 border-none rounded px-1 text-[11px] font-bold text-white w-full outline-none" />
                                  <button onClick={saveHorizonName} className="text-blue-400 p-0.5"><Check className="w-3 h-3" /></button>
                               </div>
                             ) : (
                               <span className={`text-[11px] font-bold truncate ${displayConfig.activeHorizonId === h.id ? 'text-white' : 'text-slate-500'}`}>{h.name}</span>
                             )}
                           </div>
                           <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => { e.stopPropagation(); handleRenameHorizon(h.id); }} className="p-1 hover:text-white"><Edit2 className="w-3 h-3" /></button>
                              <button onClick={(e) => { e.stopPropagation(); setHorizons(horizons.filter(x => x.id !== h.id)); }} className="p-1 hover:text-red-500"><X className="w-3 h-3" /></button>
                           </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">{h.points.length} Samples Picked</div>
                          <div className="flex gap-1">
                             <button onClick={(e) => { e.stopPropagation(); exportHorizonData(h, 'csv'); }} className="p-1 text-[7px] font-bold bg-white/5 rounded hover:bg-white/10" title="CSV">CSV</button>
                             <button onClick={(e) => { e.stopPropagation(); exportHorizonData(h, 'dat'); }} className="p-1 text-[7px] font-bold bg-white/5 rounded hover:bg-white/10" title="DAT">DAT</button>
                             <button onClick={(e) => { e.stopPropagation(); exportHorizonData(h, 'json'); }} className="p-1 text-[7px] font-bold bg-white/5 rounded hover:bg-white/10" title="JSON">JSON</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
               </div>

               <div className="h-44 bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl shrink-0 relative group/logs">
                  <div className="px-5 py-3 border-b border-white/5 text-[9px] font-bold text-slate-600 uppercase flex items-center justify-between bg-black/20 shrink-0">
                    <div className="flex items-center gap-2"><Terminal className="w-3.5 h-3.5 text-blue-500" /> Kernel Feed</div>
                  </div>
                  <div className="flex-1 p-4 font-mono text-[9.5px] text-slate-500 overflow-y-auto scrollbar-hide space-y-1.5 bg-black/40">
                    {logs.map((l, i) => <div key={i} className="flex gap-2"><span className="text-blue-900 font-bold opacity-30">#</span>{l}</div>)}
                  </div>
               </div>
            </aside>
          ) : (
            <aside className="w-12 flex flex-col items-center py-6 gap-6 bg-[#0f172a] border-l border-white/5 shrink-0 shadow-2xl">
              <button onClick={() => setRightPanelOpen(true)} className="p-2 hover:bg-white/5 rounded-xl text-blue-500"><Target className="w-5 h-5" /></button>
            </aside>
          )}
        </div>
      </main>

      {/* CHAT OVERLAY */}
      {showChat && (
        <div className="fixed inset-y-0 right-0 w-[420px] z-50 shadow-2xl border-l border-white/10 bg-[#0c0c0e] animate-in slide-in-from-right duration-300">
           <ChatPanel processingState={displayConfig} activeFlow={flow} messages={chatMessages} onSetMessages={setChatMessages} />
           <button onClick={() => setShowChat(false)} className="absolute top-1/2 -left-12 w-12 h-12 bg-[#0f172a] border border-white/10 rounded-l-2xl flex items-center justify-center text-slate-400 hover:text-white transition shadow-2xl border-r-0"><ChevronRight className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
};

const TabBtn: React.FC<{active: boolean, icon: any, label: string, onClick: () => void}> = ({ active, icon: Icon, label, onClick }) => (
  <button onClick={onClick} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition flex items-center gap-2.5 tracking-widest ${active ? 'bg-blue-600 text-white shadow-xl shadow-blue-900/30' : 'text-slate-600 hover:text-slate-200 hover:bg-white/5'}`}>
    <Icon className="w-3.5 h-3.5" /> {label}
  </button>
);

const MetadataCard: React.FC<{icon: any, label: string, value: string, color: string}> = ({ icon: Icon, label, value, color }) => (
  <div className="bg-[#0f172a]/80 backdrop-blur border border-white/5 p-4 rounded-3xl flex items-center gap-4 shadow-xl">
    <div className={`p-2.5 bg-white/5 rounded-2xl ${color}`}>
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">{label}</div>
      <div className="text-xs font-bold text-slate-200">{value}</div>
    </div>
  </div>
);

export default App;