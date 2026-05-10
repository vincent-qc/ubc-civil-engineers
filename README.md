# Personal Browser-Use Agent

A local-first browser-use agent that learns one user's browser workflows from demonstrations. The app records browser observations, DOM/accessibility-like nodes, user and agent actions, agent questions, user answers, and takeover actions. After data collection, the FastAPI backend trains a separate PyTorch action policy checkpoint for that user.

## Stack

- Next.js + TypeScript frontend
- FastAPI backend
- MongoDB persistence, with in-memory fallback for local demos
- PyTorch behavioral cloning for per-user browser action policies

## What Is Implemented

- Per-user profiles with isolated model status and checkpoint URI.
- Onboarding task generation for common email, calendar, document, ambiguity, and safety workflows.
- Trajectory recording:
  - `action` events for clicks, typing, scrolling, search, URL opens, waits, stops, and key presses.
  - `ask_user` events when the agent needs clarification.
  - `user_answer` events when the user answers in the app.
  - `control_returned` events when the user takes over and hands control back.
  - `success_state` events for final labels.
- Mongo collections for users, tasks, trajectories, trajectory events, training jobs, and model artifacts.
- Backend training endpoint that gathers only one user's trajectories and writes a unique PyTorch checkpoint under `MODEL_OUTPUT_DIR/{user_id}/{training_job_id}`.
- Prediction endpoint that uses the user's checkpoint when available and falls back to conservative heuristics otherwise.
- Safety gate that marks sensitive actions as requiring confirmation before execution.

## Quick Start

```bash
chmod +x start.sh
./start.sh
```

Open:

- Frontend: `http://localhost:3000`
- Backend docs: `http://localhost:8000/docs`

Manual startup:

```bash
docker compose up -d mongo

python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --reload --app-dir backend
```

In another terminal:

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

## Recording User Questions And Takeovers

When the agent asks a question, the recorder stores it as a normal trajectory event:

```json
{
  "actor": "agent",
  "event_type": "ask_user",
  "question": "Should I search all mail or only the inbox?",
  "action": {
    "type": "ask_user",
    "question": "Should I search all mail or only the inbox?"
  }
}
```

If the user answers in the app, the answer is stored:

```json
{
  "actor": "user",
  "event_type": "user_answer",
  "answer": "All mail"
}
```

If the user takes over the browser, each manual click/type/scroll is recorded as a user `action`, followed by `control_returned`. Those takeover actions become strong supervision for similar states later.

## API Highlights

- `POST /api/users`
- `POST /api/onboarding/tasks`
- `POST /api/trajectories`
- `POST /api/trajectories/{trajectory_id}/events`
- `POST /api/recordings/bulk`
- `POST /api/training/jobs`
- `POST /api/agent/predict`
- `GET /api/events`

## Environment

Copy `.env.example` to `.env` if you want to change defaults.

- `MONGODB_URI`: Mongo connection string.
- `MONGODB_DB`: database name.
- `ALLOW_MEMORY_FALLBACK`: use in-memory storage if Mongo is unavailable.
- `CORS_ORIGINS`: allowed frontend origins.
- `MODEL_OUTPUT_DIR`: where per-user PyTorch checkpoints are written.
- `NEXT_PUBLIC_API_URL`: frontend API base URL.

PyTorch wheels may not be available for the newest Python interpreter on your machine. If `pip install -r backend/requirements.txt` cannot resolve `torch`, run the backend with Python 3.11 or 3.12, for example `PYTHON_BIN=python3.12 ./start.sh`.
