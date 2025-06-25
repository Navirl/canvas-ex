// groqApi.ts
// Groq API (https://api.groq.com/openai/v1/chat/completions) へPOSTリクエストを送る関数

export interface GroqChatCompletionRequest {
  model: string;
  messages: { role: string; content: string }[];
  [key: string]: any;
}

export interface GroqChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  choices: any[];
  usage: any;
  [key: string]: any;
}

export async function postGroqChatCompletion(
  apiKey: string,
  body: GroqChatCompletionRequest
): Promise<GroqChatCompletionResponse> {
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API error: ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json();
} 