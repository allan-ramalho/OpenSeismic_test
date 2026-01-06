
import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, BrainCircuit } from 'lucide-react';
import { ChatMessage, ProcessingState, ActiveModule } from '../types';
import { seismicAI } from '../services/geminiService';

interface Props {
  processingState: ProcessingState;
  activeFlow?: ActiveModule[];
}

const ChatPanel: React.FC<Props> = ({ processingState, activeFlow = [] }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Olá! Sou seu Geophysics Co-pilot. Posso te ajudar a configurar os parâmetros do OSP ou sugerir um workflow para o seu dataset. Como posso ajudar hoje?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    const response = await seismicAI.analyzeWorkflow(userMsg, activeFlow);
    setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#111114] border-l border-white/5">
      <div className="p-4 border-b border-white/5 bg-[#0c0c0e] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-blue-500" />
          <h2 className="text-xs font-bold text-slate-100 uppercase tracking-tight">Seismic Intelligence</h2>
        </div>
        <Sparkles className="w-4 h-4 text-purple-500" />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] p-3 rounded-2xl text-[11px] leading-relaxed shadow-lg ${
              m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-[#1a1a1e] text-slate-300 border border-white/5 rounded-tl-none'
            }`}>
              <div className="opacity-50 text-[8px] mb-1 font-bold uppercase tracking-widest">{m.role}</div>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1a1a1e] border border-white/5 p-3 rounded-2xl rounded-tl-none flex items-center gap-2">
              <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
              <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Calculando resposta técnica...</span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-[#0c0c0e] border-t border-white/5">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
            placeholder="Ex: 'Como melhorar o empilhamento?'"
            className="w-full bg-[#111114] border border-white/10 rounded-xl p-3 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none h-24 shadow-inner"
          />
          <button 
            onClick={handleSend} 
            disabled={!input.trim() || loading}
            className="absolute right-2 bottom-2 p-2 bg-blue-600 rounded-lg text-white shadow-lg active:scale-95 transition disabled:opacity-50"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
        <p className="text-[9px] text-slate-600 mt-2 text-center uppercase tracking-tighter">Powered by OSP Intelligence Engine</p>
      </div>
    </div>
  );
};

export default ChatPanel;
