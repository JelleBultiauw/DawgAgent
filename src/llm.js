// Streaming client voor de DeepSeek (OpenAI-compatibele) Chat Completions API.
const { httpFetch, describeNetError } = require('./http');

// Als er zo lang geen echte data binnenkomt (keep-alives tellen niet), wordt het verzoek opnieuw gedaan.
const STALL_MS = 150000;

class StallError extends Error {}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Afgebroken', 'AbortError'));
    });
  });

function friendlyError(status, body) {
  let msg = body;
  try {
    msg = JSON.parse(body).error?.message || body;
  } catch {}
  if (status === 401) return 'Je API-sleutel is ongeldig (401). Controleer hem in Instellingen.';
  if (status === 402) return 'Onvoldoende saldo op je DeepSeek-account (402).';
  if (status === 429) return 'Te veel verzoeken tegelijk (429). Probeer het zo opnieuw.';
  return `API-fout ${status}: ${String(msg).slice(0, 600)}`;
}

function isDeepSeek(baseUrl) {
  return /deepseek\.com/i.test(baseUrl || '');
}

function endpoint(cfg, pathname) {
  return `${String(cfg.baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '')}${pathname}`;
}

function headers(apiKey) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

// Bouwt de modelparameters (denkmodus) op basis van de instellingen.
function modelParams(cfg) {
  const params = { model: cfg.model };
  if (isDeepSeek(cfg.baseUrl)) {
    if (cfg.thinking === 'off') params.thinking = { type: 'disabled' };
    else {
      params.thinking = { type: 'enabled' };
      params.reasoning_effort = cfg.thinking || 'high';
    }
  } else if (cfg.thinking && cfg.thinking !== 'off') {
    params.reasoning_effort = cfg.thinking;
  }
  return params;
}

async function readStream(res, out, onEvent, onProgress) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      onProgress?.();
      if (json.error) throw new Error(json.error.message || 'Onbekende API-fout');
      if (json.usage) out.usage = json.usage;
      const choice = json.choices?.[0];
      if (!choice) continue;
      const d = choice.delta || {};
      if (d.reasoning_content) {
        out.reasoning_content += d.reasoning_content;
        onEvent?.({ type: 'reasoning', text: d.reasoning_content });
      }
      if (d.content) {
        out.content += d.content;
        onEvent?.({ type: 'content', text: d.content });
      }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? 0;
        const call = (out.tool_calls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) call.id = tc.id;
        if (tc.function?.name && !call.function.name) {
          call.function.name = tc.function.name;
          onEvent?.({ type: 'tool_call_start', index: i, name: call.function.name });
        }
        if (tc.function?.arguments) {
          call.function.arguments += tc.function.arguments;
          onEvent?.({ type: 'tool_call_delta', index: i, length: call.function.arguments.length });
        }
      }
      if (choice.finish_reason) out.finish_reason = choice.finish_reason;
    }
  }
  out.tool_calls = out.tool_calls.filter(Boolean).map((c, i) => ({
    ...c,
    id: c.id || `call_${Date.now().toString(36)}_${i}`,
  }));
  return out;
}

// `out` wordt tijdens het streamen gevuld, zodat een afgebroken antwoord bewaard kan worden.
async function streamChat({ cfg, apiKey, body, signal, onEvent, out, stallMs = STALL_MS }) {
  const url = endpoint(cfg, '/chat/completions');
  for (let attempt = 0; ; attempt++) {
    Object.assign(out, { content: '', reasoning_content: '', tool_calls: [], finish_reason: null, usage: null });
    const stall = new AbortController();
    let lastProgress = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgress > stallMs) stall.abort();
    }, Math.min(5000, stallMs / 4));
    const requestSignal = signal ? AbortSignal.any([signal, stall.signal]) : stall.signal;
    const stalled = () => stall.signal.aborted && !signal?.aborted;

    try {
      let res;
      try {
        res = await httpFetch(url, {
          method: 'POST',
          headers: headers(apiKey),
          body: JSON.stringify({ ...modelParams(cfg), ...body, stream: true, stream_options: { include_usage: true } }),
          signal: requestSignal,
        });
      } catch (e) {
        if (stalled()) throw new StallError();
        if (signal?.aborted) throw e;
        if (attempt < 3) {
          onEvent?.({ type: 'retry', attempt: attempt + 1, reason: describeNetError(e) });
          await sleep(1500 * 2 ** attempt, signal);
          continue;
        }
        throw new Error(`Kan de API niet bereiken: ${describeNetError(e)}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
          onEvent?.({ type: 'retry', attempt: attempt + 1, reason: `status ${res.status}` });
          await sleep(2000 * 2 ** attempt, signal);
          continue;
        }
        throw new Error(friendlyError(res.status, text));
      }
      lastProgress = Date.now();
      try {
        return await readStream(res, out, onEvent, () => {
          lastProgress = Date.now();
        });
      } catch (e) {
        if (stalled()) throw new StallError();
        throw e;
      }
    } catch (e) {
      if (!(e instanceof StallError)) throw e;
      if (attempt < 2) {
        onEvent?.({ type: 'retry', attempt: attempt + 1, reason: 'DeepSeek reageert niet meer' });
        continue;
      }
      throw new Error(
        `DeepSeek stuurt al ${Math.round(stallMs / 60000)} minuten niets terug (${attempt + 1} pogingen). Probeer het zo opnieuw met "ga door", of zet Nadenken lager.`,
      );
    } finally {
      clearInterval(watchdog);
    }
  }
}

// Kleine niet-streamende aanroep (bijv. voor chattitels).
async function quickChat({ cfg, apiKey, messages, maxTokens = 60 }) {
  const params = modelParams({ ...cfg, thinking: 'off' });
  const res = await httpFetch(endpoint(cfg, '/chat/completions'), {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ ...params, messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(friendlyError(res.status, await res.text().catch(() => '')));
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

async function testKey({ cfg, apiKey }) {
  let res;
  try {
    res = await httpFetch(endpoint(cfg, '/models'), { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error(`Kan ${endpoint(cfg, '')} niet bereiken: ${describeNetError(e)}. Controleer je internetverbinding, VPN of het API-adres in Instellingen.`);
  }
  if (!res.ok) throw new Error(friendlyError(res.status, await res.text().catch(() => '')));
  const json = await res.json().catch(() => ({}));
  return (json.data || []).map((m) => m.id);
}

module.exports = { streamChat, quickChat, testKey, isDeepSeek };
