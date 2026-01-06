import { AnalysisResult } from "../types";

export const analyzeWithGemini = async (pairData: AnalysisResult) => {
  
  const prompt = `
    You are a senior crypto technical analyst. 
    Analyze the following automated scan result for ${pairData.symbol}.
    
    Strategy Context: 
    - HTF Trend (Last 3 candles): ${pairData.htf.trend}
    - HTF Bias (EMA50/200): ${pairData.htf.bias}
    - LTF Pullback (38-61%): ${pairData.ltf.isPullback ? 'YES' : 'NO'} (Depth: ${(pairData.ltf.pullbackDepth * 100).toFixed(1)}%)
    - Volume Contraction: ${pairData.ltf.volumeOk ? 'YES' : 'NO'}
    - Momentum (RSI 30-70): ${pairData.ltf.momentumOk ? 'YES' : 'NO'} (${pairData.ltf.rsi.toFixed(1)})
    
    Total Score: ${pairData.score}/100

    Provide a concise 3-sentence trading execution plan. 
    1. Confirm the setup validity based on the Bias and Pullback.
    2. Suggest a potential entry trigger.
    3. Suggest stop loss placement logic (e.g., below recent swing low).
    Tone: Professional, direct, no financial advice disclaimer filler.
  `;

  try {
    const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
        const err = await response.json();
        let errorMessage = 'Unknown error';
        
        if (err.error) {
            if (typeof err.error === 'string') {
                errorMessage = err.error;
            } else if (typeof err.error === 'object' && err.error.message) {
                errorMessage = err.error.message;
            } else {
                errorMessage = JSON.stringify(err.error);
            }
        }
        
        return `AI Error: ${errorMessage}`;
    }

    const data = await response.json();
    return data.text;

  } catch (error) {
    console.error("Gemini Error:", error);
    return "Unable to generate AI analysis at this time.";
  }
};