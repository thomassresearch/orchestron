from __future__ import annotations

import logging


def configure_logging(debug: bool = False) -> None:
    level = logging.DEBUG if debug else logging.INFO
    root_logger = logging.getLogger()

    # Uvicorn may install handlers before our app lifespan runs. In that case,
    # basicConfig() is a no-op, so explicitly set levels on the existing logger tree.
    if not root_logger.handlers:
        logging.basicConfig(
            level=level,
            format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        )

    root_logger.setLevel(level)
    logging.getLogger("backend").setLevel(level)
