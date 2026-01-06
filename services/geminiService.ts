
import { GoogleGenAI } from "@google/genai";
import { ActiveModule } from "../types";

export class SeismicAIService {
  async analyzeWorkflow(query: string, currentFlow: ActiveModule[]) {
    // Correct initialization with named parameter using the environment variable directly.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const flowDescription = currentFlow.length > 0 
      ? currentFlow.map(m => `${m.name} (${JSON.stringify(m.params)})`).join(' -> ')
      : "Nenhum módulo no fluxo ainda.";

    const systemPrompt = `Você é o Geophysics Co-pilot do OpenSeismicProcessing (OSP).
    O usuário está montando um fluxo de processamento sísmico.
    Fluxo atual: ${flowDescription}.
    Sua tarefa é sugerir módulos, explicar o efeito físico de parâmetros (como janelas de AGC ou filtros Bandpass) e ajudar na interpretação de refletores.
    Responda em Português do Brasil com terminologia técnica de geofísica.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: query,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.7,
        }
      });
      // Correct property access .text (not a method) for extracting output.
      return response.text || "Não consegui analisar o fluxo agora.";
    } catch (error) {
      console.error("Gemini Error:", error);
      return "Erro de conexão com o serviço de inteligência geofísica.";
    }
  }
}

export const seismicAI = new SeismicAIService();
