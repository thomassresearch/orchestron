from __future__ import annotations

import logging


def configure_logging(debug: bool = False) -> None:
    level = logging.INFO if debug else logging.ERROR
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
