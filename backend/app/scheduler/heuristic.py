from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class SchedulingDecision:
    worker_id: str
    score: float
    features: dict[str, float]


class HeuristicScheduler:
    """Deterministic worker ranker for standard fine-tuning jobs.

    This is intentionally not trained. It uses transparent fit, availability,
    priority, and historical reliability signals to pick a worker.
    """

    def choose_worker(self, job: dict[str, Any], workers: list[dict[str, Any]]) -> SchedulingDecision | None:
        if not workers:
            return None

        decisions = [self._score(job, worker) for worker in workers]
        return max(decisions, key=lambda item: item.score)

    def _score(self, job: dict[str, Any], worker: dict[str, Any]) -> SchedulingDecision:
        report = job.get("training_report", {})
        capabilities = worker.get("capabilities", {})
        vram = float(capabilities.get("vram_gb") or 0)
        required_vram = _required_vram(report)
        vram_fit = min(vram / max(required_vram, 1.0), 2.0) / 2.0
        cuda = 1.0 if capabilities.get("cuda_available") else 0.0
        cpu = 1.0 if capabilities.get("supports_cpu", True) else 0.0
        reliability = float(worker.get("reliability", 0.75))
        priority = float(job.get("priority", 5)) / 10.0
        availability = 1.0 if worker.get("status") == "idle" else 0.4
        mode_bonus = 0.08 if report.get("mode") == "max" and vram >= required_vram else 0.0

        score = (
            0.38 * vram_fit
            + 0.20 * cuda
            + 0.08 * cpu
            + 0.18 * reliability
            + 0.10 * availability
            + 0.06 * priority
            + mode_bonus
        )
        return SchedulingDecision(
            worker_id=worker["id"],
            score=round(score, 4),
            features={
                "vram_fit": round(vram_fit, 4),
                "cuda": cuda,
                "cpu": cpu,
                "reliability": reliability,
                "priority": priority,
                "availability": availability,
                "required_vram": required_vram,
            },
        )


def _required_vram(report: dict[str, Any]) -> float:
    hardware = str(report.get("hardware_requirement", "")).lower()
    if "16gb" in hardware or report.get("mode") == "max":
        return 16.0
    if "8gb" in hardware:
        return 8.0
    for token in hardware.replace(">=", " ").split():
        if token.endswith("gb"):
            try:
                return float(token.removesuffix("gb"))
            except ValueError:
                continue
    return 4.0
