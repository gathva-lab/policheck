import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { sweepStuckSources } from '@/lib/analysis-sweep';
import { maintenanceAuthFailure } from '@/lib/maintenance-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function supabaseAdmin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function POST(request: Request) {
  const authFailure = maintenanceAuthFailure(request);
  if (authFailure) {
    return NextResponse.json(authFailure.body, { status: authFailure.status });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Configuración del servidor incompleta' }, { status: 500 });
  }

  try {
    const recovered = await sweepStuckSources(supabaseAdmin());
    return NextResponse.json({ recovered });
  } catch (error) {
    console.error('[sweep] Error:', error);
    return NextResponse.json({ error: 'No se pudo ejecutar el sweep' }, { status: 500 });
  }
}
