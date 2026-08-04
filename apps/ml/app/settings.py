from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process-wide configuration loaded from env vars."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ml_host: str = "0.0.0.0"
    ml_port: int = 8000

    # Filled in starting Phase 4. Kept here so the schema is locked early.
    database_url: str | None = None
    s3_endpoint: str | None = None
    s3_region: str = "us-east-1"
    s3_bucket: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_force_path_style: bool = True

    # The InsightFace pack name. Switching this in production triggers a
    # full re-embedding job (model_version on face_embeddings).
    insightface_model_pack: str = "buffalo_l"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
