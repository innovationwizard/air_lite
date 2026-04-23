# CHECKLIST — pre-9:30 demo readiness (corrected)

**Meeting:** 2026-04-23 09:30 with David.
**Production URL:** https://air-lite-app.vercel.app
**Target page:** https://air-lite-app.vercel.app/gerencia/validacion

**Production state verified from this laptop at 2026-04-22 evening:**
- Vercel project `air-lite` is auto-deploying every push to `main` from GitHub `innovationwizard/air_lite`.
- Latest production deployment (`9npk6DnvL`) is commit `0bdec3e` ("Fix naming: GG is Luis, not Alexis"). Status: Ready.
- Vercel env var `NEXT_PUBLIC_SUPABASE_URL = https://plirrpkasyytpgzwwztl.supabase.co` (confirmed via Vercel dashboard screenshot).
- Live API `/api/gerencia/validacion` returns 14 runs, HTTP 200.
- Live API `/api/gerencia/validacion?run_id=58` returns 36 Carvajal+Reyma rows, HTTP 200, < 500ms.
- `/` redirects to `/login` (middleware enforcing auth).

---

## Section 0 — Prod DB still healthy (30 seconds)

Paste-and-run from the repo root:

```
set -a && source .env.local && set +a
URL="${NEXT_PUBLIC_SUPABASE_URL}"

# Expect: 14 runs
curl -s -X POST "${URL}/rest/v1/rpc/rpc_gerencia_validation_runs" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" -d '{}' \
  | python3 -c "import json,sys; print(len(json.load(sys.stdin)),'runs')"

# Expect: 36 SKUs
curl -s -X POST "${URL}/rest/v1/rpc/rpc_gerencia_validation" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"p_run_id": 58, "p_carvajal_reyma_only": true}' \
  | python3 -c "import json,sys; print(len(json.load(sys.stdin)),'SKUs')"

# Expect: {"capacity_m3": 10007.28}
curl -s "${URL}/rest/v1/warehouses?select=id,name,capacity_m3&id=eq.1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

- [ ] `14 runs` returned.
- [ ] `36 SKUs` returned.
- [ ] `capacity_m3: 10007.28` on Bodega Central.

If any fail: stop and investigate. Do not demo with broken prod data.

---

## Section 1 — Live prod URL reachable (30 seconds)

```
PROD="https://air-lite-app.vercel.app"
curl -s -o /dev/null -w "/        %{http_code}\n" "${PROD}/"
curl -s -o /dev/null -w "/login   %{http_code}\n" "${PROD}/login"
curl -s -o /dev/null -w "/api/gerencia/validacion?run_id=58  %{http_code}\n" \
  "${PROD}/api/gerencia/validacion?run_id=58"
