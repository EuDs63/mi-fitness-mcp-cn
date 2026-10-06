"""Authentication helpers for Mi Fitness cloud API."""

import logging
from typing import TYPE_CHECKING

import keyring

from mi_fitness_mcp.security import load_api_key_secret

if TYPE_CHECKING:
    from mi_fitness_mcp.config import Config
    from mi_fitness_mcp.storage import Database

logger = logging.getLogger(__name__)


SERVICE_NAME = "mi-fitness-mcp"
ACCOUNT_NAME = "mi_fitness_auth"


def save_mi_fitness_token(user_id: str, pass_token: str) -> None:
    try:
        keyring.set_password(SERVICE_NAME, f"{ACCOUNT_NAME}_user_id", user_id)
        keyring.set_password(SERVICE_NAME, f"{ACCOUNT_NAME}_pass_token", pass_token)
    except Exception as exc:
        logger.error("Failed to save Mi Fitness credentials: %s", exc)
        raise


def load_mi_fitness_token() -> tuple[str | None, str | None]:
    try:
        user_id = keyring.get_password(SERVICE_NAME, f"{ACCOUNT_NAME}_user_id")
        pass_token = keyring.get_password(SERVICE_NAME, f"{ACCOUNT_NAME}_pass_token")
        return user_id, pass_token
    except Exception as exc:
        logger.error("Failed to load Mi Fitness credentials: %s", exc)
        return None, None


def resolve_mcp_credentials(
    config: "Config", db: "Database", api_key: str | None = None
) -> tuple[str, str, str] | None:
    """Reuse a local Web login without copying its secrets into MCP configuration.

    An explicit issued key selects its account. Otherwise manual setup takes
    precedence, then Web logins are used only when they belong to one account.
    """
    if not api_key and config.mode == "mi_fitness_cloud":
        user_id, pass_token = load_mi_fitness_token()
        if user_id and pass_token:
            return user_id, pass_token, config.region
    with db._get_connection() as conn:
        if not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'api_keys'"
        ).fetchone():
            if api_key:
                raise ValueError("The selected API key is unavailable; sign in through the Web UI.")
            return None
        if api_key:
            rows = conn.execute(
                "SELECT key, user_id, pass_token, region FROM api_keys WHERE key = ? AND revoked = 0",
                (api_key,),
            ).fetchall()
            if not rows:
                raise ValueError("The selected API key is invalid or revoked.")
        else:
            rows = conn.execute(
                "SELECT key, user_id, pass_token, region FROM api_keys WHERE revoked = 0 ORDER BY created_at DESC"
            ).fetchall()
            if len({row["user_id"] for row in rows}) > 1:
                raise ValueError(
                    "Multiple local accounts found; select one using MI_FITNESS_API_KEY."
                )
    for row in rows:
        pass_token = load_api_key_secret(row["key"]) or row["pass_token"]
        if pass_token:
            return row["user_id"], pass_token, row["region"]
    if rows:
        raise ValueError(
            "Saved login credentials are unavailable; sign in through the Web UI again."
        )
    return None


def delete_mi_fitness_token() -> None:
    try:
        keyring.delete_password(SERVICE_NAME, f"{ACCOUNT_NAME}_user_id")
    except keyring.errors.PasswordDeleteError:
        pass
    except Exception as exc:
        logger.error("Failed to delete Mi Fitness user_id: %s", exc)
    try:
        keyring.delete_password(SERVICE_NAME, f"{ACCOUNT_NAME}_pass_token")
    except keyring.errors.PasswordDeleteError:
        pass
    except Exception as exc:
        logger.error("Failed to delete Mi Fitness passToken: %s", exc)
