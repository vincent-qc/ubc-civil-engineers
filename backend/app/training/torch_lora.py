from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

ProgressEmitter = Callable[[str, str, float | None, dict[str, Any]], None]


def run_lora_sft(job: dict[str, Any], output_root: str, emit: ProgressEmitter) -> dict[str, Any]:
    job_id = job["id"]
    report = job["training_report"]
    output_dir = Path(output_root).expanduser().resolve() / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    if os.getenv("USE_REAL_LORA", "false").lower() in {"1", "true", "yes"}:
        try:
            return _run_transformers_peft(job, output_dir, emit)
        except ImportError as exc:
            emit("warning", f"Falling back to toy PyTorch LoRA loop because a dependency is missing: {exc}", None, {})

    return _run_toy_lora(job_id, report, output_dir, emit)


def _run_toy_lora(
    job_id: str,
    report: dict[str, Any],
    output_dir: Path,
    emit: ProgressEmitter,
) -> dict[str, Any]:
    try:
        import torch
        from torch import nn
    except ImportError as exc:  # pragma: no cover - exercised only without torch.
        raise RuntimeError("PyTorch is required for worker training") from exc

    emit("training_started", "Started toy PyTorch LoRA loop.", 0.0, {"mode": report.get("mode")})
    torch.manual_seed(7)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    steps = 40 if report.get("mode") == "short" else 120
    rank = 4
    batch_size = 32
    input_dim = 48
    output_dim = 24

    frozen_base = nn.Linear(input_dim, output_dim, bias=False).to(device)
    for parameter in frozen_base.parameters():
        parameter.requires_grad_(False)

    lora_a = nn.Linear(input_dim, rank, bias=False).to(device)
    lora_b = nn.Linear(rank, output_dim, bias=False).to(device)
    optimizer = torch.optim.AdamW(list(lora_a.parameters()) + list(lora_b.parameters()), lr=0.03)
    target = nn.Linear(input_dim, output_dim, bias=False).to(device)

    final_loss = 0.0
    for step in range(1, steps + 1):
        x = torch.randn(batch_size, input_dim, device=device)
        with torch.no_grad():
            y = target(x)
        prediction = frozen_base(x) + lora_b(lora_a(x))
        loss = torch.nn.functional.mse_loss(prediction, y)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        final_loss = float(loss.detach().cpu().item())

        if step == 1 or step == steps or step % max(1, steps // 10) == 0:
            emit(
                "progress",
                f"Step {step}/{steps}",
                step / steps,
                {"loss": final_loss, "device": device, "rank": rank},
            )

    adapter_path = output_dir / "toy_lora_adapter.pt"
    torch.save(
        {
            "job_id": job_id,
            "goal": report.get("goal"),
            "base_model": report.get("base_model"),
            "lora_a": lora_a.state_dict(),
            "lora_b": lora_b.state_dict(),
        },
        adapter_path,
    )

    metadata_path = output_dir / "adapter_metadata.json"
    metadata_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "training_method": "Toy PyTorch LoRA loop",
                "final_loss": final_loss,
                "device": device,
                "steps": steps,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    emit("training_completed", "Training completed.", 1.0, {"loss": final_loss, "device": device})
    return {
        "adapter_uri": str(adapter_path),
        "metrics": {"loss": final_loss, "steps": steps, "device": device},
        "artifacts": [str(adapter_path), str(metadata_path)],
    }


def _run_transformers_peft(job: dict[str, Any], output_dir: Path, emit: ProgressEmitter) -> dict[str, Any]:
    import torch
    from datasets import Dataset, load_dataset
    from peft import LoraConfig, get_peft_model
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        DataCollatorForLanguageModeling,
        Trainer,
        TrainingArguments,
    )

    report = job["training_report"]
    base_model = report.get("base_model", "Qwen/Qwen3-0.6B")
    emit("training_started", f"Loading {base_model}.", 0.0, {"base_model": base_model})

    tokenizer = AutoTokenizer.from_pretrained(base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
    )
    model = get_peft_model(
        model,
        LoraConfig(
            r=8,
            lora_alpha=16,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
        ),
    )

    dataset_name = job.get("dataset_name")
    if dataset_name:
        dataset = load_dataset(dataset_name, split="train")
    else:
        examples = [
            {"text": f"Instruction: {prompt}\nAnswer: Provide a concise, helpful answer."}
            for prompt in report.get("eval_prompts", [])
        ]
        dataset = Dataset.from_list(examples)

    def tokenize(batch: dict[str, list[str]]) -> dict[str, Any]:
        return tokenizer(batch["text"], truncation=True, max_length=512)

    tokenized = dataset.map(tokenize, batched=True, remove_columns=dataset.column_names)
    epochs = 1 if report.get("mode") == "short" else 3
    training_args = TrainingArguments(
        output_dir=str(output_dir / "trainer"),
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        num_train_epochs=epochs,
        learning_rate=2e-4,
        logging_steps=5,
        save_strategy="no",
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
    )
    trainer.train()
    adapter_dir = output_dir / "adapter"
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    emit("training_completed", "LoRA adapter saved.", 1.0, {"adapter_dir": str(adapter_dir)})
    return {
        "adapter_uri": str(adapter_dir),
        "metrics": {"epochs": epochs, "examples": len(dataset)},
        "artifacts": [str(adapter_dir)],
    }
