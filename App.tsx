import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Plus, Waves, Target, LayoutDashboard, LineChart, AudioLines, 
  Database, Settings, Play, ChevronUp, ChevronDown, X, Folder, 
  Edit2, Trash2, Download, Terminal, RotateCcw, FileUp, 
  MessageSquare, Sliders, PlusSquare, PanelLeftClose, PanelLeftOpen, 
  PanelRightClose, PanelRightOpen, Activity, ChevronRight, Zap
} from 'lucide-react';
import SeismicCanvas from './components/SeismicCanvas';
import ChatPanel from './components/ChatPanel';
import { MODULE_LIBRARY } from './utils/ospModules';
import { generateSyntheticSeismic } from './utils/seismicGenerators';
import { SeismicDataset, ActiveModule, ProcessingState, SeismicTrace, Horizon, HorizonPoint, TreeItem, ChatMessage } from './types';
import { applyAGC, applyBandpass, applyMixing, applyTGain, calculateAverageSpectrum, calculateAVOCurve, applyWhitening, applyDecon, applyStack, applyInversion, applyNMO } from './utils/dsp';

const STORAGE_KEY = 'OSP_PRO_ULTIMATE_PERSISTENT_V1';

const App: React.FC = () => {
  const [flow, setFlow] = useState<ActiveModule[]>([]);
  const [rawDataset, setRawDataset] = useState<SeismicDataset | null>(null);
  const [processedDataset, setProcessedDataset] = useState<SeismicDataset | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  
  // Persistent Chat History
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Olá! Sou seu Geophysics Co-pilot. Posso te ajudar a configurar os parâmetros do OSP ou sugerir um workflow para o seu dataset. Como posso ajudar hoje?" }
  ]);

  const [logs, setLogs] = useState<string[]>(["[KERNEL] OSP Suite v18.0 - SYSTEMS ONLINE"]);
  const [horizons, setHorizons] = useState<Horizon[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
        if (data.chatMessages) setChatMessages(data.chatMessages);
        setDisplayConfig(prev => ({ ...prev, activeHorizonId: data.activeId || (data.horizons?.[0]?.id || null) }));
      } catch(e) { console.error("Load failed", e); }
    } else {
      const defaultH = { id: 'h1', name: 'Reflector_Main', color: '#3b82f6', points: [], isVisible: true };
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
          case 'read_segy': addLog("IO: Module active. Syncing headers..."); break;
        }
      }
      setProcessedDataset({ ...rawDataset, traces: working });
      addLog(`Kernel: Flow completed in ${(performance.now() - startTime).toFixed(1)}ms`);
    } catch (e) { addLog(`[ERROR] Workflow failed: ${e}`); } finally { setIsProcessing(false); }
  };

  return (
    <div className="flex h-screen w-screen bg-[#020617] text-slate-300 font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          addLog(`System: Parsing SEGY file...`);
          const { parseSegy } = await import('./utils/segyParser');
          try {
            const dataset = await parseSegy(file);
            setRawDataset(dataset);
            setProcessedDataset(dataset);
            addLog(`System: SEGY parsed. ${dataset.traces.length} traces.`);
          } catch(err) { addLog(`ERROR: Parse failed.`); }
      }} accept=".sgy,.seg,.segy" className="hidden" />

      {/* SIDEBAR */}
      <aside className="w-80 bg-[#0f172a] border-r border-white/5 flex flex-col shrink-0 z-30 shadow-2xl">
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3">
            <Waves className="text-blue-500 w-6 h-6" />
            <span className="font-bold text-white text-lg tracking-tight">OSP Suite</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
          <div className="space-y-4">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><Folder className="w-3 h-3" /> Navigator</h4>
             <div className="space-y-1">
                {projectTree.map(node => (
                  <div key={node.id} className="space-y-1">
                    <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-slate-400">
                      <ChevronDown className="w-3 h-3 text-slate-600" />
                      {node.label}
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
          </div>

          <div className="space-y-4 pt-6 border-t border-white/5">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><Sliders className="w-3 h-3" /> Display Props</h4>
             <div className="px-2 space-y-4">
               <div>
                 <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase mb-1.5"><span>Gain</span><span className="text-blue-400">{displayConfig.gain.toFixed(1)}x</span></div>
                 <input type="range" min="0.1" max="25" step="0.5" value={displayConfig.gain} onChange={(e) => setDisplayConfig({...displayConfig, gain: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-blue-600 cursor-pointer" />
               </div>
               <div className="flex gap-2">
                 <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: false})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${!displayConfig.isWiggle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/5 text-slate-500'}`}>DENSITY</button>
                 <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: true})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${displayConfig.isWiggle ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/5 text-slate-500'}`}>WIGGLE</button>
               </div>
             </div>
          </div>

          <div className="space-y-4 pt-6 border-t border-white/5">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><PlusSquare className="w-3 h-3" /> Processing Library</h4>
             <div className="grid grid-cols-1 gap-2">
                {MODULE_LIBRARY.map(mod => (
                  <button key={mod.id} onClick={() => setFlow([...flow, {...mod, instanceId: Date.now().toString()}])} className="w-full p-2.5 rounded-xl bg-slate-800/40 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/30 text-left transition flex items-center justify-between group">
                    <span className="text-[10px] font-bold text-slate-400 group-hover:text-blue-400">{mod.name}</span>
                    <Plus className="w-3 h-3 text-slate-600 group-hover:text-blue-400" />
                  </button>
                ))}
             </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-16 border-b border-white/5 px-8 flex items-center justify-between backdrop-blur-md bg-[#0f172a]/80 shrink-0 z-20 shadow-xl">
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
            <TabBtn active={displayConfig.activeTab === 'section'} icon={LayoutDashboard} label="Section" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'section'})} />
            <TabBtn active={displayConfig.activeTab === 'avo'} icon={LineChart} label="AVO Analysis" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'avo'})} />
            <TabBtn active={displayConfig.activeTab === 'spectral'} icon={AudioLines} label="Spectral" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'spectral'})} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setDisplayConfig({...displayConfig, isPickerActive: !displayConfig.isPickerActive})} className={`px-4 py-2 rounded-xl text-[10px] font-bold border transition ${displayConfig.isPickerActive ? 'bg-amber-500/20 border-amber-500/50 text-amber-500 shadow-lg' : 'bg-slate-800/40 border-white/5 text-slate-500 hover:text-slate-300'}`}>{displayConfig.isPickerActive ? 'PICKER ON' : 'PICKER OFF'}</button>
            <button onClick={runFlow} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition flex items-center gap-2 shadow-lg shadow-blue-600/20 disabled:opacity-50"><Play className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} /> RUN FLOW</button>
            <button onClick={() => setShowChat(!showChat)} className="p-2.5 bg-slate-800 border border-white/5 rounded-xl text-slate-400 hover:text-white transition shadow-lg"><MessageSquare className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden relative">
          <div className="flex-1 flex flex-row gap-6 overflow-hidden relative min-h-0">
            <div className="flex-1 flex flex-col gap-6 min-w-0 h-full">
              <div className="flex-1 relative rounded-3xl overflow-hidden border border-white/5 bg-black shadow-2xl">
                {displayConfig.activeTab === 'section' && processedDataset && (
                  <SeismicCanvas dataset={processedDataset} config={displayConfig} horizons={horizons} onAddPoint={addHorizonPoint} />
                )}
                
                {displayConfig.activeTab === 'avo' && (
                  <div className="absolute inset-0 p-12 bg-slate-950 flex flex-col items-center justify-center">
                    {avoResult ? (
                      <div className="w-full h-full max-w-4xl flex flex-col gap-8">
                         <div className="flex justify-between items-center bg-slate-900 p-6 rounded-2xl border border-white/5">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Intercept/Gradient Stats</h3>
                            <div className="flex gap-8">
                               <div className="flex flex-col"><span className="text-[9px] text-slate-500 uppercase font-black">Intercept</span><span className="text-xl font-mono text-white">{avoResult.regression.intercept.toFixed(4)}</span></div>
                               <div className="flex flex-col"><span className="text-[9px] text-slate-500 uppercase font-black">Gradient</span><span className="text-xl font-mono text-blue-400">{avoResult.regression.slope.toFixed(6)}</span></div>
                            </div>
                         </div>
                         <div className="flex-1 border-l border-b border-white/10 relative flex items-end p-8 bg-black/20 rounded-tr-3xl">
                            {avoResult.points.map((p: any, i: number) => (
                              <div key={i} className="absolute w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.6)]" style={{ left: `${(p.offset / datasetMaxOffset) * 100}%`, bottom: `${p.normAmplitude * 100}%` }} />
                            ))}
                         </div>
                      </div>
                    ) : (
                      <div className="text-slate-800 text-[10px] font-black uppercase tracking-[0.3em] flex flex-col items-center gap-4"><Activity className="w-12 h-12 opacity-10" /> Select active horizon and pick points</div>
                    )}
                  </div>
                )}

                {displayConfig.activeTab === 'spectral' && (
                  <div className="absolute inset-0 p-12 bg-slate-950 flex flex-col items-center justify-center">
                    {averageSpectrum ? (
                       <div className="flex-1 w-full max-w-3xl flex items-end gap-1 px-8 pb-12 border-b border-l border-white/5">
                        {averageSpectrum.map((val: number, i: number) => (
                          <div key={i} className="flex-1 bg-blue-600/80 rounded-t-sm transition-all duration-700" style={{ height: `${val}%` }} />
                        ))}
                      </div>
                    ) : <span className="text-slate-800 text-[10px] font-black uppercase">No spectral data</span>}
                  </div>
                )}
              </div>

              <div className="h-44 bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl relative shrink-0">
                <div className="px-5 py-3 border-b border-white/5 text-[9px] font-bold text-slate-600 uppercase flex items-center justify-between bg-black/20">
                  <div className="flex items-center gap-2"><Settings className="w-3.5 h-3.5 text-blue-500" /> Processing Flow Stack</div>
                  <button onClick={() => setFlow([])} className="hover:text-red-400 transition flex items-center gap-1 font-black"><RotateCcw className="w-3 h-3" /> FLUSH</button>
                </div>
                <div className="flex-1 p-3 flex gap-3 overflow-x-auto scrollbar-hide">
                  {flow.length === 0 ? (
                    <div className="flex-1 border-2 border-dashed border-white/5 rounded-2xl m-2 flex items-center justify-center text-[10px] text-slate-700 uppercase font-black tracking-[0.3em]">Build workflow sequence</div>
                  ) : flow.map((mod, i) => (
                    <div key={mod.instanceId} className="w-56 shrink-0 bg-slate-900/80 border border-white/10 rounded-2xl p-4 flex flex-col justify-between shadow-xl">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold text-blue-400 uppercase truncate w-36">{mod.name}</span>
                        <button onClick={() => setFlow(flow.filter(f => f.instanceId !== mod.instanceId))} className="text-slate-600 hover:text-red-500 transition"><X className="w-4 h-4" /></button>
                      </div>
                      <div className="space-y-3">
                        {Object.entries(mod.params).map(([key, param]) => (
                          <div key={key} className="flex flex-col gap-1">
                              <div className="flex justify-between text-[8px] text-slate-600 uppercase font-bold"><span>{param.label}</span><span className="text-blue-200">{String(param.value)}</span></div>
                              <input type="range" min={param.min} max={param.max} step="0.1" value={param.value as number} onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setFlow(flow.map(m => m.instanceId === mod.instanceId ? { ...m, params: { ...m.params, [key]: { ...param, value: val } } } : m));
                              }} className="w-full h-1 bg-slate-800 rounded-full appearance-none accent-blue-500" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <aside className="w-80 flex flex-col gap-6 shrink-0 h-full">
               <div className="bg-[#0f172a] border border-white/5 rounded-3xl flex-1 flex flex-col overflow-hidden shadow-2xl relative">
                  <div className="p-5 border-b border-white/5 flex items-center justify-between bg-black/10">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Target className="w-4 h-4 text-blue-400" /> Interpretation</span>
                    <button onClick={() => {
                        const nid = Date.now().toString();
                        setHorizons([...horizons, { id: nid, name: `Refl_${horizons.length+1}`, color: '#'+Math.floor(Math.random()*16777215).toString(16), points: [], isVisible: true }]);
                        setDisplayConfig(p => ({...p, activeHorizonId: nid}));
                    }} className="p-1.5 bg-blue-600/10 text-blue-400 rounded-lg hover:bg-blue-600/20 transition"><Plus className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                    {horizons.map(h => (
                      <div key={h.id} onClick={() => setDisplayConfig({...displayConfig, activeHorizonId: h.id})} className={`group p-3 rounded-xl border transition-all cursor-pointer ${displayConfig.activeHorizonId === h.id ? 'bg-blue-600/10 border-blue-500/30' : 'bg-slate-900/40 border-white/5 hover:border-white/10'}`}>
                        <div className="flex items-center gap-3 mb-1 overflow-hidden">
                           <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
                           <span className={`text-[11px] font-bold truncate ${displayConfig.activeHorizonId === h.id ? 'text-white' : 'text-slate-500'}`}>{h.name}</span>
                        </div>
                        <div className="text-[8px] font-black text-slate-700 uppercase">{h.points.length} Points</div>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 bg-black/20 border-t border-white/5">
                     <button className="w-full py-2 bg-slate-800 border border-white/5 rounded-xl text-[9px] font-bold uppercase tracking-widest hover:bg-slate-700 transition">Export Pick</button>
                  </div>
               </div>

               <div className="h-44 bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl">
                <div className="px-5 py-3 border-b border-white/5 text-[9px] font-bold text-slate-600 uppercase flex items-center gap-2 bg-black/20"><Terminal className="w-3.5 h-3.5 text-blue-500" /> Kernel Feed</div>
                <div className="flex-1 p-4 font-mono text-[9px] text-slate-500 overflow-y-auto scrollbar-hide space-y-1 bg-black/40">
                  {logs.map((l, i) => <div key={i} className="flex gap-2"><span className="text-blue-900 font-bold opacity-30">#</span>{l}</div>)}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {showChat && (
        <div className="fixed inset-y-0 right-0 w-[420px] z-50 shadow-2xl border-l border-white/10 animate-in slide-in-from-right duration-500 bg-[#0c0c0e]">
           <ChatPanel 
             processingState={displayConfig} 
             activeFlow={flow} 
             messages={chatMessages}
             onSetMessages={setChatMessages}
           />
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