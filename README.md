This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Variables de entorno requeridas

Copia `.env.example` a `.env.local` y completa los valores:

| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima pública (cliente + SSR) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role` (solo servidor): escrituras internas del pipeline |
| `OPENROUTER_API_KEY` | Clave de OpenRouter para el análisis multi-modelo (solo servidor) |

Ninguna clave se referencia desde el cliente. `NEXT_PUBLIC_*` es pública por diseño; el resto vive en los secretos del deploy (Vercel/Cloudflare).

## Pipeline de análisis IA

`POST /api/analyze` (route handler, sin n8n):

1. Extrae el contenido de la URL (cheerio para artículos; oEmbed + transcripción opcional para YouTube).
2. Cache: si la URL ya existe en `sources`, devuelve el registro sin re-analizar.
3. Rate limit: máx. 5 análisis/día por usuario autenticado (HTTP 429).
4. Consulta el triplete activo de `ai_model_config` (capa `free` primero) y llama a 3 modelos OpenRouter en paralelo con fallback a la capa económica.
5. Consenso FEVER (taxonomía 8 niveles, veracidad 0-100) en `src/lib/consensus.ts`; acuerdo <60% → `requires_review`.
6. Persiste `ai_reports`, `sources.verdict`/`verdict_score` y `ai_cost_log`.

El esquema de BD está versionado en `supabase/migrations/` (idempotente, pensado para Supabase donde existe el schema `auth` con `auth.uid()`/`auth.users`).

## Deploy en Cloudflare Workers

El proyecto usa el adaptador [OpenNext para Cloudflare](https://opennext.js.org/cloudflare) (Workers, no Pages). La configuración vive en `wrangler.jsonc` (`nodejs_compat` + binding `ASSETS`) y `open-next.config.ts`.

```bash
npm run build:cf     # genera .open-next/worker.js y .open-next/assets
npm run preview:cf   # sirve el worker en local con wrangler
npm run deploy:cf    # despliega en Cloudflare (requiere sesión/token)
```

Variables de entorno requeridas en el deploy (secretos de Cloudflare):

| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima pública (cliente + SSR) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role` (solo servidor) |
| `OPENROUTER_API_KEY` | Clave de OpenRouter para el análisis multi-modelo |

Opcionales futuras: `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY`.

Notas de compatibilidad:

- El route handler `src/app/api/analyze/route.ts` mantiene `runtime = 'nodejs'`; OpenNext lo soporta gracias a `nodejs_compat`.
- La optimización de imágenes de Next no corre en Workers: `next.config.ts` usa `images.unoptimized: true`. Si se necesita optimización, usar las transformaciones de imagen de Cloudflare.
- `@opennextjs/cloudflare` está fijado en `1.15.0` porque es la última versión compatible con `next@15.4.10` (versiones posteriores requieren `next >= 15.5.x`).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
