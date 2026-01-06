
import React from 'react';
import { Settings, Sliders, Activity, BrainCircuit, Trash2, Download } from 'lucide-react';
import { ProcessingState } from '../types';

interface Props {
  config: ProcessingState;
  setConfig: React.Dispatch<React.SetStateAction<ProcessingState>>;
}

const Sidebar: React.FC<Props> = ({ config, setConfig }) => {
  const handleChange = (key: keyof ProcessingState, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="w-80 bg-slate-800 border-r border-slate-700 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-slate-700 flex items-center gap-2">
        <Activity className="w-6 h-6 text-blue-400" />
        <h1 className="text-xl font-bold tracking-tight text-white">SeismicStream</h1>
      </div>

      <div className="p-6 space-y-8">
        <section>
          <div className="flex items-center gap-2 mb-4 text-slate-400 uppercase text-xs font-bold tracking-widest">
            <Sliders className="w-4 h-4" />
            Display Controls
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-300 block mb-2">Display Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => handleChange('isWiggle', false)}
                  className={`py-2 px-3 rounded text-xs transition ${!config.isWiggle ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                >
                  Density
                </button>
                <button 
                  onClick={() => handleChange('isWiggle', true)}
                  className={`py-2 px-3 rounded text-xs transition ${config.isWiggle ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                >
                  Wiggle
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm text-slate-300">Amplitude Gain</label>
                <span className="text-xs text-blue-400 mono">{config.gain.toFixed(1)}x</span>
              </div>
              <input 
                type="range" min="0.1" max="10" step="0.1" 
                value={config.gain}
                onChange={(e) => handleChange('gain', parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4 text-slate-400 uppercase text-xs font-bold tracking-widest">
            <Settings className="w-4 h-4" />
            Signal Processing
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm text-slate-300">Low Cut Filter</label>
                <span className="text-xs text-blue-400 mono">{config.lowCut} Hz</span>
              </div>
              <input 
                type="range" min="0" max="60" 
                value={config.lowCut}
                onChange={(e) => handleChange('lowCut', parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm text-slate-300">High Cut Filter</label>
                <span className="text-xs text-blue-400 mono">{config.highCut} Hz</span>
              </div>
              <input 
                type="range" min="60" max="250" 
                value={config.highCut}
                onChange={(e) => handleChange('highCut', parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm text-slate-300">AGC Window</label>
                <span className="text-xs text-blue-400 mono">{config.agcWindow} ms</span>
              </div>
              <input 
                type="range" min="0" max="1000" step="50" 
                value={config.agcWindow}
                onChange={(e) => handleChange('agcWindow', parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          </div>
        </section>

        <div className="pt-4 border-t border-slate-700">
           <button className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-2 rounded mb-2 flex items-center justify-center gap-2">
             <Download className="w-4 h-4" /> Export SEGY
           </button>
           <button className="w-full bg-red-900/30 hover:bg-red-900/50 text-red-400 text-sm py-2 rounded flex items-center justify-center gap-2 border border-red-900/50">
             <Trash2 className="w-4 h-4" /> Clear Dataset
           </button>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
