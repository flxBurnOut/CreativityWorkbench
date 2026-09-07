export async function GET() {
  try {
    const base = process.env.WORKBENCH_RUNTIME_URL || 'http://127.0.0.1:8791';
    const response = await fetch(base + '/v1/capabilities', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Runtime unavailable');
    return Response.json(await response.json());
  } catch {
    return Response.json({ error: 'Runtime unavailable' }, { status: 503 });
  }
}
