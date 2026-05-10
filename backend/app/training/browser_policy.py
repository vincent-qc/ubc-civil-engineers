from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any, Callable

ProgressEmitter = Callable[[str, str, float | None, dict[str, Any]], None]

INPUT_DIM = 512
HIDDEN_DIM = 128


def train_user_policy(
    user_id: str,
    trajectories: list[dict[str, Any]],
    events: list[dict[str, Any]],
    output_root: str,
    training_job_id: str,
    epochs: int,
    batch_size: int,
    emit: ProgressEmitter,
) -> dict[str, Any]:
    try:
        import torch
        from torch import nn
    except ImportError as exc:  # pragma: no cover - exercised only without torch.
        raise RuntimeError("PyTorch is required to train the browser action policy") from exc

    examples = _build_examples(trajectories, events)
    if not examples:
        raise ValueError("No trainable action events found for this user")

    labels = sorted({example["label"] for example in examples})
    label_to_idx = {label: index for index, label in enumerate(labels)}
    x_rows = [_vectorize(example["text"]) for example in examples]
    y_rows = [label_to_idx[example["label"]] for example in examples]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    x = torch.tensor(x_rows, dtype=torch.float32, device=device)
    y = torch.tensor(y_rows, dtype=torch.long, device=device)

    torch.manual_seed(13)
    model = nn.Sequential(
        nn.Linear(INPUT_DIM, HIDDEN_DIM),
        nn.ReLU(),
        nn.Dropout(0.1),
        nn.Linear(HIDDEN_DIM, len(labels)),
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.01, weight_decay=0.01)
    loss_fn = nn.CrossEntropyLoss()

    final_loss = 0.0
    emit("training_started", "Started per-user browser action training.", 0.0, {"examples": len(examples), "device": device})
    for epoch in range(1, epochs + 1):
        permutation = torch.randperm(x.shape[0], device=device)
        epoch_loss = 0.0
        batches = 0
        for start in range(0, x.shape[0], batch_size):
            indices = permutation[start : start + batch_size]
            logits = model(x[indices])
            loss = loss_fn(logits, y[indices])
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            epoch_loss += float(loss.detach().cpu().item())
            batches += 1

        final_loss = epoch_loss / max(1, batches)
        if epoch == 1 or epoch == epochs or epoch % max(1, epochs // 5) == 0:
            emit("progress", f"Epoch {epoch}/{epochs}", epoch / epochs, {"loss": final_loss, "device": device})

    artifact_dir = Path(output_root).expanduser().resolve() / user_id / training_job_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = artifact_dir / "browser_policy.pt"
    metadata_path = artifact_dir / "metadata.json"

    torch.save(
        {
            "user_id": user_id,
            "training_job_id": training_job_id,
            "state_dict": model.state_dict(),
            "labels": labels,
            "input_dim": INPUT_DIM,
            "hidden_dim": HIDDEN_DIM,
            "examples": examples,
        },
        checkpoint_path,
    )

    metadata = {
        "user_id": user_id,
        "training_job_id": training_job_id,
        "labels": labels,
        "example_count": len(examples),
        "final_loss": final_loss,
        "device": device,
        "checkpoint_uri": str(checkpoint_path),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    emit("training_completed", "Per-user browser policy checkpoint saved.", 1.0, {"loss": final_loss, "device": device})
    return {
        "artifact_uri": str(checkpoint_path),
        "metadata_uri": str(metadata_path),
        "label_set": labels,
        "example_count": len(examples),
        "metrics": {"loss": final_loss, "device": device, "epochs": epochs},
    }


def predict_action_from_checkpoint(
    checkpoint_uri: str,
    task: str,
    observation: dict[str, Any],
    previous_actions: list[dict[str, Any]],
) -> dict[str, Any]:
    try:
        import torch
        from torch import nn
    except ImportError as exc:  # pragma: no cover - exercised only without torch.
        raise RuntimeError("PyTorch is required to run the browser action policy") from exc

    checkpoint = torch.load(checkpoint_uri, map_location="cpu", weights_only=False)
    labels: list[str] = checkpoint["labels"]
    model = nn.Sequential(
        nn.Linear(int(checkpoint.get("input_dim", INPUT_DIM)), int(checkpoint.get("hidden_dim", HIDDEN_DIM))),
        nn.ReLU(),
        nn.Dropout(0.1),
        nn.Linear(int(checkpoint.get("hidden_dim", HIDDEN_DIM)), len(labels)),
    )
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    text = _request_text(task, observation, previous_actions)
    with torch.no_grad():
        vector = torch.tensor([_vectorize(text)], dtype=torch.float32)
        probabilities = torch.softmax(model(vector), dim=-1)[0]
        best_index = int(torch.argmax(probabilities).item())
        confidence = float(probabilities[best_index].item())

    predicted_type = labels[best_index]
    exemplar = _nearest_exemplar(text, predicted_type, checkpoint.get("examples", []))
    action = dict(exemplar.get("action") or {"type": predicted_type})
    action["type"] = predicted_type
    action["confidence"] = confidence
    return {
        "action": action,
        "confidence": confidence,
        "label": predicted_type,
        "nearest_event_id": exemplar.get("event_id"),
    }


def _build_examples(trajectories: list[dict[str, Any]], events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    trajectory_by_id = {trajectory["id"]: trajectory for trajectory in trajectories}
    ordered_events = sorted(events, key=lambda event: event.get("created_at", ""))
    examples: list[dict[str, Any]] = []
    history_by_trajectory: dict[str, list[dict[str, Any]]] = {}

    for event in ordered_events:
        trajectory = trajectory_by_id.get(event.get("trajectory_id"))
        if not trajectory:
            continue
        trajectory_id = trajectory["id"]
        history = history_by_trajectory.setdefault(trajectory_id, [])
        action = _event_action(event)
        if action is not None:
            text = _example_text(trajectory.get("task", ""), event, history)
            examples.append(
                {
                    "event_id": event.get("id"),
                    "trajectory_id": trajectory_id,
                    "task": trajectory.get("task", ""),
                    "source": trajectory.get("source", "manual"),
                    "actor": event.get("actor"),
                    "label": action["type"],
                    "text": text,
                    "action": action,
                    "answer": event.get("answer"),
                }
            )
        history.append(event)
    return examples


def _event_action(event: dict[str, Any]) -> dict[str, Any] | None:
    if event.get("action"):
        return _sanitize_action(dict(event["action"]))
    if event.get("event_type") == "ask_user" and event.get("question"):
        return {"type": "ask_user", "question": event["question"]}
    return None


def _sanitize_action(action: dict[str, Any]) -> dict[str, Any]:
    redacted = dict(action)
    if redacted.get("text") and _looks_sensitive(redacted):
        redacted["text"] = "<REDACTED_TEXT>"
    return redacted


def _looks_sensitive(action: dict[str, Any]) -> bool:
    haystack = " ".join(str(action.get(key, "")) for key in ["selector", "text", "url", "query"]).lower()
    return any(token in haystack for token in ["password", "passcode", "card", "ssn", "secret", "token"])


def _example_text(task: str, event: dict[str, Any], history: list[dict[str, Any]]) -> str:
    observation = event.get("observation") or {}
    previous = history[-4:]
    return _request_text(
        task,
        observation,
        [item.get("action") for item in previous if item.get("action")],
        extra=[
            str(event.get("question") or ""),
            str(event.get("answer") or ""),
            " ".join(str(item.get("answer") or item.get("question") or "") for item in previous),
        ],
    )


def _request_text(
    task: str,
    observation: dict[str, Any],
    previous_actions: list[dict[str, Any] | None],
    extra: list[str] | None = None,
) -> str:
    nodes = observation.get("dom_nodes") or []
    node_text = " ".join(
        " ".join(
            str(node.get(key) or "")
            for key in ["selector", "role", "name", "text", "tag"]
        )
        for node in nodes[:80]
    )
    actions_text = " ".join(
        " ".join(str(action.get(key) or "") for key in ["type", "selector", "direction", "url", "query", "key"])
        for action in previous_actions
        if action
    )
    parts = [
        task,
        observation.get("url", ""),
        observation.get("title", ""),
        observation.get("visible_text", ""),
        observation.get("focused_selector") or "",
        node_text,
        actions_text,
    ]
    if extra:
        parts.extend(extra)
    return " ".join(parts)


def _vectorize(text: str) -> list[float]:
    vector = [0.0] * INPUT_DIM
    tokens = _tokens(text)
    if not tokens:
        return vector
    for token in tokens:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % INPUT_DIM
        sign = 1.0 if int.from_bytes(digest[4:], "little") % 2 == 0 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


def _nearest_exemplar(text: str, predicted_type: str, examples: list[dict[str, Any]]) -> dict[str, Any]:
    candidates = [example for example in examples if example.get("label") == predicted_type] or examples
    if not candidates:
        return {"action": {"type": predicted_type}}
    query_vector = _vectorize(text)
    return max(candidates, key=lambda example: _dot(query_vector, _vectorize(example.get("text", ""))))


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9_:@./#=-]+", text.lower())
