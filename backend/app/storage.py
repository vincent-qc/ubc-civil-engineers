from __future__ import annotations

import copy
import logging
from typing import Any

from app.core.config import settings

try:
    from motor.motor_asyncio import AsyncIOMotorClient
except Exception:  # pragma: no cover - dependency may be absent in syntax-only checks.
    AsyncIOMotorClient = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

COLLECTIONS = [
    "users",
    "user_skills",
    "skill_sessions",
    "onboarding_tasks",
    "trajectories",
    "trajectory_events",
    "training_jobs",
    "model_artifacts",
]


class MemoryStore:
    def __init__(self) -> None:
        self.collections: dict[str, dict[str, dict[str, Any]]] = {name: {} for name in COLLECTIONS}

    async def connect(self) -> None:
        logger.warning("Using in-memory store. Set MONGODB_URI for persistent MongoDB.")

    async def close(self) -> None:
        return None

    async def insert(self, collection: str, document: dict[str, Any]) -> dict[str, Any]:
        doc = copy.deepcopy(document)
        self.collections[collection][doc["id"]] = doc
        return copy.deepcopy(doc)

    async def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        doc = self.collections[collection].get(doc_id)
        return copy.deepcopy(doc) if doc else None

    async def update(self, collection: str, doc_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        doc = self.collections[collection].get(doc_id)
        if not doc:
            return None
        doc.update(copy.deepcopy(updates))
        return copy.deepcopy(doc)

    async def list(self, collection: str, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        filters = filters or {}
        docs = list(self.collections[collection].values())
        filtered = [doc for doc in docs if _matches(doc, filters)]
        return sorted(copy.deepcopy(filtered), key=lambda item: item.get("created_at", ""), reverse=True)

    async def delete(self, collection: str, doc_id: str) -> None:
        self.collections[collection].pop(doc_id, None)


class MongoStore:
    def __init__(self, uri: str, database: str) -> None:
        if AsyncIOMotorClient is None:
            raise RuntimeError("motor is not installed")
        self.client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=2000)
        self.db = self.client[database]

    async def connect(self) -> None:
        await self.client.admin.command("ping")
        for name in COLLECTIONS:
            await self.db[name].create_index("id", unique=True)
            await self.db[name].create_index("created_at")
        await self.db.users.create_index("model_status")
        await self.db.user_skills.create_index("user_id")
        await self.db.user_skills.create_index("status")
        await self.db.skill_sessions.create_index("user_id")
        await self.db.onboarding_tasks.create_index("user_id")
        await self.db.onboarding_tasks.create_index("skill_id")
        await self.db.trajectories.create_index("user_id")
        await self.db.trajectories.create_index("skill_id")
        await self.db.trajectories.create_index("task_id")
        await self.db.trajectory_events.create_index("trajectory_id")
        await self.db.trajectory_events.create_index("user_id")
        await self.db.training_jobs.create_index("user_id")
        await self.db.training_jobs.create_index("skill_id")
        await self.db.training_jobs.create_index("status")
        await self.db.model_artifacts.create_index("user_id")
        await self.db.model_artifacts.create_index("skill_id")

    async def close(self) -> None:
        self.client.close()

    async def insert(self, collection: str, document: dict[str, Any]) -> dict[str, Any]:
        doc = copy.deepcopy(document)
        await self.db[collection].insert_one(doc)
        return _clean_mongo(doc)

    async def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        doc = await self.db[collection].find_one({"id": doc_id})
        return _clean_mongo(doc) if doc else None

    async def update(self, collection: str, doc_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        await self.db[collection].update_one({"id": doc_id}, {"$set": copy.deepcopy(updates)})
        return await self.get(collection, doc_id)

    async def list(self, collection: str, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        cursor = self.db[collection].find(filters or {}).sort("created_at", -1)
        return [_clean_mongo(doc) async for doc in cursor]

    async def delete(self, collection: str, doc_id: str) -> None:
        await self.db[collection].delete_one({"id": doc_id})


async def create_store() -> MemoryStore | MongoStore:
    if settings.mongo_uri.startswith("memory://"):
        store: MemoryStore | MongoStore = MemoryStore()
        await store.connect()
        return store

    try:
        store = MongoStore(settings.mongo_uri, settings.mongo_db)
        await store.connect()
        logger.info("Connected to MongoDB at %s", settings.mongo_uri)
        return store
    except Exception as exc:
        if not settings.allow_memory_fallback:
            raise
        logger.warning("MongoDB unavailable; falling back to in-memory store: %s", exc)
        fallback = MemoryStore()
        await fallback.connect()
        return fallback


def _matches(document: dict[str, Any], filters: dict[str, Any]) -> bool:
    for key, expected in filters.items():
        if document.get(key) != expected:
            return False
    return True


def _clean_mongo(document: dict[str, Any]) -> dict[str, Any]:
    doc = copy.deepcopy(document)
    doc.pop("_id", None)
    return doc
