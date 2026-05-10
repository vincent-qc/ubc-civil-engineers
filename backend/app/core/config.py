from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - dotenv is optional during syntax-only checks.
    load_dotenv = None  # type: ignore[assignment]

if load_dotenv is not None:
    load_dotenv()


def _truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _split_csv(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    mongo_uri: str = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongo_db: str = os.getenv("MONGODB_DB", "ft_marketplace")
    allow_memory_fallback: bool = _truthy(os.getenv("ALLOW_MEMORY_FALLBACK"), True)
    agent_provider: str = os.getenv("AGENT_PROVIDER", "clod")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    nia_base_url: str = os.getenv("NIA_BASE_URL", "")
    cors_origins: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "cors_origins",
            _split_csv(
                os.getenv("CORS_ORIGINS"),
                ["http://localhost:5173", "http://127.0.0.1:5173"],
            ),
        )


settings = Settings()
