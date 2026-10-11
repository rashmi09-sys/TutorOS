# The tutor's voice: Google Cloud Chirp 3 HD (Sulafat), with the browser voice as fallback

## What is implemented

- **Server:** `POST /api/tts` (`src/app/api/tts/route.ts`, `src/lib/server/tts.ts`) uses the official `@google-cloud/text-to-speech` client (HTTP/1.1 REST transport) to synthesise **MP3** in **`en-US-Chirp3-HD-Sulafat`** (configurable). It is off unless `GOOGLE_TTS_ENABLED=true`.
- **Authentication without keys.** Local development uses Application Default Credentials. On Vercel, Workload Identity Federation is used: Vercel's short-lived OIDC token is exchanged for a short-lived Google token that impersonates a service account. No API key, no service-account key file, nothing in the browser. Credentials are resolved inside the route's own error handling, so missing credentials give a clean `upstream_auth` reply instead of crashing the server.
- **Cost and abuse controls** (all configurable; in memory, per server instance):

  | Control | Default | Over the limit |
  |---|---|---|
  | Opt-in switch `GOOGLE_TTS_ENABLED` | off | 503, no network call |
  | Characters per request | 1,000 | 413 |
  | Characters per day | 100,000 | 429 `daily_budget_exhausted` |
  | Requests per minute per client | 30 | 429 `rate_limited` |
  | Timeout (our own timer around the library) | 8 s | 504 |

  There are no retries. A 100-entry cache means Replay of the same turn costs nothing.
- **Errors**, mapped without returning Google's error text:

  | Problem | Reply |
  |---|---|
  | Google quota exhausted | 429 `upstream_quota` |
  | Credentials missing, wrong, or permission denied | 502 `upstream_auth` |
  | Anything else | 502 `upstream_error` |
  | Timeout | 504 `upstream_timeout` |

  Every refusal carries `fallback: "browser"`. Logs record the category, status code, character count and time; they never record text, credentials or error messages.
- **Client:**
  - **Turning it on:** the page asks `/api/health` once. If it reports the Google voice, the page's single speech controller uses `/api/tts` from then on.
  - **What is spoken:** exactly the tutor message on screen. Maths is spoken as words (`3x + 5 = 20` → "3 x plus 5 equals 20"), and nothing else is added.
  - **Timing:** each turn is spoken once, when it appears — the same moment the whiteboard updates for it.
  - **No overlap:** a new turn cancels the previous one, whether its audio is still downloading or already playing. Sending a line, tapping the mic, Stop, turning sound off or leaving the page all stop it.
  - **No stale audio:** audio that arrives late for an older turn is discarded and never reported as finished.
  - **Loading:** while the audio is being fetched, the status line says "Getting the tutor's voice ready…".
  - **Fallback:** any failure for a turn (error, timeout, autoplay blocked, bad audio) speaks that turn with the browser voice instead. After two failures in a row, the browser voice is used for the rest of the page session.

## What is not implemented

- **Streaming audio:** each turn waits for the whole MP3, usually well under a second for a turn of this length.
- **Interrupting by just speaking:** to interrupt, tap the mic or Stop.
- **Word-by-word sync:** the whiteboard changes per turn, not word by word with the voice. There are no word timestamps, so nothing claims word-level sync.
- **Global limits:** the usage caps are per server instance, not shared across instances.

## Verified here, and not

- **Verified with a fake client** (`tests/tts.test.ts`, 27 tests): request shape, MP3 decoding, all the limits, quota, credential and timeout errors, the cache, no credential details in health output or errors, and the client lifecycle (no overlap, stop never reports "finished", fallback, switching off).
- **Verified against the real library in this sandbox:** the production build loads the library, and with no credentials here `/api/tts` answers `502 upstream_auth` in about 0.5 s while the server keeps running. The federation path, run outside Vercel, also fails cleanly as `upstream_auth`.
- **Not verified here:** real Sulafat audio. This environment has no Google credentials, and outbound calls to Google are blocked. Run the local check below on your machine.

## Local setup (Application Default Credentials)

