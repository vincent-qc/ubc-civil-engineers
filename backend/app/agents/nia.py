from __future__ import annotations

from app.core.config import settings
from app.models import DatasetResult


class NiaSearchClient:
    async def search(self, query: str, limit: int = 5) -> list[DatasetResult]:
        if settings.nia_base_url:
            try:
                return await self._remote_search(query, limit)
            except Exception:
                return self._demo_results(query, limit, note="Nia service unavailable; showing demo matches.")
        return self._demo_results(query, limit)

    async def _remote_search(self, query: str, limit: int) -> list[DatasetResult]:
        import httpx

        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{settings.nia_base_url.rstrip('/')}/search",
                params={"q": query, "limit": limit},
            )
            response.raise_for_status()
            data = response.json()

        results = data.get("results", data if isinstance(data, list) else [])
        return [
            DatasetResult(
                id=str(item.get("id", item.get("slug", f"nia_{index}"))),
                title=item.get("title", item.get("name", "Untitled dataset")),
                source=item.get("source", "nia"),
                rows=item.get("rows"),
                license=item.get("license"),
                match_reason=item.get("match_reason", "Matched by Nia search."),
                url=item.get("url"),
            )
            for index, item in enumerate(results[:limit])
        ]

    def _demo_results(self, query: str, limit: int, note: str | None = None) -> list[DatasetResult]:
        topics = [
            ("open-instruct-code-debug", "Open instruction/code debugging mix", 185000, "Apache-2.0"),
            ("stack-trace-repair", "Traceback explanation and repair pairs", 42000, "MIT"),
            ("domain-sft-seed", "Domain QA seed instructions", 76000, "CC-BY-4.0"),
            ("writing-feedback-sft", "Writing feedback instruction examples", 98000, "Apache-2.0"),
            ("synthetic-eval-prompts", "Synthetic eval prompt pack", 12000, "CC0-1.0"),
        ]
        results: list[DatasetResult] = []
        for index, (dataset_id, title, rows, license_name) in enumerate(topics[:limit]):
            reason = note or f"Demo Nia match for query: {query}"
            results.append(
                DatasetResult(
                    id=dataset_id,
                    title=title,
                    source="nia-demo",
                    rows=rows,
                    license=license_name,
                    match_reason=reason,
                    url=f"https://datasets.example.local/{dataset_id}",
                )
            )
        return results
