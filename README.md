# Distributed Fine-Tuning Marketplace

Local-first marketplace for fine-tuning jobs. Users describe a training goal to an
agent, the agent writes a saved `TrainingReport`, and local worker apps run
standard PyTorch LoRA SFT jobs on available consumer compute.

## Stack

- React + TypeScript frontend powered by Vite
- FastAPI backend
- MongoDB for persistent reports, jobs, workers, and events
- PyTorch for standard LoRA fine-tuning
- Nia-compatible dataset search harness
- Generic agent harness with `clod` demo mode and optional Gemini provider

## Local Compute Model

Browsers cannot safely access local GPUs directly, so the web app talks only to
FastAPI. Every compute machine runs a local Python worker:

1. Worker registers its CPU/GPU/VRAM capabilities with the API.
2. Worker heartbeats while idle or training.
3. Backend assigns queued jobs to available workers with a transparent heuristic.
4. Worker runs PyTorch locally and streams progress/events back to the API.
5. Frontend reads live job state through SSE.

This works for one laptop, multiple machines on a LAN, or a public marketplace
behind authenticated API endpoints.

## Quick Start

One-command local startup:

```bash
chmod +x start.sh
./start.sh
```

To also start a local training worker:

```bash
START_WORKER=1 ./start.sh
```

Manual startup:

```bash
docker compose up -d mongo

python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --reload --app-dir backend
```

In another terminal:

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

Register a local worker:

```bash
source .venv/bin/activate
pip install -r backend/requirements-worker.txt
PYTHONPATH=backend python -m app.worker.local_worker --api http://localhost:8000 --name "Local GPU" --output ./runs
```

Open the frontend at `http://localhost:5173`.

## Environment

Copy `.env.example` to `.env` for local development.

- `MONGODB_URI`: Mongo connection string.
- `MONGODB_DB`: database name.
- `AGENT_PROVIDER`: `clod` for local demo mode or `gemini`.
- `GEMINI_API_KEY`: used only when `AGENT_PROVIDER=gemini`.
- `NIA_BASE_URL`: optional Nia-compatible search service URL.
- `USE_REAL_LORA`: set to `true` on a worker to run the Transformers/PEFT path.

By default the worker runs a tiny PyTorch LoRA-style training loop so the full
marketplace flow can be demonstrated without downloading a base model. Set
`USE_REAL_LORA=true` when the machine has the Hugging Face stack, model access,
and enough compute.

## API Highlights

- `POST /api/agent/training-report`: convert chat into a saved training report.
- `POST /api/datasets/search`: search datasets through Nia or demo fallback.
- `POST /api/jobs`: create a training job from a report.
- `GET /api/jobs`: list jobs.
- `POST /api/workers/register`: register a local compute worker.
- `GET /api/workers/{worker_id}/next-job`: worker polling endpoint.
- `GET /api/events`: server-sent event stream for live UI updates.

## Project Layout

```text
backend/
  app/
    agents/        # CLōD/Gemini harness and Nia search client
    scheduler/     # deterministic worker-ranking policy
    training/      # PyTorch LoRA runner
    worker/        # Local compute worker process
frontend/
  src/             # React TypeScript dashboard
```
