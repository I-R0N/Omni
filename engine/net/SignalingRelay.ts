// ── Signaling relay over ntfy.sh ────────────────────────────────────────────
// Lets two peers exchange WebRTC SDP via a short, human-typable room code
// instead of pasting 2-3 KB base64 blobs by hand.  Uses ntfy.sh (free,
// public, no signup) as a simple HTTP pub-sub broker.  SDP is gzip+base64
// compressed to fit comfortably under ntfy.sh's ~4 KB per-message limit.
//
// Flow:
//   HOST:
//     const relay = new SignalingRelay();
//     const code  = generateRoomCode();                 // e.g. "BLUE"
//     await relay.publishOffer(code, sdpOffer);         // POST to ntfy
//     const sdpAnswer = await relay.waitForAnswer(code);// SSE subscribe
//
//   CLIENT:
//     const relay = new SignalingRelay();
//     const sdpOffer  = await relay.fetchOffer(code);
//     const sdpAnswer = /* create answer from offer */;
//     await relay.publishAnswer(code, sdpAnswer);
//
// Rate limits: ntfy.sh free tier allows ~60 requests/hour per IP, which is
// plenty for a two-message handshake per session.  Topics are public —
// anyone knowing the code can hijack the session — acceptable for a
// prototype, not for production.  Topics are prefixed with "omni-mp-" to
// avoid collisions with other users of the service.

const NTFY_BASE = 'https://ntfy.sh';
// Avoid visually confusable letters (0/O, 1/I/L).  23^4 = ~280k combinations
// — plenty for concurrent sessions without collision.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH   = 4;

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Compress a UTF-8 string with gzip and base64-encode the result.  Uses
// the native CompressionStream API (Safari 15+, Chrome 80+, Firefox 113+).
async function gzipBase64(str: string): Promise<string> {
  const bytes = new TextEncoder().encode(str);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  // btoa() can't take arbitrary Uint8Array directly; chunk to avoid call-stack
  // overflow on large inputs (a few KB is small but stay safe).
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < compressed.length; i += CHUNK) {
    binary += String.fromCharCode(...compressed.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function gunzipBase64(b64: string): Promise<string> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return await new Response(ds.readable).text();
}

export class SignalingRelay {
  private topic(code: string, kind: 'offer' | 'answer'): string {
    return `omni-mp-${code.toLowerCase()}-${kind}`;
  }

  /** Host: publish the SDP offer under the room code. */
  public async publishOffer(code: string, sdp: string): Promise<void> {
    const body = await gzipBase64(sdp);
    const res = await fetch(`${NTFY_BASE}/${this.topic(code, 'offer')}`, {
      method: 'POST',
      body,
    });
    if (!res.ok) {
      throw new Error(`Failed to publish offer (${res.status} ${res.statusText})`);
    }
  }

  /** Client: fetch the latest offer for a room code.  Returns null if no
   *  offer has been published yet. */
  public async fetchOffer(code: string): Promise<string | null> {
    const url = `${NTFY_BASE}/${this.topic(code, 'offer')}/json?poll=1&since=all`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch offer (${res.status} ${res.statusText})`);
    }
    const text = await res.text();
    if (!text.trim()) return null;
    // ntfy returns newline-delimited JSON, one object per published message.
    const lines = text.trim().split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    // Latest message wins — earlier offers from previous sessions are ignored.
    const latest = lines[lines.length - 1];
    let msg: { message?: string; event?: string };
    try {
      msg = JSON.parse(latest);
    } catch {
      return null;
    }
    if (!msg.message) return null;
    return await gunzipBase64(msg.message);
  }

  /** Client: publish the SDP answer under the room code. */
  public async publishAnswer(code: string, sdp: string): Promise<void> {
    const body = await gzipBase64(sdp);
    const res = await fetch(`${NTFY_BASE}/${this.topic(code, 'answer')}`, {
      method: 'POST',
      body,
    });
    if (!res.ok) {
      throw new Error(`Failed to publish answer (${res.status} ${res.statusText})`);
    }
  }

  /** Host: subscribe to the answer topic via SSE, resolve when the answer
   *  arrives, reject on timeout or error.  Returns the decoded SDP. */
  public waitForAnswer(code: string, timeoutMs: number = 180_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const url = `${NTFY_BASE}/${this.topic(code, 'answer')}/sse`;
      let done = false;
      const es = new EventSource(url);
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        es.close();
        reject(new Error('Timed out waiting for answer — did the other device join?'));
      }, timeoutMs);
      es.onmessage = async (evt) => {
        if (done) return;
        try {
          const payload = JSON.parse(evt.data) as { message?: string; event?: string };
          if (!payload.message) return;
          const sdp = await gunzipBase64(payload.message);
          done = true;
          clearTimeout(timer);
          es.close();
          resolve(sdp);
        } catch (e) {
          // Malformed frame — keep listening for the next one.
        }
      };
      es.onerror = () => {
        // EventSource auto-reconnects, so don't give up on first error.
        // The timeout will fire if we never recover.
      };
      // Safety net: if EventSource never connects (network locked down),
      // the caller still has the timeout.
    });
  }
}
