import { GoogleGenAI } from "@google/genai";
import { ActiveModule } from "../types";

export class SeismicAIService {
  async analyzeWorkflow(query: string, currentFlow: ActiveModule[]) {
    // Initializing with the system-provided API Key.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const flowDescription = currentFlow.length > 0 
      ? currentFlow.map(m => `${m.name} (ID: ${m.id})`).join(' -> ')
      : "O fluxo está vazio no momento.";

    const systemInstruction = `Você é o Geophysics Co-pilot do OpenSeismicProcessing (OSP).
    Fluxo atual no canvas: ${flowDescription}.
    Seu papel é orientar o processamento sísmico, sugerindo parâmetros para AGC, Decon, Filtros e empilhamento.
    Use terminologia profissional de geofísica (PSTM, PSDM, CMP, NMO, etc.).
    Responda em Português do Brasil.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: query,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        }
      });
      // Correct extraction using .text property
      return response.text || "O modelo não retornou uma resposta válida.";
    } catch (error) {
      console.error("Gemini AI Kernel Error:", error);
      return "Ocorreu um erro ao consultar o kernel de inteligência geofísica.";
    }
  }
}

export const seismicAI = new SeismicAIService();