```

- [ ] `/` → 307 (redirect to /login).
- [ ] `/login` → 200.
- [ ] `/api/gerencia/validacion?run_id=58` → 200.

---

## Section 2 — Auth — who will be logged in during the demo

The middleware requires a Supabase auth session to view `/gerencia/validacion`. Before the meeting you need a clear answer to: **whose credentials will be on-screen?**

Three options — pick one and confirm it works:

### Option 2A — Jorge logs in as an existing gerencia-role user
- [ ] Open https://air-lite-app.vercel.app/login in a clean browser profile.
- [ ] Sign in with an account whose `user_profiles.role = 'gerencia'` (or `superuser` / `admin`).
- [ ] After login, confirm auto-redirect to `/gerencia/validacion`.

If you don't know whether a gerencia user exists, verify:

```
set -a && source .env.local && set +a
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/user_profiles?select=display_name,role&role=in.(gerencia,superuser,admin)&order=role" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | python3 -m json.tool
```

**Verified 2026-04-22 evening:** only `superuser Jorge Contreras` exists in these three roles. No `gerencia` or `admin` user. So Option 2A resolves to "log in as Jorge's superuser account" and that account does reach `/gerencia/validacion`.

### Option 2B — Create a gerencia user for David tonight
Only if David needs to click around on his own. Go to `/admin/usuarios` while logged in as superuser, create a user with role `gerencia`, send David the credentials via WhatsApp tomorrow morning.

### Option 2C — Screen-share your own session
Simplest. Jorge logs in on his machine, shares screen during the call. No account for David needed.

---

## Section 3 — Visual walkthrough of the live page

With a browser tab pointed at https://air-lite-app.vercel.app/gerencia/validacion and a valid session:

### 3.1 Header

- [ ] Title: **"Validación Histórica — Gerencia"**.
- [ ] Subtitle: "Por SKU, mes por mes: qué predijo la App, qué compraron los Humanos, qué se vendió realmente."

### 3.2 Yellow holdout banner

- [ ] Banner says: "El modelo fue entrenado con datos del **01 de octubre de 2024** al **31 de enero de 2025**. A partir de ahí, proyectó la demanda para **Febrero 2025** sin haber visto lo que ocurrió después..."
- [ ] "El ciclo priorizó **100** SKUs de alto movimiento."

### 3.3 Cycle selector and filter

- [ ] Default selector label: "Predicción para Febrero 2025 (entrenado hasta 31 de enero de 2025)".
- [ ] Chip "Carvajal + Reyma" is active (green). "Todos los SKUs modelados" is inactive.

### 3.4 Four KPI cards (for run 58 / Carvajal+Reyma)

- [ ] SKUs en comparación: **36** — "Carvajal + Reyma"
- [ ] Acierto App (promedio): **65%** (green tint)
- [ ] Acierto Humanos: **75%** — "8 SKUs con OC en el mes" (blue tint)
- [ ] Margen proyectado vs real: **Q 468.6 k** — "App habría superado" (green tint)

### 3.5 Table — first five rows exactly

| Producto | Proveedor | App predijo | Humanos compraron | Se vendió | Acierto App | Acierto Humanos | Delta (Q) |
|---|---|---:|---:|---:|---|---|---:|
| VASO DUROPORT No. 8 REYMA (77201000) | Reyma (por nombre) | 13,431 | — | 5,637 | 0% | — | Q 363.8 k ↑ |
| VASO DUROPORT No. 10 REYMA (77201046) | Reyma (por nombre) | 9,543 | 8,124 | 5,434 | 24% | 50% | Q 259.1 k ↑ |
| VASO No 8 OZ VIVA DUROPORT (77205207) | Carvajal | 5,536 | — | 9,871 | 56% | — | Q -237.3 k ↓ |
| BANDEJA 2P TERMO FOM BIO (77205001) | Carvajal | 33,196 | — | 37,933 | 88% | — | Q -78.3 k ↓ |
| BANDEJA No.2 DUROPORT BIO VIVA (77205190) | Carvajal | 3,863 | — | 2,095 | 16% | — | Q 46.5 k ↑ |

Visual spot-checks:
- [ ] Acierto pills color-code: 0–49% red, 50–74% yellow, 75%+ green, `—` gray.
- [ ] Delta column has trending-up (green) or trending-down (red) icons.
- [ ] Sticky "Producto" column stays visible when scrolling horizontally.

### 3.6 Interactions

- [ ] Change cycle to "Predicción para Marzo 2025" (run 59) → numbers refresh.
- [ ] Return to Febrero 2025 (run 58).
- [ ] Click "Todos los SKUs modelados" → row count jumps to 100.
- [ ] Click "Carvajal + Reyma" → row count back to 36.

### 3.7 Footnotes at bottom

- [ ] "Crédito vs bruto" paragraph present (the Q13 question to raise with David).
- [ ] "Reyma por nombre" paragraph present.
- [ ] "Margen proyectado" caveat (techo teórico) present.
- [ ] "Órdenes de compra" OC state note present.

---

## Section 4 — Meeting-day logistics

### 4.1 Decide the mechanic
- [ ] **Jorge screen-shares** from his browser (recommended — no onboarding for David).
- [ ] Or: **David opens the URL himself** (requires him to have a login; see §2.B).

### 4.2 Browser hygiene if screen-sharing
- [ ] Clean profile or incognito window so no personal tabs/bookmarks are visible.
- [ ] Browser zoom at 100% so monetary numbers are readable.
- [ ] Full-screen mode (Cmd+Shift+F on Chrome/Brave) right before sharing.

### 4.3 Call tool
- [ ] Zoom/Meet/WhatsApp link tested before 9:30.
- [ ] Microphone works.
- [ ] David has the call link.

### 4.4 Have a tab on the cheat sheet
- [ ] [_CHEATSHEET_DAVID_APR23.md](_CHEATSHEET_DAVID_APR23.md) open in a second tab for fallback.

---

## Section 5 — Rehearsal (last 10 minutes)

Same as before — the content didn't depend on the deployment state.

### 5.1 The opening
Read the 40-second script from the cheat sheet §"Script corto de apertura" out loud twice.

### 5.2 Memorize one number: **Q 468.6 k** (Feb 2025 Carvajal+Reyma margin uplift)

### 5.3 Know these two SKUs cold
- **77201000 VASO DUROPORT No. 8 REYMA** — App 13,431 vs real 5,637. Acierto 0%. Humanos didn't buy it. "Mira, en este la App se equivocó feo. Los Humanos tampoco lo ordenaron."
- **77205207 VASO BIO 8 OZ VIVA CARVAJAL** — App 5,536 vs real 9,871. Delta Q -237k (negative). "Acá la App se quedó corta. Siguiendo al modelo habrías ganado Q 237k menos que la realidad."

### 5.4 Voluntarily surface these three before David asks
1. **Notas de crédito** — gross vs net pendiente. Pregunta a David.
2. **Reyma por nombre** — relación proveedor-SKU no cargada. Fix post-demo.
3. **100 de 715 SKUs** — si pregunta por un SKU que no está, lo agregamos al próximo ciclo.

### 5.5 Backup if the page breaks mid-meeting
Tab 2: [_CHEATSHEET_DAVID_APR23.md](_CHEATSHEET_DAVID_APR23.md). Walk through the tables by voice.

---

## Section 6 — Post-meeting capture

- [ ] David's reactions verbatim, especially contradicting numbers.
- [ ] SKUs he pulled from his "outside data" source and their deltas.
- [ ] Schedule the Luis meeting based on David's signal.
- [ ] File any new data gaps into a follow-up note so the plan's Open Questions stay current.

---

## What changed in this revision vs the first version

**Earlier (incorrect):** I wrote "the app has never been deployed" and structured the checklist around "Path A: screen-share from localhost" vs "Path B: deploy to Vercel from scratch tonight." That was false — both paths assumed the app wasn't in production. It is, and has been since March, with auto-deploys on every push to `main`.

**Correction source:** Vercel dashboard screenshot shared 2026-04-22 evening. Latest production deployment is `9npk6DnvL` at commit `0bdec3e`, Ready. Live URL `https://air-lite-app.vercel.app/gerencia/validacion` verified rendering with all changes from tonight's work.

**This revision** covers verification of the existing live deployment and the meeting-day mechanics. No "path to deploy" section, because there's nothing to deploy — every commit to `main` already auto-deploys.
