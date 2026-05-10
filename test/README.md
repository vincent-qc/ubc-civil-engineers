# CLOD Computer Use Electron React

A tiny Electron React app that sketches the OpenAI Computer Use loop, but sends model requests to CLOD's OpenAI-compatible API instead of the OpenAI API.

The app uses CLOD Chat Completions at `https://api.clod.io/v1/chat/completions`, captures the full visible macOS desktop, asks the configured model for JSON actions, executes those actions with native CoreGraphics events, captures a fresh screenshot after every action, asks a critic model whether the action succeeded, and repeats until the model reports `done`.

Routes:

- `#/` runs the desktop computer-use loop.
- `#/settings` shows the local environment variables and desktop permission notes.

## Setup

```sh
npm install
export CLOD_API_KEY="your_clod_api_key"
npm start
```

Optional environment variables:

```sh
export CLOD_BASE_URL="https://api.clod.io/v1"
export CLOD_MODEL="GPT 5.4"
export CLOD_CRITIC_MODEL="GPT 5.4"
export CLOD_MAX_TURNS="8"
```

CLOD model names must match the model catalog in your CLOD dashboard. If the catalog uses a different OpenAI 5.4 label, set `CLOD_MODEL` to that exact value before starting Electron. `CLOD_CRITIC_MODEL` is optional and falls back to `CLOD_MODEL`.

## Notes

- The API key is read only by Electron's main process from `CLOD_API_KEY`.
- This is a minimal custom harness because CLOD documents OpenAI-compatible Chat Completions, not OpenAI's Responses API `computer` tool.
- After each action, the app emits the new screenshot and a `critic: TRUE` or `critic: FALSE` activity line.
- Supported action types are `click`, `double_click`, `move`, `scroll`, `type`, `keypress`, `drag`, `wait`, and `screenshot`.
- The target is the full desktop. On macOS, grant Screen Recording and Accessibility permissions to the terminal or app that launches Electron.
