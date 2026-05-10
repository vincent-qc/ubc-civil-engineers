from __future__ import annotations

import argparse
import asyncio
import os
import platform
import socket
from typing import Any

import httpx

from app.training.torch_lora import run_lora_sft


def collect_capabilities(tags: list[str]) -> dict[str, Any]:
    capabilities: dict[str, Any] = {
        "hostname": socket.gethostname(),
        "platform": platform.platform(),
        "cpu_count": os.cpu_count() or 1,
        "memory_gb": None,
        "gpu_name": None,
        "cuda_available": False,
        "vram_gb": None,
        "supports_cpu": True,
        "tags": tags,
    }
    try:
        import torch

        capabilities["cuda_available"] = bool(torch.cuda.is_available())
        if torch.cuda.is_available():
            index = torch.cuda.current_device()
            capabilities["gpu_name"] = torch.cuda.get_device_name(index)
            props = torch.cuda.get_device_properties(index)
            capabilities["vram_gb"] = round(props.total_memory / (1024**3), 2)
    except Exception:
        pass
    return capabilities


async def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local fine-tuning worker.")
    parser.add_argument("--api", default="http://localhost:8000", help="FastAPI base URL")
    parser.add_argument("--name", default=socket.gethostname(), help="Worker display name")
    parser.add_argument("--output", default="./runs", help="Directory for adapters and logs")
    parser.add_argument("--tag", action="append", default=[], help="Worker tag, repeatable")
    parser.add_argument("--poll-seconds", type=float, default=4.0)
    args = parser.parse_args()

    api = args.api.rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        registration = await client.post(
            f"{api}/api/workers/register",
            json={"name": args.name, "capabilities": collect_capabilities(args.tag)},
        )
        registration.raise_for_status()
        worker = registration.json()
        worker_id = worker["id"]
        print(f"Registered worker {worker_id} ({args.name})")

        while True:
            await client.post(
                f"{api}/api/workers/{worker_id}/heartbeat",
                json={"status": "idle", "metrics": {}},
            )
            response = await client.get(f"{api}/api/workers/{worker_id}/next-job")
            response.raise_for_status()
            assignment = response.json()
            job = assignment.get("job")
            if not job:
                await asyncio.sleep(args.poll_seconds)
                continue

            print(f"Starting job {job['id']}")
            await asyncio.to_thread(run_training_job, api, worker_id, job, args.output)


def run_training_job(api: str, worker_id: str, job: dict[str, Any], output: str) -> None:
    with httpx.Client(timeout=30) as client:
        client.post(
            f"{api}/api/workers/{worker_id}/heartbeat",
            json={"status": "running", "current_job_id": job["id"], "metrics": {}},
        )

        def emit(kind: str, message: str, progress: float | None, metrics: dict[str, Any]) -> None:
            client.post(
                f"{api}/api/jobs/{job['id']}/events",
                json={"kind": kind, "message": message, "progress": progress, "metrics": metrics},
            )
            client.post(
                f"{api}/api/workers/{worker_id}/heartbeat",
                json={
                    "status": "running",
                    "current_job_id": job["id"],
                    "metrics": {"progress": progress, **metrics},
                },
            )

        try:
            result = run_lora_sft(job, output, emit)
            client.post(
                f"{api}/api/jobs/{job['id']}/complete",
                json={"status": "completed", **result},
            )
        except Exception as exc:
            client.post(
                f"{api}/api/jobs/{job['id']}/events",
                json={"kind": "error", "message": str(exc), "metrics": {}},
            )
            client.post(
                f"{api}/api/jobs/{job['id']}/complete",
                json={"status": "failed", "error": str(exc)},
            )


if __name__ == "__main__":
    asyncio.run(main())
