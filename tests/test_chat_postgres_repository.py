from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from chat.errors import InvalidChatRequest, ThreadNotFound
from chat.repository import PostgresChatRepository


USER_A = "00000000-0000-0000-0000-000000000101"
USER_B = "00000000-0000-0000-0000-000000000102"


@pytest.mark.asyncio
async def test_foreign_thread_is_rejected_before_stale_run_cleanup(monkeypatch):
    repository = PostgresChatRepository()
    pool = AsyncMock()
    thread_id = str(uuid4())
    pool.fetchrow.return_value = {
        "thread_id": UUID(thread_id),
        "user_id": UUID(USER_B),
        "title": "Private",
        "created_at": None,
        "updated_at": None,
    }
    monkeypatch.setattr(repository, "_pool", AsyncMock(return_value=pool))

    with pytest.raises(ThreadNotFound):
        await repository.ensure_thread(thread_id, USER_A)

    pool.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_postgres_message_ids_are_append_only(monkeypatch):
    repository = PostgresChatRepository()
    pool = AsyncMock()
    thread_id = str(uuid4())
    message_id = str(uuid4())
    pool.fetchrow.side_effect = [
        None,
        {
            "id": 1,
            "thread_id": UUID(thread_id),
            "message_id": UUID(message_id),
            "role": "user",
            "content": "Original",
            "metadata": None,
            "created_at": None,
        },
    ]
    monkeypatch.setattr(repository, "_pool", AsyncMock(return_value=pool))

    with pytest.raises(InvalidChatRequest):
        await repository.save_message(
            thread_id,
            USER_A,
            "user",
            "Replacement",
            message_id,
        )

    pool.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_postgres_run_persists_request_fingerprint(monkeypatch):
    repository = PostgresChatRepository()
    pool = AsyncMock()
    thread_id = str(uuid4())
    user_message_id = str(uuid4())
    assistant_message_id = str(uuid4())
    fingerprint = "a" * 64
    pool.fetchrow.side_effect = [
        None,
        {
            "run_id": uuid4(),
            "thread_id": UUID(thread_id),
            "user_id": UUID(USER_A),
            "idempotency_key": "request-1",
            "request_fingerprint": fingerprint,
            "user_message_id": UUID(user_message_id),
            "assistant_message_id": UUID(assistant_message_id),
            "status": "running",
        },
    ]
    monkeypatch.setattr(repository, "_pool", AsyncMock(return_value=pool))

    run, created = await repository.start_run(
        thread_id,
        USER_A,
        "request-1",
        fingerprint,
        user_message_id,
        assistant_message_id,
    )

    assert created is True
    assert run["request_fingerprint"] == fingerprint
    insert_args = pool.fetchrow.await_args_list[1].args
    assert insert_args[5] == fingerprint
