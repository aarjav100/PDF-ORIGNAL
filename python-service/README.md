# Paperflow Dataset Studio — Python microservice

Lovable Cloud runs on Cloudflare Workers and **cannot host Python**. Advanced
preprocessing (SMOTE, scikit-learn encoders, polynomial features, robust
scaling) lives in this small FastAPI service that you deploy yourself.

## Endpoints

| Method | Path         | Body                                                                 |
|--------|--------------|----------------------------------------------------------------------|
| GET    | `/health`    | —                                                                    |
| POST   | `/transform` | `{ "csv": "<csv string>", "steps": [{ "kind": "...", "columns": [...], "options": {...} }] }` |
| POST   | `/augment`   | `{ "csv": "<csv string>", "method": "smote"\|"random_over"\|"random_under", "target": "col" }` |

All POST endpoints require `Authorization: Bearer <PAPERFLOW_PY_TOKEN>`.

Supported `transform` kinds:
`label_encode`, `one_hot_encode`, `standard_scale`, `minmax_scale`,
`robust_scale`, `polynomial_features`, `log_transform`, `binning`,
`variance_threshold`, `correlation_drop`.

## Local development

```bash
cd python-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PAPERFLOW_PY_TOKEN=devtoken
uvicorn main:app --reload --port 8080
```

## Deploy options

### Fly.io
```bash
fly launch --no-deploy
fly secrets set PAPERFLOW_PY_TOKEN=$(openssl rand -hex 32)
fly deploy
```

### Render / Railway
- Connect this folder as a service.
- Build: `pip install -r requirements.txt`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Env: set `PAPERFLOW_PY_TOKEN` to a random secret.

### Docker
```bash
docker build -t paperflow-py .
docker run -p 8080:8080 -e PAPERFLOW_PY_TOKEN=devtoken paperflow-py
```

## Wiring back to Paperflow

Once deployed, add two secrets to Lovable Cloud (Project Settings → Secrets):

- `PAPERFLOW_PY_URL` — e.g. `https://paperflow-py.fly.dev`
- `PAPERFLOW_PY_TOKEN` — the same value you set on the service

Then create a server function in the web app, e.g.
`src/lib/datasetsAdvanced.functions.ts`:

```ts
const res = await fetch(`${process.env.PAPERFLOW_PY_URL}/transform`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.PAPERFLOW_PY_TOKEN}`,
  },
  body: JSON.stringify({ csv, steps }),
});
```

The TypeScript v1 ships with cleaning + analysis built in (drop missing rows,
fill mean/median/mode/constant, drop duplicates, IQR outlier removal/cap, AI
analysis). Use this service for SMOTE, scaling, encoding, polynomial features,
and variance/correlation-based feature selection.
