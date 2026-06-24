export async function callAi(payload: {
  messages: Array<{ role: string; content: string }>;
  tools?: any[];
  tool_choice?: any;
  max_tokens?: number;
}) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  const maxTokens = payload.max_tokens ?? 4096;
  const errors: string[] = [];

  if (lovableKey) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: payload.messages,
          tools: payload.tools,
          tool_choice: payload.tool_choice,
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI error (Lovable: ${res.status}): ${text}`);
      }
      return await res.json();
    } catch (e: any) {
      console.warn("Lovable API failed, trying fallback. Error:", e.message);
      errors.push(e.message);
    }
  }

  if (geminiKey) {
    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${geminiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gemini-1.5-flash",
            messages: payload.messages,
            tools: payload.tools,
            tool_choice: payload.tool_choice,
            max_tokens: maxTokens,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI error (Gemini API: ${res.status}): ${text}`);
      }
      return await res.json();
    } catch (e: any) {
      console.warn("Gemini API failed, trying fallback. Error:", e.message);
      errors.push(e.message);
    }
  }

  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: payload.messages,
          tools: payload.tools,
          tool_choice: payload.tool_choice,
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI error (OpenAI API: ${res.status}): ${text}`);
      }
      return await res.json();
    } catch (e: any) {
      console.warn("OpenAI API failed, trying fallback. Error:", e.message);
      errors.push(e.message);
    }
  }

  if (openrouterKey) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:8080",
          "X-Title": "Paperflow Studio",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: payload.messages,
          tools: payload.tools,
          tool_choice: payload.tool_choice,
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI error (OpenRouter API: ${res.status}): ${text}`);
      }
      return await res.json();
    } catch (e: any) {
      console.warn("OpenRouter API failed. Error:", e.message);
      errors.push(e.message);
    }
  }

  const combinedError =
    errors.length > 0
      ? `All configured AI providers failed:\n- ${errors.join("\n- ")}`
      : "AI gateway not configured. Please define LOVABLE_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in your .env file.";
  throw new Error(combinedError);
}
