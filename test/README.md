# GPT Computer Use Electron React

A tiny Electron React app that runs a desktop computer-use loop through OpenAI's Responses API `computer` tool.

The app captures the full visible macOS desktop, asks the configured GPT CUA model for batched computer actions, executes those actions with native CoreGraphics events, sends the updated screenshot back as `computer_call_output`, and repeats until the model stops calling the computer tool.

Routes:

- `#/` runs the desktop computer-use loop.
- `#/settings` shows the local environment variables and desktop permission notes.

## Setup

```sh
npm install
export OPENAI_API_KEY="your_openai_api_key"
npm start
```

Optional environment variables:

```sh
export CUA_PROVIDER="openai"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export CUA_MODEL="gpt-5.5"
export CUA_MAX_TURNS="8"
export CLOD_API_KEY="your_clod_api_key"
export CLOD_BASE_URL="https://api.clod.io/v1"
export CLOD_MODEL="GPT 5.4"
export CLOD_MAX_TURNS="8"
```

Runs with zero enabled skills route through the legacy CLOD chat-completions loop in `lib/computer-use.cjs`. Runs with one or more enabled skills route through GPT CUA in `lib/gptcua.cjs` so saved skill context is injected into OpenAI's computer tool. Skill suggestion and trajectory analysis always use GPT CUA.

## Notes

- The API key is read only by Electron's main process from `OPENAI_API_KEY`.
- The desktop driver is not sandboxed; it operates the current macOS desktop directly.
- Saved skill analyses are injected into the GPT CUA prompt as in-context guidance, while screenshots and other on-screen content are treated as untrusted.
- After each returned action batch, the app emits the new screenshot.
- Supported action types are `click`, `double_click`, `move`, `scroll`, `type`, `keypress`, `drag`, `wait`, and `screenshot`.
- The target is the full desktop. On macOS, grant Screen Recording and Accessibility permissions to the terminal or app that launches Electron.
