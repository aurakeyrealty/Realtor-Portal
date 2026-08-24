"""Conversation turns, in a shape no framework owns.

Deliberately not PydanticAI's message type. The wire format between the client
and this service outlives whichever loop is running underneath, and a client
that had to speak `ModelMessage` would be pinned to today's framework.

Text only, no tool calls: replaying a tool result from three turns ago would put
stale prices back in the prompt, which is exactly what the freshness rules
exist to prevent. The model re-reads what it needs.
"""

from enum import StrEnum

from pydantic import BaseModel, Field


class Role(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class Turn(BaseModel):
    role: Role
    content: str = Field(max_length=8000)


# A cap on how much conversation travels with each question. Long enough for the
# refinements a realtor actually makes ("only detached", "under $1.1M", "compare
# the best three"), short enough that the prompt does not grow without bound.
MAX_HISTORY_TURNS = 20
