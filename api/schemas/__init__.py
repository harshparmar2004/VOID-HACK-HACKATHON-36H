"""Pydantic response models. Unknown fields are rejected so a drifting response fails loudly."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
