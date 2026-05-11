<div align="center">
  <img src="gregory-logo.png" alt="Gregory" width="220"/>

  # Gregory

  *An AI agent that learns who you are — through the normal act of using your computer.*
</div>

---

## Inspiration

Every agent demo we'd seen breaks the moment something unexpected happens. This is because the agent has no idea who you are. Your shortcuts, your preferences, your workflow. We wanted to build something that starts dumb and gets smart about you specifically, through the normal act of using your computer.

## What We Built

Gregory is an Electron desktop app wrapping a Computer Use Agent powered by **CLōD**. CLōD is a unified API routing requests across 25+ free LLMs from Anthropic, OpenAI, Google, Meta, and others.

The core loop:

1. **Add a skill** in plain English
2. **Gregory generates a training scenario** — a sequence of on-screen tasks and decision points
3. **You complete it** — labelled trajectories feed a two-stage learning pipeline:

| Stage | Mechanism | Effect |
|---|---|---|
| In-context learning | Distils a skill summary from your trajectory | Gregory can perform the task right away |
| LoRA fine-tuning | Local SFT via low-rank adaptation, $W = W_0 + BA$ | Per-skill adapters that compose without interfering |

Everything — trajectories, adapters, and skill summaries — stays on your machine.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Gregory (Electron)              │
│                                                  │
│   ┌──────────────┐      ┌─────────────────────┐  │
│   │  Skill UI    │─────▶│  Training Scenario  │  │
│   └──────────────┘      │     Generator       │  │
│                          └────────┬────────────┘  │
│                                   │ trajectory    │
│                          ┌────────▼────────────┐  │
│   ┌──────────────┐       │   Learning Pipeline │  │
│   │  CLōD API    │◀─────▶│  in-context + LoRA  │  │
│   │  (25+ LLMs)  │       └─────────────────────┘  │
│   └──────────────┘                                │
└─────────────────────────────────────────────────┘
         All data stays local
```

## Challenges

**Safety.** This project requires broad permissions from the user's computer. By running inside a sandbox, we ensure the user's data stays protected until the AI agent needs control.

**Two-stage consistency.** The in-context summary and the LoRA adapter can disagree. We fixed this by deriving the summary directly from the trajectory, so both are grounded in the same data.

**LoRA fast enough to feel immediate.** With $r = 8$ adapters and a few hundred steps, a fine-tuning pass runs in under two minutes on CPU — fast enough to finish in the background while you keep working.

## What We Learned

In-context learning and fine-tuning are complementary, not competing. In-context gets you to *good enough* immediately; fine-tuning gets you to *reliably correct* over time.

CLōD's dynamic cost routing turned out to be genuinely useful — hundreds of CUA calls over the hackathon at near-zero cost.

## Project Structure

```
.
├── backend/       # CUA + learning pipeline
├── frontend/      # Electron UI
├── extension/     # Browser / OS integration layer
└── test/          # Test harness
```

## Getting Started

```bash
# Install dependencies
npm install

# Run in development
npm run dev
```

---

<div align="center">
  Built at a hackathon &nbsp;·&nbsp; Powered by <strong>CLōD</strong>
</div>