```bash
gcloud auth application-default login                      # once, as yourself
gcloud auth application-default set-quota-project project-c6fd5340-c2ad-481e-a43
cat >> .env.local <<'ENV'
GOOGLE_TTS_ENABLED=true
GOOGLE_CLOUD_PROJECT=project-c6fd5340-c2ad-481e-a43
ENV
GOOGLE_TTS_ENABLED=true GOOGLE_CLOUD_PROJECT=project-c6fd5340-c2ad-481e-a43 npm run tts:smoke   # writes a short MP3 to your temp folder
npm run dev        # /api/health → voice.provider "google-chirp3-hd", auth "adc"
```

Your user account needs permission to call Text-to-Speech on that project; the owner role does. If the smoke test reports `auth`, re-run the login and check the quota project.

## Production on Vercel: Workload Identity Federation (short-lived credentials)

Your local ADC does **not** exist on Vercel. Don't upload a key file. Instead:

### 1. Create a service account that can only do Text-to-Speech

```bash
PROJECT_ID=project-c6fd5340-c2ad-481e-a43
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud iam service-accounts create tutoros-tts --project=$PROJECT_ID --display-name="TutorOS TTS (Vercel)"
SA=tutoros-tts@$PROJECT_ID.iam.gserviceaccount.com
```

Text-to-Speech has no special role: enabling the API on the project lets any authenticated caller in the project use it, billed to that project. So the service account needs **no project roles at all**. If Google returns a permission error, grant `roles/serviceusage.serviceUsageConsumer` and nothing broader.

### 2. Create a workload identity pool and an OIDC provider that trusts only your Vercel team

```bash
gcloud iam workload-identity-pools create vercel --project=$PROJECT_ID --location=global --display-name="Vercel"
# Issuer: team issuer mode (Vercel → Settings → Security → OIDC Federation). TEAM_SLUG is in your Vercel team URL.
gcloud iam workload-identity-pools providers create-oidc vercel \
  --project=$PROJECT_ID --location=global --workload-identity-pool=vercel \
  --issuer-uri="https://oidc.vercel.com/TEAM_SLUG" \
  --allowed-audiences="https://vercel.com/TEAM_SLUG" \
  --attribute-mapping="google.subject=assertion.sub" \
  --attribute-condition="assertion.sub.startsWith('owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:')"
```

### 3. Let only your production deployments impersonate the service account

```bash
gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT_ID \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/vercel/subject/owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production"
```

Add a second binding with `environment:preview` only if you want the voice on preview deployments.

### 4. Set the Vercel environment variables

Set these in Vercel → Project → Settings → Environment Variables, Production. None is a secret:

```
GOOGLE_TTS_ENABLED=true
GOOGLE_CLOUD_PROJECT=project-c6fd5340-c2ad-481e-a43
GCP_PROJECT_NUMBER=<PROJECT_NUMBER>
GCP_WORKLOAD_IDENTITY_POOL_ID=vercel
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel
GCP_SERVICE_ACCOUNT_EMAIL=tutoros-tts@project-c6fd5340-c2ad-481e-a43.iam.gserviceaccount.com
TTS_MAX_CHARS_PER_DAY=100000        # your own daily cap
```

Also make sure OIDC federation is enabled for the project, with **Team** issuer mode. When the four `GCP_*` variables are present, the route automatically switches from ADC to federation. If the provider was created with Google's "default audience" instead of `--allowed-audiences`, also set `GCP_OIDC_AUDIENCE=https://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel/providers/vercel`.

### 5. Put a hard cap on spending in Google Cloud

The in-app limits are per instance. For a real ceiling:

- Set a **quota** in Google Cloud Console → IAM & Admin → Quotas, filtered to Cloud Text-to-Speech: lower the characters-per-minute limit.
- Set a **billing budget** with email alerts on the project.

### 6. Verify after deploying

- `curl https://<your-domain>/api/health` should show `"voice": {"provider": "google-chirp3-hd", "auth": "vercel-oidc", …}`.
- Play a lesson with sound on.
- If the tutor still sounds like the browser voice, the function logs show `evt: tts` with `result: "auth"`. The usual causes are a wrong team slug in the issuer or condition, the wrong environment in the principal, or OIDC federation not enabled.

Sources: [Vercel: Connect to Google Cloud Platform](https://vercel.com/docs/oidc/gcp) · [Google: Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation) · [Google: Chirp 3 HD voices](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd)
