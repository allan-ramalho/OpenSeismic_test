import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Plus, Zap, ChevronRight, Settings2, Activity, 
  MessageSquare, Terminal, Trash2, Download, BarChart3, 
  Waves, MousePointer2, Eye, EyeOff, Target, LassoSelect, ShieldCheck, 
  LayoutDashboard, Map as MapIcon, LineChart, AudioLines, Search, Beaker, Database, AlertCircle, RotateCcw,
  Settings, Layers, Play, Save, ChevronUp, ChevronDown, X
} from 'lucide-react';
import SeismicCanvas from './components/SeismicCanvas';
import ChatPanel from './components/ChatPanel';
import { MODULE_LIBRARY } from './utils/ospModules';
import { generateSyntheticSeismic } from './utils/seismicGenerators';
import { SeismicDataset, ActiveModule, OSPModule, ProcessingState, SeismicTrace, Horizon, HorizonPoint, WorkspaceTab } from './types';
import { applyAGC, applyBandpass, applyMixing, applyTGain, calculateAverageSpectrum, autoTrackHorizon, calculateAVOCurve, applyWhitening, applyDecon, applyStack } from './utils/dsp';

const STORAGE_KEY = 'OSP_PRO_ULTIMATE_V5';

const App: React.FC = () => {
  const [flow, setFlow] = useState<ActiveModule[]>([]);
  const [rawDataset, setRawDataset] = useState<SeismicDataset | null>(null);
  const [processedDataset, setProcessedDataset] = useState<SeismicDataset | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [logs, setLogs] = useState<string[]>(["[KERNEL] OSP Engine v8.1 - Ready"]);
  const [horizons, setHorizons] = useState<Horizon[]>([]);
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

  // Mapeamento de Grid para o Time Map (20x20)
  const mapGrid = useMemo(() => {
    const grid = new Array(400).fill(null);
    const activeH = horizons.find(h => h.id === displayConfig.activeHorizonId);
    if (!activeH || activeH.points.length === 0) return grid;

    activeH.points.forEach(p => {
      // Mapeia o índice do traço (0-249) para a grade 20x20
      const traceNorm = p.traceIndex / (rawDataset?.traces.length || 250);
      const gridIdx = Math.floor(traceNorm * 400);
      if (gridIdx >= 0 && gridIdx < 400) {
        grid[gridIdx] = p.sampleIndex;
      }
    });
    return grid;
  }, [horizons, displayConfig.activeHorizonId, rawDataset]);

  const avoData = useMemo(() => {
    return calculateAVOCurve(processedDataset, horizons.find(h => h.id === displayConfig.activeHorizonId));
  }, [horizons, displayConfig.activeHorizonId, processedDataset]);

  // Added datasetMaxOffset to resolve ReferenceError on line 242
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
      } catch(e) { console.error("Failed to load state", e); }
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
    addLog("Executing DSP Stack...");
    const startTime = performance.now();
    try {
      let working: SeismicTrace[] = JSON.parse(JSON.stringify(rawDataset.traces));
      const sr = 1000 / rawDataset.sampleInterval;
      for (const mod of flow) {
        switch (mod.id) {
          case 'agc': working = working.map(t => ({...t, data: applyAGC(t.data, (mod.params.window.value as number)/rawDataset.sampleInterval)})); break;
          case 'bandpass': working = working.map(t => ({...t, data: applyBandpass(t.data, mod.params.lowCut.value as number, mod.params.highCut.value as number, sr)})); break;
          case 'tgain': working = working.map(t => ({...t, data: applyTGain(t.data, mod.params.exponent.value as number)})); break;
          case 'mixing': working = applyMixing(working, mod.params.numTraces.value as number); break;
          case 'whitening': working = working.map(t => ({...t, data: applyWhitening(t.data)})); break;
          case 'decon': working = working.map(t => ({...t, data: applyDecon(t.data, mod.params.opLength.value as number)})); break;
          case 'v_stack': working = applyStack(working, mod.params.velocity.value as number, rawDataset.sampleInterval); break;
        }
      }
      setProcessedDataset({ ...rawDataset, traces: working });
      addLog(`Full stack processed in ${(performance.now() - startTime).toFixed(1)}ms`);
    } catch (e) { addLog(`[ERROR] Processing failed: ${e}`); } finally { setIsProcessing(false); }
  };

  const exportInterpretation = () => {
    const exportData = {
      project: "OSP_PRO_EXPORT",
      timestamp: new Date().toISOString(),
      horizons: horizons.map(h => ({
        id: h.id,
        name: h.name,
        color: h.color,
        pointCount: h.points.length,
        points: h.points
      }))
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `OSP_Interpretation_${Date.now()}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    addLog("Interpretation exported as JSON.");
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
      <aside className="w-72 bg-[#0f172a] border-r border-white/5 flex flex-col shrink-0 z-30 shadow-2xl">
        <div className="p-6 border-b border-white/5 flex items-center gap-3">
          <Waves className="text-blue-500 w-6 h-6" />
          <span className="font-bold text-white text-lg tracking-tight">OSP Workspace</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6 no-scrollbar">
          <div className="space-y-4">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest flex items-center gap-2"><Layers className="w-3 h-3" /> Module Library</h4>
             <div className="grid grid-cols-1 gap-2">
                {MODULE_LIBRARY.map(mod => (
                  <button key={mod.id} onClick={() => setFlow([...flow, {...mod, instanceId: Date.now().toString()}])} className="group w-full p-3 rounded-xl bg-slate-800/40 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/30 text-left transition flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-white group-hover:text-blue-400 transition">{mod.name}</span>
                      <Plus className="w-3 h-3" />
                    </div>
                  </button>
                ))}
             </div>
          </div>
          <div className="space-y-4 pt-6 border-t border-white/5">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase px-2 tracking-widest">Display Params</h4>
             <div className="px-2 space-y-4">
               <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase"><span>Gain</span><span className="text-blue-400">{displayConfig.gain.toFixed(1)}x</span></div>
               <input type="range" min="0.1" max="20" step="0.5" value={displayConfig.gain} onChange={(e) => setDisplayConfig({...displayConfig, gain: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-800 rounded-lg appearance-none accent-blue-600" />
               <div className="flex gap-2">
                 <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: false})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${!displayConfig.isWiggle ? 'bg-blue-600 text-white' : 'bg-slate-800 border-white/5'}`}>DENSITY</button>
                 <button onClick={() => setDisplayConfig({...displayConfig, isWiggle: true})} className={`flex-1 py-2 rounded-lg text-[9px] font-bold border transition ${displayConfig.isWiggle ? 'bg-blue-600 text-white' : 'bg-slate-800 border-white/5'}`}>WIGGLE</button>
               </div>
             </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-white/5 px-8 flex items-center justify-between glass z-20">
          <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
            <TabBtn active={displayConfig.activeTab === 'section'} icon={LayoutDashboard} label="Section" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'section'})} />
            <TabBtn active={displayConfig.activeTab === 'map'} icon={MapIcon} label="Time Map" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'map'})} />
            <TabBtn active={displayConfig.activeTab === 'spectral'} icon={AudioLines} label="Spectral" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'spectral'})} />
            <TabBtn active={displayConfig.activeTab === 'avo'} icon={LineChart} label="AVO Analysis" onClick={() => setDisplayConfig({...displayConfig, activeTab: 'avo'})} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setDisplayConfig({...displayConfig, isPickerActive: !displayConfig.isPickerActive})} className={`px-4 py-2 rounded-xl text-[10px] font-bold border flex items-center gap-2 transition ${displayConfig.isPickerActive ? 'bg-amber-500/20 border-amber-500/50 text-amber-500 shadow-lg' : 'bg-slate-800/40 border-white/5 text-slate-500'}`}><MousePointer2 className="w-3.5 h-3.5" /> PICKER</button>
            <button onClick={runFlow} disabled={isProcessing} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-blue-600/20"><Play className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} /> EXECUTE</button>
            <button onClick={() => setShowChat(!showChat)} className="p-2.5 bg-slate-800 border border-white/5 rounded-xl text-slate-400 hover:text-white transition"><MessageSquare className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="flex-1 flex flex-row p-6 gap-6 bg-[#020617] scanline overflow-hidden">
          <div className="flex-1 flex flex-col gap-6 min-w-0 h-full">
            <div className="flex-1 relative rounded-3xl overflow-hidden border border-white/5 bg-black shadow-2xl">
              {displayConfig.activeTab === 'section' && processedDataset && (
                <SeismicCanvas dataset={processedDataset} config={displayConfig} horizons={horizons} onAddPoint={addHorizonPoint} />
              )}
              {displayConfig.activeTab === 'map' && (
                <div className="absolute inset-0 p-12 flex flex-col items-center justify-center bg-slate-950">
                   <h3 className="text-xs font-bold text-slate-500 mb-8 uppercase tracking-[0.3em]">Structural Time Surface</h3>
                   <div className="w-full max-w-xl aspect-square grid grid-cols-20 gap-px rounded-3xl overflow-hidden border border-white/10 p-2 bg-black/40">
                      {mapGrid.map((val, i) => (
                        <div key={i} className="transition-all duration-700" style={{ 
                          backgroundColor: val ? `rgba(${Math.floor((val/800)*255)}, 100, ${255 - Math.floor((val/800)*255)}, 0.8)` : 'rgba(255,255,255,0.02)',
                          boxShadow: val ? 'inset 0 0 10px rgba(0,0,0,0.5)' : 'none'
                        }} />
                      ))}
                   </div>
                   <div className="mt-8 flex items-center gap-6 text-[10px] uppercase font-bold text-slate-600">
                     <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded-sm" /> Raso</div>
                     <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500 rounded-sm" /> Profundo</div>
                   </div>
                </div>
              )}
              {displayConfig.activeTab === 'spectral' && processedDataset && (
                <div className="absolute inset-0 p-24 flex flex-col bg-slate-950">
                  <h3 className="text-xs font-bold text-slate-500 mb-12 uppercase tracking-[0.3em] text-center"><AudioLines className="inline mr-2 w-4 h-4 text-blue-500" /> Average Amplitude Spectrum</h3>
                  <div className="flex-1 flex items-end gap-1 px-12 border-b border-white/5 pb-1">
                    {calculateAverageSpectrum(processedDataset.traces).map((v, i) => (
                      <div key={i} className="bg-gradient-to-t from-blue-600/80 to-blue-400/20 w-full rounded-t-sm transition-all duration-1000" style={{ height: `${v}%` }} />
                    ))}
                  </div>
                  <div className="flex justify-between mt-6 text-[10px] text-slate-600 px-12 font-bold uppercase tracking-widest"><span>0 Hz</span><span>Nyquist (125 Hz)</span></div>
                </div>
              )}
              {displayConfig.activeTab === 'avo' && (
                <div className="absolute inset-0 p-24 flex flex-col items-center justify-center bg-slate-950">
                   {avoData ? (
                     <div className="w-full h-full flex flex-col max-w-3xl">
                        <h3 className="text-xs font-bold text-slate-500 mb-12 uppercase tracking-[0.3em] text-center">Amplitude variation with offset (Normalized)</h3>
                        <div className="flex-1 relative border-l-2 border-b-2 border-white/10 flex items-end">
                          <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 opacity-5">
                            {Array.from({length: 16}).map((_, i) => <div key={i} className="border border-white" />)}
                          </div>
                          {avoData.map((d: any, i: number) => (
                             <div key={i} className="absolute w-2.5 h-2.5 bg-amber-500 rounded-full shadow-[0_0_15px_rgba(245,158,11,0.6)] transform -translate-x-1/2 translate-y-1/2 group" 
                                  style={{ bottom: `${d.normAmplitude * 100}%`, left: `${(d.offset / (datasetMaxOffset || 6000)) * 100}%` }}>
                               <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 text-[8px] p-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-50">
                                 T:{d.traceIndex} | A:{d.amplitude.toFixed(3)}
                               </div>
                             </div>
                          ))}
                        </div>
                        <div className="mt-6 flex justify-between text-[10px] text-slate-600 uppercase font-bold"><span>Near (0m)</span><span>Far (6000m)</span></div>
                     </div>
                   ) : (
                     <div className="text-slate-700 text-xs uppercase font-bold flex flex-col items-center gap-4">
                       <AlertCircle className="w-8 h-8 opacity-20" />
                       Marque pontos no horizonte ativo para ver AVO
                     </div>
                   )}
                </div>
              )}
            </div>

            <div className="h-40 bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl">
              <div className="px-5 py-2.5 border-b border-white/5 text-[9px] font-bold text-slate-500 uppercase flex items-center justify-between">
                <div className="flex items-center gap-2"><Settings className="w-3.5 h-3.5 text-blue-500" /> Active Flow Stack</div>
                <span className="text-slate-700">{flow.length} Modules</span>
              </div>
              <div className="flex-1 p-3 flex gap-3 overflow-x-auto scrollbar-hide">
                {flow.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-[10px] text-slate-700 uppercase font-bold border-2 border-dashed border-white/5 rounded-2xl">Add modules to start processing</div>
                ) : flow.map((mod, i) => (
                  <div key={mod.instanceId} className="w-48 shrink-0 bg-slate-900 border border-white/10 rounded-2xl p-3 flex flex-col justify-between shadow-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter truncate w-32">{mod.name}</span>
                      <button onClick={() => setFlow(flow.filter(f => f.instanceId !== mod.instanceId))} className="text-slate-600 hover:text-red-500"><X className="w-3 h-3" /></button>
                    </div>
                    <div className="space-y-2">
                       {Object.entries(mod.params).map(([key, param]) => (
                         <div key={key} className="flex flex-col gap-1">
                            <div className="flex justify-between text-[8px] text-slate-500 font-bold uppercase"><span>{param.label}</span><span>{param.value}</span></div>
                            <input type="range" min={param.min} max={param.max} step="0.1" value={param.value as number} onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setFlow(flow.map(m => m.instanceId === mod.instanceId ? { ...m, params: { ...m.params, [key]: { ...param, value: val } } } : m));
                            }} className="w-full h-0.5 accent-blue-500" />
                         </div>
                       ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="w-80 flex flex-col gap-6 shrink-0 h-full">
             <div className="bg-[#0f172a] border border-white/5 rounded-3xl flex-1 flex flex-col overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Database className="w-4 h-4 text-blue-400" /> Interpretation</span>
                  <button onClick={() => {
                    const nid = Date.now().toString();
                    setHorizons([...horizons, { id: nid, name: `Horiz_${horizons.length+1}`, color: '#'+Math.floor(Math.random()*16777215).toString(16), points: [], isVisible: true }]);
                    setDisplayConfig(p => ({...p, activeHorizonId: nid}));
                  }} className="p-2 bg-blue-600/10 text-blue-400 rounded-xl hover:bg-blue-600/20"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
                  {horizons.map(h => (
                    <div key={h.id} onClick={() => setDisplayConfig({...displayConfig, activeHorizonId: h.id})} className={`group p-4 rounded-2xl border transition-all cursor-pointer ${displayConfig.activeHorizonId === h.id ? 'bg-blue-600/10 border-blue-500/40' : 'bg-slate-900/40 border-white/5 hover:border-white/20'}`}>
                      <div className="flex items-center justify-between mb-2">
                         <div className="flex items-center gap-3">
                           <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: h.color }} />
                           <span className={`text-[11px] font-bold ${displayConfig.activeHorizonId === h.id ? 'text-white' : 'text-slate-400'}`}>{h.name}</span>
                         </div>
                         <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                           <button onClick={(e) => { e.stopPropagation(); setHorizons(horizons.filter(x => x.id !== h.id)); if (displayConfig.activeHorizonId === h.id) setDisplayConfig({...displayConfig, activeHorizonId: null}) }} className="text-slate-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                         </div>
                      </div>
                      <div className="text-[8px] font-bold text-slate-500 uppercase">{h.points.length} Pts</div>
                    </div>
                  ))}
                </div>
                <div className="p-5 border-t border-white/5 bg-black/20">
                   <button onClick={exportInterpretation} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition flex items-center justify-center gap-3 shadow-lg shadow-blue-600/20"><Download className="w-4 h-4" /> Export interpretation</button>
                </div>
             </div>
             <div className="h-48 bg-[#0f172a] border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl">
              <div className="px-5 py-3 border-b border-white/5 text-[9px] font-bold text-slate-600 uppercase flex items-center gap-2"><Terminal className="w-3.5 h-3.5 text-blue-500" /> Kernel Feed</div>
              <div className="flex-1 p-4 font-mono text-[9px] text-slate-500 overflow-y-auto no-scrollbar space-y-1">
                {logs.map((l, i) => <div key={i} className="animate-in fade-in duration-300">{l}</div>)}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {showChat && (
        <div className="fixed inset-y-0 right-0 w-[420px] z-50 shadow-[-100px_0_150px_rgba(0,0,0,0.8)] border-l border-white/10 animate-in slide-in-from-right duration-500">
           <ChatPanel processingState={displayConfig} activeFlow={flow} />
           <button onClick={() => setShowChat(false)} className="absolute top-1/2 -left-12 w-12 h-12 bg-[#0f172a] border border-white/10 rounded-l-2xl flex items-center justify-center text-slate-400 hover:text-white transition shadow-2xl"><ChevronRight className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
};

const TabBtn: React.FC<{active: boolean, icon: any, label: string, onClick: () => void}> = ({ active, icon: Icon, label, onClick }) => (
  <button onClick={onClick} className={`px-5 py-2.5 rounded-lg text-[10px] font-bold uppercase transition flex items-center gap-2.5 ${active ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><Icon className="w-4 h-4" /> {label}</button>
);

export default App;